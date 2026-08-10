import type { JobType } from "@viralya/shared";
import { supabase } from "../supabase";

// Représentation runtime d'une ligne de la table `jobs`.
export interface JobRow {
  id: string;
  type: JobType;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  error: string | null;
  content_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueOpts {
  runAfterMs?: number;
  contentItemId?: string | null;
  maxAttempts?: number;
}

/** Enfile un job. */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOpts = {},
): Promise<JobRow> {
  const run_after = new Date(Date.now() + (opts.runAfterMs ?? 0)).toISOString();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type,
      payload,
      run_after,
      content_item_id: opts.contentItemId ?? null,
      ...(opts.maxAttempts ? { max_attempts: opts.maxAttempts } : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return data as JobRow;
}

/** Claim atomique d'un lot de jobs prêts (via RPC claim_jobs / SKIP LOCKED). */
export async function claimJobs(worker: string, limit: number): Promise<JobRow[]> {
  const { data, error } = await supabase.rpc("claim_jobs", { p_worker: worker, p_limit: limit });
  if (error) throw new Error(`claim_jobs failed: ${error.message}`);
  return (data ?? []) as JobRow[];
}

/** Marque un job terminé. */
export async function completeJob(id: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ status: "done", locked_at: null, locked_by: null, error: null })
    .eq("id", id);
  if (error) throw new Error(`completeJob failed: ${error.message}`);
}

/**
 * Gère l'échec d'un job : retry avec backoff exponentiel tant que
 * attempts < max_attempts, sinon marque failed. Retourne true si un retry est prévu.
 */
export async function failJob(job: JobRow, err: unknown): Promise<boolean> {
  const message = String((err as Error)?.message ?? err).slice(0, 1000);
  const willRetry = job.attempts < job.max_attempts;

  if (willRetry) {
    // attempts a déjà été incrémenté par claim_jobs.
    const backoffMs = Math.min(30_000 * 2 ** (job.attempts - 1), 3_600_000);
    const { error } = await supabase
      .from("jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        error: message,
        run_after: new Date(Date.now() + backoffMs).toISOString(),
      })
      .eq("id", job.id);
    if (error) throw new Error(`failJob(retry) failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("jobs")
      .update({ status: "failed", locked_at: null, locked_by: null, error: message })
      .eq("id", job.id);
    if (error) throw new Error(`failJob(final) failed: ${error.message}`);
    // Marque le content_item associé en échec pour visibilité dashboard.
    if (job.content_item_id) {
      await supabase
        .from("content_items")
        .update({ status: "failed", error: message })
        .eq("id", job.content_item_id);
    }
  }
  return willRetry;
}
