import { AvatarInputSchema, AvatarMemoryInputSchema } from "@viralya/shared";
import { Router } from "express";
import { chatAvatar, chatAvatarStream, type ChatMessage } from "../domain/avatarChat";
import { buildFacePrompt } from "../domain/faceGen";
import { buildSystemPrompt } from "../domain/systemPrompt";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../logger";
import { recordMemory } from "../memory/memory";
import { listElevenVoices } from "../providers/elevenlabs";
import { generateImage } from "../providers/image";
import { supabase } from "../supabase";

export const avatarsRouter = Router();

// ── Chat Ultime : construction conversationnelle du personnage (Étape 1) ──
avatarsRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const messages = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMessage[]) : [];
    const draft = (req.body?.draft ?? {}) as Record<string, unknown>;
    const result = await chatAvatar(messages, draft);
    res.json(result);
  }),
);

// Étape 2 — génère un portrait depuis la fiche (+ affinage libre optionnel).
avatarsRouter.post(
  "/generate-face",
  asyncHandler(async (req, res) => {
    const fiche = (req.body?.fiche ?? {}) as Record<string, unknown>;
    const refinement = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    const model = typeof req.body?.model === "string" ? req.body.model : undefined;
    const prompt = buildFacePrompt(fiche, refinement);
    const key = `faces/${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { imageUrl } = await generateImage(prompt, key, "1024x1536", model);
    res.json({ imageUrl, prompt });
  }),
);

// Étape 3 — voix ElevenLabs disponibles (avec aperçu audio).
avatarsRouter.get(
  "/voices",
  asyncHandler(async (_req, res) => {
    res.json(await listElevenVoices());
  }),
);

// Version streaming (SSE) : réponse token par token + fiche à la fin.
avatarsRouter.post(
  "/chat/stream",
  asyncHandler(async (req, res) => {
    const messages = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMessage[]) : [];
    const draft = (req.body?.draft ?? {}) as Record<string, unknown>;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const result = await chatAvatarStream(messages, draft, (text) => send({ type: "token", text }));
      send({ type: "done", draft: result.draft, ready: result.ready });
    } catch (err) {
      send({ type: "error", error: String((err as Error)?.message ?? err) });
    }
    res.end();
  }),
);

// Pack multi-angles : dérive 3 vues supplémentaires du portrait (3/4, profil,
// plan taille) pour stabiliser l'identité dans toutes les scènes.
const ANGLE_VIEWS = [
  { key: "three-quarter", prompt: "the SAME woman as the reference photo, three-quarter view of her face turned slightly to her left, neutral expression, same hairstyle, same skin tone, plain soft background, natural light, photorealistic portrait" },
  { key: "profile", prompt: "the SAME woman as the reference photo, full side profile view, same hairstyle, same features, plain soft background, natural light, photorealistic portrait" },
  { key: "waist-up", prompt: "the SAME woman as the reference photo, waist-up full body shot standing, same face and hairstyle, casual outfit, plain soft background, natural light, photorealistic" },
];

avatarsRouter.post(
  "/:id/angles/generate",
  asyncHandler(async (req, res) => {
    const { data: avatar } = await supabase.from("avatars").select("id, ref_image_url").eq("id", req.params.id).single();
    if (!avatar) { res.status(404).json({ error: "not_found" }); return; }
    if (!avatar.ref_image_url) { res.status(400).json({ error: "Génère d'abord son portrait principal." }); return; }

    const { composeKeyframe } = await import("../providers/image");
    const angles: string[] = [];
    for (const view of ANGLE_VIEWS) {
      try {
        const { imageUrl } = await composeKeyframe(avatar.ref_image_url, null, view.prompt, `${avatar.id}/angles/${view.key}-${Date.now()}`);
        angles.push(imageUrl);
      } catch (err) {
        logger.warn("angle_generation_failed", { view: view.key, err: String((err as Error)?.message ?? err) });
      }
    }
    if (angles.length === 0) { res.status(502).json({ error: "Génération des angles impossible." }); return; }
    const { data, error } = await supabase.from("avatars").update({ ref_angles: angles }).eq("id", avatar.id).select("ref_angles").single();
    if (error) throw error;
    res.json({ ref_angles: data.ref_angles });
  }),
);

// ── Univers de lieux (décors récurrents) ─────────────────────
avatarsRouter.get(
  "/:id/locations",
  asyncHandler(async (req, res) => {
    const { listLocations, optimizeLocationImages } = await import("../domain/locations");
    const locations = await listLocations(String(req.params.id));
    res.json({ locations });
    // Les anciennes images PNG (lourdes) sont ré-encodées en tâche de fond.
    if (locations.some((l) => l.ref_image_url?.toLowerCase().endsWith(".png"))) {
      void optimizeLocationImages(String(req.params.id)).catch(() => {});
    }
  }),
);

// Génère automatiquement l'univers (Claude + images de référence).
avatarsRouter.post(
  "/:id/locations/generate",
  asyncHandler(async (req, res) => {
    const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, system_prompt").eq("id", req.params.id).single();
    if (!avatar) { res.status(404).json({ error: "not_found" }); return; }
    const { generateUniverse } = await import("../domain/locations");
    res.json({ locations: await generateUniverse(avatar) });
  }),
);

avatarsRouter.post(
  "/:id/locations",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (name.length < 2 || description.length < 10) { res.status(400).json({ error: "name et description requis" }); return; }
    const key = (String(req.body?.key ?? "") || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const { createLocation } = await import("../domain/locations");
    res.status(201).json({ location: await createLocation(String(req.params.id), { key, name, description }, true) });
  }),
);

avatarsRouter.post(
  "/:id/locations/:locId/regenerate",
  asyncHandler(async (req, res) => {
    const { regenerateLocationImage } = await import("../domain/locations");
    const refinement = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    res.json({ location: await regenerateLocationImage(String(req.params.id), String(req.params.locId), refinement) });
  }),
);

avatarsRouter.delete(
  "/:id/locations/:locId",
  asyncHandler(async (req, res) => {
    const { error } = await supabase.from("avatar_locations").delete().eq("id", req.params.locId).eq("avatar_id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── Mémoire narrative ────────────────────────────────────────
avatarsRouter.get(
  "/:id/memory",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("avatar_memory")
      .select("*")
      .eq("avatar_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ memory: data });
  }),
);

avatarsRouter.post(
  "/:id/memory",
  asyncHandler(async (req, res) => {
    const parsed = AvatarMemoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    await recordMemory(String(req.params.id), parsed.data);
    res.status(201).json({ ok: true });
  }),
);

avatarsRouter.delete(
  "/:id/memory/:memoryId",
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from("avatar_memory")
      .delete()
      .eq("id", req.params.memoryId)
      .eq("avatar_id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── CRUD avatars ─────────────────────────────────────────────
avatarsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.from("avatars").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ avatars: data });
  }),
);

avatarsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatars").select("*").eq("id", req.params.id).single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ avatar: data });
  }),
);

avatarsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = AvatarInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const system_prompt = buildSystemPrompt(parsed.data);
    const { data, error } = await supabase.from("avatars").insert({ ...parsed.data, system_prompt }).select("*").single();
    if (error) throw error;
    res.status(201).json({ avatar: data });
  }),
);

avatarsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = AvatarInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const { data: current, error: e1 } = await supabase.from("avatars").select("*").eq("id", req.params.id).single();
    if (e1 || !current) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const merged = { ...current, ...parsed.data };
    const system_prompt = buildSystemPrompt(merged);
    const { data, error } = await supabase.from("avatars").update({ ...parsed.data, system_prompt }).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ avatar: data });
  }),
);

avatarsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { error } = await supabase.from("avatars").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  }),
);
