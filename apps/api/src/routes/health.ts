import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { supabase } from "../supabase";

export const healthRouter = Router();

healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const { error } = await supabase.from("avatars").select("id", { count: "exact", head: true });
    // Battement de cœur du worker (system_status, migration 0017) : 503 s'il s'est tu depuis plus de 3 min,
    // pour qu'un moniteur externe (UptimeRobot…) alerte.
    const { data: hb } = await supabase.from("system_status").select("updated_at").eq("key", "worker").maybeSingle();
    const lastBeat = hb?.updated_at ? new Date(String(hb.updated_at)) : null;
    const workerAlive = !!lastBeat && Date.now() - lastBeat.getTime() < 3 * 60_000;
    const ok = !error && (workerAlive || !lastBeat);
    res.status(ok ? 200 : 503).json({ ok, service: "viralya-api", db: error ? "error" : "ok", worker: { alive: workerAlive, last_beat: lastBeat?.toISOString() ?? null }, time: new Date().toISOString() });
  }),
);
