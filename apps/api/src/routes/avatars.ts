import { AvatarInputSchema, AvatarMemoryInputSchema } from "@viralya/shared";
import { Router } from "express";
import { chatAvatar, chatAvatarStream, type ChatMessage } from "../domain/avatarChat";
import { buildCharacterSheetPrompt, buildPortraitPrompt, draftPortraitSpec, normalizePortraitSpec } from "../domain/faceGen";
import { buildSystemPrompt } from "../domain/systemPrompt";
import { assertBudget, recordUsage } from "../domain/billing";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest } from "../lib/httpError";
import { requireAvatar } from "../lib/scope";
import { recordMemory } from "../memory/memory";
import { generateVoiceSamples, listElevenVoices } from "../providers/elevenlabs";
import { generateImage } from "../providers/image";
import { supabase } from "../supabase";

// Influenceurs de l'organisation active. Toute lecture par id passe par
// requireAvatar(org, id) : un avatar d'une autre organisation renvoie 404.
export const avatarsRouter = Router();

// ── Chat Ultime : construction conversationnelle du personnage (Étape 1) ──
avatarsRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.02);
    const messages = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMessage[]) : [];
    const draft = (req.body?.draft ?? {}) as Record<string, unknown>;
    res.json(await chatAvatar(messages, draft));
  }),
);

// Étape 2a — l'IA pré-remplit la fiche portrait structurée (ajustable ensuite).
avatarsRouter.post(
  "/portrait-spec",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.02);
    const fiche = (req.body?.fiche ?? {}) as Record<string, any>;
    const spec = await draftPortraitSpec({
      name: fiche.name,
      niche: fiche.niche ?? null,
      city: fiche.city ?? null,
      sex_age: fiche.sex_age ?? null,
      nationality: fiche.nationality ?? null,
      personality: Array.isArray(fiche.personality) ? fiche.personality : null,
      clothing_style: fiche.clothing_style ?? null,
      brief: typeof req.body?.brief === "string" ? req.body.brief : undefined,
    });
    res.json({ spec });
  }),
);

// Étape 2b — génère le portrait depuis la fiche structurée (ou l'ancienne fiche libre).
avatarsRouter.post(
  "/generate-face",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.2);
    await recordUsage({ orgId: req.org!.id, avatarId: null, kind: "portrait", estimatedUsd: 0.2 });
    let spec = req.body?.spec ? normalizePortraitSpec(req.body.spec as Record<string, unknown>) : null;
    if (!spec) {
      const fiche = (req.body?.fiche ?? {}) as Record<string, any>;
      spec = await draftPortraitSpec({
        name: fiche.name, niche: fiche.niche ?? null, city: fiche.city ?? null,
        sex_age: fiche.sex_age ?? null, nationality: fiche.nationality ?? null,
        personality: Array.isArray(fiche.personality) ? fiche.personality : null,
        clothing_style: fiche.clothing_style ?? null,
        brief: typeof req.body?.prompt === "string" ? req.body.prompt : undefined,
      });
    }
    const prompt = buildPortraitPrompt(spec);
    const key = `${req.org!.id}/faces/${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { imageUrl } = await generateImage(prompt, key, "1024x1536");
    res.json({ imageUrl, prompt, spec });
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
    await assertBudget(req.org!.id, 0.02);
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

// CHARACTER SHEET : planche 8 vues générée avec le portrait comme référence d'identité.
avatarsRouter.post(
  "/:id/character-sheet/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.3);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "character_sheet", estimatedUsd: 0.3 });
    const avatar = await requireAvatar(req.org!.id, String(req.params.id), "id, ref_image_url, portrait_spec");
    if (!avatar.ref_image_url) throw badRequest("Génère d'abord son portrait principal.");

    const { composeKeyframe } = await import("../providers/image");
    const prompt = buildCharacterSheetPrompt(avatar.portrait_spec ?? null);
    const { imageUrl } = await composeKeyframe(
      avatar.ref_image_url, null, prompt,
      `${avatar.id}/character-sheet-${Date.now()}`, "1536x1024",
    );
    const { data, error } = await supabase.from("avatars").update({ character_sheet_url: imageUrl }).eq("id", avatar.id).select("character_sheet_url").single();
    if (error) throw error;
    res.json({ character_sheet_url: data.character_sheet_url });
  }),
);

// ÉCHANTILLONS DE TIMBRE : 2 mp3 courts (voix ElevenLabs choisie).
avatarsRouter.post(
  "/:id/voice-samples/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.05);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "voice_samples", estimatedUsd: 0.05 });
    const avatar = await requireAvatar(req.org!.id, String(req.params.id), "id, eleven_voice_id");
    if (!avatar.eleven_voice_id) throw badRequest("Choisis d'abord sa voix ElevenLabs.");
    const urls = await generateVoiceSamples(avatar.eleven_voice_id, avatar.id);
    const { data, error } = await supabase.from("avatars").update({ voice_sample_urls: urls }).eq("id", avatar.id).select("voice_sample_urls").single();
    if (error) throw error;
    res.json({ voice_sample_urls: data.voice_sample_urls });
  }),
);

// ── Univers de lieux (décors récurrents) ─────────────────────
avatarsRouter.get(
  "/:id/locations",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { listLocations, optimizeLocationImages } = await import("../domain/locations");
    // ?scope=permanent (défaut : l'univers) | oneoff (décors de voyage) | all
    const scope = ["permanent", "oneoff", "all"].includes(String(req.query.scope)) ? (String(req.query.scope) as "permanent" | "oneoff" | "all") : "permanent";
    const locations = await listLocations(avatarId, scope);
    res.json({ locations });
    if (locations.some((l) => l.ref_image_url?.toLowerCase().endsWith(".png"))) {
      void optimizeLocationImages(avatarId).catch(() => {});
    }
  }),
);

avatarsRouter.post(
  "/:id/locations/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.5);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "locations", estimatedUsd: 0.5 });
    const avatar = await requireAvatar<{ id: string; name: string; niche: string | null; city: string | null; system_prompt: string | null }>(
      req.org!.id, String(req.params.id), "id, name, niche, city, system_prompt",
    );
    const { generateUniverse } = await import("../domain/locations");
    res.json({ locations: await generateUniverse(avatar) });
  }),
);

avatarsRouter.post(
  "/:id/locations",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (name.length < 2 || description.length < 10) throw badRequest("name et description requis");
    const key = (String(req.body?.key ?? "") || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const { createLocation } = await import("../domain/locations");
    res.status(201).json({ location: await createLocation(avatarId, { key, name, description }, true) });
  }),
);

avatarsRouter.post(
  "/:id/locations/:locId/regenerate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.15);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "location", estimatedUsd: 0.15 });
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { regenerateLocationImage } = await import("../domain/locations");
    const refinement = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    res.json({ location: await regenerateLocationImage(avatarId, String(req.params.locId), refinement) });
  }),
);

avatarsRouter.delete(
  "/:id/locations/:locId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { error } = await supabase.from("avatar_locations").delete().eq("id", req.params.locId).eq("avatar_id", avatarId);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── Mémoire narrative ────────────────────────────────────────
avatarsRouter.get(
  "/:id/memory",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { data, error } = await supabase
      .from("avatar_memory")
      .select("*")
      .eq("avatar_id", avatarId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ memory: data });
  }),
);

avatarsRouter.post(
  "/:id/memory",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const parsed = AvatarMemoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    await recordMemory(avatarId, parsed.data);
    res.status(201).json({ ok: true });
  }),
);

avatarsRouter.delete(
  "/:id/memory/:memoryId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { error } = await supabase.from("avatar_memory").delete().eq("id", req.params.memoryId).eq("avatar_id", avatarId);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── Character Bible : pack de références ─────────────────────
avatarsRouter.get(
  "/:id/references",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { listReferences } = await import("../domain/characterBible");
    res.json({ references: await listReferences(avatarId) });
  }),
);

// Génère les vues manquantes (ou celles demandées) avec le modèle photo de l'influenceur, scorées SFace.
avatarsRouter.post(
  "/:id/references/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.6);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "references", estimatedUsd: 0.6 });
    const { IDENTITY_SELECT, generateReferencePack } = await import("../domain/characterBible");
    const avatar = await requireAvatar<import("../domain/characterBible").AvatarIdentity>(req.org!.id, String(req.params.id), IDENTITY_SELECT);
    const kinds = Array.isArray(req.body?.kinds) ? (req.body.kinds as string[]) : undefined;
    const labels = Array.isArray(req.body?.labels) ? (req.body.labels as string[]) : undefined;
    const model = typeof req.body?.model === "string" ? req.body.model : undefined;
    res.status(201).json({ references: await generateReferencePack(avatar, { kinds, labels, model }) });
  }),
);

avatarsRouter.put(
  "/:id/references/:refId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.validated === "boolean") patch.validated = req.body.validated;
    if (typeof req.body?.label === "string") patch.label = req.body.label.slice(0, 60);
    if (Object.keys(patch).length === 0) throw badRequest("Rien à modifier.");
    const { data, error } = await supabase.from("avatar_references").update(patch).eq("id", req.params.refId).eq("avatar_id", avatarId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "Référence introuvable" }); return; }
    res.json({ reference: data });
  }),
);

avatarsRouter.delete(
  "/:id/references/:refId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { error } = await supabase.from("avatar_references").delete().eq("id", req.params.refId).eq("avatar_id", avatarId);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── Character Bible : garde-robe ─────────────────────────────
avatarsRouter.get(
  "/:id/wardrobe",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { listWardrobe } = await import("../domain/characterBible");
    res.json({ wardrobe: await listWardrobe(avatarId) });
  }),
);

avatarsRouter.post(
  "/:id/wardrobe/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.4);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "wardrobe", estimatedUsd: 0.4 });
    const { IDENTITY_SELECT, generateWardrobe } = await import("../domain/characterBible");
    const avatar = await requireAvatar<import("../domain/characterBible").AvatarIdentity & { personality: string[] | null; clothing_style: string | null; system_prompt: string | null }>(
      req.org!.id, String(req.params.id), `${IDENTITY_SELECT}, personality, clothing_style, system_prompt`,
    );
    const count = Number(req.body?.count ?? 4);
    const withImages = req.body?.with_images !== false;
    res.status(201).json({ wardrobe: await generateWardrobe(avatar, { count, withImages, model: typeof req.body?.model === "string" ? req.body.model : undefined }) });
  }),
);

avatarsRouter.post(
  "/:id/wardrobe",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const name = String(req.body?.name ?? "").trim();
    const description_en = String(req.body?.description_en ?? "").trim();
    if (name.length < 2 || description_en.length < 10) throw badRequest("name et description_en requis");
    const { data, error } = await supabase
      .from("avatar_wardrobe")
      .insert({ avatar_id: avatarId, name: name.slice(0, 80), description_en, is_default: Boolean(req.body?.is_default) })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json({ outfit: data });
  }),
);

avatarsRouter.put(
  "/:id/wardrobe/:outfitId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.name === "string") patch.name = req.body.name.slice(0, 80);
    if (typeof req.body?.description_en === "string") patch.description_en = req.body.description_en;
    if (req.body?.is_default === true) {
      await supabase.from("avatar_wardrobe").update({ is_default: false }).eq("avatar_id", avatarId);
      patch.is_default = true;
    }
    if (Object.keys(patch).length === 0) throw badRequest("Rien à modifier.");
    const { data, error } = await supabase.from("avatar_wardrobe").update(patch).eq("id", req.params.outfitId).eq("avatar_id", avatarId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "Tenue introuvable" }); return; }
    res.json({ outfit: data });
  }),
);

avatarsRouter.delete(
  "/:id/wardrobe/:outfitId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { error } = await supabase.from("avatar_wardrobe").delete().eq("id", req.params.outfitId).eq("avatar_id", avatarId);
    if (error) throw error;
    res.status(204).end();
  }),
);

// ── Keyframes : l'influenceur dans un décor, avec une tenue, dans un cadrage (cache réutilisable) ──
avatarsRouter.get(
  "/:id/keyframes",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { listKeyframes, KEYFRAME_FRAMINGS } = await import("../domain/keyframes");
    res.json({
      keyframes: await listKeyframes(avatarId),
      framings: Object.entries(KEYFRAME_FRAMINGS).map(([id, f]) => ({ id, label: f.label, aspect: f.aspect })),
    });
  }),
);

// Renvoie le keyframe du trio (décor, tenue, cadrage) : celui du cache s'il est validé (200, cached),
// sinon le génère, le score et l'archive (201). `force` regénère quoi qu'il arrive.
avatarsRouter.post(
  "/:id/keyframes/generate",
  asyncHandler(async (req, res) => {
    await assertBudget(req.org!.id, 0.15);
    await recordUsage({ orgId: req.org!.id, avatarId: String(req.params.id), kind: "keyframe", estimatedUsd: 0.15 });
    const { IDENTITY_SELECT } = await import("../domain/characterBible");
    const { ensureKeyframe, isFraming } = await import("../domain/keyframes");
    const avatar = await requireAvatar<import("../domain/characterBible").AvatarIdentity>(req.org!.id, String(req.params.id), IDENTITY_SELECT);
    const locationId = String(req.body?.location_id ?? "");
    if (!locationId) throw badRequest("location_id requis");
    if (!avatar.ref_image_url) throw badRequest("Génère d'abord le portrait de l'influenceur.");
    const result = await ensureKeyframe(avatar, {
      locationId,
      outfitId: typeof req.body?.outfit_id === "string" && req.body.outfit_id ? req.body.outfit_id : null,
      framing: isFraming(req.body?.framing) ? req.body.framing : undefined,
      model: typeof req.body?.model === "string" ? req.body.model : undefined,
      force: req.body?.force === true,
    });
    res.status(result.cached ? 200 : 201).json({ keyframe: result.keyframe, cached: result.cached, cost_usd: result.cost });
  }),
);

avatarsRouter.put(
  "/:id/keyframes/:kfId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    if (typeof req.body?.validated !== "boolean") throw badRequest("validated (booléen) requis");
    const { setKeyframeValidated } = await import("../domain/keyframes");
    const keyframe = await setKeyframeValidated(avatarId, String(req.params.kfId), req.body.validated);
    if (!keyframe) { res.status(404).json({ error: "Keyframe introuvable" }); return; }
    res.json({ keyframe });
  }),
);

avatarsRouter.delete(
  "/:id/keyframes/:kfId",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.params.id);
    await requireAvatar(req.org!.id, avatarId, "id");
    const { deleteKeyframe } = await import("../domain/keyframes");
    await deleteKeyframe(avatarId, String(req.params.kfId));
    res.status(204).end();
  }),
);

// ── CRUD avatars ─────────────────────────────────────────────
avatarsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatars").select("*").eq("org_id", req.org!.id).order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ avatars: data });
  }),
);

avatarsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ avatar: await requireAvatar(req.org!.id, String(req.params.id)) });
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
    const { data, error } = await supabase.from("avatars").insert({ ...parsed.data, system_prompt, org_id: req.org!.id }).select("*").single();
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
    const current = await requireAvatar(req.org!.id, String(req.params.id));
    const merged = { ...current, ...parsed.data } as Parameters<typeof buildSystemPrompt>[0];
    const system_prompt = buildSystemPrompt(merged);
    const { data, error } = await supabase
      .from("avatars")
      .update({ ...parsed.data, system_prompt })
      .eq("id", current.id)
      .eq("org_id", req.org!.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ avatar: data });
  }),
);

avatarsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await requireAvatar(req.org!.id, String(req.params.id), "id");
    const { error } = await supabase.from("avatars").delete().eq("id", req.params.id).eq("org_id", req.org!.id);
    if (error) throw error;
    res.status(204).end();
  }),
);
