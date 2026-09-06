import { config } from "../config";
import { badRequest } from "../lib/httpError";
import { estimateHybridCost, readHybridSettings } from "../pipeline/hybrid";
import { clampDuration, clampResolution, DEFAULT_SEEDANCE_MODEL, DEFAULT_SEEDANCE_RESOLUTION, estimateProductionCost, isSeedanceModel, piapiConfigured, type SeedanceTaskType } from "../providers/piapi";
import { DEFAULT_TALK_PROVIDER, isTalkMode, isTalkProvider, type TalkMode, type TalkProvider } from "../providers/talkingAvatar";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";
import type { VlogProduction, VlogScene } from "./director";
import { createLocation, listLocations, type LocationScope } from "./locations";

// ─────────────────────────────────────────────────────────────
// LANCEMENT D'UNE PRODUCTION VIDÉO — partagé par l'assistant (route /studio/vlog/produce),
// le calendrier (plan_entries) et les campagnes UGC. Crée le content_item et le premier job ;
// jamais de contenu bloqué « en cours » sans job.
// ─────────────────────────────────────────────────────────────

export interface LaunchOptions {
  format?: "hybrid" | "seedance";
  videoModel?: string;
  resolution?: string;
  talkProvider?: string;
  talkMode?: string;
  ttsModel?: string;
  subtitles?: boolean;
  music?: boolean;
  network?: string;
  ratioClass?: "value" | "proof" | "sale";
  /** Prise unique (une scène de 20-30 s, coupes internes entre angles) — défaut du produit. */
  singleTake?: boolean;
  /** Inserts photo pendant la parole (« B-roll ») — désactivés par défaut depuis le 6 sept. 2026. */
  inserts?: boolean;
  locationScopes?: Record<string, LocationScope>;
  /** Champs supplémentaires du payload (kind: "ugc", plan_entry_id, product_image_url…). */
  extraPayload?: Record<string, unknown>;
  /** Colonnes supplémentaires du content_item (plan_entry_id, ai_label…). */
  extraColumns?: Record<string, unknown>;
}

export interface LaunchResult { itemId: string; jobId: string; estimate: number; format: "hybrid" | "seedance" }

/** Crée les décors inédits demandés par le réalisateur et propage leurs clés réelles (suffixées). */
export async function resolveNewLocations(avatarId: string, scenes: VlogScene[], scopes: Record<string, LocationScope> = {}): Promise<void> {
  const known = new Set((await listLocations(avatarId, "all").catch(() => [])).map((l) => l.key));
  const created = new Map<string, string>();
  for (const sc of scenes) {
    const nl = sc.new_location;
    if (!nl) continue;
    if (created.has(nl.key)) { sc.location_key = created.get(nl.key); continue; }
    if (known.has(nl.key)) { sc.location_key = nl.key; continue; }
    try {
      const row = await createLocation(avatarId, nl, true, scopes[nl.key] ?? nl.scope ?? "permanent");
      created.set(nl.key, row.key);
      known.add(row.key);
      sc.location_key = row.key;
    } catch {
      if (!sc.location_key) sc.location_key = nl.key;
    }
  }
  for (const sc of scenes) {
    if (!sc.location_key || known.has(sc.location_key)) continue;
    if (created.has(sc.location_key)) { sc.location_key = created.get(sc.location_key); continue; }
    const match = [...known].find((k) => k.startsWith(`${sc.location_key}-`));
    if (match) sc.location_key = match;
  }
}

export async function launchProduction(avatarId: string, production: VlogProduction, opts: LaunchOptions = {}): Promise<LaunchResult> {
  if (!production?.scenes?.length) throw badRequest("production.scenes requis");
  if (!piapiConfigured()) throw badRequest("PiAPI non configuré (PIAPI_API_KEY dans .env)");
  await resolveNewLocations(avatarId, production.scenes, opts.locationScopes ?? {});

  const taskType: SeedanceTaskType = isSeedanceModel(opts.videoModel) ? opts.videoModel : DEFAULT_SEEDANCE_MODEL;
  const resolution = clampResolution(taskType, String(opts.resolution ?? DEFAULT_SEEDANCE_RESOLUTION));
  const format: "hybrid" | "seedance" = opts.format === "seedance" ? "seedance" : "hybrid";
  const talkProvider: TalkProvider = isTalkProvider(opts.talkProvider) ? opts.talkProvider : DEFAULT_TALK_PROVIDER;
  const talkMode: TalkMode = isTalkMode(opts.talkMode) ? opts.talkMode : "std";
  const ttsModel = opts.ttsModel === "eleven_multilingual_v2" ? "eleven_multilingual_v2" : "eleven_v3";
  const subtitles = opts.subtitles === true;
  const music = opts.music !== false;

  if (format === "hybrid") {
    if (!config.ELEVENLABS_API_KEY) throw badRequest("ElevenLabs non configuré (ELEVENLABS_API_KEY dans .env)");
    const { data: voiceRow } = await supabase.from("avatars").select("eleven_voice_id").eq("id", avatarId).single();
    if (!voiceRow?.eleven_voice_id) throw badRequest("L'influenceur n'a pas de voix ElevenLabs — choisis-en une dans sa fiche avant de produire.");
  }

  const estimate =
    format === "hybrid"
      ? estimateHybridCost(production.scenes, readHybridSettings({ talk_provider: talkProvider, talk_mode: talkMode, video_model: taskType, resolution }), { music, kind: String(opts.extraPayload?.kind ?? ""), inserts: opts.inserts === true })
      : estimateProductionCost(taskType, resolution, production.scenes.map((s) => clampDuration(Number(s.duration_sec) || 12, taskType)));

  const title = production.title ?? "Vlog";
  const { data: item, error } = await supabase
    .from("content_items")
    .insert({
      avatar_id: avatarId,
      type: "video",
      network: opts.network ?? "tiktok",
      ratio_class: opts.ratioClass ?? "value",
      status: "generating",
      title,
      payload: {
        theme: title,
        production,
        format, video_model: taskType, resolution,
        ...(format === "hybrid" ? { talk_provider: talkProvider, talk_mode: talkMode, tts_model: ttsModel, subtitles, music, single_take: opts.singleTake !== false, cuts: opts.singleTake !== false ? "multi" : "none", inserts: opts.inserts === true } : {}),
        caption: production.caption ?? "",
        hashtags: production.hashtags ?? [],
        script: production.scenes.map((s) => s.texte).join(" "),
        ...(opts.extraPayload ?? {}),
      },
      ...(opts.extraColumns ?? {}),
    })
    .select("id")
    .single();
  if (error || !item) throw new Error(`insert failed: ${error?.message ?? ""}`);

  const first = format === "hybrid" ? "generate_voice" : "generate_video";
  try {
    const job = await enqueue(first, { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label: title });
    return { itemId: item.id, jobId: job.id, estimate: estimate.total, format };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    await supabase.from("content_items").update({ status: "failed", error: msg.slice(0, 300) }).eq("id", item.id);
    throw new Error(/jobs_type_check/.test(msg) ? "La base n'accepte pas encore ces jobs : applique les migrations 0015 et 0016." : msg);
  }
}
