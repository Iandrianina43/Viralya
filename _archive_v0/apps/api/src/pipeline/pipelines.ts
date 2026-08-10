import type { ContentType, JobType, RatioClass } from "@viralya/shared";
import { enqueue, type JobRow } from "../queue/queue";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Définition des chaînes de jobs par type de contenu.
// Chaque chaîne s'arrête à 'assemble' → statut needs_review (revue humaine).
// 'schedule' est enfilé séparément après approbation humaine.
// ─────────────────────────────────────────────────────────────
export const PIPELINES: Record<ContentType, JobType[]> = {
  // Vidéo : voix native HeyGen (TTS) → pas d'étape generate_voice.
  video: ["generate_text", "generate_video", "poll_video", "assemble"],
  hook: ["generate_text", "assemble"],
  tweet: ["generate_text", "assemble"],
  story: ["generate_text", "generate_image", "assemble"],
  carousel: ["generate_text", "generate_image", "assemble"],
  email: ["generate_text", "assemble"],
};

export interface ContentItemRow {
  id: string;
  avatar_id: string;
  type: ContentType;
  network: string;
  ratio_class: RatioClass;
  status: string;
  // payload/assets sont des jsonb libres côté runtime.
  payload: Record<string, any>;
  assets: Record<string, any>;
  scheduled_at: string | null;
}

export function requireContentItemId(job: JobRow): string {
  if (!job.content_item_id) throw new Error(`${job.type}: content_item_id manquant`);
  return job.content_item_id;
}

export async function loadContentItem(id: string): Promise<ContentItemRow> {
  const { data, error } = await supabase.from("content_items").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`content_item ${id} introuvable: ${error?.message ?? ""}`);
  return data as ContentItemRow;
}

export async function patchContentItem(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("content_items").update(patch).eq("id", id);
  if (error) throw new Error(`patch content_item failed: ${error.message}`);
}

export async function mergePayload(id: string, patch: Record<string, unknown>): Promise<void> {
  const item = await loadContentItem(id);
  await patchContentItem(id, { payload: { ...item.payload, ...patch } });
}

export async function mergeAssets(id: string, patch: Record<string, unknown>): Promise<void> {
  const item = await loadContentItem(id);
  await patchContentItem(id, { assets: { ...item.assets, ...patch } });
}

/** Enfile l'étape suivante de la chaîne du content_item courant. */
export async function advance(job: JobRow, opts: { runAfterMs?: number } = {}): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  const pipe = PIPELINES[item.type];
  const idx = pipe.indexOf(job.type);
  const next = pipe[idx + 1];
  if (!next) return; // chaîne terminée
  await enqueue(next, { ...job.payload }, { contentItemId: id, runAfterMs: opts.runAfterMs });
}
