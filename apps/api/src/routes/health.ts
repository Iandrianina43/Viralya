import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { supabase } from "../supabase";

export const healthRouter = Router();

healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const { error } = await supabase.from("avatars").select("id", { count: "exact", head: true });
    res.json({ ok: true, service: "viralya-api", db: error ? "error" : "ok", time: new Date().toISOString() });
  }),
);
