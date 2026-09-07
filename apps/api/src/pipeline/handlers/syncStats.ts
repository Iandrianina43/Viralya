import { syncAvatarConnections } from "../../domain/connections";
import { logger } from "../../logger";
import { realPublisher } from "../../providers/publisher";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";

// Remontée des statistiques réelles (Zernio) pour les contenus publiés via le fournisseur, puis
// rafraîchissement des comptes connectés (abonnés, état). Les statistiques simulées se calculent à la
// lecture (domain/social.ts), rien à synchroniser. Cadence : +1 h, +6 h, +24 h, +72 h, +7 j.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncStatsJob(job: JobRow): Promise<void> {
  const publisher = realPublisher();
  if (!publisher) { logger.info("sync_stats_skip_no_provider"); return; }
  const avatarId = job.payload.avatar_id ? String(job.payload.avatar_id) : null;
  let q = supabase.from("content_items").select("id, network, external_post_id, stats").eq("status", "published").eq("publish_provider", publisher.name).not("external_post_id", "is", null).order("published_at", { ascending: false }).limit(100);
  if (avatarId) q = q.eq("avatar_id", avatarId);
  const { data: rows } = await q;
  let n = 0;
  for (const row of rows ?? []) {
    try {
      const s = await publisher.stats(String(row.external_post_id), String(row.network));
      if (s && Object.keys(s).length) {
        const prev = (row.stats as Record<string, any>)?.real ?? {};
        const real = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers_gained: 0, ...prev, ...s, synced_at: new Date().toISOString() };
        await supabase.from("content_items").update({ stats: { ...(row.stats as Record<string, unknown>), real } }).eq("id", row.id);
        n++;
      }
    } catch (err) {
      logger.warn("sync_stats_item_failed", { itemId: row.id, err: String((err as Error)?.message ?? err).slice(0, 200) });
    }
    await pause(250); // limite de débit Zernio : 60 requêtes/min sur le palier gratuit
  }
  if (avatarId) {
    try { await syncAvatarConnections(avatarId); } catch (err) { logger.warn("sync_stats_accounts_failed", { avatarId, err: String((err as Error)?.message ?? err).slice(0, 160) }); }
  }
  logger.info("sync_stats_done", { synced: n, avatarId });
}
