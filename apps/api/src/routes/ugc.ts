import { Router } from "express";
import { beatBudget, createCampaign, deleteCampaign, getCampaign, listCampaigns, produceVariant, updateVariant } from "../domain/ugc";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, notFound } from "../lib/httpError";
import { orgAvatarIds } from "../lib/scope";
import { seedanceCost } from "../providers/piapi";

// ─────────────────────────────────────────────────────────────
// CAMPAGNES UGC — /api/ugc
//   GET    /campaigns · GET /campaigns/:id · DELETE /campaigns/:id
//   POST   /campaigns              {brand, product{…}, objective, target, tone, avatar_ids[], angles[], hooks_per_angle, durations[], ctas[]}
//   POST   /campaigns/estimate     même corps → nombre de variantes et coût estimé (aucun appel IA)
//   PATCH  /variants/:id           {script?, hook?, cta?, status?}
//   POST   /variants/:id/produce   {resolution?, talk_mode?, music?} → vidéo
// ─────────────────────────────────────────────────────────────
export const ugcRouter = Router();

ugcRouter.get(
  "/campaigns",
  asyncHandler(async (req, res) => {
    res.json({ campaigns: await listCampaigns(req.org!.id) });
  }),
);

ugcRouter.post(
  "/campaigns/estimate",
  asyncHandler(async (req, res) => {
    const avatars = Array.isArray(req.body?.avatar_ids) ? req.body.avatar_ids.length : 0;
    const angles = Array.isArray(req.body?.angles) ? req.body.angles.filter(Boolean).length : 0;
    const hooks = Math.max(1, Math.min(4, Number(req.body?.hooks_per_angle) || 2));
    const durations: number[] = (Array.isArray(req.body?.durations) && req.body.durations.length ? req.body.durations : [30]).map((d: unknown) => Math.max(15, Math.min(45, Number(d) || 30)));
    const variants = avatars * angles * hooks * durations.length;
    const perDuration = durations.map((d) => seedanceCost("seedance-2.5-less-restriction", String(req.body?.resolution) === "1080p" ? "1080p" : "720p", d + 1) + 0.15);
    const total = avatars * angles * hooks * perDuration.reduce((a, b) => a + b, 0);
    res.json({ variants, scripts_cost_usd: Math.round(avatars * durations.length * 0.03 * 100) / 100, production_cost_usd: Math.round(total * 100) / 100, budget: durations.map((d) => ({ duration: d, beats: beatBudget(d) })) });
  }),
);

ugcRouter.post(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const allowed = new Set(await orgAvatarIds(req.org!.id));
    const avatarIds = (Array.isArray(req.body?.avatar_ids) ? req.body.avatar_ids.map(String) : []).filter((id: string) => allowed.has(id));
    if (!avatarIds.length) throw badRequest("Choisis au moins un influenceur de ton organisation.");
    const { assertBudget, recordUsage } = await import("../domain/billing");
    const scriptsEstimate = 0.05 * avatarIds.length * Math.max(1, Array.isArray(req.body?.durations) ? req.body.durations.length : 1);
    await assertBudget(req.org!.id, scriptsEstimate);
    await recordUsage({ orgId: req.org!.id, kind: "ugc_scripts", estimatedUsd: scriptsEstimate });
    const campaign = await createCampaign(req.org!.id, { ...req.body, avatar_ids: avatarIds }).catch((err) => {
      const msg = String((err as Error)?.message ?? err);
      throw new Error(/relation .* does not exist|ugc_campaigns/.test(msg) && /exist/.test(msg) ? "Applique la migration 0016_phase3_calendar_social_ugc.sql pour activer les campagnes UGC." : msg);
    });
    res.status(201).json({ campaign });
  }),
);

ugcRouter.get(
  "/campaigns/:id",
  asyncHandler(async (req, res) => {
    const campaign = await getCampaign(req.org!.id, String(req.params.id));
    if (!campaign) throw notFound("Campagne");
    res.json({ campaign });
  }),
);

ugcRouter.delete(
  "/campaigns/:id",
  asyncHandler(async (req, res) => {
    await deleteCampaign(req.org!.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

ugcRouter.patch(
  "/variants/:id",
  asyncHandler(async (req, res) => {
    res.json({ variant: await updateVariant(req.org!.id, String(req.params.id), req.body ?? {}) });
  }),
);

ugcRouter.post(
  "/variants/:id/produce",
  asyncHandler(async (req, res) => {
    const r = await produceVariant(req.org!.id, String(req.params.id), { resolution: req.body?.resolution, talkMode: req.body?.talk_mode, music: req.body?.music });
    res.status(202).json({ ok: true, content_item_id: r.itemId, estimated_cost_usd: r.estimate });
  }),
);
