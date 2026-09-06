import { logger } from "../logger";
import { piapiFetch } from "./piapi";

// ─────────────────────────────────────────────────────────────
// AVATAR PARLANT piloté par l'audio (PiAPI) — la voix vient d'ElevenLabs,
// la vidéo est animée EN LIP-SYNC sur ce fichier à partir d'un keyframe.
// Banc du 3 sept. 2026 (docs/PLAN-REFONTE.md, phase 2) :
//   Kling AI Avatar std : 0,052 $/s, 1232×1648 30 fps, ≈ 6 min, visage le plus fidèle
//   OmniHuman 1.5      : 0,13 $/s,  960×1280,           ≈ 5 min, plus démonstratif
// Recherche du 4 sept. 2026 (docs officielles) :
//   - Kling AI Avatar 2 ne liste que EN/JA/KO/ZH pour l'audio (guide Kling, déc. 2025) et PiAPI
//     décrit lui-même le mode std comme « static, fixed hands, stiff » → mauvais choix pour le français.
//   - OmniHuman 1.5 : aucune restriction de langue documentée, corps entier et gestes liés au sens
//     de la parole, 60 s max en 720p / 30 s en 1080p → moteur par défaut.
//   - Aucun des deux n'a de mesure publiée du lip-sync FRANÇAIS : jugement à l'oreille obligatoire.
// Champs vérifiés en réel : Kling attend `local_dubbing_url`, OmniHuman `audio_url`.
// ─────────────────────────────────────────────────────────────

export type TalkProvider = "seedance-2.5" | "omnihuman" | "kling-avatar";
export type TalkMode = "std" | "pro";

export interface TalkProviderDef {
  label: string;
  hint: string;
  pricePerSec: Record<TalkMode, number>;
  modes: TalkMode[];
  /** Durée d'audio maximale par génération (s) — au-delà, le réalisateur doit couper la scène. */
  maxSeconds: number;
}

export const TALK_PROVIDERS: Record<TalkProvider, TalkProviderDef> = {
  // Voix SYNTHÉTISÉE par Seedance (timbre = mp3 ElevenLabs de la réplique) : pas de lip-sync sur un
  // fichier, mais image 1080p et mouvement naturels. std = 720p (0,385 $/s), pro = 1080p (0,88 $/s).
  // Soumis via submitSeedanceSegment (pipeline/hybrid.ts), pas par submitTalkingAvatar.
  "seedance-2.5": {
    label: "Seedance 2.5",
    hint: "🏆 image nette et jeu naturel, voix synthétisée au timbre ElevenLabs — std 720p, pro 1080p",
    pricePerSec: { std: 0.385, pro: 0.88 },
    modes: ["std", "pro"],
    maxSeconds: 30,
  },
  omnihuman: {
    label: "OmniHuman 1.5",
    hint: "corps entier, gestes naturels, toutes langues — recommandé pour le français",
    pricePerSec: { std: 0.13, pro: 0.13 },
    modes: ["std"],
    maxSeconds: 30,
  },
  "kling-avatar": {
    label: "Kling AI Avatar",
    hint: "2,5× moins cher mais raide (mains figées) et officiellement EN/JA/KO/ZH seulement",
    // Pro : 0,26 $/s sur la page produit PiAPI, 0,104 $/s dans la doc → estimation prudente.
    pricePerSec: { std: 0.052, pro: 0.26 },
    modes: ["std", "pro"],
    maxSeconds: 60,
  },
};
export const DEFAULT_TALK_PROVIDER: TalkProvider = "seedance-2.5";

export function isTalkProvider(v: unknown): v is TalkProvider {
  return typeof v === "string" && v in TALK_PROVIDERS;
}
export function isTalkMode(v: unknown): v is TalkMode {
  return v === "std" || v === "pro";
}

/** Coût estimé d'un plan parlé : prix/s × durée de l'audio (arrondie à la seconde supérieure). */
export function estimateTalkCost(provider: TalkProvider, mode: TalkMode, seconds: number): number {
  const def = TALK_PROVIDERS[provider];
  const m: TalkMode = def.modes.includes(mode) ? mode : "std";
  return Math.round(def.pricePerSec[m] * Math.max(1, Math.ceil(seconds)) * 1000) / 1000;
}

export interface TalkingAvatarInput {
  provider: TalkProvider;
  mode?: TalkMode;
  imageUrl: string; // keyframe : l'influenceur dans le décor, tenue de la scène
  audioUrl: string; // mp3 ElevenLabs de la réplique
  prompt?: string; // jeu, gestes, cadrage (EN)
}

/** Soumet la tâche PiAPI. Renvoie le task_id. */
export async function submitTalkingAvatar(input: TalkingAvatarInput): Promise<string> {
  if (input.provider === "seedance-2.5") throw new Error("seedance-2.5 se soumet via submitSeedanceSegment (voix native)");
  const mode: TalkMode = input.mode && TALK_PROVIDERS[input.provider].modes.includes(input.mode) ? input.mode : "std";
  const body =
    input.provider === "kling-avatar"
      ? { model: "kling", task_type: "avatar", input: { image_url: input.imageUrl, local_dubbing_url: input.audioUrl, ...(input.prompt ? { prompt: input.prompt } : {}), mode } }
      : { model: "omni-human", task_type: "omni-human-1.5", input: { image_url: input.imageUrl, audio_url: input.audioUrl, prompt: input.prompt ?? "" } };
  const data = await piapiFetch("/api/v1/task", { method: "POST", body: JSON.stringify(body) });
  const taskId = data?.task_id as string | undefined;
  if (!taskId) throw new Error("piapi: pas de task_id dans la réponse");
  logger.info("talking_avatar_submit", { taskId, provider: input.provider, mode });
  return taskId;
}

export interface TalkingAvatarPoll {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
  /** Coût réel facturé par PiAPI quand il est renvoyé (10 000 000 points = 1 $). */
  costUsd?: number;
}

export async function pollTalkingAvatar(taskId: string): Promise<TalkingAvatarPoll> {
  const data = await piapiFetch(`/api/v1/task/${taskId}`);
  const status = String(data?.status ?? "").trim().toLowerCase();
  const consume = Number(data?.meta?.usage?.consume ?? 0);
  const costUsd = consume > 0 ? Math.round((consume / 10_000_000) * 1000) / 1000 : undefined;
  if (status === "completed" || status === "success") {
    const out = data?.output ?? {};
    const videoUrl = (out.video || out.video_url || out.works?.[0]?.video?.resource_without_watermark || out.works?.[0]?.video?.resource) as string | undefined;
    if (!videoUrl) return { status: "failed", error: "vidéo absente de la réponse PiAPI" };
    return { status: "ready", videoUrl, costUsd };
  }
  if (status === "failed") {
    const err = data?.error as { message?: string; raw_message?: string } | undefined;
    return { status: "failed", error: String(err?.message || err?.raw_message || "échec inconnu").slice(0, 300), costUsd };
  }
  return { status: "processing" };
}
