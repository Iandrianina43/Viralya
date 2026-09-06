import { logger } from "../../logger";
import { realPublisher } from "../../providers/publisher";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";

// Remontée des statistiques réelles (phase 4) pour les contenus publiés via un fournisseur.
// Les statistiques simulées se calculent à la lecture (domain/social.ts), rien à synchroniser.
export async function syncStatsJob(job: JobRow): Promise<void> {
  const publisher = realPublisher();
  if (!publisher) { logger.info("sync_stats_skip_no_provider"); return; }
  let q = supabase.from("content_items").select("id, network, external_post_id, stats").eq("status", "published").eq("publish_provider", "ayrshare").not("external_post_id", "is", null).limit(100);
  if (job.payload.avatar_id) q = q.eq("avatar_id", String(job.payload.avatar_id));
  const { data: rows } = await q;
  let n = 0;
  for (const row of rows ?? []) {
    try {
      const s = await publisher.stats(String(row.external_post_id), String(row.network));
      if (!s) continue;
      const prev = (row.stats as Record<string, any>)?.real ?? {};
      const real = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers_gained: 0, ...prev, ...Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "number")), synced_at: new Date().toISOString() };
      await supabase.from("content_items").update({ stats: { ...(row.stats as Record<string, unknown>), real } }).eq("id", row.id);
      n++;
    } catch (err) {
      logger.warn("sync_stats_item_failed", { itemId: row.id, err: String((err as Error)?.message ?? err).slice(0, 200) });
    }
  }
  logger.info("sync_stats_done", { synced: n });
}
