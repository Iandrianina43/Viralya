import { AvatarInputSchema } from "@viralya/shared";
import { Router } from "express";
import { buildSystemPrompt } from "../domain/systemPrompt";
import { asyncHandler } from "../lib/asyncHandler";
import { supabase } from "../supabase";

// Brouillons de création d'avatar (Chat Ultime) — auto-save serveur.
export const avatarDraftsRouter = Router();

avatarDraftsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from("avatar_drafts")
      .select("id, title, ready, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    res.json({ drafts: data });
  }),
);

avatarDraftsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatar_drafts").select("*").eq("id", req.params.id).single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
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
    const { data, error } = await supabase.from("avatar_drafts").insert(body(req)).select("*").single();
    if (error) throw error;
    res.status(201).json({ record: data });
  }),
);

avatarDraftsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("avatar_drafts").update(body(req)).eq("id", req.params.id).select("*").single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ record: data });
  }),
);

avatarDraftsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { error } = await supabase.from("avatar_drafts").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  }),
);

// Étape 4 — transforme le brouillon en avatar réel (actif), puis supprime le brouillon.
avatarDraftsRouter.post(
  "/:id/finalize",
  asyncHandler(async (req, res) => {
    const { data: rec, error } = await supabase.from("avatar_drafts").select("*").eq("id", req.params.id).single();
    if (error || !rec) {
      res.status(404).json({ error: "not_found" });
      return;
    }
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
      .insert({ ...parsed.data, system_prompt })
      .select("*")
      .single();
    if (insErr) throw insErr;

    await supabase.from("avatar_drafts").delete().eq("id", req.params.id);
    res.status(201).json({ avatar });
  }),
);
