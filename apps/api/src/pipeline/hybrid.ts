import { avatarImageModel, IDENTITY_SELECT, resolveOutfit, type AvatarIdentity, type ResolvedOutfit } from "../domain/characterBible";
import { piapiImageToStorage } from "../providers/piapiImage";
import { buildBrollPrompt, buildSeedance25Prompt, foldText, type InsertFraming, type VlogScene } from "../domain/director";
import { ensureKeyframe, findKeyframe, type AvatarKeyframe, type KeyframeFraming } from "../domain/keyframes";
import { qcVerdict } from "../lib/qc";
import { logger } from "../logger";
import { estimateSpeechSeconds } from "../providers/elevenlabs";
import {
  clampDuration,
  estimateProductionCost,
  isLessRestriction,
  isSeedance25,
  seedanceCost,
  submitSeedanceSegment,
  toLessRestriction,
  type SeedanceResolution,
  type SeedanceTaskType,
} from "../providers/piapi";
import {
  DEFAULT_TALK_PROVIDER,
  estimateTalkCost,
  isTalkMode,
  isTalkProvider,
  submitTalkingAvatar,
  type TalkMode,
  type TalkProvider,
} from "../providers/talkingAvatar";
import { supabase } from "../supabase";
import { loadAvatarRefs, readSeedanceSettings, type AvatarRefs, type SeedanceSettings } from "./handlers/generateVideo";
import type { ContentItemRow } from "./pipelines";

// ─────────────────────────────────────────────────────────────
// VIDÉO V2 HYBRIDE — une production = des PLANS indépendants :
//   talk  : la réplique est dite par ElevenLabs, puis l'avatar est animé en
//           lip-sync sur cet audio (Kling Avatar / OmniHuman) depuis un keyframe ;
//   broll : plan d'illustration muet (Seedance), la voix off est mixée au montage.
// Chaque plan se régénère seul ; le montage ffmpeg recolle l'ensemble + sous-titres.
// État persistant : content_items.assets.shots (versionné avec le contenu).
// ─────────────────────────────────────────────────────────────

export type ShotRole = "talk" | "broll";
export type ShotPhase = "waiting" | "voice" | "video" | "done" | "failed";
export interface ShotWord { w: string; s: number; e: number }

/**
 * Insert PHOTO d'un plan parlé : image (keyframe du décor dans un autre cadrage, ou le
 * décor seul) incrustée 1,5-3 s pendant la parole, à l'endroit des mots « anchor ».
 * Casse la fixité de l'avatar parlant sans coût vidéo (keyframe en cache ≈ 0,07 $ une fois).
 */
export interface InsertState {
  anchor: string;
  framing: InsertFraming;
  desc?: string;
  url?: string | null;
  keyframe_id?: string | null;
  cost_usd?: number;
  /** Calculés au montage depuis les mots horodatés (s, relatifs au début du plan). */
  at?: number | null;
  len?: number | null;
  error?: string;
}

export const INSERT_COST_ESTIMATE = 0.07;
export const MUSIC_COST_ESTIMATE = 0.06;

export interface ShotState {
  idx: number;
  role: ShotRole;
  titre: string;
  texte: string;
  phase: ShotPhase;
  /** Durée cible du plan (s) : talk = durée de l'audio, broll = 4-15 s Seedance. */
  duration: number;
  location_key?: string | null;
  version?: number;
  inserts?: InsertState[] | null;
  // Voix
  audio_url?: string | null;
  audio_seconds?: number | null;
  words?: ShotWord[] | null;
  tts_model?: string | null;
  // Vidéo
  provider?: TalkProvider | "seedance";
  /** Voix synthétisée par Seedance 2.5 dans le clip (pas de mix ElevenLabs ; mots via transcription). */
  native_voice?: boolean;
  transcript?: string | null;
  /** Part des mots du texte retrouvés dans la transcription (0-1) — contrôle de ce qui est vraiment dit. */
  dialogue_score?: number | null;
  task_id?: string;
  clip_url?: string;
  prompt?: string;
  keyframe_url?: string | null;
  keyframe_id?: string | null;
  framing?: KeyframeFraming | null;
  qc?: { face_score: number | null; face_height?: number | null; verdict: string; note?: string } | null;
  cost_usd?: number;
  error?: string;
  submit_attempts?: number;
  /** Seedance a refusé ce plan pour modération (référence réaliste) → variante less-restriction désormais. */
  moderated?: boolean;
}

export interface HybridSettings {
  talkProvider: TalkProvider;
  talkMode: TalkMode;
  seedance: SeedanceSettings;
}

/** Plans parlés Seedance 2.5 : toujours la variante less-restriction (visage réaliste) ; std = 720p, pro = 1080p. */
export const TALK_25_TASK: SeedanceTaskType = "seedance-2.5-less-restriction";
/** pro = 1080p ; sinon la résolution b-roll de la production si elle est plus basse (480p), sinon 720p. */
export const talkResolution = (mode: TalkMode, base: SeedanceResolution = "720p"): SeedanceResolution => (mode === "pro" ? "1080p" : base === "480p" ? "480p" : "720p");

/** Similarité 0-1 entre deux mots repliés (distance de Levenshtein normalisée). */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

/**
 * Recale l'orthographe des mots transcrits sur le texte prévu (« Calos » → « callos »,
 * « pente » → « pointe ») en gardant les horodatages de la transcription : les sous-titres
 * affichent ce qui était écrit, pas ce que l'oreille du modèle a cru entendre.
 * Alignement glouton : chaque mot transcrit est associé au mot du script le plus proche
 * (fenêtre de 3 mots, similarité ≥ 0,6) ; un mot vraiment différent est gardé tel quel.
 */
export function alignWordsToScript(words: ShotWord[], texte: string): ShotWord[] {
  const script = texte.split(/\s+/).filter(Boolean);
  const folded = script.map((w) => foldText(w));
  let p = 0;
  return words.map((w) => {
    const fw = foldText(w.w);
    if (!fw) return w;
    let best = -1;
    let bestSim = 0.6;
    for (let k = p; k < Math.min(script.length, p + 3); k++) {
      const sim = wordSimilarity(fw, folded[k]!);
      if (sim > bestSim) { bestSim = sim; best = k; }
    }
    if (best < 0) return w;
    p = best + 1;
    // Ponctuation : celle du script (le transcripteur en invente ou en oublie).
    return { ...w, w: script[best]! };
  });
}

/** Part des mots du texte prévu retrouvés dans ce qui a été prononcé (0-1). */
export function dialogueScore(texte: string, transcript: string): number {
  const want = foldText(texte).split(" ").filter((t) => t.length > 1);
  if (!want.length) return 1;
  const got = new Set(foldText(transcript).split(" "));
  return Math.round((want.filter((t) => got.has(t)).length / want.length) * 100) / 100;
}

export function readHybridSettings(payload: Record<string, unknown>): HybridSettings {
  return {
    talkProvider: isTalkProvider(payload.talk_provider) ? payload.talk_provider : DEFAULT_TALK_PROVIDER,
    talkMode: isTalkMode(payload.talk_mode) ? payload.talk_mode : "std",
    seedance: readSeedanceSettings(payload),
  };
}

/**
 * Cadrage du keyframe d'un plan parlé, déduit de la direction caméra (EN).
 * Toujours un cadrage 9:16 en 2K : OmniHuman conserve le format de l'image d'entrée, un
 * keyframe 3:4 donnait un clip 960×1280 agrandi et recadré au montage (image molle).
 */
export function framingFromCamera(camera: string): KeyframeFraming {
  const c = String(camera ?? "").toLowerCase();
  if (/selfie|arm'?s length|phone in (her|his) hand|front camera/.test(c)) return "selfie";
  if (/full[- ]?body|wide shot|head to toe|establishing/.test(c)) return "full";
  return "talk";
}

export function shotsFromScenes(scenes: VlogScene[]): ShotState[] {
  return scenes.map((sc, idx) => ({
    idx,
    role: sc.mode === "talk" ? "talk" : "broll",
    titre: sc.titre,
    texte: String(sc.texte ?? "").trim(),
    phase: String(sc.texte ?? "").trim() ? "voice" : "waiting",
    duration: clampDuration(sc.duration_sec),
    location_key: sc.location_key ?? null,
    version: 1,
    ...(sc.mode === "talk" && sc.inserts?.length ? { inserts: sc.inserts.map((i) => ({ anchor: i.anchor, framing: i.framing, ...(i.desc ? { desc: i.desc } : {}) })) } : {}),
  }));
}

/** Estimation avant lancement : avatar parlant × durée parlée, Seedance × durée, voix ≈ 0,0025 $/s, inserts ≈ 0,07 $, musique ≈ 0,06 $. */
export function estimateHybridCost(scenes: VlogScene[], settings: HybridSettings, opts: { music?: boolean } = {}): { total: number; shots: number[] } {
  const shots = scenes.map((sc) => {
    const speech = String(sc.texte ?? "").trim() ? estimateSpeechSeconds(sc.texte) : 0;
    const voice = speech * 0.0025;
    if (sc.mode === "talk") {
      const inserts = (sc.inserts?.length ?? 0) * INSERT_COST_ESTIMATE;
      const talk = settings.talkProvider === "seedance-2.5"
        ? seedanceCost(TALK_25_TASK, talkResolution(settings.talkMode, settings.seedance.resolution), clampDuration(Math.ceil(speech + 1.2), TALK_25_TASK))
        : estimateTalkCost(settings.talkProvider, settings.talkMode, speech + 0.5);
      return Math.round((talk + voice + inserts) * 1000) / 1000;
    }
    const dur = clampDuration(Math.max(sc.duration_sec, Math.ceil(speech + 0.5)), settings.seedance.taskType);
    return Math.round((estimateProductionCost(settings.seedance.taskType, settings.seedance.resolution, [dur]).total + voice) * 1000) / 1000;
  });
  const music = opts.music === false ? 0 : MUSIC_COST_ESTIMATE;
  return { total: Math.round((shots.reduce((a, b) => a + b, 0) + music) * 100) / 100, shots };
}

/**
 * Place les inserts d'un plan parlé sur sa timeline à partir des mots horodatés :
 * jamais avant 2 s (le visage accroche), 1,5-3 s chacun, ≥ 1,5 s de visage entre deux,
 * jamais sur la fin du plan. Les inserts sans image ou sans ancre trouvée sont ignorés.
 */
export function planInserts(words: ShotWord[], inserts: InsertState[], partSeconds: number): Array<{ url: string; at: number; len: number }> {
  const out: Array<{ url: string; at: number; len: number }> = [];
  const fw = words.map((w) => foldText(w.w));
  let free = 2.0;
  for (const ins of inserts) {
    ins.at = null;
    ins.len = null;
    if (!ins.url) continue;
    const a = foldText(ins.anchor).split(" ").filter(Boolean);
    if (!a.length) continue;
    let idx = -1;
    for (let i = 0; i + a.length <= fw.length; i++) {
      if (a.every((t, k) => fw[i + k] === t)) { idx = i; break; }
    }
    if (idx < 0) { ins.error = "ancre introuvable dans la voix"; continue; }
    const at = Math.round(Math.max(free, (words[idx]?.s ?? 0) - 0.1) * 100) / 100;
    let len = 2.2;
    const room = partSeconds - 0.4 - at;
    if (room < 1.2) { ins.error = "trop tard dans le plan"; continue; }
    len = Math.min(len, room);
    out.push({ url: ins.url, at, len: Math.round(len * 100) / 100 });
    ins.at = at;
    ins.len = Math.round(len * 100) / 100;
    ins.error = undefined;
    free = at + len + 1.5;
  }
  return out;
}

// ── Soumission d'un plan (partagée par generate_shots et poll_shots) ──
interface LocationRow { id: string; key: string; description: string; ref_image_url: string | null }

export interface ShotContext {
  item: ContentItemRow;
  scenes: VlogScene[];
  settings: HybridSettings;
  avatar: AvatarIdentity;
  refs: AvatarRefs;
  locations: Map<string, LocationRow>;
  /** Tenue de la vidéo (payload.outfit_id, sinon tenue par défaut) : la même sur tous les plans. */
  outfit: ResolvedOutfit | null;
}

export async function loadShotContext(item: ContentItemRow): Promise<ShotContext> {
  const production = item.payload.production as { scenes?: VlogScene[] } | undefined;
  const scenes = production?.scenes ?? [];
  const { data: avatarRow } = await supabase.from("avatars").select(IDENTITY_SELECT).eq("id", item.avatar_id).single();
  const avatar = avatarRow as AvatarIdentity | null;
  if (!avatar?.ref_image_url) throw new Error("L'influenceur n'a pas de portrait — génère-le d'abord.");
  const refs = await loadAvatarRefs(item.avatar_id);
  const { data: locRows } = await supabase.from("avatar_locations").select("id, key, description, ref_image_url").eq("avatar_id", item.avatar_id);
  const locations = new Map<string, LocationRow>((locRows ?? []).map((l) => [String(l.key), l as LocationRow]));
  const outfit = await resolveOutfit(item.avatar_id, typeof item.payload.outfit_id === "string" ? item.payload.outfit_id : null);
  return { item, scenes, settings: readHybridSettings(item.payload), avatar, refs, locations, outfit };
}

/**
 * Keyframe du décor pour un b-roll : le même trio (décor, tenue de la vidéo,
 * cadrage moyen) que les plans parlés, généré une fois puis mis en cache.
 * Utilisé seulement s'il est fiable (validé ou visage ≥ seuil) ; jamais bloquant.
 */
async function brollKeyframe(ctx: ShotContext, loc: LocationRow, shot: ShotState, say?: (msg: string) => void): Promise<AvatarKeyframe | null> {
  const outfitId = ctx.outfit?.id ?? null;
  try {
    const { keyframe, cached, cost } = await ensureKeyframe(ctx.avatar, { locationId: loc.id, outfitId });
    if (!cached) say?.(`🖼️ ${shot.titre} : keyframe du décor généré (${cost.toFixed(3)} $)`);
    return keyframe.validated || qcVerdict(keyframe.face_score) === "pass" ? keyframe : null;
  } catch (err) {
    logger.warn("broll_keyframe_failed", { itemId: ctx.item.id, shot: shot.idx, err: String((err as Error)?.message ?? err) });
    return findKeyframe(ctx.avatar.id, { locationId: loc.id, outfitId }, { validatedOnly: true }).catch(() => null);
  }
}

function talkPrompt(avatar: AvatarIdentity, scene: VlogScene | undefined): string {
  return [
    `${avatar.name} speaks naturally to the camera like a vlogger talking to a friend${scene?.action ? `: ${scene.action}` : ""}.`,
    scene?.camera ? `Camera: ${scene.camera}.` : "",
    "Lively facial expressions that follow the meaning of what she says, natural varied hand gestures (never the same gesture twice), small head movements, steady eye contact, accurate lip-sync to the audio, stable identity and outfit.",
    "Real phone-video look: natural unretouched skin, no beauty filter, subtle grain.",
    scene?.lighting ? `${scene.lighting}.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Images des inserts d'un plan parlé : keyframe du décor dans le cadrage demandé (cache) ou le décor seul.
 * Test du 4 sept. : le réalisateur avait demandé deux fois « close » dans le même décor → même image
 * deux fois. On varie donc le cadrage quand ce trio (décor, cadrage) a déjà servi dans cette vidéo.
 */
const INSERT_ROTATION: InsertFraming[] = ["close", "full", "selfie", "location"];
const SELF_FRAMINGS: InsertFraming[] = ["close", "full", "selfie"];
async function resolveInserts(ctx: ShotContext, shot: ShotState, loc: LocationRow | undefined, say?: (msg: string) => void): Promise<void> {
  if (!shot.inserts?.length) return;
  const allShots = Array.isArray(ctx.item.assets.shots) ? (ctx.item.assets.shots as ShotState[]) : [];
  const used = new Set<string>();
  for (const s of allShots) if (s.idx !== shot.idx) for (const i of s.inserts ?? []) if (i.url && i.framing !== "illustration") used.add(`${s.location_key ?? ""}:${i.framing}`);
  let k = 0;
  for (const ins of shot.inserts) {
    k++;
    if (ins.url) { if (ins.framing !== "illustration") used.add(`${shot.location_key ?? ""}:${ins.framing}`); continue; }
    try {
      // Illustration de ce dont elle parle : image sans identité (pas de visage), 9:16, ≈ 0,07 $.
      if (ins.framing === "illustration") {
        if (!ins.desc) { ins.error = "illustration sans description"; continue; }
        const prompt = [
          `Candid handheld smartphone photo of: ${ins.desc}.`,
          loc?.description ? `Setting: ${loc.description}.` : ctx.refs.city ? `Setting: ${ctx.refs.city}.` : "",
          "Natural light, real textures, slightly off-center framing, mild sensor grain. No recognizable person's face, no text, no watermark.",
        ].filter(Boolean).join(" ");
        const r = await piapiImageToStorage({ prompt, model: avatarImageModel(ctx.avatar), aspect: "9:16", quality: "1K" }, `${ctx.avatar.id}/${ctx.item.id}/insert-${shot.idx}-${k}-${Date.now()}`);
        ins.url = r.imageUrl;
        ins.cost_usd = r.cost;
        say?.(`🖼️ ${shot.titre} : illustration « ${ins.anchor} » générée (${r.cost.toFixed(3)} $)`);
        continue;
      }
      if (!loc) { ins.error = "plan sans décor"; continue; }
      if (SELF_FRAMINGS.includes(ins.framing) && used.has(`${shot.location_key ?? ""}:${ins.framing}`)) {
        const next = INSERT_ROTATION.find((f) => !used.has(`${shot.location_key ?? ""}:${f}`) && (f !== "location" || loc.ref_image_url));
        if (next) { say?.(`🔁 ${shot.titre} : insert « ${ins.anchor} » passé de ${ins.framing} à ${next} (déjà utilisé)`); ins.framing = next; }
      }
      used.add(`${shot.location_key ?? ""}:${ins.framing}`);
      if (ins.framing === "location") {
        ins.url = loc.ref_image_url ?? null;
        ins.cost_usd = 0;
        if (!ins.url) ins.error = "décor sans image";
        continue;
      }
      const selfFraming: KeyframeFraming = ins.framing === "full" || ins.framing === "selfie" ? ins.framing : "close";
      const r = await ensureKeyframe(ctx.avatar, { locationId: loc.id, outfitId: ctx.outfit?.id ?? null, framing: selfFraming });
      const usable = r.keyframe.validated || qcVerdict(r.keyframe.face_score) === "pass";
      ins.url = usable ? r.keyframe.url : null;
      ins.keyframe_id = r.keyframe.id;
      ins.cost_usd = r.cost;
      if (!usable) ins.error = "visage non reconnu sur l'insert (écarté)";
      if (!r.cached) say?.(`🖼️ ${shot.titre} : insert « ${ins.anchor} » (${ins.framing}) généré (${r.cost.toFixed(3)} $)`);
    } catch (err) {
      ins.error = String((err as Error)?.message ?? err).slice(0, 120);
    }
  }
}

/**
 * Soumet le plan à son fournisseur et met à jour son état (task_id, prompt, keyframe, coût).
 * Lève une erreur si la soumission échoue (l'appelant gère les tentatives).
 */
export async function submitShot(ctx: ShotContext, shot: ShotState, say?: (msg: string) => void): Promise<void> {
  const scene = ctx.scenes[shot.idx];
  const loc = scene?.location_key ? ctx.locations.get(scene.location_key) : undefined;
  const { talkProvider, talkMode, seedance } = ctx.settings;

  if (shot.role === "talk") {
    if (!shot.audio_url) throw new Error("réplique sans audio (generate_voice n'a pas abouti)");
    let imageUrl = String(ctx.avatar.ref_image_url);
    if (loc) {
      const framing = framingFromCamera(scene?.camera ?? "");
      const { keyframe, cached, cost } = await ensureKeyframe(ctx.avatar, { locationId: loc.id, outfitId: ctx.outfit?.id ?? null, framing });
      imageUrl = keyframe.url;
      shot.keyframe_url = keyframe.url;
      shot.keyframe_id = keyframe.id;
      shot.framing = framing;
      say?.(cached ? `🖼️ ${shot.titre} : keyframe du décor réutilisé (0 $)` : `🖼️ ${shot.titre} : keyframe du décor généré (${cost.toFixed(3)} $)`);
    }
    await resolveInserts(ctx, shot, loc, say);
    const insertsCost = (shot.inserts ?? []).reduce((a, i) => a + (Number(i.cost_usd) || 0), 0);

    // Seedance 2.5 : la réplique est synthétisée par le modèle (timbre = mp3 ElevenLabs en @audio1).
    if (talkProvider === "seedance-2.5") {
      const taskType = TALK_25_TASK;
      const resolution = talkResolution(talkMode, seedance.resolution);
      const hasKeyframe = imageUrl !== String(ctx.avatar.ref_image_url);
      const outfitUrl = ctx.outfit?.ref_url ?? null;
      // Campagne UGC : la photo du produit est la dernière référence, décrite dans le prompt.
      const product = ctx.item.payload.product as { name?: string; description?: string } | undefined;
      const productUrl = typeof ctx.item.payload.product_image_url === "string" ? ctx.item.payload.product_image_url : null;
      // Prise unique (payload.single_take, ou plan parlé ≥ 12 s) : coupes internes entre 3-5 angles ;
      // plans courts du format monté : plan continu.
      const speech = shot.audio_seconds ?? shot.duration;
      const cuts: "multi" | "none" = ctx.item.payload.cuts === "none" ? "none" : ctx.item.payload.cuts === "multi" || ctx.item.payload.single_take === true || speech >= 12 ? "multi" : "none";
      const prompt = buildSeedance25Prompt({
        mode: "talk",
        scene: scene ?? fallbackScene(shot),
        refs: { hasSheet: ctx.refs.hasSheet, hasLocationImage: !!loc?.ref_image_url, hasKeyframe, hasOutfitImage: !!outfitUrl, hasProductImage: !!productUrl, hasVoiceRef: true },
        locationDescription: loc?.description ?? scene?.new_location?.description ?? null,
        city: ctx.refs.city,
        outfitDescription: ctx.outfit?.description_en ?? null,
        productDescription: product?.name ? `${product.name}${product.description ? `: ${String(product.description).slice(0, 160)}` : ""}` : null,
        cuts,
      });
      const duration = clampDuration(Math.ceil((shot.audio_seconds ?? shot.duration) + 1.2), taskType);
      const taskId = await submitSeedanceSegment({
        prompt,
        imageUrls: [...ctx.refs.imageUrls, ...(loc?.ref_image_url ? [loc.ref_image_url] : []), ...(hasKeyframe ? [imageUrl] : []), ...(outfitUrl ? [outfitUrl] : []), ...(productUrl ? [productUrl] : [])],
        audioUrls: [shot.audio_url],
        duration,
        resolution,
        taskType,
      });
      shot.provider = "seedance-2.5";
      shot.native_voice = true;
      shot.prompt = prompt;
      shot.task_id = taskId;
      shot.phase = "video";
      shot.duration = duration;
      shot.error = undefined;
      shot.cost_usd = Math.round((seedanceCost(taskType, resolution, duration) + insertsCost) * 1000) / 1000;
      return;
    }

    const prompt = talkPrompt(ctx.avatar, scene);
    const taskId = await submitTalkingAvatar({ provider: talkProvider, mode: talkMode, imageUrl, audioUrl: shot.audio_url, prompt });
    shot.provider = talkProvider;
    shot.native_voice = false;
    shot.prompt = prompt;
    shot.task_id = taskId;
    shot.phase = "video";
    shot.error = undefined;
    shot.cost_usd = Math.round((estimateTalkCost(talkProvider, talkMode, shot.audio_seconds ?? shot.duration) + insertsCost) * 1000) / 1000;
    return;
  }

  // B-roll Seedance : identité + décor + keyframe du décor (même tenue que les plans
  // parlés) + photo et description de la tenue → continuité vestimentaire entre plans.
  const kf = loc ? await brollKeyframe(ctx, loc, shot, say) : null;
  const kfUrl = kf?.url ?? null;
  const outfitUrl = ctx.outfit?.ref_url ?? null;
  // Refus de modération (nos références montrent une personne réaliste) → variante less-restriction.
  let taskType = seedance.taskType;
  if ((shot.moderated || /moderation/i.test(shot.error ?? "")) && !isLessRestriction(taskType)) {
    taskType = toLessRestriction(taskType);
    shot.moderated = true;
    say?.(`🔓 ${shot.titre} : refus de modération Seedance → variante ${taskType}`);
  }
  // Seedance 2.5 : la narration est dite par le modèle (même voix que les plans parlés) ;
  // Seedance 2.0 : plan muet, la voix off ElevenLabs est mixée au montage.
  const native = isSeedance25(taskType) && !!shot.texte.trim() && !!shot.audio_url;
  const promptOpts = {
    scene: scene ?? fallbackScene(shot),
    refs: { hasSheet: ctx.refs.hasSheet, hasLocationImage: !!loc?.ref_image_url, hasKeyframe: !!kfUrl, hasOutfitImage: !!outfitUrl },
    locationDescription: loc?.description ?? scene?.new_location?.description ?? null,
    city: ctx.refs.city,
    outfitDescription: ctx.outfit?.description_en ?? null,
  };
  const prompt = native
    ? buildSeedance25Prompt({ mode: "voiceover", ...promptOpts, refs: { ...promptOpts.refs, hasVoiceRef: true } })
    : buildBrollPrompt(promptOpts);
  const duration = native ? clampDuration(Math.max(shot.duration, Math.ceil((shot.audio_seconds ?? 0) + 1)), taskType) : shot.duration;
  const taskId = await submitSeedanceSegment({
    prompt,
    imageUrls: [...ctx.refs.imageUrls, ...(loc?.ref_image_url ? [loc.ref_image_url] : []), ...(kfUrl ? [kfUrl] : []), ...(outfitUrl ? [outfitUrl] : [])],
    ...(native ? { audioUrls: [String(shot.audio_url)] } : {}),
    duration,
    resolution: seedance.resolution,
    taskType,
  });
  shot.provider = "seedance";
  shot.native_voice = native;
  shot.prompt = prompt;
  shot.task_id = taskId;
  shot.phase = "video";
  shot.duration = duration;
  shot.error = undefined;
  shot.keyframe_url = kfUrl;
  shot.keyframe_id = kf?.id ?? null;
  shot.cost_usd = estimateProductionCost(taskType, seedance.resolution, [duration]).total;
}

function fallbackScene(shot: ShotState): VlogScene {
  return {
    titre: shot.titre,
    mode: "voiceover",
    texte: shot.texte,
    duration_sec: shot.duration,
    action: "candid lifestyle moment, natural gestures",
    shots: [],
    scene_desc: "",
    camera: "medium-wide shot, natural handheld camera movement",
    lighting: "natural light, photorealistic cinematic vlog style",
    audio_ambiance: "natural ambient sound of the location",
    constraints: "",
  };
}

export function totalShotCost(shots: ShotState[]): number {
  return Math.round(shots.reduce((a, s) => a + (Number(s.cost_usd) || 0), 0) * 100) / 100;
}
