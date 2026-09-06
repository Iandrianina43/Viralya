import { logger } from "../../logger";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// Enfilé après approbation. Garde-fou 70/20/10 (sale ≤ 10% sur 7j), puis planifie.
// V1 : "planifier" = statut scheduled + créneau (programmation Buffer/Publer = Phase 2).
export async function scheduleJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

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
    const sale = rows.filter((r) => r.ratio_class === "sale").length + 1;
    if (sale / total > 0.1 + 1e-9) {
      await patchContentItem(id, { status: "needs_review", error: `Ratio : part vente ${sale}/${total} > 10% sur 7j — maintenu en revue` });
      logger.warn("schedule_ratio_block", { itemId: id, sale, total });
      return;
    }
  }

  const scheduledAt = String(job.payload.scheduled_at ?? new Date(Date.now() + 3600 * 1000).toISOString());
  await patchContentItem(id, { status: "scheduled", scheduled_at: scheduledAt, error: null });
  await supabase.from("plan_entries").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("content_item_id", id);
  // Publication (simulée ou réelle) à l'heure prévue — la file maison porte le délai.
  const delay = Math.max(0, Date.parse(scheduledAt) - Date.now());
  await enqueue("publish", { content_item_id: id, avatar_id: item.avatar_id }, { contentItemId: id, runAfterMs: delay, avatarId: item.avatar_id, label: item.title ?? "Publication", maxAttempts: 1 });
  logger.info("content_scheduled", { itemId: id, network: item.network, scheduledAt });
}
