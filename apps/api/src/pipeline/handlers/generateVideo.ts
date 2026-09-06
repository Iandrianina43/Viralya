import { buildSegmentPrompt, VLOG_PRESETS, type VlogScene } from "../../domain/director";
import { logger } from "../../logger";
import {
  clampDuration,
  DEFAULT_SEEDANCE_MODEL,
  DEFAULT_SEEDANCE_RESOLUTION,
  estimateProductionCost,
  isSeedanceModel,
  clampResolution,
  piapiConfigured,
  submitSeedanceSegment,
  type SeedanceResolution,
  type SeedanceTaskType,
} from "../../providers/piapi";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// GÉNÉRATION VIDÉO — Seedance 2.0 via PiAPI, en PLAN-SÉQUENCE :
// chaque scène = un segment (4-15 s) ; le segment N+1 prolonge le N
// (extension vidéo : les 4 dernières secondes passées en @video1).
// L'identité vient du portrait + character sheet (@image1/@image2),
// la voix des 2 échantillons de timbre (@audio1/@audio2).
// Ce handler soumet le SEGMENT 1 ; poll_video déroule la chaîne.
// ─────────────────────────────────────────────────────────────

export interface SegmentState {
  idx: number;
  phase: "waiting" | "video" | "done" | "failed";
  titre: string;
  duration: number;
  task_id?: string;
  clip_url?: string;
  /** Prompt final réellement envoyé à Seedance (archivé pour la salle de production). */
  prompt?: string;
  error?: string;
  submit_attempts?: number;
}

export interface SeedanceSettings {
  taskType: SeedanceTaskType;
  resolution: SeedanceResolution;
}

export function readSeedanceSettings(payload: Record<string, unknown>): SeedanceSettings {
  const taskType = isSeedanceModel(payload.video_model) ? payload.video_model : DEFAULT_SEEDANCE_MODEL;
  const resolution = clampResolution(taskType, String(payload.resolution ?? DEFAULT_SEEDANCE_RESOLUTION));
  return { taskType, resolution };
}

/** Références d'identité + voix d'un avatar, prêtes pour Seedance. */
export interface AvatarRefs {
  imageUrls: string[];
  audioUrls: string[];
  hasSheet: boolean;
  hasVoice: boolean;
  city: string | null;
  niche: string | null;
}

export async function loadAvatarRefs(avatarId: string): Promise<AvatarRefs> {
  const { data: avatar } = await supabase
    .from("avatars")
    .select("ref_image_url, character_sheet_url, voice_sample_urls, niche, city")
    .eq("id", avatarId)
    .single();
  if (!avatar?.ref_image_url) throw new Error("L'avatar n'a pas de portrait — génère son portrait d'abord.");
  const sheet = avatar.character_sheet_url as string | null;
  const samples = (Array.isArray(avatar.voice_sample_urls) ? avatar.voice_sample_urls : []).filter(Boolean) as string[];
  return {
    imageUrls: [avatar.ref_image_url, ...(sheet ? [sheet] : [])],
    audioUrls: samples.slice(0, 2),
    hasSheet: !!sheet,
    hasVoice: samples.length > 0,
    city: avatar.city ?? null,
    niche: avatar.niche ?? null,
  };
}

export async function generateVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") {
    logger.info("generate_video_canceled", { itemId: id });
    return;
  }
  if (!piapiConfigured()) throw new Error("PiAPI non configuré (PIAPI_API_KEY manquante).");

  const refs = await loadAvatarRefs(item.avatar_id);
  const settings = readSeedanceSettings(item.payload);

  // Scènes de la production (réalisateur IA), sinon clip unique (preset / vidéo du jour).
  const production = item.payload.production as { scenes?: VlogScene[] } | undefined;
  const scenes: VlogScene[] = production?.scenes?.length
    ? production.scenes
    : [singleClipScene(item.payload)];

  // Décors : description canonique + IMAGE DE RÉFÉRENCE de chaque lieu (passée en @image à Seedance).
  const { data: locRows } = await supabase
    .from("avatar_locations")
    .select("key, description, ref_image_url")
    .eq("avatar_id", item.avatar_id);
  const locations = new Map(
    (locRows ?? []).map((l) => [l.key as string, { description: String(l.description ?? ""), image: (l.ref_image_url as string) || null }]),
  );

  const segments: SegmentState[] = scenes.map((sc, i) => ({
    idx: i,
    phase: "waiting",
    titre: sc.titre ?? `Segment ${i + 1}`,
    duration: clampDuration(sc.duration_sec),
  }));

  const estimate = estimateProductionCost(settings.taskType, settings.resolution, segments.map((s) => s.duration));

  // Soumission du 1er segment (les suivants s'enchaînent dans poll_video).
  const loc0 = scenes[0]!.location_key ? locations.get(scenes[0]!.location_key) : undefined;
  const firstPrompt = buildSegmentPrompt({
    scene: scenes[0]!,
    isFirst: true,
    refs: { hasSheet: refs.hasSheet, hasLocationImage: !!loc0?.image, voiceRefs: refs.audioUrls.length },
    locationDescription: loc0?.description ?? null,
    city: refs.city,
  });
  const taskId = await submitSeedanceSegment({
    prompt: firstPrompt,
    imageUrls: [...refs.imageUrls, ...(loc0?.image ? [loc0.image] : [])],
    audioUrls: refs.audioUrls,
    duration: segments[0]!.duration,
    resolution: settings.resolution,
    taskType: settings.taskType,
  });
  segments[0]!.phase = "video";
  segments[0]!.task_id = taskId;
  segments[0]!.prompt = firstPrompt;

  await mergeAssets(id, {
    video_provider: "piapi",
    seedance: { video_model: settings.taskType, resolution: settings.resolution },
    estimated_cost_usd: estimate.total,
    segments,
    scenes_prompts: scenes.map((sc) => ({ location_key: sc.location_key ?? null })),
    log: [
      {
        t: new Date().toISOString(),
        msg: `🎬 Tournage lancé — ${segments.length} segment(s), ~${estimate.total.toFixed(2)} $ (${settings.taskType} ${settings.resolution})`,
      },
    ],
  });
  logger.info("seedance_production_started", { itemId: id, segments: segments.length, estimate: estimate.total });
  await advance(job, { runAfterMs: 15_000 });
}

/** Fabrique la scène unique d'un clip rapide (preset ou vidéo du jour). */
function singleClipScene(payload: Record<string, any>): VlogScene {
  const presetKey = String(payload.preset ?? "");
  const preset = VLOG_PRESETS[presetKey];
  const hint = preset?.scene ?? String(payload.scene_hint ?? payload.theme ?? "candid lifestyle moment");
  const script = String(payload.script ?? "").trim();
  return {
    titre: preset?.label ?? String(payload.theme ?? "Clip"),
    mode: script ? "talk" : "voiceover",
    texte: script.slice(0, 220),
    duration_sec: clampDuration(Number(payload.duration_sec) || 15),
    action: `${hint}, natural authentic gestures`,
    shots: [],
    scene_desc: "",
    camera: "medium-wide shot framed from head to waist with the surroundings clearly visible, natural handheld camera movement",
    lighting: "natural light, photorealistic cinematic vlog style",
    audio_ambiance: "natural ambient sound of the location",
    constraints: "",
  };
}
