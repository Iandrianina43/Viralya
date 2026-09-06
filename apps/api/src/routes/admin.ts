import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { adminAuth } from "../middleware/adminAuth";
import { reapStaleJobs, retryJob } from "../queue/queue";
import { supabase } from "../supabase";

// Administration de la plateforme (rôle admin ou clé interne) :
// vue globale des jobs, déclenchement du quotidien, reprise manuelle.
export const adminRouter = Router();
adminRouter.use(adminAuth);

adminRouter.post(
  "/enqueue-daily",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.rpc("enqueue_daily_content");
    if (error) throw error;
    res.status(202).json({ ok: true, enqueued: data });
  }),
);

adminRouter.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    let q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(200);
    if (req.query.status) q = q.eq("status", String(req.query.status));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ jobs: data });
  }),
);

adminRouter.post(
  "/jobs/:id/retry",
  asyncHandler(async (req, res) => {
    await retryJob(String(req.params.id));
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/jobs/reap",
  asyncHandler(async (req, res) => {
    const stale = Math.max(60, Number(req.body?.stale_seconds ?? 300));
    res.json({ ok: true, reaped: await reapStaleJobs(stale) });
  }),
);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [orgs, avatars, content, jobsActive, jobsFailed] = await Promise.all([
      supabase.from("organizations").select("id", { count: "exact", head: true }),
      supabase.from("avatars").select("id", { count: "exact", head: true }),
      supabase.from("content_items").select("id", { count: "exact", head: true }),
      supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "running"]),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ]);
    res.json({
      organizations: orgs.count ?? 0,
      avatars: avatars.count ?? 0,
      content_total: content.count ?? 0,
      jobs_active: jobsActive.count ?? 0,
      jobs_failed: jobsFailed.count ?? 0,
    });
  }),
);
