import express, { Router } from "express";
import { config } from "../config";
import { buildContextBrief } from "../context/contextBuilder";
import { breakIntoScenes, directVlog, writeStory, VLOG_PRESETS, type VlogProduction, type VlogScene } from "../domain/director";
import { launchProduction, type LaunchOptions } from "../domain/production";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, notFound } from "../lib/httpError";
import { orgAvatarIds, requireAvatar } from "../lib/scope";
import { getMemoryBrief } from "../memory/memory";
import {
  clampDuration,
  clampResolution,
  DEFAULT_SEEDANCE_MODEL,
  DEFAULT_SEEDANCE_RESOLUTION,
  estimateProductionCost,
  isSeedanceModel,
  piapiAccountInfo,
  piapiConfigured,
  SEEDANCE_MODELS,
  type SeedanceTaskType,
} from "../providers/piapi";
import { DEFAULT_TALK_PROVIDER, isTalkMode, isTalkProvider, TALK_PROVIDERS, type TalkMode, type TalkProvider } from "../providers/talkingAvatar";
import { estimateHybridCost, readHybridSettings } from "../pipeline/hybrid";
import { enqueue, retryJob, type JobLogEntry } from "../queue/queue";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// STUDIO — fonctions de production ouvertes à tout utilisateur connecté,
// strictement dans le périmètre de son organisation (req.org).
// Réalisateur IA, production Seedance, coûts PiAPI, Task Center.
// ─────────────────────────────────────────────────────────────
export const studioRouter = Router();

type AvatarCore = { id: string; name: string; niche: string; city: string | null; timezone: string | null; system_prompt: string | null };
const AVATAR_CORE = "id, name, niche, city, timezone, system_prompt";

function sse(res: import("express").Response) {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
  return (evt: Record<string, unknown>) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

// Déclenche plan_day pour un influenceur (équivalent manuel du cron).
studioRouter.post(
  "/plan-day",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    // manual: true → passe outre DAILY_PLAN_ENABLED (déclenchement volontaire depuis l'interface).
    const job = await enqueue("plan_day", { avatar_id: avatarId, manual: true }, { avatarId, label: "Contenu du jour" });
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// ── ASSISTANT DE RÉALISATION (étape par étape) ───────────────
async function loadDirectorContext(orgId: string, avatarId: string) {
  const avatar = await requireAvatar<AvatarCore>(orgId, avatarId, AVATAR_CORE);
  const { listLocations } = await import("../domain/locations");
  const [contextBrief, memoryBrief, locations] = await Promise.all([
    buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }),
    getMemoryBrief(avatarId),
    listLocations(avatarId).catch(() => []),
  ]);
  return {
    avatar,
    base: {
      name: avatar.name, niche: avatar.niche, city: avatar.city, system_prompt: avatar.system_prompt,
      contextBrief, memoryBrief,
      locations: locations.map((l) => ({ key: l.key, name: l.name, description: l.description })),
    },
  };
}

// Étape 1 (SSE) : écrit / réécrit l'histoire.
studioRouter.post(
  "/vlog/story",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    const { base } = await loadDirectorContext(req.org!.id, avatarId);
    const send = sse(res);
    try {
      const result = await writeStory(
        {
          ...base,
          presetKey: req.body?.preset ? String(req.body.preset) : undefined,
          brief: req.body?.brief ? String(req.body.brief) : undefined,
          previousStory: req.body?.previous_story ? String(req.body.previous_story) : undefined,
          instruction: req.body?.instruction ? String(req.body.instruction) : undefined,
        },
        (t) => send({ type: "token", text: t }),
      );
      send({ type: "story", result });
    } catch (err) {
      send({ type: "error", error: String((err as Error)?.message ?? err) });
    } finally {
      res.end();
    }
  }),
);

// Étape 2 : découpe l'histoire validée en scènes (durée cible).
studioRouter.post(
  "/vlog/scenes",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const story = String(req.body?.story ?? "");
    if (!avatarId || story.length < 20) throw badRequest("avatar_id et story requis");
    const { base } = await loadDirectorContext(req.org!.id, avatarId);
    const scenes = await breakIntoScenes({
      ...base,
      story,
      format: req.body?.format === "seedance" ? "seedance" : "hybrid",
      // Prise unique par défaut (recommandée) ; `single_take: false` = format monté en plans courts.
      singleTake: req.body?.single_take !== false,
      durationSec: Math.max(10, Math.min(90, Number(req.body?.duration_sec ?? 30))),
      previousScenes: Array.isArray(req.body?.previous_scenes) ? (req.body.previous_scenes as VlogScene[]) : undefined,
      instruction: req.body?.instruction ? String(req.body.instruction) : undefined,
    });
    res.json({ scenes });
  }),
);

// Étape 3 : lance la production du découpage validé.
studioRouter.post(
  "/vlog/produce",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const production = req.body?.production as VlogProduction | undefined;
    if (!avatarId || !production?.scenes?.length) throw badRequest("avatar_id et production.scenes requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    // Logique partagée avec le calendrier et les campagnes UGC (domain/production.ts) :
    // décors inédits, estimation, content_item, premier job — jamais de contenu bloqué sans job.
    const r = await launchProduction(avatarId, production, {
      format: req.body?.format, videoModel: req.body?.video_model, resolution: req.body?.resolution,
      talkProvider: req.body?.talk_provider, talkMode: req.body?.talk_mode, ttsModel: req.body?.tts_model,
      subtitles: req.body?.subtitles === true, music: req.body?.music !== false,
      // Prise unique par défaut ; le format monté (plans courts) est demandé explicitement.
      singleTake: req.body?.single_take !== false, inserts: req.body?.inserts === true,
      locationScopes: (req.body?.location_scopes ?? {}) as Record<string, "permanent" | "oneoff">,
    });
    res.status(202).json({ ok: true, job_id: r.jobId, content_item_id: r.itemId, estimated_cost_usd: r.estimate, format: r.format });
  }),
);

// Estimation du coût d'une production (avant lancement).
//  - format "seedance" : durations[] ;
//  - format "hybrid"   : scenes[{mode, texte, duration_sec}] + talk_provider/talk_mode.
studioRouter.post("/vlog/estimate", (req, res) => {
  const taskType: SeedanceTaskType = isSeedanceModel(req.body?.video_model) ? req.body.video_model : DEFAULT_SEEDANCE_MODEL;
  const resolution = clampResolution(taskType, String(req.body?.resolution ?? DEFAULT_SEEDANCE_RESOLUTION));
  if (req.body?.format === "hybrid" && Array.isArray(req.body?.scenes)) {
    const scenes = (req.body.scenes as Array<Partial<VlogScene>>).map((s) => ({
      mode: s.mode === "talk" ? ("talk" as const) : ("voiceover" as const),
      texte: String(s.texte ?? ""),
      duration_sec: Number(s.duration_sec) || 12,
      ...(Array.isArray(s.inserts) ? { inserts: s.inserts } : {}),
    })) as VlogScene[];
    const settings = readHybridSettings({ talk_provider: req.body?.talk_provider, talk_mode: req.body?.talk_mode, video_model: taskType, resolution });
    const estimate = estimateHybridCost(scenes, settings, { music: req.body?.music !== false });
    res.json({ format: "hybrid", task_type: taskType, resolution, talk_provider: settings.talkProvider, talk_mode: settings.talkMode, total_usd: estimate.total, per_segment_usd: estimate.shots });
    return;
  }
  const durations = (Array.isArray(req.body?.durations) ? req.body.durations : [15]).map((d: unknown) => clampDuration(Number(d) || 15));
  const estimate = estimateProductionCost(taskType, resolution, durations);
  res.json({ format: "seedance", task_type: taskType, resolution, total_usd: estimate.total, per_segment_usd: estimate.segments });
});

// Catalogue des moteurs d'avatar parlant (vidéo v2) : prix/s + verdict du banc du 3 sept. 2026.
studioRouter.get("/talk-providers", (_req, res) => {
  res.json({
    providers: Object.entries(TALK_PROVIDERS).map(([id, p]) => ({ id, label: p.label, hint: p.hint, price_per_sec: p.pricePerSec, modes: p.modes })),
    default: DEFAULT_TALK_PROVIDER,
    default_mode: "std",
    elevenlabs_configured: !!config.ELEVENLABS_API_KEY,
  });
});

// PROMPTS FINAUX : assemble le prompt Seedance exact de chaque segment (avant lancement).
studioRouter.post(
  "/vlog/preview-prompts",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const scenes = (req.body?.production?.scenes ?? []) as VlogScene[];
    if (!avatarId || !scenes.length) throw badRequest("avatar_id et production.scenes requis");
    await requireAvatar(req.org!.id, avatarId, "id");

    const { loadAvatarRefs } = await import("../pipeline/handlers/generateVideo");
    const { buildSegmentPrompt } = await import("../domain/director");
    let refs;
    try {
      refs = await loadAvatarRefs(avatarId);
    } catch (err) {
      throw badRequest(String((err as Error)?.message ?? err));
    }
    const { data: locRows } = await supabase.from("avatar_locations").select("key, description, ref_image_url").eq("avatar_id", avatarId);
    const locations = new Map((locRows ?? []).map((l) => [l.key as string, l as { description: string; ref_image_url: string | null }]));

    const prompts = scenes.map((sc, i) => {
      const loc = sc.location_key ? locations.get(sc.location_key) : undefined;
      const description = loc?.description ?? sc.new_location?.description ?? null;
      return buildSegmentPrompt({
        scene: sc,
        isFirst: i === 0,
        refs: { hasSheet: refs.hasSheet, hasLocationImage: !!loc?.ref_image_url, voiceRefs: refs.audioUrls.length },
        locationDescription: description,
        city: refs.city,
      });
    });
    res.json({ prompts });
  }),
);

// DÉCOR PRÊT AVANT PAIEMENT : crée un lieu inédit (avec image) ou régénère l'image manquante.
studioRouter.post(
  "/vlog/prepare-location",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const key = String(req.body?.key ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    if (!avatarId || !key) throw badRequest("avatar_id et key requis");
    await requireAvatar(req.org!.id, avatarId, "id");

    const { listLocations, createLocation, regenerateLocationImage } = await import("../domain/locations");
    const existing = (await listLocations(avatarId, "all").catch(() => [])).find((l) => l.key === key);

    if (existing?.ref_image_url) { res.json({ location: existing }); return; }
    if (existing) {
      res.json({ location: await regenerateLocationImage(avatarId, existing.id) });
      return;
    }
    const name = String(req.body?.name ?? key);
    const description = String(req.body?.description ?? "").trim();
    if (description.length < 10) throw badRequest("description requise pour créer le décor");
    const scope = req.body?.scope === "oneoff" ? ("oneoff" as const) : ("permanent" as const);
    res.status(201).json({ location: await createLocation(avatarId, { key, name, description }, true, scope) });
  }),
);

// MOTEUR VLOG COMPLET (SSE) : histoire en streaming, puis production en file.
studioRouter.post(
  "/generate-vlog",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const preset = String(req.body?.preset ?? "vlog");
    if (!avatarId) throw badRequest("avatar_id requis");
    if (!piapiConfigured()) throw badRequest("PiAPI non configuré (PIAPI_API_KEY dans .env)");
    const avatar = await requireAvatar<AvatarCore>(req.org!.id, avatarId, AVATAR_CORE);

    const send = sse(res);
    try {
      send({ type: "step", step: "context", label: "Lecture du contexte (météo, heure, mémoire, lieux)…" });
      const { listLocations, createLocation } = await import("../domain/locations");
      const [contextBrief, memoryBrief, locations] = await Promise.all([
        buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }),
        getMemoryBrief(avatarId),
        listLocations(avatarId).catch(() => []),
      ]);

      send({ type: "step", step: "director", label: "Le réalisateur IA écrit l'histoire…" });
      const production = await directVlog(
        {
          name: avatar.name, niche: avatar.niche, city: avatar.city,
          system_prompt: avatar.system_prompt, presetKey: preset, contextBrief, memoryBrief,
          locations: locations.map((l) => ({ key: l.key, name: l.name, description: l.description })),
        },
        (t) => send({ type: "token", text: t }),
      );
      send({ type: "production", production });

      const known = new Set(locations.map((l) => l.key));
      for (const sc of production.scenes) {
        if (sc.new_location && !known.has(sc.new_location.key)) {
          send({ type: "step", step: "location", label: `Nouveau lieu : « ${sc.new_location.name} » — création de sa référence…` });
          try {
            await createLocation(avatarId, sc.new_location, true);
            known.add(sc.new_location.key);
          } catch { /* le vlog peut continuer sans la réf */ }
        }
        if (sc.new_location && !sc.location_key) sc.location_key = sc.new_location.key;
      }

      const { data: item, error } = await supabase
        .from("content_items")
        .insert({
          avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating", title: production.title,
          payload: {
            preset, theme: production.title, production,
            caption: production.caption, hashtags: production.hashtags, script: production.scenes.map((s) => s.texte).join(" "),
          },
        })
        .select("id")
        .single();
      if (error || !item) throw new Error(`insert failed: ${error?.message ?? ""}`);

      await enqueue("generate_video", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label: production.title });
      send({ type: "enqueued", content_item_id: item.id });
    } catch (err) {
      send({ type: "error", error: String((err as Error)?.message ?? err) });
    } finally {
      res.end();
    }
  }),
);

// Clip rapide (preset) via Seedance.
studioRouter.post(
  "/generate-clip",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const preset = String(req.body?.preset ?? "vlog");
    if (!avatarId) throw badRequest("avatar_id requis");
    if (!piapiConfigured()) throw badRequest("PiAPI non configuré (PIAPI_API_KEY dans .env)");
    if (!VLOG_PRESETS[preset]) throw badRequest(`preset inconnu (${Object.keys(VLOG_PRESETS).join(", ")})`);
    await requireAvatar(req.org!.id, avatarId, "id");
    const label = VLOG_PRESETS[preset]!.label;
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({ avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating", title: label, payload: { preset, theme: label } })
      .select("id")
      .single();
    if (error || !item) throw new Error(`generate-clip insert failed: ${error?.message ?? ""}`);
    const job = await enqueue("generate_video", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label });
    res.status(202).json({ ok: true, job_id: job.id, content_item_id: item.id });
  }),
);

// ── PHOTO : une image de l'influenceur dans une scène (références + tenue + décor + QC) ──
studioRouter.post(
  "/photo",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const scene = String(req.body?.scene ?? "").trim();
    if (!avatarId || scene.length < 5) throw badRequest("avatar_id et scene (5 caractères min) requis");
    if (!piapiConfigured()) throw badRequest("PiAPI non configuré (PIAPI_API_KEY dans .env)");
    const avatar = await requireAvatar<{ id: string; ref_image_url: string | null }>(req.org!.id, avatarId, "id, ref_image_url");
    if (!avatar.ref_image_url) throw badRequest("Génère d'abord le portrait de l'influenceur.");

    const { isPiapiImageModel } = await import("../providers/piapiImage");
    const model = isPiapiImageModel(req.body?.model) ? req.body.model : undefined;
    const aspect = ["1:1", "3:4", "4:3", "9:16", "16:9"].includes(String(req.body?.aspect)) ? String(req.body.aspect) : "3:4";
    const network = ["instagram", "tiktok", "facebook", "youtube", "x"].includes(String(req.body?.network)) ? String(req.body.network) : "instagram";
    const title = scene.slice(0, 80);
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({
        avatar_id: avatarId, type: "photo", network, ratio_class: "value", status: "queued", title,
        payload: {
          theme: title, scene, aspect,
          location_key: typeof req.body?.location_key === "string" ? req.body.location_key : null,
          outfit_id: typeof req.body?.outfit_id === "string" ? req.body.outfit_id : null,
          framing: typeof req.body?.framing === "string" ? req.body.framing : null,
          ...(model ? { model } : {}),
        },
      })
      .select("id")
      .single();
    if (error || !item) throw new Error(`insert failed: ${error?.message ?? ""}`);
    const job = await enqueue("generate_text", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label: title });
    res.status(202).json({ ok: true, job_id: job.id, content_item_id: item.id });
  }),
);

// Catalogue des modèles photo (PiAPI) : prix/image + verdict du banc d'essai.
studioRouter.get("/image-models", (_req, res) => {
  void import("../providers/piapiImage").then(({ PIAPI_IMAGE_MODELS, DEFAULT_IMAGE_MODEL }) => {
    res.json({
      models: Object.entries(PIAPI_IMAGE_MODELS).map(([id, m]) => ({ id, label: m.label, hint: m.hint, price_per_image: m.price, max_refs: m.maxRefs })),
      default: config.IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    });
  });
});

// Catalogue Seedance 2.0 (sélecteur du studio) : variantes + prix/s.
studioRouter.get("/video-models", (_req, res) => {
  res.json({
    models: Object.entries(SEEDANCE_MODELS).map(([id, m]) => ({ id, label: m.label, hint: m.hint, price_per_sec: m.pricePerSec })),
    default: DEFAULT_SEEDANCE_MODEL,
    default_resolution: DEFAULT_SEEDANCE_RESOLUTION,
    duration: { min: 4, max: 15, default: 15 },
  });
});

studioRouter.get(
  "/piapi-balance",
  asyncHandler(async (_req, res) => {
    res.json(await piapiAccountInfo());
  }),
);

studioRouter.get(
  "/piapi-history",
  asyncHandler(async (_req, res) => {
    const { piapiHistory } = await import("../providers/piapi");
    const { total, items } = await piapiHistory(100);
    const now = Date.now();
    const DAY = 86_400_000;
    const sum = (sinceMs: number) =>
      Math.round(items.filter((i) => now - Date.parse(i.created_at) < sinceMs).reduce((a, i) => a + i.cost_usd, 0) * 100) / 100;
    res.json({
      total_tasks: total,
      totals: { today: sum(DAY), week: sum(7 * DAY), month: sum(30 * DAY), all_listed: Math.round(items.reduce((a, i) => a + i.cost_usd, 0) * 100) / 100 },
      items: items.slice(0, 20),
    });
  }),
);

// État de configuration des intégrations (booléens, jamais les clés).
studioRouter.get("/setup", (_req, res) => {
  res.json({
    llm: { configured: config.LLM_PROVIDER === "anthropic" ? !!config.ANTHROPIC_API_KEY : !!config.OPENAI_API_KEY, provider: config.LLM_PROVIDER },
    image: { configured: config.IMAGE_PROVIDER === "openai" && !!config.OPENAI_API_KEY },
    piapi: { configured: piapiConfigured() },
    elevenlabs: { configured: !!config.ELEVENLABS_API_KEY },
    default_video_provider: "piapi",
  });
});

// KPIs de l'organisation active.
studioRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const ids = await orgAvatarIds(req.org!.id);
    if (ids.length === 0) { res.json({ avatars: 0, content_total: 0, content_live: 0, in_progress: 0, to_review: 0, failed: 0 }); return; }
    const count = (statuses?: string[]) => {
      let q = supabase.from("content_items").select("id", { count: "exact", head: true }).in("avatar_id", ids);
      if (statuses) q = q.in("status", statuses);
      return q;
    };
    const [total, live, prog, review, failed] = await Promise.all([
      count(), count(["scheduled", "published"]), count(["queued", "generating"]), count(["needs_review"]), count(["failed", "canceled"]),
    ]);
    res.json({
      avatars: ids.length,
      content_total: total.count ?? 0,
      content_live: live.count ?? 0,
      in_progress: prog.count ?? 0,
      to_review: review.count ?? 0,
      failed: failed.count ?? 0,
    });
  }),
);

// ── TASK CENTER ──────────────────────────────────────────────
type TaskState = "running" | "upcoming" | "review" | "done" | "failed";
const CONTENT_STATE: Record<string, TaskState> = {
  queued: "running", generating: "running", needs_review: "review", scheduled: "upcoming",
  published: "done", failed: "failed", canceled: "failed",
};
const JOB_STATE: Record<string, TaskState> = { pending: "running", running: "running", done: "done", failed: "failed", canceled: "failed" };
const TYPE_LABEL: Record<string, string> = { video: "Vidéo", hook: "Accroche", carousel: "Carrousel", story: "Story", tweet: "Post", photo: "Photo" };
const JOB_LABEL: Record<string, string> = {
  plan_day: "Contenu du jour", generate_text: "Écriture", generate_video: "Tournage", poll_video: "Rendu vidéo",
  generate_voice: "Voix", generate_shots: "Plans", poll_shots: "Rendu des plans",
  generate_image: "Image", generate_photo: "Photo", assemble: "Assemblage", schedule: "Programmation", publish: "Publication",
};

interface JobLite {
  id: string; type: string; status: string; attempts: number; max_attempts: number; error: string | null;
  progress: number; logs: JobLogEntry[]; label: string | null; avatar_id: string | null; content_item_id: string | null;
  run_after: string; created_at: string; updated_at: string; cancel_requested: boolean;
}

function itemProgress(status: string, assets: Record<string, any>): number {
  if (status === "needs_review" || status === "scheduled" || status === "published") return 100;
  if (status === "failed" || status === "canceled") return 0;
  const segs = Array.isArray(assets.segments) ? (assets.segments as Array<{ phase: string }>) : [];
  if (segs.length) {
    if (assets.assembling) return 95;
    const done = segs.filter((s) => s.phase === "done").length;
    const inflight = segs.some((s) => s.phase === "video") ? 0.5 : 0;
    return Math.min(95, Math.max(5, Math.round(((done + inflight) / segs.length) * 90)));
  }
  return status === "generating" ? 15 : 2;
}

studioRouter.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const orgId = req.org!.id;
    const { data: avatarRows, error: aErr } = await supabase.from("avatars").select("id, name, ref_image_url").eq("org_id", orgId);
    if (aErr) throw new Error(aErr.message);
    let avatars = avatarRows ?? [];
    if (req.query.avatar_id) avatars = avatars.filter((a) => String(a.id) === String(req.query.avatar_id));
    const ids = avatars.map((a) => String(a.id));
    const empty = { running: 0, upcoming: 0, review: 0, done: 0, failed: 0 };
    if (ids.length === 0) { res.json({ tasks: [], counts: empty }); return; }
    const byAvatar = new Map(avatars.map((a) => [String(a.id), a]));

    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data: items, error: iErr } = await supabase
      .from("content_items")
      .select("id, avatar_id, type, network, status, payload, assets, error, scheduled_at, published_at, created_at, updated_at, current_version, title")
      .in("avatar_id", ids)
      .or(`status.in.(queued,generating,needs_review,scheduled),updated_at.gte.${since}`)
      .order("updated_at", { ascending: false })
      .limit(300);
    if (iErr) throw new Error(iErr.message);
    const itemIds = (items ?? []).map((i) => String(i.id));

    let jobsQ = supabase
      .from("jobs")
      .select("id, type, status, attempts, max_attempts, error, progress, logs, label, avatar_id, content_item_id, run_after, created_at, updated_at, cancel_requested")
      .order("created_at", { ascending: false })
      .limit(400);
    jobsQ = itemIds.length
      ? jobsQ.or(`avatar_id.in.(${ids.join(",")}),content_item_id.in.(${itemIds.join(",")})`)
      : jobsQ.in("avatar_id", ids);
    const { data: jobRows, error: jErr } = await jobsQ;
    if (jErr) throw new Error(jErr.message);
    const jobs = (jobRows ?? []) as JobLite[];

    const latestByItem = new Map<string, JobLite>();
    const logsByItem = new Map<string, JobLogEntry[]>();
    const standalone: JobLite[] = [];
    for (const j of jobs) {
      if (j.content_item_id) {
        if (!latestByItem.has(j.content_item_id)) latestByItem.set(j.content_item_id, j);
        // Journal cumulé de toutes les étapes du contenu (écriture, image, assemblage…).
        if (j.logs?.length) logsByItem.set(j.content_item_id, [...(logsByItem.get(j.content_item_id) ?? []), ...j.logs]);
      } else standalone.push(j);
    }

    const avatarView = (id: string | null) => {
      const a = id ? byAvatar.get(id) : undefined;
      return a ? { id: String(a.id), name: String(a.name), image: (a.ref_image_url as string | null) ?? null } : null;
    };

    const tasks = (items ?? []).map((it) => {
      const assets = (it.assets ?? {}) as Record<string, any>;
      const payload = (it.payload ?? {}) as Record<string, any>;
      const job = latestByItem.get(String(it.id)) ?? null;
      const state = CONTENT_STATE[String(it.status)] ?? "done";
      const logs = [
        ...(Array.isArray(assets.log) ? (assets.log as JobLogEntry[]) : []),
        ...(logsByItem.get(String(it.id)) ?? []),
      ].sort((x, y) => (x.t < y.t ? -1 : 1)).slice(-40);
      const typeLabel = TYPE_LABEL[String(it.type)] ?? String(it.type);
      return {
        id: `content:${it.id}`,
        kind: "content" as const,
        state,
        title: String(it.title || payload.theme || payload.production?.title || typeLabel),
        subtitle: `${typeLabel} · ${it.network}`,
        avatar: avatarView(String(it.avatar_id)),
        content_item_id: String(it.id),
        content_type: String(it.type),
        status: String(it.status),
        progress: itemProgress(String(it.status), assets),
        started_at: String(it.created_at),
        updated_at: String(it.updated_at),
        scheduled_at: (it.scheduled_at as string | null) ?? null,
        error: (it.error as string | null) ?? null,
        logs,
        video_url: (assets.video_url as string | null) ?? null,
        image_urls: Array.isArray(assets.image_urls) ? (assets.image_urls as string[]) : [],
        cost_usd: typeof assets.estimated_cost_usd === "number" ? assets.estimated_cost_usd : null,
        version: Number(it.current_version ?? 0),
        job: job ? { id: job.id, type: job.type, label: JOB_LABEL[job.type] ?? job.type, status: job.status, attempts: job.attempts, max_attempts: job.max_attempts, run_after: job.run_after, error: job.error } : null,
        can_retry: ["failed", "canceled", "needs_review"].includes(String(it.status)),
        can_cancel: ["queued", "generating"].includes(String(it.status)),
      };
    });

    for (const j of standalone) {
      tasks.push({
        id: `job:${j.id}`,
        kind: "content" as const,
        state: JOB_STATE[j.status] ?? "done",
        title: j.label ?? JOB_LABEL[j.type] ?? j.type,
        subtitle: "Tâche",
        avatar: avatarView(j.avatar_id),
        content_item_id: "",
        content_type: "job",
        status: j.status,
        progress: j.status === "done" ? 100 : Number(j.progress ?? 0),
        started_at: j.created_at,
        updated_at: j.updated_at,
        scheduled_at: j.status === "pending" ? j.run_after : null,
        error: j.error,
        logs: j.logs ?? [],
        video_url: null,
        image_urls: [],
        cost_usd: null,
        version: 0,
        job: { id: j.id, type: j.type, label: JOB_LABEL[j.type] ?? j.type, status: j.status, attempts: j.attempts, max_attempts: j.max_attempts, run_after: j.run_after, error: j.error },
        can_retry: j.status === "failed" || j.status === "canceled",
        can_cancel: false,
      });
    }

    const counts = { ...empty };
    for (const t of tasks) counts[t.state] += 1;
    res.json({ tasks, counts });
  }),
);

// Relance un job autonome (ex. plan_day) échoué, dans le périmètre de l'organisation.
studioRouter.post(
  "/jobs/:id/retry",
  asyncHandler(async (req, res) => {
    const { data: job } = await supabase.from("jobs").select("id, avatar_id, status").eq("id", req.params.id).maybeSingle();
    if (!job) throw notFound("Tâche");
    const ids = await orgAvatarIds(req.org!.id);
    if (!job.avatar_id || !ids.includes(String(job.avatar_id))) throw notFound("Tâche");
    await retryJob(String(job.id));
    res.json({ ok: true });
  }),
);

// ─────────────────────────────────────────────────────────────
// FORMATS (6 sept. 2026, docs/RECHERCHE-FORMATS.md) : pub produit sans visage, pub avec elle,
// vidéo explicative sans visage, clone de vidéo. Le script est relu dans l'assistant avant le
// lancement (formats/produce), comme le vlog.
// ─────────────────────────────────────────────────────────────

studioRouter.post(
  "/formats/script",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const kind = String(req.body?.kind ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    const avatar = await requireAvatar<AvatarCore>(req.org!.id, avatarId, AVATAR_CORE);
    const durationSec = Math.max(10, Math.min(30, Number(req.body?.duration_sec) || 30));
    const brief = String(req.body?.brief ?? "").trim();
    const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
    const { writeExplainer, writeProductAd, adCreatorBrief, parseProduct } = await import("../domain/formats");

    if (kind === "explainer") {
      if (brief.length < 5) throw badRequest("Décris le sujet de la vidéo (5 caractères minimum).");
      res.json({ production: await writeExplainer({ avatar, topic: brief, durationSec, instruction }) });
      return;
    }
    if (kind === "ad_product" || kind === "ad_creator") {
      let product;
      try { product = parseProduct(req.body?.product); } catch (err) { throw badRequest(String((err as Error).message)); }
      if (kind === "ad_product") {
        res.json({ production: await writeProductAd({ avatar, product, brief, durationSec, voiceOver: req.body?.voice_over !== false, instruction }) });
        return;
      }
      // Pub avec elle : la prise unique existante (histoire + découpage) avec un brief publicitaire.
      const { listLocations } = await import("../domain/locations");
      const [contextBrief, memoryBrief, locations] = await Promise.all([
        buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }),
        getMemoryBrief(avatarId),
        listLocations(avatarId, "all").catch(() => []),
      ]);
      const base = {
        name: avatar.name, niche: avatar.niche, city: avatar.city, system_prompt: avatar.system_prompt, contextBrief, memoryBrief,
        locations: locations.map((l) => ({ key: l.key, name: l.name, description: l.description })),
      };
      const story = await writeStory({ ...base, brief: adCreatorBrief(product, brief), instruction: instruction || undefined }, () => {});
      const scenes = await breakIntoScenes({ ...base, story: story.story, durationSec, format: "hybrid", singleTake: true });
      res.json({ production: { ...story, scenes } });
      return;
    }
    throw badRequest("kind inconnu (explainer, ad_product, ad_creator)");
  }),
);

studioRouter.post(
  "/formats/produce",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const kind = String(req.body?.kind ?? "");
    const production = req.body?.production as VlogProduction | undefined;
    if (!avatarId || !production?.scenes?.length) throw badRequest("avatar_id et production requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    const { parseProduct, isFormatKind } = await import("../domain/formats");
    if (!isFormatKind(kind) || kind === "vlog") throw badRequest("kind inconnu (ad_product, ad_creator, explainer, clone)");

    const extra: Record<string, unknown> = { kind };
    const opts: LaunchOptions = {
      resolution: typeof req.body?.resolution === "string" ? req.body.resolution : "720p",
      talkMode: typeof req.body?.talk_mode === "string" ? req.body.talk_mode : undefined,
      subtitles: req.body?.subtitles === true,
      music: req.body?.music !== false,
      singleTake: true,
      inserts: req.body?.inserts === true,
      extraPayload: extra,
    };
    if (kind === "ad_product" || kind === "ad_creator") {
      let product;
      try { product = parseProduct(req.body?.product); } catch (err) { throw badRequest(String((err as Error).message)); }
      extra.product = product;
      extra.product_image_url = product.image_url ?? null;
      extra.product_image_urls = product.image_urls ?? [];
      if (kind === "ad_product") extra.faceless = true;
      opts.ratioClass = "sale";
    } else if (kind === "explainer") {
      extra.faceless = true;
    } else if (kind === "clone") {
      const src = String(req.body?.source_video_url ?? "");
      if (!/^https?:\/\//.test(src)) throw badRequest("source_video_url requis (dépose d'abord la vidéo)");
      extra.source_video_url = src;
      extra.source_seconds = Number(req.body?.source_seconds) || null;
      opts.music = false; // la source impose son rythme ; la musique se mixe au montage si on la réactive
    }
    const r = await launchProduction(avatarId, production, opts);
    res.status(202).json({ ok: true, job_id: r.jobId, content_item_id: r.itemId, estimated_cost_usd: r.estimate });
  }),
);

// Estimation d'un format avant lancement (même calcul que le lancement).
studioRouter.post(
  "/formats/estimate",
  asyncHandler(async (req, res) => {
    const production = req.body?.production as VlogProduction | undefined;
    if (!production?.scenes?.length) throw badRequest("production requise");
    const kind = String(req.body?.kind ?? "");
    const settings = readHybridSettings({ talk_mode: req.body?.talk_mode, resolution: req.body?.resolution ?? "720p" });
    const e = estimateHybridCost(production.scenes, settings, { music: req.body?.music !== false && kind !== "clone", kind, inserts: req.body?.inserts === true });
    res.json({ total_usd: e.total, per_shot_usd: e.shots });
  }),
);

// ── CLONE : dépôt de la vidéo source (corps brut ≤ 200 Mo), lien, transcription ──
studioRouter.post(
  "/clone/upload",
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "200mb" }),
  asyncHandler(async (req, res) => {
    const avatarId = String(req.query.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    const bytes = req.body as unknown;
    if (!Buffer.isBuffer(bytes) || bytes.length < 10_000) throw badRequest("Fichier vidéo vide ou illisible (envoie le fichier en corps de requête, content-type video/mp4).");
    const { storeCloneSource } = await import("../domain/formats");
    res.json(await storeCloneSource(avatarId, bytes, String(req.headers["content-type"] ?? "video/mp4")));
  }),
);

studioRouter.post(
  "/clone/link",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const url = String(req.body?.url ?? "").trim();
    if (!avatarId || !url) throw badRequest("avatar_id et url requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    const { downloadCloneLink } = await import("../domain/formats");
    try {
      res.json(await downloadCloneLink(avatarId, url));
    } catch (err) {
      throw badRequest(String((err as Error).message));
    }
  }),
);

studioRouter.post(
  "/clone/transcribe",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const url = String(req.body?.source_url ?? "");
    if (!avatarId || !/^https?:\/\//.test(url)) throw badRequest("avatar_id et source_url requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    const { transcribeCloneSource } = await import("../domain/formats");
    res.json(await transcribeCloneSource(url, typeof req.body?.language === "string" ? req.body.language : undefined));
  }),
);

// Photo de produit (corps brut ≤ 15 Mo) → URL publique réutilisable comme référence.
studioRouter.post(
  "/upload-image",
  express.raw({ type: ["image/*", "application/octet-stream"], limit: "15mb" }),
  asyncHandler(async (req, res) => {
    const avatarId = String(req.query.avatar_id ?? "");
    if (!avatarId) throw badRequest("avatar_id requis");
    await requireAvatar(req.org!.id, avatarId, "id");
    const bytes = req.body as unknown;
    if (!Buffer.isBuffer(bytes) || bytes.length < 1_000) throw badRequest("Image vide ou illisible.");
    const type = String(req.headers["content-type"] ?? "image/jpeg");
    const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : "jpg";
    const { uploadBytes } = await import("../lib/storage");
    const url = await uploadBytes(`${avatarId}/products/${Date.now()}.${ext}`, bytes, type);
    res.json({ url });
  }),
);
