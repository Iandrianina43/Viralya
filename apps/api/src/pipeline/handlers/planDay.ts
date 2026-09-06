import type { ContentType, Network, RatioClass } from "@viralya/shared";
import { config } from "../../config";
import { assertBudget, orgIdOfAvatar, recordUsage } from "../../domain/billing";
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
  const manual = job.payload.manual === true;

  // Garde-fous (incident du 3 sept. 2026 : 5 plan_day accumulés → 5 vidéos facturées).
  // 1) Le quotidien automatique est désactivé par défaut ; seul le déclenchement manuel passe.
  if (!manual && !config.DAILY_PLAN_ENABLED) {
    logger.info("plan_day_skip_disabled", { avatarId, jobId: job.id });
    return;
  }
  // 2) Un job du cron qui a attendu jusqu'au lendemain est périmé : on ne rattrape jamais les jours manqués.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!manual && job.created_at && new Date(job.created_at) < today) {
    logger.info("plan_day_skip_stale", { avatarId, jobId: job.id, createdAt: job.created_at });
    return;
  }

  const { data: avatar, error } = await supabase.from("avatars").select("id, status").eq("id", avatarId).single();
  if (error || !avatar) throw new Error(`plan_day: avatar ${avatarId} introuvable`);
  if (avatar.status !== "active") {
    logger.info("plan_day_skip_inactive", { avatarId });
    return;
  }

  // 3) Verrou atomique (avatar, jour) : un seul plan par influenceur et par jour, même si
  //    plusieurs jobs tournent en parallèle. Repli sur le comptage si la table manque (migration 0014).
  const dayKey = today.toISOString().slice(0, 10);
  const { error: lockErr } = await supabase.from("daily_plans").insert({ avatar_id: avatarId, day: dayKey, job_id: job.id });
  if (lockErr) {
    if (/duplicate|unique|23505/i.test(lockErr.message)) {
      logger.info("plan_day_already_done", { avatarId, day: dayKey });
      return;
    }
    logger.warn("plan_day_lock_unavailable", { err: lockErr.message });
    const { count } = await supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("avatar_id", avatarId)
      .gte("created_at", today.toISOString());
    if ((count ?? 0) > 0) {
      logger.info("plan_day_already_done", { avatarId, count });
      return;
    }
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

  // Budget de l'organisation : 1 vidéo + 2 hooks + 1 carrousel ≈ 12 $ (refus avant tout coût).
  const orgId = await orgIdOfAvatar(avatarId);
  if (orgId) await assertBudget(orgId, 12);
  for (const e of plan) {
    const { data: item, error: insErr } = await supabase
      .from("content_items")
      .insert({ avatar_id: avatarId, type: e.type, network: e.network, ratio_class: e.ratio_class, status: "queued", payload: { theme } })
      .select("id")
      .single();
    if (insErr || !item) throw new Error(`plan_day insert failed: ${insErr?.message ?? ""}`);
    await enqueue("generate_text", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label: theme });
  }
  if (orgId) await recordUsage({ orgId, avatarId, kind: "daily", estimatedUsd: 12 });
  logger.info("plan_day_done", { avatarId, items: plan.length, theme });
}
