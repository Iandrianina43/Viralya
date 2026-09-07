import { Router, type RequestHandler } from "express";
import { config } from "../config";
import { disconnect, handleZernioEvent, listConnections, publisherConfigured, recordEvent, startConnect, syncAvatarConnections, verifyZernioSignature } from "../domain/connections";
import { ensureProfile, getFeed, publishSimulated, updateProfile, type SocialNetwork } from "../domain/social";
import { activeConnection } from "../domain/publishing";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, HttpError } from "../lib/httpError";
import { requireAvatar, requireContentItem } from "../lib/scope";
import { logger } from "../logger";
import { enqueue } from "../queue/queue";

// ─────────────────────────────────────────────────────────────
// COMPTE SOCIAL — /api/social
//   GET   /avatars/:id/profile?network=       profil (créé au premier accès)
//   PATCH /avatars/:id/profile                {network, handle, display_name, bio, link}
//   GET   /avatars/:id/feed?network=          profil + posts publiés (stats du moment) + à venir
//   POST  /content/:id/publish-now            publication immédiate (réelle si un compte est connecté, sinon simulée)
//   GET   /connections?avatar_id=             comptes connectés (Zernio) de l'espace / de l'influenceur
//   POST  /connections/connect                {avatar_id, network, consent} → {auth_url} (OAuth hébergé par Zernio)
//   POST  /connections/sync                   {avatar_id} → relit les comptes du profil Zernio
//   DELETE /connections/:id                   déconnexion (chez Zernio puis chez nous)
//   POST  /sync-stats                         remontée des statistiques réelles
//   POST  /api/social/zernio/webhook          (public, signé) — monté dans routes/index.ts sur le corps brut
// ─────────────────────────────────────────────────────────────
export const socialRouter = Router();

const NETWORKS: SocialNetwork[] = ["instagram", "tiktok", "youtube", "x", "facebook"];
const network = (v: unknown): SocialNetwork => (NETWORKS.includes(v as SocialNetwork) ? (v as SocialNetwork) : "instagram");

socialRouter.get(
  "/avatars/:id/profile",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    res.json({ profile: await ensureProfile(String(req.params.id), network(req.query.network)) });
  }),
);

socialRouter.patch(
  "/avatars/:id/profile",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    res.json({ profile: await updateProfile(String(req.params.id), network(req.body?.network), req.body ?? {}) });
  }),
);

socialRouter.get(
  "/avatars/:id/feed",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    res.json(await getFeed(String(req.params.id), network(req.query.network)));
  }),
);

// « Publier maintenant » depuis la revue : contenu prêt (needs_review / scheduled / failed) → publication immédiate.
socialRouter.post(
  "/content/:id/publish-now",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, status, avatar_id, title, network, external_post_id, publish_provider, payload");
    if (!["needs_review", "scheduled", "failed"].includes(item.status)) throw new HttpError(409, `statut ${item.status} non publiable`);
    if (item.publish_provider === "zernio" && item.external_post_id && (item.payload as Record<string, unknown> | null)?.publish_state === "publishing") {
      throw new HttpError(409, "Publication déjà en cours chez le fournisseur : patiente quelques minutes.");
    }
    const conn = await activeConnection(String(item.avatar_id), String(item.network));
    if (conn) {
      if (!publisherConfigured()) throw new HttpError(503, "Un compte est connecté mais la publication réelle n'est pas configurée sur ce serveur.");
      const job = await enqueue("publish", { content_item_id: item.id, avatar_id: item.avatar_id }, { contentItemId: item.id, avatarId: item.avatar_id, label: item.title ?? "Publication", maxAttempts: 1 });
      res.status(202).json({ ok: true, mode: "real", job_id: job.id });
      return;
    }
    const post = await publishSimulated(item.id);
    res.json({ ok: true, mode: "simulated", post });
  }),
);

socialRouter.get(
  "/connections",
  asyncHandler(async (req, res) => {
    const avatarId = req.query.avatar_id ? String(req.query.avatar_id) : null;
    if (avatarId) await requireAvatar(req.org!.id, avatarId, "id");
    res.json({ connections: await listConnections(req.org!.id, avatarId), provider_configured: publisherConfigured() });
  }),
);

socialRouter.post(
  "/connections/connect",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    if (req.body?.consent !== true) throw badRequest("Confirme que ces comptes t'appartiennent et que les contenus seront publiés avec la mention « généré par IA ».");
    const url = await startConnect({ orgId: req.org!.id, userId: req.user?.id ?? null, avatarId, network: network(req.body?.network) });
    res.json({ auth_url: url });
  }),
);

socialRouter.post(
  "/connections/sync",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    res.json({ connections: await syncAvatarConnections(avatarId) });
  }),
);

socialRouter.delete(
  "/connections/:id",
  asyncHandler(async (req, res) => {
    await disconnect({ orgId: req.org!.id, userId: req.user?.id ?? null, connectionId: String(req.params.id) });
    res.json({ ok: true });
  }),
);

socialRouter.post(
  "/sync-stats",
  asyncHandler(async (req, res) => {
    const avatarId = req.body?.avatar_id ? String(req.body.avatar_id) : null;
    if (!avatarId) { res.status(400).json({ error: "avatar_id requis" }); return; }
    await requireAvatar(req.org!.id, avatarId, "id");
    const job = await enqueue("sync_stats", { avatar_id: avatarId }, { avatarId, label: "Statistiques réelles" });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

/** Webhook Zernio : corps BRUT (monté avant express.json), signature HMAC vérifiée, réponse immédiate (délai Zernio : 5 s). */
export const zernioWebhook: RequestHandler = async (req, res) => {
  if (!config.ZERNIO_API_KEY || !config.ZERNIO_WEBHOOK_SECRET) {
    res.status(503).json({ error: "webhook non configuré" });
    return;
  }
  const raw = req.body as unknown;
  if (!Buffer.isBuffer(raw) || !verifyZernioSignature(raw, req.get("x-zernio-signature"))) {
    logger.warn("zernio_webhook_bad_signature");
    res.status(400).json({ error: "signature invalide" });
    return;
  }
  let payload: { id?: string; event?: string };
  try { payload = JSON.parse(raw.toString("utf8")); } catch { res.status(400).json({ error: "JSON invalide" }); return; }
  const eventId = String(payload?.id ?? req.get("x-zernio-event-id") ?? "");
  const type = String(payload?.event ?? "");
  if (eventId && !(await recordEvent(eventId, type))) { res.json({ ok: true, duplicate: true }); return; }
  res.json({ ok: true });
  handleZernioEvent(payload as Parameters<typeof handleZernioEvent>[0]).catch((err) => logger.error("zernio_webhook_failed", { type, id: eventId, err: String((err as Error)?.message ?? err).slice(0, 200) }));
};
