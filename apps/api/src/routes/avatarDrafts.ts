import { AvatarInputSchema } from "@viralya/shared";
import { Router } from "express";
import { buildSystemPrompt } from "../domain/systemPrompt";
import { asyncHandler } from "../lib/asyncHandler";
import { notFound } from "../lib/httpError";
import { supabase } from "../supabase";

// Brouillons de création d'avatar (Chat Ultime) — auto-save serveur, par organisation.
export const avatarDraftsRouter = Router();

avatarDraftsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("avatar_drafts")
      .select("id, title, ready, updated_at")
      .eq("org_id", req.org!.id)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    res.json({ drafts: data });
  }),
);

avatarDraftsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatar_drafts").select("*").eq("id", req.params.id).eq("org_id", req.org!.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Brouillon");
    res.json({ record: data });
  }),
);

function body(req: { body?: Record<string, unknown> }) {
  const b = req.body ?? {};
  return {
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "Brouillon",
    messages: Array.isArray(b.messages) ? b.messages : [],
    fiche: b.fiche && typeof b.fiche === "object" ? b.fiche : {},
    ready: Boolean(b.ready),
  };
}

avatarDraftsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatar_drafts").insert({ ...body(req), org_id: req.org!.id }).select("*").single();
    if (error) throw error;
    res.status(201).json({ record: data });
  }),
);

avatarDraftsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("avatar_drafts")
      .update(body(req))
      .eq("id", req.params.id)
      .eq("org_id", req.org!.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Brouillon");
    res.json({ record: data });
  }),
);

avatarDraftsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { error } = await supabase.from("avatar_drafts").delete().eq("id", req.params.id).eq("org_id", req.org!.id);
    if (error) throw error;
    res.status(204).end();
  }),
);

// Étape 4 — transforme le brouillon en avatar réel (actif), puis supprime le brouillon.
avatarDraftsRouter.post(
  "/:id/finalize",
  asyncHandler(async (req, res) => {
    const orgId = req.org!.id;
    const { data: rec, error } = await supabase.from("avatar_drafts").select("*").eq("id", req.params.id).eq("org_id", orgId).maybeSingle();
    if (error) throw error;
    if (!rec) throw notFound("Brouillon");
    const f = (rec.fiche ?? {}) as Record<string, any>;
    const parsed = AvatarInputSchema.safeParse({
      name: f.name,
      niche: f.niche,
      sex_age: f.sex_age ?? "",
      nationality: f.nationality ?? "",
      city: f.city ?? "",
      timezone: f.timezone ?? "Europe/Paris",
      personality: f.personality ?? [],
      tone_of_voice: f.tone_of_voice ?? "",
      values: f.values ?? [],
      backstory: f.backstory ?? "",
      business_positioning: f.business_positioning ?? "",
      target_audience: f.target_audience ?? "",
      products: f.products ?? [],
      is_ai_disclosed: true,
      status: "active",
      ref_image_url: f.ref_image_url ?? null,
      portrait_spec: f.portrait_spec ?? null,
      eleven_voice_id: f.eleven_voice_id ?? null,
      eleven_voice_name: f.eleven_voice_name ?? null,
    });
    if (!parsed.success) {
      res.status(400).json({ error: "fiche incomplète", details: parsed.error.flatten() });
      return;
    }
    const system_prompt = buildSystemPrompt(parsed.data);
    const { data: avatar, error: insErr } = await supabase
      .from("avatars")
      .insert({ ...parsed.data, system_prompt, org_id: orgId })
      .select("*")
      .single();
    if (insErr) throw insErr;

    await supabase.from("avatar_drafts").delete().eq("id", req.params.id).eq("org_id", orgId);
    res.status(201).json({ avatar });

    // En tâche de fond : planche d'identité + échantillons de timbre.
    // Non bloquant — regénérables depuis l'éditeur.
    void (async () => {
      try {
        if (avatar.ref_image_url) {
          const { composeKeyframe } = await import("../providers/image");
          const { buildCharacterSheetPrompt } = await import("../domain/faceGen");
          const { imageUrl } = await composeKeyframe(
            avatar.ref_image_url, null, buildCharacterSheetPrompt(avatar.portrait_spec ?? null),
            `${avatar.id}/character-sheet-${Date.now()}`, "1536x1024",
          );
          await supabase.from("avatars").update({ character_sheet_url: imageUrl }).eq("id", avatar.id);
        }
        if (avatar.eleven_voice_id) {
          const { generateVoiceSamples } = await import("../providers/elevenlabs");
          const urls = await generateVoiceSamples(avatar.eleven_voice_id, avatar.id);
          await supabase.from("avatars").update({ voice_sample_urls: urls }).eq("id", avatar.id);
        }
      } catch (err) {
        const { logger } = await import("../logger");
        logger.warn("avatar_refs_bootstrap_failed", { avatarId: avatar.id, err: String((err as Error)?.message ?? err) });
      }
    })();
  }),
);
