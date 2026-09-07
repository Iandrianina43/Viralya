import { activeConnection, failRealPublish, finalizeRealPublish, markPublishing } from "../../domain/publishing";
import { publishSimulated } from "../../domain/social";
import { logger } from "../../logger";
import { realPublisher, type PublishResult } from "../../providers/publisher";
import { ZernioError } from "../../providers/zernio";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// PUBLICATION — enfilée par `schedule` à l'heure prévue (ou tout de suite via « Publier maintenant »).
//   1) Compte connecté (social_connections, Zernio) → publication chez le fournisseur ; si Zernio
//      répond « en cours » (vidéo à envoyer au réseau), le job se relance toutes les 45 s (≤ 18 min)
//      jusqu'au verdict, que le webhook peut aussi apporter ;
//   2) sinon → publication SIMULÉE sur le compte social interne.
// Une publication réelle qui échoue laisse le contenu en « scheduled » avec l'erreur (jamais de faux « publié »).
// ─────────────────────────────────────────────────────────────

const POLL_MS = 45_000;
const MAX_POLLS = 24;

export async function publishJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "published" || item.status === "canceled" || item.status === "failed") return;

  const publisher = realPublisher();

  // Suivi d'une publication déjà soumise au fournisseur.
  if (item.publish_provider === "zernio" && item.external_post_id && item.payload?.publish_state === "publishing") {
    if (!publisher) throw new Error("publication en cours chez Zernio mais ZERNIO_API_KEY absente");
    const polls = Number(job.payload.poll ?? 0);
    const r = await publisher.status(String(item.external_post_id), item.network);
    await applyResult(id, item.avatar_id, publisher.name, r, polls);
    return;
  }

  const conn = await activeConnection(item.avatar_id, item.network);
  if (!conn) {
    await publishSimulated(id);
    return;
  }
  if (!publisher) {
    await patchContentItem(id, { error: "Publication réelle impossible : fournisseur non configuré sur ce serveur" });
    throw new Error("compte connecté mais ZERNIO_API_KEY absente");
  }

  const a = item.assets ?? {};
  const media: string[] = a.video_url ? [String(a.video_url)] : Array.isArray(a.image_urls) ? a.image_urls.map(String) : a.image_url ? [String(a.image_url)] : [];
  const textOnlyOk = item.network === "x" || item.network === "facebook";
  if (!media.length && !textOnlyOk) {
    await patchContentItem(id, { error: "Publication réelle impossible : aucun média final" });
    return;
  }
  const hashtags: string[] = Array.isArray(item.payload?.hashtags) ? item.payload.hashtags.map(String) : [];
  const caption = [String(item.payload?.caption ?? item.payload?.hook ?? item.payload?.text ?? ""), ...hashtags].filter(Boolean).join(" ").trim();
  const shots = Array.isArray(a.shots) ? (a.shots as Array<{ keyframe_url?: string }>) : [];
  const cover = (a.cover_url as string) ?? shots.find((s) => s.keyframe_url)?.keyframe_url ?? null;
  // Divulgation commerciale TikTok : contenu de vente ou publicité = marque du compte (« Your Brand ») ;
  // variante UGC produite pour une marque tierce = partenariat rémunéré.
  const commercial = item.payload?.ugc_campaign_id || item.payload?.ugc ? "brand_content" : item.ratio_class === "sale" || /^ad_/.test(String(item.payload?.kind ?? "")) ? "brand_organic" : "none";

  try {
    const r = await publisher.publish({
      network: item.network,
      caption,
      mediaUrls: media,
      isVideo: !!a.video_url,
      coverUrl: a.video_url ? cover : null,
      title: item.title ?? null,
      hashtags,
      accountId: String(conn.external_account_id),
      aiLabel: item.ai_label !== false,
      commercial,
      requestId: id,
      metadata: { viralya_content_id: id, viralya_avatar_id: item.avatar_id, viralya_org_id: String(conn.org_id) },
    });
    await applyResult(id, item.avatar_id, publisher.name, r, 0);
  } catch (err) {
    if (err instanceof ZernioError && err.code === "ACCOUNT_DISCONNECTED") {
      await supabase.from("social_connections").update({ status: "error", meta: { ...(conn.meta ?? {}), needs_reconnection: true, reason: err.message.slice(0, 200) } }).eq("id", conn.id);
    }
    const msg = String((err as Error)?.message ?? err);
    await failRealPublish(id, publisher.name, msg);
    throw err;
  }
}

async function applyResult(itemId: string, avatarId: string, provider: string, r: PublishResult, polls: number): Promise<void> {
  if (r.state === "published") {
    await finalizeRealPublish(itemId, provider, r);
    return;
  }
  if (r.state === "failed") {
    await failRealPublish(itemId, provider, r.error ?? "échec chez le fournisseur", r.postId);
    throw new Error(`publication réelle échouée : ${r.error ?? "?"}`);
  }
  if (!r.postId) throw new Error("fournisseur : publication en cours sans identifiant");
  if (polls === 0) await markPublishing(itemId, provider, r.postId);
  if (polls >= MAX_POLLS) {
    // Le webhook (post.published / post.failed) tranchera ; l'état reste « en cours » et visible.
    logger.warn("publish_real_still_pending", { itemId, postId: r.postId, polls });
    return;
  }
  await enqueue("publish", { content_item_id: itemId, avatar_id: avatarId, poll: polls + 1 }, { contentItemId: itemId, avatarId, runAfterMs: POLL_MS, label: "Publication (suivi)", maxAttempts: 1 });
  logger.info("publish_real_pending", { itemId, postId: r.postId, polls });
}
