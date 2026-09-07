import type { ContentType, JobType, RatioClass } from "@viralya/shared";
import { enqueue, type JobRow } from "../queue/queue";
import { supabase } from "../supabase";

// Chaînes de jobs par type. S'arrêtent à 'assemble' → needs_review (revue humaine).
// 'schedule' est enfilé après approbation.
export const PIPELINES: Record<ContentType, JobType[]> = {
  video: ["generate_text", "generate_video", "poll_video", "assemble"],
  hook: ["generate_text", "assemble"],
  tweet: ["generate_text", "assemble"],
  story: ["generate_text", "generate_image", "assemble"],
  carousel: ["generate_text", "generate_image", "assemble"],
  // Photo de l'influenceur : légende (texte) → image multi-référence + QC visage → revue.
  photo: ["generate_text", "generate_photo", "assemble"],
};

// Vidéo v2 hybride (payload.format = "hybrid") : voix ElevenLabs → plans → suivi + montage → revue.
export const HYBRID_PIPELINE: JobType[] = ["generate_text", "generate_voice", "generate_shots", "poll_shots", "assemble"];

export function pipelineFor(item: Pick<ContentItemRow, "type" | "payload">): JobType[] {
  if (item.type === "video" && item.payload?.format === "hybrid") return HYBRID_PIPELINE;
  return PIPELINES[item.type];
}

export interface ContentItemRow {
  id: string;
  avatar_id: string;
  type: ContentType;
  network: string;
  ratio_class: RatioClass;
  status: string;
  payload: Record<string, any>;
  assets: Record<string, any>;
  title?: string | null;
  current_version?: number;
  ai_label?: boolean;
  publish_provider?: string | null;
  external_post_id?: string | null;
  external_url?: string | null;
  stats?: Record<string, any>;
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

export async function patchContentItem(id: string, patch: Record<string, unknown>): Promise<void> {
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
  const pipe = pipelineFor(item);
  const next = pipe[pipe.indexOf(job.type) + 1];
  if (!next) return;
  await enqueue(next, { ...job.payload }, {
    contentItemId: id,
    runAfterMs: opts.runAfterMs,
    avatarId: job.avatar_id ?? item.avatar_id,
    label: job.label ?? item.title ?? null,
  });
}
