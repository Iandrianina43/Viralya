import { Router } from "express";
import { assertBudget, recordUsage, releaseUsage } from "../domain/billing";
import { bannerEstimate, deleteBanner, generateBanner, generateIdentity, getKit, isBannerNetwork, LAUNCH_AVATAR_SELECT, patchKit } from "../domain/launch";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest } from "../lib/httpError";
import { requireAvatar } from "../lib/scope";

// ─────────────────────────────────────────────────────────────
// KIT DE LANCEMENT — /api/launch
//   GET    /avatars/:id                    kit (identité, bios, bannières, checklist, règles par réseau)
//   POST   /avatars/:id/identity           génère l'identité de compte (LLM, ≈ 0,05 $)
//   PATCH  /avatars/:id                    {bios?, chosen_handle?, notes?, checklist?}
//   GET    /avatars/:id/banners/estimate   ?with_avatar= → coût d'une bannière
//   POST   /avatars/:id/banners            {network, with_avatar, hook} → bannière composée (image 2K, ≈ 0,08-0,14 $)
//   DELETE /avatars/:id/banners/:bannerId
// ─────────────────────────────────────────────────────────────
export const launchRouter = Router();

type LaunchAvatar = Parameters<typeof generateIdentity>[0];

launchRouter.get(
  "/avatars/:id",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    res.json({ kit: await getKit(req.org!.id, String(req.params.id)) });
  }),
);

launchRouter.post(
  "/avatars/:id/identity",
  asyncHandler(async (req, res) => {
    const avatar = await requireAvatar<LaunchAvatar>(req.org!.id, String(req.params.id), LAUNCH_AVATAR_SELECT);
    await assertBudget(req.org!.id, 0.05);
    const ledgerId = await recordUsage({ orgId: req.org!.id, avatarId: avatar.id, kind: "launch_identity", estimatedUsd: 0.05 });
    try {
      const identity = await generateIdentity(avatar);
      res.status(201).json({ identity });
    } catch (err) {
      await releaseUsage(ledgerId);
      throw err;
    }
  }),
);

launchRouter.patch(
  "/avatars/:id",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    const b = (req.body ?? {}) as Record<string, unknown>;
    await patchKit(String(req.params.id), {
      bios: b.bios && typeof b.bios === "object" ? (b.bios as Record<string, string>) : undefined,
      chosen_handle: typeof b.chosen_handle === "string" || b.chosen_handle === null ? (b.chosen_handle as string | null) : undefined,
      notes: b.notes && typeof b.notes === "object" ? (b.notes as Record<string, unknown>) : undefined,
      checklist: b.checklist && typeof b.checklist === "object" ? (b.checklist as Record<string, Record<string, unknown>>) : undefined,
    });
    res.json({ kit: await getKit(req.org!.id, String(req.params.id)) });
  }),
);

launchRouter.get(
  "/avatars/:id/banners/estimate",
  asyncHandler(async (req, res) => {
    const avatar = await requireAvatar<{ image_model: string | null }>(req.org!.id, String(req.params.id), "id, image_model");
    const withAvatar = String(req.query.with_avatar ?? "true") !== "false";
    const e = bannerEstimate(avatar, withAvatar);
    res.json({ model: e.model, cost_usd: Math.round(e.cost * 1000) / 1000 });
  }),
);

launchRouter.post(
  "/avatars/:id/banners",
  asyncHandler(async (req, res) => {
    const avatar = await requireAvatar<LaunchAvatar>(req.org!.id, String(req.params.id), LAUNCH_AVATAR_SELECT);
    const network = req.body?.network;
    if (!isBannerNetwork(network)) throw badRequest("Réseau sans bannière : youtube, facebook ou x.");
    const withAvatar = req.body?.with_avatar !== false;
    const hook = typeof req.body?.hook === "string" && req.body.hook.trim() ? String(req.body.hook) : null;
    const estimate = Math.round(bannerEstimate(avatar, withAvatar).cost * 1000) / 1000;
    await assertBudget(req.org!.id, estimate);
    const ledgerId = await recordUsage({ orgId: req.org!.id, avatarId: avatar.id, kind: "launch_banner", estimatedUsd: estimate });
    try {
      res.status(201).json({ banner: await generateBanner(avatar, { network, withAvatar, hook }) });
    } catch (err) {
      await releaseUsage(ledgerId);
      throw err;
    }
  }),
);

launchRouter.delete(
  "/avatars/:id/banners/:bannerId",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    await deleteBanner(String(req.params.id), String(req.params.bannerId));
    res.json({ ok: true });
  }),
);
