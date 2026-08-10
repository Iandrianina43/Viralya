import { Router } from "express";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { adminAuth } from "../middleware/adminAuth";
import { listHeygenAvatars, listHeygenVoices } from "../providers/video";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

export const adminRouter = Router();
adminRouter.use(adminAuth);

// Déclenche plan_day pour un avatar (équivalent manuel du cron).
adminRouter.post(
  "/plan-day",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) {
      res.status(400).json({ error: "avatar_id requis" });
      return;
    }
    const job = await enqueue("plan_day", { avatar_id: avatarId });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// Déclenche le contenu du jour pour tous les avatars actifs (via la fonction SQL).
adminRouter.post(
  "/enqueue-daily",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.rpc("enqueue_daily_content");
    if (error) throw error;
    res.status(202).json({ ok: true, enqueued: data });
  }),
);

// Vue queue (debug / monitoring).
adminRouter.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    let q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(100);
    if (req.query.status) q = q.eq("status", String(req.query.status));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ jobs: data });
  }),
);

// État de configuration des intégrations (booléens uniquement, jamais les clés).
adminRouter.get("/setup", (_req, res) => {
  res.json({
    llm: {
      configured:
        config.LLM_PROVIDER === "anthropic" ? !!config.ANTHROPIC_API_KEY : !!config.OPENAI_API_KEY,
      provider: config.LLM_PROVIDER,
      model: config.LLM_MODEL,
    },
    voice: { configured: !!config.ELEVENLABS_API_KEY, provider: "elevenlabs" },
    video: {
      configured: config.VIDEO_PROVIDER === "heygen" && !!config.HEYGEN_API_KEY,
      provider: config.VIDEO_PROVIDER,
    },
    image: {
      configured: config.IMAGE_PROVIDER === "openai" && !!config.OPENAI_API_KEY,
      provider: config.IMAGE_PROVIDER,
    },
    stripe: { configured: !!config.STRIPE_SECRET_KEY },
    email: { configured: !!config.BREVO_API_KEY, provider: "brevo" },
    scheduler: {
      configured: config.SCHEDULER_PROVIDER !== "stub",
      provider: config.SCHEDULER_PROVIDER,
    },
  });
});

// Intégrations média — voix HeyGen disponibles (TTS natif de la vidéo).
adminRouter.get(
  "/voices",
  asyncHandler(async (_req, res) => {
    res.json(await listHeygenVoices());
  }),
);

// Intégrations média — avatars HeyGen disponibles (assignation par avatar).
adminRouter.get(
  "/heygen-avatars",
  asyncHandler(async (_req, res) => {
    res.json(await listHeygenAvatars());
  }),
);

// M8 — KPIs consolidés pour le dashboard.
adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [avatarsRes, leadsRes, contentRes, ordersRes] = await Promise.all([
      supabase.from("avatars").select("id", { count: "exact", head: true }),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed"),
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .in("status", ["scheduled", "published"]),
      supabase.from("orders").select("amount_cents").eq("status", "paid"),
    ]);
    const revenue_cents = (ordersRes.data ?? []).reduce(
      (s, o) => s + (o.amount_cents ?? 0),
      0,
    );
    res.json({
      avatars: avatarsRes.count ?? 0,
      leads_confirmed: leadsRes.count ?? 0,
      content_live: contentRes.count ?? 0,
      revenue_cents,
    });
  }),
);
