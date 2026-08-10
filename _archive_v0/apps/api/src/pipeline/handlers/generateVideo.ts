import type { VideoScene } from "@viralya/shared";
import { logger } from "../../logger";
import { getVideoProvider, resolveHeygenVoiceId } from "../../providers/video";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// Soumet la vidéo talking-head à HeyGen v3 (TTS natif, fiable).
// La voix est résolue automatiquement vers une voix HeyGen valide.
export async function generateVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const { data: avatar } = await supabase
    .from("avatars")
    .select("heygen_avatar_id, voice_id")
    .eq("id", item.avatar_id)
    .single();

  const script = String(item.payload.script ?? "").trim();
  if (!script) throw new Error("Script vide — régénère le contenu (étape generate_text).");

  const scenes = (item.payload.scenes ?? []) as VideoScene[];
  const background = scenes[0]?.background ?? null;

  // Voix HeyGen valide (auto-corrige un id absent/étranger).
  const heygenVoiceId = await resolveHeygenVoiceId(avatar?.voice_id ?? null);

  logger.info("generate_video_submit", {
    itemId: id,
    scriptLen: script.length,
    voice: heygenVoiceId ? "set" : "none",
    avatar: avatar?.heygen_avatar_id ? "set" : "none",
  });

  const provider = getVideoProvider();
  const { externalId } = await provider.submit({
    script,
    background,
    captions: true,
    heygenAvatarId: avatar?.heygen_avatar_id ?? null,
    voiceId: heygenVoiceId,
  });

  await mergeAssets(id, { video_external_id: externalId });
  await advance(job, { runAfterMs: 20_000 });
}
