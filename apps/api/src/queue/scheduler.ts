import { hostname } from "node:os";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// TÂCHES PÉRIODIQUES DU WORKER (7 sept. 2026) — sans pg_cron :
//  - battement de cœur dans system_status (supervision via /health) ;
//  - pilote automatique du calendrier (content_plans.auto_produce) au plus toutes les 30 min,
//    avec un verrou optimiste pour que prod et local (même base) ne produisent pas deux fois.
// ─────────────────────────────────────────────────────────────

export const HEARTBEAT_KEY = "worker";
const AUTO_KEY = "calendar_auto";
const AUTO_EVERY_MS = 30 * 60_000;

export async function heartbeat(workerId: string): Promise<void> {
  const { error } = await supabase
    .from("system_status")
    .upsert({ key: HEARTBEAT_KEY, value: { worker_id: workerId, host: hostname(), pid: process.pid }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error && !/system_status/.test(error.message)) logger.warn("heartbeat_failed", { err: error.message });
}

/** Verrou : vrai si cette instance obtient le droit de lancer la tâche (dernier passage > intervalle). */
async function claimTask(key: string, everyMs: number, workerId: string): Promise<boolean> {
  const now = new Date();
  const { data: row, error } = await supabase.from("system_status").select("updated_at").eq("key", key).maybeSingle();
  if (error) return false; // table absente (migration 0017 non appliquée) : on ne fait rien
  if (!row) {
    const { error: ins } = await supabase.from("system_status").insert({ key, value: { worker_id: workerId }, updated_at: now.toISOString() });
    return !ins;
  }
  if (now.getTime() - new Date(row.updated_at).getTime() < everyMs) return false;
  const { data: upd } = await supabase
    .from("system_status")
    .update({ value: { worker_id: workerId }, updated_at: now.toISOString() })
    .eq("key", key)
    .eq("updated_at", row.updated_at)
    .select("key");
  return !!upd?.length;
}

export async function schedulerTick(workerId: string): Promise<void> {
  await heartbeat(workerId);
  if (await claimTask(AUTO_KEY, AUTO_EVERY_MS, workerId)) {
    try {
      const { produceDueEntries } = await import("../domain/calendar");
      const n = await produceDueEntries();
      if (n) logger.info("calendar_auto_produced", { entries: n });
    } catch (err) {
      logger.warn("calendar_auto_failed", { err: String((err as Error)?.message ?? err) });
    }
  }
}
