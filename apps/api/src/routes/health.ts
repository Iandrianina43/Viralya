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
    // Vivacité de l'API : ne dépend pas du worker (un orchestrateur ne doit pas redémarrer l'API parce que
    // le worker s'est tu) ; /health/worker sert à la supervision du worker.
    res.status(error ? 503 : 200).json({ ok: !error, service: "viralya-api", db: error ? "error" : "ok", worker: { alive: workerAlive, last_beat: lastBeat?.toISOString() ?? null }, time: new Date().toISOString() });
  }),
);

healthRouter.get(
  "/health/worker",
  asyncHandler(async (_req, res) => {
    const { data: hb } = await supabase.from("system_status").select("updated_at").eq("key", "worker").maybeSingle();
    const lastBeat = hb?.updated_at ? new Date(String(hb.updated_at)) : null;
    const alive = !!lastBeat && Date.now() - lastBeat.getTime() < 3 * 60_000;
    res.status(alive ? 200 : 503).json({ ok: alive, last_beat: lastBeat?.toISOString() ?? null, time: new Date().toISOString() });
  }),
);
