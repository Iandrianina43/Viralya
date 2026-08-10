import type { Network } from "@viralya/shared";
import { logger } from "../../logger";
import { schedulePost } from "../../providers/scheduler";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// Enfilé après approbation humaine. Applique le garde-fou 70/20/10 sur
// une fenêtre glissante de 7 jours, puis planifie via le provider (Buffer/Publer).
export async function scheduleJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  // Garde-fou : la part "sale" ne doit jamais dépasser 10% sur 7 jours.
  if (item.ratio_class === "sale") {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("content_items")
      .select("ratio_class")
      .eq("avatar_id", item.avatar_id)
      .in("status", ["scheduled", "published"])
      .gte("created_at", since);
    const rows = recent ?? [];
    const total = rows.length + 1;
    const saleCount = rows.filter((r) => r.ratio_class === "sale").length + 1;
    if (saleCount / total > 0.1 + 1e-9) {
      await patchContentItem(id, {
        status: "needs_review",
        error: `Ratio 70/20/10 : part vente ${saleCount}/${total} > 10% sur 7j — maintenu en revue`,
      });
      logger.warn("schedule_ratio_block", { itemId: id, saleCount, total });
      return;
    }
  }

  const scheduledAt = String(
    job.payload.scheduled_at ?? new Date(Date.now() + 3600 * 1000).toISOString(),
  );
  const hashtags = Array.isArray(item.payload.hashtags) ? (item.payload.hashtags as string[]) : [];
  const caption = [String(item.payload.caption ?? ""), ...hashtags].join(" ").trim();
  const mediaUrl =
    (item.assets.video_url as string | undefined) ??
    (Array.isArray(item.assets.image_urls) ? (item.assets.image_urls[0] as string) : null);

  await schedulePost({ network: item.network as Network, caption, mediaUrl, scheduledAt });
  await patchContentItem(id, { status: "scheduled", scheduled_at: scheduledAt, error: null });
  logger.info("content_scheduled", { itemId: id, network: item.network, scheduledAt });
}
