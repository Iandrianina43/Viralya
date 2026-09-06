import type { JobType } from "@viralya/shared";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// File de jobs maison (table `jobs`, Supabase).
//  - claim atomique via claim_jobs_v2 (SKIP LOCKED)
//  - retry exponentiel, progression + journal par job, annulation coopérative,
//    battement de cœur (heartbeat) pour la reprise des jobs orphelins.
// ─────────────────────────────────────────────────────────────

export interface JobLogEntry {
  t: string;
  msg: string;
}

export interface JobRow {
  id: string;
  type: JobType;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  content_item_id: string | null;
  avatar_id: string | null;
  label: string | null;
  progress: number;
  logs: JobLogEntry[];
  cancel_requested: boolean;
  run_after: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueOpts {
  runAfterMs?: number;
  contentItemId?: string | null;
  avatarId?: string | null;
  label?: string | null;
  /** Nombre d'essais (défaut : 5 en base). 1 pour les actions non idempotentes (publication réelle). */
  maxAttempts?: number;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOpts = {}): Promise<JobRow> {
  const run_after = new Date(Date.now() + (opts.runAfterMs ?? 0)).toISOString();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type,
      payload,
      run_after,
      content_item_id: opts.contentItemId ?? null,
      avatar_id: opts.avatarId ?? (typeof payload.avatar_id === "string" ? payload.avatar_id : null),
      label: opts.label ?? null,
      ...(opts.maxAttempts ? { max_attempts: opts.maxAttempts } : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return normalize(data as Record<string, unknown>);
}

export async function claimJobs(worker: string, limit: number): Promise<JobRow[]> {
  // claim_jobs_v2 : l'ancienne claim_jobs a été neutralisée (migration 0011) pour
  // écarter le worker de l'ancien déploiement qui partage cette base.
  const { data, error } = await supabase.rpc("claim_jobs_v2", { p_worker: worker, p_limit: limit });
  if (error) throw new Error(`claim_jobs_v2 failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(normalize);
}

export async function completeJob(id: string): Promise<void> {
  await supabase.from("jobs").update({ status: "done", progress: 100, locked_at: null, locked_by: null, error: null }).eq("id", id);
}

/** Retry avec backoff exponentiel tant que attempts < max_attempts, sinon failed. */
export async function failJob(job: JobRow, err: unknown): Promise<boolean> {
  const message = String((err as Error)?.message ?? err).slice(0, 1000);
  const willRetry = job.attempts < job.max_attempts;
  if (willRetry) {
    const backoff = Math.min(30_000 * 2 ** (job.attempts - 1), 3_600_000);
    await supabase
      .from("jobs")
      .update({ status: "pending", locked_at: null, locked_by: null, error: message, run_after: new Date(Date.now() + backoff).toISOString() })
      .eq("id", job.id);
  } else {
    await supabase.from("jobs").update({ status: "failed", locked_at: null, locked_by: null, error: message }).eq("id", job.id);
    if (job.content_item_id) {
      await supabase.from("content_items").update({ status: "failed", error: message }).eq("id", job.content_item_id);
      // Registre des dépenses : seul ce qui a réellement été rendu reste compté (0 si rien).
      void (async () => {
        const { data } = await supabase.from("content_items").select("assets").eq("id", job.content_item_id).maybeSingle();
        const actual = Number((data?.assets as Record<string, unknown> | null)?.estimated_cost_usd ?? 0);
        const m = await import("../domain/billing");
        await m.settleUsage(String(job.content_item_id), Number.isFinite(actual) ? actual : 0);
      })().catch(() => {});
      // E-mail d'échec aux membres de l'organisation (jamais bloquant).
      void import("../domain/notifications").then((m) => m.notifyContentStatus(String(job.content_item_id), "failed")).catch(() => {});
    }
  }
  return willRetry;
}

export async function markCanceled(id: string): Promise<void> {
  await supabase.from("jobs").update({ status: "canceled", locked_at: null, locked_by: null }).eq("id", id);
}

/** Battement de cœur d'un job en cours (reprise automatique si silence > 5 min). */
export async function heartbeat(id: string): Promise<void> {
  await supabase.from("jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", id);
}

/** Journal + progression d'un job (visibles dans le Task Center). */
export async function jobLog(job: JobRow, msg: string, progress?: number): Promise<void> {
  job.logs = [...(job.logs ?? []), { t: new Date().toISOString(), msg: msg.slice(0, 300) }].slice(-50);
  if (typeof progress === "number") job.progress = Math.max(0, Math.min(100, Math.round(progress)));
  await supabase.from("jobs").update({ logs: job.logs, progress: job.progress }).eq("id", job.id);
}

/**
 * Annulation coopérative des jobs d'un contenu : ceux en attente sont annulés
 * tout de suite ; ceux en cours voient `cancel_requested` et s'arrêtent à leur
 * prochaine étape (les handlers vérifient aussi le statut du contenu).
 */
export async function requestCancel(contentItemId: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({ status: "canceled", cancel_requested: true, locked_at: null, locked_by: null })
    .eq("content_item_id", contentItemId)
    .eq("status", "pending");
  await supabase.from("jobs").update({ cancel_requested: true }).eq("content_item_id", contentItemId).eq("status", "running");
}

/** Relance un job échoué depuis zéro (compteur d'essais remis). */
export async function retryJob(id: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({ status: "pending", attempts: 0, error: null, progress: 0, cancel_requested: false, run_after: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["failed", "canceled"]); // jamais un job en cours (double exécution payante)
}

/** Remet en file les jobs orphelins (worker mort). Renvoie le nombre repris. */
export async function reapStaleJobs(staleSeconds = 300): Promise<number> {
  const { data, error } = await supabase.rpc("reap_stale_jobs", { p_stale_seconds: staleSeconds });
  if (error) throw new Error(`reap_stale_jobs failed: ${error.message}`);
  return Number(data ?? 0);
}

function normalize(row: Record<string, unknown>): JobRow {
  return {
    ...(row as unknown as JobRow),
    logs: Array.isArray(row.logs) ? (row.logs as JobLogEntry[]) : [],
    progress: Number(row.progress ?? 0),
    cancel_requested: Boolean(row.cancel_requested),
    avatar_id: (row.avatar_id as string | null) ?? null,
    label: (row.label as string | null) ?? null,
  };
}
