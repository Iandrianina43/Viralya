import { VIDEO_PROVIDERS, type VideoProviderName } from "@viralya/shared";
import { Router } from "express";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { adminAuth } from "../middleware/adminAuth";
import { buildContextBrief } from "../context/contextBuilder";
import { breakIntoScenes, directVlog, writeStory, type VlogScene } from "../domain/director";
import { getMemoryBrief } from "../memory/memory";
import { DEFAULT_VIDEO_MODEL, higgsfieldConfigured, VIDEO_MODELS, VLOG_PRESETS } from "../providers/higgsfield";
import { listAvatars, listVoices } from "../providers/video";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

export const adminRouter = Router();
adminRouter.use(adminAuth);

function providerParam(v: unknown): VideoProviderName {
  const s = String(v ?? config.VIDEO_PROVIDER);
  return (VIDEO_PROVIDERS as readonly string[]).includes(s) ? (s as VideoProviderName) : config.VIDEO_PROVIDER;
}

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

// ── ASSISTANT DE RÉALISATION (étape par étape) ───────────────
// Charge le personnage + son contexte vivant + son univers de lieux.
async function loadDirectorContext(avatarId: string) {
  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, name, niche, city, timezone, system_prompt")
    .eq("id", avatarId)
    .single();
  if (!avatar) throw new Error("avatar introuvable");
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
adminRouter.post(
  "/vlog/story",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    if (!avatarId) { res.status(400).json({ error: "avatar_id requis" }); return; }

    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();
    const send = (evt: Record<string, unknown>) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

    try {
      const { base } = await loadDirectorContext(avatarId);
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
adminRouter.post(
  "/vlog/scenes",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const story = String(req.body?.story ?? "");
    if (!avatarId || story.length < 20) { res.status(400).json({ error: "avatar_id et story requis" }); return; }
    const { base } = await loadDirectorContext(avatarId);
    const scenes = await breakIntoScenes({
      ...base,
      story,
      durationSec: Math.max(10, Math.min(90, Number(req.body?.duration_sec ?? 30))),
      previousScenes: Array.isArray(req.body?.previous_scenes) ? (req.body.previous_scenes as VlogScene[]) : undefined,
      instruction: req.body?.instruction ? String(req.body.instruction) : undefined,
    });
    res.json({ scenes });
  }),
);

// Étape 3 : lance la production du découpage validé (avec pause avant animation).
adminRouter.post(
  "/vlog/produce",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const production = req.body?.production as { title?: string; story?: string; caption?: string; hashtags?: string[]; scenes?: VlogScene[] } | undefined;
    if (!avatarId || !production?.scenes?.length) { res.status(400).json({ error: "avatar_id et production.scenes requis" }); return; }
    if (!higgsfieldConfigured()) { res.status(400).json({ error: "Higgsfield non configuré (clés .env)" }); return; }

    // Nouveaux décors → créés avec leur portée : "permanent" (rejoint l'univers)
    // ou "oneoff" (décor de référence de CETTE vidéo uniquement).
    // Le front peut surcharger le choix de l'IA via location_scopes: { key: scope }.
    const scopes = (req.body?.location_scopes ?? {}) as Record<string, "permanent" | "oneoff">;
    const { listLocations, createLocation } = await import("../domain/locations");
    const known = new Set((await listLocations(avatarId, "all").catch(() => [])).map((l) => l.key));
    const created = new Map<string, string>(); // clé proposée → clé réelle en base

    for (const sc of production.scenes) {
      const nl = sc.new_location;
      if (!nl) continue;
      if (created.has(nl.key)) {
        sc.location_key = created.get(nl.key);
        continue;
      }
      const scope = scopes[nl.key] ?? nl.scope ?? "permanent";
      if (scope === "permanent" && known.has(nl.key)) {
        sc.location_key = nl.key;
        continue;
      }
      try {
        const row = await createLocation(avatarId, nl, true, scope);
        created.set(nl.key, row.key);
        known.add(row.key);
        sc.location_key = row.key;
      } catch {
        if (!sc.location_key) sc.location_key = nl.key; // non bloquant : repli sur la description
      }
    }

    const { data: item, error } = await supabase
      .from("content_items")
      .insert({
        avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating",
        payload: {
          theme: production.title ?? "Vlog", production,
          video_model: String(req.body?.video_model ?? "kling"),
          approve_images: req.body?.approve_images !== false, // pause avant animation par défaut
          caption: production.caption ?? "", hashtags: production.hashtags ?? [],
          script: production.scenes.map((s) => s.texte).join(" "),
        },
      })
      .select("id")
      .single();
    if (error || !item) throw new Error(`insert failed: ${error?.message ?? ""}`);

    const job = await enqueue("generate_video", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id, content_item_id: item.id });
  }),
);

// MOTEUR VLOG COMPLET (SSE) : le réalisateur IA écrit l'histoire en streaming,
// puis les scènes partent en production (Soul → voix → lip-sync/anim → montage).
adminRouter.post(
  "/generate-vlog",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const preset = String(req.body?.preset ?? "vlog");
    if (!avatarId) { res.status(400).json({ error: "avatar_id requis" }); return; }
    if (!higgsfieldConfigured()) { res.status(400).json({ error: "Higgsfield non configuré (clés .env)" }); return; }

    const { data: avatar } = await supabase
      .from("avatars")
      .select("id, name, niche, city, timezone, system_prompt")
      .eq("id", avatarId)
      .single();
    if (!avatar) { res.status(404).json({ error: "avatar introuvable" }); return; }

    // SSE
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();
    const send = (evt: Record<string, unknown>) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

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

      // Lieux inédits inventés par le réalisateur → mémorisés dans l'univers (image de réf incluse).
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
          avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating",
          payload: {
            preset, theme: production.title, production,
            caption: production.caption, hashtags: production.hashtags, script: production.scenes.map((s) => s.texte).join(" "),
          },
        })
        .select("id")
        .single();
      if (error || !item) throw new Error(`insert failed: ${error?.message ?? ""}`);

      await enqueue("generate_video", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id });
      send({ type: "enqueued", content_item_id: item.id });
    } catch (err) {
      send({ type: "error", error: String((err as Error)?.message ?? err) });
    } finally {
      res.end();
    }
  }),
);

// Génère un clip vidéo cinématique (preset vlog) via Higgsfield pour un avatar.
adminRouter.post(
  "/generate-clip",
  asyncHandler(async (req, res) => {
    const avatarId = String(req.body?.avatar_id ?? "");
    const preset = String(req.body?.preset ?? "vlog");
    if (!avatarId) {
      res.status(400).json({ error: "avatar_id requis" });
      return;
    }
    if (!higgsfieldConfigured()) {
      res.status(400).json({ error: "Higgsfield non configuré (clés .env)" });
      return;
    }
    if (!VLOG_PRESETS[preset]) {
      res.status(400).json({ error: `preset inconnu (${Object.keys(VLOG_PRESETS).join(", ")})` });
      return;
    }
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({ avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating", payload: { preset, theme: VLOG_PRESETS[preset].label } })
      .select("id")
      .single();
    if (error || !item) throw new Error(`generate-clip insert failed: ${error?.message ?? ""}`);
    const job = await enqueue("generate_video", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id });
    res.status(202).json({ ok: true, job_id: job.id, content_item_id: item.id });
  }),
);

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
    let q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(100);
    if (req.query.status) q = q.eq("status", String(req.query.status));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ jobs: data });
  }),
);

// Voix / avatars du moteur vidéo choisi (?provider=heygen|argil).
adminRouter.get(
  "/voices",
  asyncHandler(async (req, res) => {
    res.json(await listVoices(providerParam(req.query.provider)));
  }),
);
adminRouter.get(
  "/avatars",
  asyncHandler(async (req, res) => {
    res.json(await listAvatars(providerParam(req.query.provider)));
  }),
);

// Catalogue des moteurs d'animation disponibles (pour le sélecteur du studio).
adminRouter.get("/video-models", (_req, res) => {
  res.json({
    models: Object.entries(VIDEO_MODELS).map(([id, m]) => ({ id, label: m.label, credits: m.credits, hint: m.hint })),
    default: DEFAULT_VIDEO_MODEL,
  });
});

// État de configuration des intégrations (booléens, jamais les clés).
adminRouter.get("/setup", (_req, res) => {
  res.json({
    llm: { configured: config.LLM_PROVIDER === "anthropic" ? !!config.ANTHROPIC_API_KEY : !!config.OPENAI_API_KEY, provider: config.LLM_PROVIDER },
    image: { configured: config.IMAGE_PROVIDER === "openai" && !!config.OPENAI_API_KEY },
    heygen: { configured: !!config.HEYGEN_API_KEY },
    argil: { configured: !!config.ARGIL_API_KEY },
    default_video_provider: config.VIDEO_PROVIDER,
  });
});

// KPIs simples de pilotage.
adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [avatars, content, live] = await Promise.all([
      supabase.from("avatars").select("id", { count: "exact", head: true }),
      supabase.from("content_items").select("id", { count: "exact", head: true }),
      supabase.from("content_items").select("id", { count: "exact", head: true }).in("status", ["scheduled", "published"]),
    ]);
    res.json({ avatars: avatars.count ?? 0, content_total: content.count ?? 0, content_live: live.count ?? 0 });
  }),
);
