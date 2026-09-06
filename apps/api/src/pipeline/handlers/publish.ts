import { publishSimulated } from "../../domain/social";
import { logger } from "../../logger";
import { realPublisher } from "../../providers/publisher";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// PUBLICATION — enfilée par `schedule` à l'heure prévue (ou tout de suite via « Publier maintenant »).
//   1) Connexion réelle (social_connections, fournisseur configuré) → publication chez le fournisseur,
//      identifiants externes conservés pour les statistiques ;
//   2) sinon → publication SIMULÉE sur le compte social interne.
// Une publication réelle qui échoue laisse le contenu en « scheduled » avec l'erreur (jamais de faux « publié »).
// ─────────────────────────────────────────────────────────────

export async function publishJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "published") return;
  if (item.status === "canceled" || item.status === "failed") return;

  const { data: conn } = await supabase
    .from("social_connections")
    .select("id, provider, profile_key, networks, status")
    .eq("avatar_id", item.avatar_id)
    .eq("status", "active")
    .contains("networks", [item.network])
    .maybeSingle()
    .throwOnError()
    .then((r) => r, () => ({ data: null }));
  const publisher = conn?.provider === "ayrshare" ? realPublisher() : null;

  if (publisher && conn) {
    const a = item.assets ?? {};
    const media: string[] = a.video_url ? [String(a.video_url)] : Array.isArray(a.image_urls) ? a.image_urls : a.image_url ? [String(a.image_url)] : [];
    if (!media.length) {
      await patchContentItem(id, { error: "Publication réelle impossible : aucun média final" });
      return;
    }
    const caption = [String(item.payload?.caption ?? ""), ...(Array.isArray(item.payload?.hashtags) ? item.payload.hashtags : [])].filter(Boolean).join(" ").trim();
    try {
      const r = await publisher.publish({ network: item.network, caption, mediaUrls: media, isVideo: !!a.video_url, profileKey: conn.profile_key, aiLabel: (item as any).ai_label !== false });
      await patchContentItem(id, {
        status: "published", published_at: new Date().toISOString(), publish_provider: "ayrshare",
        external_post_id: r.externalId, external_url: r.url, error: null,
        stats: { ...(item as any).stats, real: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers_gained: 0 } },
      });
      await supabase.from("plan_entries").update({ status: "published" }).eq("content_item_id", id);
      logger.info("content_published_real", { itemId: id, provider: "ayrshare", externalId: r.externalId });
      // Cadence de remontée des statistiques (docs/RECHERCHE-PUBLICATION.md) : +1 h, +6 h, +24 h, +72 h, +7 j.
      for (const h of [1, 6, 24, 72, 168]) {
        await enqueue("sync_stats", { avatar_id: item.avatar_id }, { avatarId: item.avatar_id, runAfterMs: h * 3_600_000, label: `Stats +${h} h` }).catch(() => {});
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 300);
      await patchContentItem(id, { error: `Publication réelle échouée : ${msg}` });
      logger.warn("publish_real_failed", { itemId: id, err: msg });
      throw err;
    }
    return;
  }

  await publishSimulated(id);
}
