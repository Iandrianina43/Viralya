import { uploadBytes } from "../../lib/storage";
import { logger } from "../../logger";
import { getVideoProvider } from "../../providers/video";
import { enqueue, type JobRow } from "../../queue/queue";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

const MAX_POLLS = 30; // ~30 x 20s = 10 min max

// Les URLs HeyGen sont signées et TEMPORAIRES : on rapatrie la vidéo
// dans le Storage Supabase pour une URL pérenne. Fallback : URL provider.
async function persistVideo(providerUrl: string, avatarId: string, itemId: string): Promise<string> {
  try {
    const res = await fetch(providerUrl);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const bytes = await res.arrayBuffer();
    return await uploadBytes(`${avatarId}/${itemId}/video.mp4`, bytes, "video/mp4");
  } catch (err) {
    logger.warn("video_persist_failed_fallback_provider_url", {
      itemId,
      err: String((err as Error)?.message ?? err),
    });
    return providerUrl;
  }
}

// Vérifie l'état du rendu vidéo. Si prêt → persiste puis avance vers assemble.
// Sinon, se ré-enfile avec délai (sans avancer), jusqu'à MAX_POLLS.
export async function pollVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  const externalId = String(item.assets.video_external_id ?? "");
  if (!externalId) throw new Error("poll_video: video_external_id manquant");

  const provider = getVideoProvider();
  const result = await provider.poll(externalId);

  if (result.status === "ready") {
    const videoUrl = result.videoUrl
      ? await persistVideo(result.videoUrl, item.avatar_id, id)
      : null;
    await mergeAssets(id, { video_url: videoUrl });
    await advance(job); // → assemble
    return;
  }
  if (result.status === "failed") {
    throw new Error(`poll_video: rendu échoué (${result.error ?? "inconnu"})`);
  }

  const polls = Number(job.payload.poll_attempts ?? 0) + 1;
  if (polls > MAX_POLLS) throw new Error("poll_video: timeout (rendu trop long)");
  await enqueue(
    "poll_video",
    { ...job.payload, poll_attempts: polls },
    { contentItemId: id, runAfterMs: 20_000 },
  );
}
