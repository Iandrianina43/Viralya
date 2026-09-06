import { Router } from "express";
import { config } from "../config";
import { ensureProfile, getFeed, publishSimulated, updateProfile, type SocialNetwork } from "../domain/social";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, HttpError, notFound } from "../lib/httpError";
import { requireAvatar, requireContentItem } from "../lib/scope";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// COMPTE SOCIAL — /api/social
//   GET   /avatars/:id/profile?network=       profil (créé au premier accès)
//   PATCH /avatars/:id/profile                {network, handle, display_name, bio, link}
//   GET   /avatars/:id/feed?network=          profil + posts publiés (stats du moment) + à venir
//   POST  /content/:id/publish-now            publication immédiate (simulée ou réelle)
//   GET   /connections · POST /connections · DELETE /connections/:id   (phase 4, Ayrshare)
//   POST  /sync-stats                         remontée des statistiques réelles
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

// « Publier maintenant » depuis la revue : contenu prêt (needs_review / scheduled) → publication immédiate.
socialRouter.post(
  "/content/:id/publish-now",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, status, avatar_id, title, network");
    if (!["needs_review", "scheduled", "failed"].includes(item.status)) throw new HttpError(409, `statut ${item.status} non publiable`);
    const { data: conn } = await supabase.from("social_connections").select("id").eq("avatar_id", item.avatar_id).eq("status", "active").contains("networks", [item.network]).maybeSingle();
    if (conn && config.AYRSHARE_API_KEY) {
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
    const { data } = await supabase.from("social_connections").select("*").eq("org_id", req.org!.id).order("created_at", { ascending: false });
    res.json({ connections: data ?? [], provider_configured: !!config.AYRSHARE_API_KEY });
  }),
);

socialRouter.post(
  "/connections",
  asyncHandler(async (req, res) => {
    const avatarId = req.body?.avatar_id ? String(req.body.avatar_id) : null;
    if (avatarId) await requireAvatar(req.org!.id, avatarId, "id");
    const networks = (Array.isArray(req.body?.networks) ? req.body.networks : []).filter((n: unknown) => NETWORKS.includes(n as SocialNetwork));
    if (!networks.length) throw badRequest("networks requis");
    const provider = req.body?.provider === "ayrshare" ? "ayrshare" : "simulated";
    if (provider === "ayrshare" && !config.AYRSHARE_API_KEY) throw badRequest("AYRSHARE_API_KEY absente de l'environnement : la publication réelle n'est pas configurée.");
    const { data, error } = await supabase
      .from("social_connections")
      .insert({ org_id: req.org!.id, avatar_id: avatarId, provider, profile_key: req.body?.profile_key ? String(req.body.profile_key) : null, networks, display_name: req.body?.display_name ? String(req.body.display_name) : null })
      .select("*")
      .single();
    if (error || !data) throw new Error(`connection insert: ${error?.message ?? ""}`);
    res.status(201).json({ connection: data });
  }),
);

socialRouter.delete(
  "/connections/:id",
  asyncHandler(async (req, res) => {
    const { data } = await supabase.from("social_connections").delete().eq("org_id", req.org!.id).eq("id", String(req.params.id)).select("id");
    if (!data?.length) throw notFound("Connexion");
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
