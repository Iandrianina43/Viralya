import { synthesizeVoice } from "../../providers/voice";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// Synthèse vocale ElevenLabs : un seul audio à partir du script complet
// (aligné sur HeyGen v3, mono-scène). L'URL publique est passée à HeyGen
// comme piste voix (lip-sync sur la voix clonée de l'avatar).
export async function generateVoiceJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const { data: avatar } = await supabase
    .from("avatars")
    .select("voice_id")
    .eq("id", item.avatar_id)
    .single();

  const script = String(item.payload.script ?? "");
  const { audioUrl } = await synthesizeVoice(
    script,
    avatar?.voice_id ?? null,
    `${item.avatar_id}/${item.id}`,
  );

  await mergeAssets(id, { audio_url: audioUrl });
  await advance(job);
}
