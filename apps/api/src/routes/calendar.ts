import { Router } from "express";
import { addEntry, deleteEntry, getEntry, getPlan, listPlans, produceEntry, updateEntry } from "../domain/calendar";
import { getPlanAuto, updatePlanAuto, type PlanAuto } from "../domain/calendar";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, notFound } from "../lib/httpError";
import { requireAvatar } from "../lib/scope";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// CALENDRIER ÉDITORIAL — /api/calendar
//   GET    /avatars/:id/plans                 mois disponibles
//   GET    /avatars/:id/plans/:month          plan + entrées (YYYY-MM)
//   POST   /avatars/:id/plans/generate        {month, posts_per_week, brief, arcs[]} → job generate_plan
//   POST   /avatars/:id/plans/:month/entries  ajout manuel
//   PATCH  /entries/:entryId                  édition / skip
//   DELETE /entries/:entryId
//   POST   /entries/:entryId/produce          {resolution?, talk_mode?, music?} → contenu réel
// ─────────────────────────────────────────────────────────────
export const calendarRouter = Router();

const nextMonth = (): string => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 7);
};

calendarRouter.get(
  "/avatars/:id/plans",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    res.json({ plans: await listPlans(String(req.params.id)) });
  }),
);

calendarRouter.get(
  "/avatars/:id/plans/:month",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    const plan = await getPlan(String(req.params.id), String(req.params.month));
    res.json({ plan: plan ? { ...plan, ...(await getPlanAuto(plan.id)) } : null });
  }),
);

// Pilote automatique du mois : { auto_produce?: boolean, auto_lead_days?: 0-7 }.
calendarRouter.patch(
  "/avatars/:id/plans/:month",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    const patch: Partial<PlanAuto> = {};
    if (typeof req.body?.auto_produce === "boolean") patch.auto_produce = req.body.auto_produce;
    if (req.body?.auto_lead_days != null) patch.auto_lead_days = Number(req.body.auto_lead_days);
    res.json({ auto: await updatePlanAuto(String(req.params.id), String(req.params.month), patch) });
  }),
);

calendarRouter.post(
  "/avatars/:id/plans/generate",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    const avatar = await requireAvatar<{ id: string; name: string }>(req.org!.id, avatarId, "id, name");
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month ?? "")) ? String(req.body.month) : nextMonth();
    const job = await enqueue(
      "generate_plan",
      {
        avatar_id: avatarId, month,
        posts_per_week: Number(req.body?.posts_per_week) || 5,
        brief: typeof req.body?.brief === "string" ? req.body.brief.slice(0, 2000) : undefined,
        arcs: Array.isArray(req.body?.arcs) ? req.body.arcs.map(String).slice(0, 6) : undefined,
      },
      { avatarId, label: `Calendrier ${month} — ${avatar.name}` },
    ).catch((err) => {
      const msg = String((err as Error)?.message ?? err);
      throw new Error(/jobs_type_check/.test(msg) ? "Applique la migration 0016_phase3_calendar_social_ugc.sql pour activer le calendrier." : msg);
    });
    res.status(202).json({ ok: true, job_id: job.id, month });
  }),
);

calendarRouter.post(
  "/avatars/:id/plans/:month/entries",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const plan = await getPlan(avatarId, String(req.params.month));
    if (!plan) throw notFound("Plan");
    if (!req.body?.day || !req.body?.title || !req.body?.brief) throw badRequest("day, title et brief requis");
    res.status(201).json({ entry: await addEntry(plan.id, avatarId, req.body) });
  }),
);

async function ownedEntry(orgId: string, entryId: string) {
  const entry = await getEntry(entryId);
  if (!entry) throw notFound("Entrée");
  await requireAvatar(orgId, entry.avatar_id, "id");
  return entry;
}

calendarRouter.patch(
  "/entries/:entryId",
  asyncHandler(async (req, res) => {
    await ownedEntry(req.org!.id, String(req.params.entryId));
    res.json({ entry: await updateEntry(String(req.params.entryId), req.body ?? {}) });
  }),
);

calendarRouter.delete(
  "/entries/:entryId",
  asyncHandler(async (req, res) => {
    await ownedEntry(req.org!.id, String(req.params.entryId));
    await deleteEntry(String(req.params.entryId));
    res.json({ ok: true });
  }),
);

calendarRouter.post(
  "/entries/:entryId/produce",
  asyncHandler(async (req, res) => {
    await ownedEntry(req.org!.id, String(req.params.entryId));
    const r = await produceEntry(String(req.params.entryId), {
      resolution: req.body?.resolution, talkMode: req.body?.talk_mode, music: req.body?.music, subtitles: req.body?.subtitles,
    });
    res.status(202).json({ ok: true, content_item_id: r.itemId, estimated_cost_usd: r.estimate });
  }),
);

// Vue d'ensemble pour le dashboard : prochaines entrées de tous les influenceurs de l'organisation.
calendarRouter.get(
  "/upcoming",
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("plan_entries")
      .select("*, avatars!inner(org_id, name)")
      .eq("avatars.org_id", req.org!.id)
      .gte("day", today)
      .order("day", { ascending: true })
      .limit(30);
    res.json({ entries: (data ?? []).map((r: Record<string, any>) => { const { avatars, ...e } = r; return { ...e, avatar_name: avatars?.name ?? null }; }) });
  }),
);
