import type { VideoProviderName, VideoScene } from "@viralya/shared";
import { logger } from "../../logger";
import { buildScenePrompt, higgsfieldConfigured, submitSoulKeyframe, VLOG_PRESETS } from "../../providers/higgsfield";
import { getVideoProvider, resolveVoiceId } from "../../providers/video";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// Soumet la vidéo au moteur de l'avatar :
//  - higgsfield → vlog CINÉMATIQUE (Soul keyframe → image2video), perso cohérent en scène ;
//  - heygen/argil → talking-head (script + voix).
export async function generateVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed") {
    logger.info("generate_video_canceled", { itemId: id });
    return;
  }

  const { data: avatar } = await supabase
    .from("avatars")
    .select("video_provider, video_avatar_id, voice_id, ref_image_url, ref_angles, niche, city")
    .eq("id", item.avatar_id)
    .single();
  const providerName = (avatar?.video_provider ?? "stub") as VideoProviderName;

  // MOTEUR VLOG COMPLET : une production écrite par le réalisateur IA (multi-scènes).
  // Les scènes démarrent en "waiting" — le régulateur de poll_video les soumet
  // au fil de l'eau (limite Higgsfield : 4 requêtes simultanées par compte).
  const production = item.payload.production as { scenes?: Array<{ soul_prompt: string }> } | undefined;
  if (production?.scenes?.length) {
    if (!higgsfieldConfigured()) throw new Error("Higgsfield non configuré (HIGGSFIELD_API_KEY/SECRET manquants).");
    const scenes = production.scenes.map((_, i) => ({ idx: i, phase: "waiting" }));
    await mergeAssets(id, {
      video_provider: "higgsfield",
      vlog: true,
      ref_image_url: avatar?.ref_image_url ?? null,
      ref_angles: Array.isArray(avatar?.ref_angles) ? avatar.ref_angles : [],
      scenes,
      log: [{ t: new Date().toISOString(), msg: `🎬 Production lancée — ${scenes.length} scènes en file de tournage` }],
    });
    logger.info("vlog_started", { itemId: id, scenes: scenes.length });
    await advance(job, { runAfterMs: 1_000 });
    return;
  }

  // Moteur cinématique : dès qu'un preset vlog est demandé, ou que l'avatar est en higgsfield.
  const presetKey = String(item.payload.preset ?? "");
  const useHiggsfield = providerName === "higgsfield" || !!presetKey;
  if (useHiggsfield) {
    if (!higgsfieldConfigured()) throw new Error("Higgsfield non configuré (HIGGSFIELD_API_KEY/SECRET manquants).");
    const preset = VLOG_PRESETS[presetKey];
    const hint = preset?.scene ?? String(item.payload.scene_hint ?? item.payload.theme ?? "candid lifestyle moment");
    const scenePrompt = buildScenePrompt({ niche: avatar?.niche, city: avatar?.city, hint, shot: preset?.shot });
    const jobId = await submitSoulKeyframe(scenePrompt, avatar?.ref_image_url ?? null);
    logger.info("higgsfield_soul_submit", { itemId: id, jobId, preset: presetKey || "(daily)" });
    await mergeAssets(id, {
      video_provider: "higgsfield",
      hf_phase: "soul",
      hf_job_id: jobId,
      scene_prompt: scenePrompt,
      motion_prompt: preset?.motion ?? "natural subtle movement, cinematic camera, lifelike",
    });
    await advance(job, { runAfterMs: 8_000 });
    return;
  }

  const script = String(item.payload.script ?? "").trim();
  if (!script) throw new Error("Script vide — régénère le contenu (generate_text).");

  const scenes = (item.payload.scenes ?? []) as VideoScene[];
  const voiceId = await resolveVoiceId(providerName, avatar?.voice_id ?? null);

  logger.info("generate_video_submit", {
    itemId: id,
    provider: providerName,
    scriptLen: script.length,
    scenes: scenes.length,
    voice: voiceId ? "set" : "none",
    avatar: avatar?.video_avatar_id ? "set" : "none",
  });

  const provider = getVideoProvider(providerName);
  const { externalId } = await provider.submit({
    script,
    scenes: scenes.map((s) => ({ text: s.text, background: s.background ?? null })),
    captions: true,
    avatarId: avatar?.video_avatar_id ?? null,
    voiceId,
  });

  await mergeAssets(id, { video_external_id: externalId, video_provider: providerName });
  await advance(job, { runAfterMs: 20_000 });
}
