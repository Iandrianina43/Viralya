import { AvatarInputSchema, AvatarMemoryInputSchema } from "@viralya/shared";
import { Router } from "express";
import { buildSystemPrompt } from "../domain/systemPrompt";
import { asyncHandler } from "../lib/asyncHandler";
import { recordMemory } from "../memory/memory";
import { supabase } from "../supabase";

export const avatarsRouter = Router();

// ── Mémoire narrative (écosystème vivant) ────────────────────
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
    const parsed = AvatarMemoryInputSchema.omit({ avatar_id: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    await recordMemory(String(req.params.id), {
      kind: parsed.data.kind,
      summary: parsed.data.summary,
      status: parsed.data.status,
      importance: parsed.data.importance,
    });
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

avatarsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from("avatars")
      .select("*")
      .order("created_at", { ascending: false });
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
    const { data, error } = await supabase
      .from("avatars")
      .insert({ ...parsed.data, system_prompt })
      .select("*")
      .single();
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
    const { data: current, error: e1 } = await supabase
      .from("avatars")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (e1 || !current) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const merged = { ...current, ...parsed.data };
    const system_prompt = buildSystemPrompt(merged);
    const { data, error } = await supabase
      .from("avatars")
      .update({ ...parsed.data, system_prompt })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ avatar: data });
  }),
);

// Régénère le prompt système depuis la fiche courante.
avatarsRouter.post(
  "/:id/regenerate-prompt",
  asyncHandler(async (req, res) => {
    const { data: current, error: e1 } = await supabase
      .from("avatars")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (e1 || !current) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const system_prompt = buildSystemPrompt(current);
    const { data, error } = await supabase
      .from("avatars")
      .update({ system_prompt })
      .eq("id", req.params.id)
      .select("*")
      .single();
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
