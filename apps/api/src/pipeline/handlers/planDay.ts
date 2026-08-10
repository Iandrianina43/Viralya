import type { ContentType, Network, RatioClass } from "@viralya/shared";
import { logger } from "../../logger";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";

interface PlanEntry {
  type: ContentType;
  network: Network;
  ratio_class: RatioClass;
}

// Construit le set de contenu du jour d'un avatar actif (compact = coût maîtrisé,
// exerce tout le pipeline) : 1 vidéo + 2 hooks + 1 carrousel.
export async function planDay(job: JobRow): Promise<void> {
  const avatarId = String(job.payload.avatar_id ?? "");
  if (!avatarId) throw new Error("plan_day: avatar_id manquant");

  const { data: avatar, error } = await supabase.from("avatars").select("id, status").eq("id", avatarId).single();
  if (error || !avatar) throw new Error(`plan_day: avatar ${avatarId} introuvable`);
  if (avatar.status !== "active") {
    logger.info("plan_day_skip_inactive", { avatarId });
    return;
  }

  // Idempotence : pas de re-planification si déjà fait aujourd'hui.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("avatar_id", avatarId)
    .gte("created_at", start.toISOString());
  if ((count ?? 0) > 0) {
    logger.info("plan_day_already_done", { avatarId, count });
    return;
  }

  const dow = new Date().getDay();
  const { data: cal } = await supabase
    .from("content_calendar")
    .select("theme, ratio_class")
    .eq("avatar_id", avatarId)
    .eq("day_of_week", dow)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const theme = cal?.theme ?? "Astuce business du jour";
  const themeClass = (cal?.ratio_class ?? "value") as RatioClass;

  const plan: PlanEntry[] = [
    { type: "video", network: "tiktok", ratio_class: themeClass },
    { type: "hook", network: "x", ratio_class: "value" },
    { type: "hook", network: "instagram", ratio_class: "value" },
    { type: "carousel", network: "instagram", ratio_class: "proof" },
  ];

  for (const e of plan) {
    const { data: item, error: insErr } = await supabase
      .from("content_items")
      .insert({ avatar_id: avatarId, type: e.type, network: e.network, ratio_class: e.ratio_class, status: "queued", payload: { theme } })
      .select("id")
      .single();
    if (insErr || !item) throw new Error(`plan_day insert failed: ${insErr?.message ?? ""}`);
    await enqueue("generate_text", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id });
  }
  logger.info("plan_day_done", { avatarId, items: plan.length, theme });
}
