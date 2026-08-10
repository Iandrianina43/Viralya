import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

export const contentRouter = Router();

contentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let q = supabase
      .from("content_items")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (req.query.avatar_id) q = q.eq("avatar_id", String(req.query.avatar_id));
    if (req.query.status) q = q.eq("status", String(req.query.status));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ content: data });
  }),
);

contentRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("content_items")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ item: data });
  }),
);

// Approbation humaine → enfile un job `schedule` (compliance-safe).
contentRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase
      .from("content_items")
      .select("id, status")
      .eq("id", req.params.id)
      .single();
    if (error || !item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!["needs_review", "ready", "failed"].includes(item.status)) {
      res.status(409).json({ error: `statut ${item.status} non approuvable` });
      return;
    }
    const scheduledAt = req.body?.scheduled_at as string | undefined;
    const job = await enqueue(
      "schedule",
      { content_item_id: item.id, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) },
      { contentItemId: item.id },
    );
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

contentRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from("content_items")
      .update({ status: "failed", error: "rejeté en revue humaine" })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  }),
);

// Régénère un contenu depuis le début (nouveau script + médias).
// Utile après avoir assigné le visage/voix, ou pour retenter un échec.
contentRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase
      .from("content_items")
      .select("id")
      .eq("id", req.params.id)
      .single();
    if (error || !item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await supabase
      .from("content_items")
      .update({ status: "queued", error: null })
      .eq("id", item.id);
    const job = await enqueue(
      "generate_text",
      { content_item_id: item.id },
      { contentItemId: item.id },
    );
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);
