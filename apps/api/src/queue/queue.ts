import type { JobType } from "@viralya/shared";
import { supabase } from "../supabase";

export interface JobRow {
  id: string;
  type: JobType;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  content_item_id: string | null;
}

export interface EnqueueOpts {
  runAfterMs?: number;
  contentItemId?: string | null;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOpts = {}): Promise<JobRow> {
  const run_after = new Date(Date.now() + (opts.runAfterMs ?? 0)).toISOString();
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type, payload, run_after, content_item_id: opts.contentItemId ?? null })
    .select("*")
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return data as JobRow;
}

export async function claimJobs(worker: string, limit: number): Promise<JobRow[]> {
  const { data, error } = await supabase.rpc("claim_jobs", { p_worker: worker, p_limit: limit });
  if (error) throw new Error(`claim_jobs failed: ${error.message}`);
  return (data ?? []) as JobRow[];
}

export async function completeJob(id: string): Promise<void> {
  await supabase.from("jobs").update({ status: "done", locked_at: null, locked_by: null, error: null }).eq("id", id);
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
    }
  }
  return willRetry;
}
