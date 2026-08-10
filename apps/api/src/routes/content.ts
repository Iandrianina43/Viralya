import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

export const contentRouter = Router();

contentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let q = supabase.from("content_items").select("*").order("created_at", { ascending: false }).limit(200);
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
    const { data, error } = await supabase.from("content_items").select("*").eq("id", req.params.id).single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ item: data });
  }),
);

// Approbation humaine → enfile un job schedule.
contentRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase.from("content_items").select("id, status").eq("id", req.params.id).single();
    if (error || !item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!["needs_review", "failed"].includes(item.status)) {
      res.status(409).json({ error: `statut ${item.status} non approuvable` });
      return;
    }
    const scheduledAt = req.body?.scheduled_at as string | undefined;
    const job = await enqueue("schedule", { content_item_id: item.id, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// Valide les images (keyframes) → reprend la production : animation + montage.
contentRouter.post(
  "/:id/approve-images",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase.from("content_items").select("id, assets").eq("id", req.params.id).single();
    if (error || !item) { res.status(404).json({ error: "not_found" }); return; }
    const assets = (item.assets ?? {}) as Record<string, unknown>;
    const log = Array.isArray(assets.log) ? (assets.log as Array<{ t: string; msg: string }>) : [];
    log.push({ t: new Date().toISOString(), msg: "▶️ Images validées — animation des scènes" });
    await supabase
      .from("content_items")
      .update({ assets: { ...assets, images_approved: true, awaiting_approval: false, log } })
      .eq("id", item.id);
    const job = await enqueue("poll_video", { content_item_id: item.id }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// Régénère l'image d'une scène (avant validation) — sans relancer toute la production.
contentRouter.post(
  "/:id/scenes/:idx/regenerate-image",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase.from("content_items").select("id, assets").eq("id", req.params.id).single();
    if (error || !item) { res.status(404).json({ error: "not_found" }); return; }
    const assets = (item.assets ?? {}) as Record<string, any>;
    const idx = Number(req.params.idx);
    const scenes = Array.isArray(assets.scenes) ? assets.scenes : [];
    const sc = scenes.find((s: { idx: number }) => s.idx === idx);
    if (!sc) { res.status(404).json({ error: "scène introuvable" }); return; }
    sc.phase = "waiting";
    sc.keyframe_url = undefined;
    sc.hf_job_id = undefined;
    sc.submit_attempts = 0;
    const log = Array.isArray(assets.log) ? assets.log : [];
    log.push({ t: new Date().toISOString(), msg: `🔄 Scène ${idx + 1} : nouvelle image demandée` });
    await supabase
      .from("content_items")
      .update({ assets: { ...assets, scenes, log, awaiting_approval: false } })
      .eq("id", item.id);
    const job = await enqueue("poll_video", { content_item_id: item.id }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// Annule une production en cours : stoppe les jobs en file et marque le contenu.
// (Les rendus déjà lancés chez le provider ne sont pas facturés en retour, mais
// plus aucune étape suivante ne sera soumise.)
contentRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase.from("content_items").select("id, status").eq("id", req.params.id).single();
    if (error || !item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (["needs_review", "published", "scheduled", "failed"].includes(item.status)) {
      res.status(409).json({ error: `production ${item.status} — rien à annuler` });
      return;
    }
    await supabase
      .from("jobs")
      .update({ status: "canceled", locked_at: null, locked_by: null })
      .eq("content_item_id", item.id)
      .in("status", ["pending", "running"]);
    await supabase
      .from("content_items")
      .update({ status: "failed", error: "Production annulée" })
      .eq("id", item.id);
    res.json({ ok: true });
  }),
);

contentRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const { error } = await supabase.from("content_items").update({ status: "failed", error: "rejeté en revue" }).eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  }),
);

// Régénère depuis le début (utile après avoir assigné visage/voix, ou après échec).
contentRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    const { data: item, error } = await supabase.from("content_items").select("id").eq("id", req.params.id).single();
    if (error || !item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await supabase.from("content_items").update({ status: "queued", error: null }).eq("id", item.id);
    const job = await enqueue("generate_text", { content_item_id: item.id }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);
