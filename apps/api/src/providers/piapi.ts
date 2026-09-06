import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// PiAPI — moteur vidéo principal de Viralya : SEEDANCE 2.0 (ByteDance).
// API unifiée : POST /api/v1/task → { data: { task_id } }
//               GET  /api/v1/task/{id} → { data: { status, output } }
// Doc : https://piapi.ai/docs/seedance-api/seedance-2
// Seedance 2.0 est multimodal (mode omni_reference) : images + vidéos + audios
// en référence, citées dans le prompt via @image1 / @video1 / @audio1.
// L'audio est GÉNÉRÉ nativement (parole au timbre des mp3 de référence + ambiance).
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.piapi.ai";
// PiAPI rejette les prompts Seedance au-delà de 4 000 caractères. On garde une
// petite marge pour éviter un écart de comptage Unicode côté fournisseur.
const SEEDANCE_PROMPT_MAX_CHARS = 3_950;

export function piapiConfigured(): boolean {
  return !!config.PIAPI_API_KEY;
}

export type SeedanceResolution = "480p" | "720p" | "1080p";
export type SeedanceTaskType =
  | "seedance-2.5"
  | "seedance-2.5-less-restriction"
  | "seedance-2"
  | "seedance-2-fast"
  | "seedance-2-mini"
  | "seedance-2-less-restriction"
  | "seedance-2-fast-less-restriction"
  | "seedance-2-mini-less-restriction";

export interface SeedanceModelDef {
  label: string;
  hint: string;
  /** USD par seconde de vidéo produite, par résolution (absent = résolution non supportée). */
  pricePerSec: Partial<Record<SeedanceResolution, number>>;
  /** Durée max d'un clip (s) — 15 pour la 2.0, 30 pour la 2.5. */
  maxSeconds?: number;
}

// Tarifs PROMOTIONNELS 2.0 (fin le 2026-09-07 06:00 UTC : mini −40 %, fast −20 %).
// Seedance 2.5 (page PiAPI, 4 sept. 2026) : 480p 0,15 $/s, 720p 0,35 $/s, 1080p 0,80 $/s (+10 % en
// less-restriction), clips de 4 à 30 s. Test réel du 4 sept. (Voahangy, 5 s 1080p, 4,40 $) : image
// 1080×1920 nette, mouvement naturel, tenue du keyframe respectée — jugé « top » par l'utilisateur.
// IMPORTANT (vérifié en réel) : les variantes STRICTES refusent toute image de
// référence contenant une personne réaliste — donc TOUS les avatars Viralya.
// Les -less-restriction (+10 %) sont le mode NORMAL de la plateforme ; les
// références y passent par la bibliothèque d'assets (auto_upload_assets).
export const SEEDANCE_MODELS: Record<SeedanceTaskType, SeedanceModelDef> = {
  "seedance-2.5-less-restriction": {
    label: "Seedance 2.5",
    hint: "🏆 Qualité de référence (test du 4 sept.) : image nette, voix native, clips jusqu'à 30 s — 4× le prix du Mini",
    pricePerSec: { "480p": 0.165, "720p": 0.385, "1080p": 0.88 },
    maxSeconds: 30,
  },
  "seedance-2.5": {
    label: "Seedance 2.5 (strict)",
    hint: "⚠️ Refuse les références de personnes réalistes — texte seul",
    pricePerSec: { "480p": 0.15, "720p": 0.35, "1080p": 0.8 },
    maxSeconds: 30,
  },
  "seedance-2-mini-less-restriction": {
    label: "Seedance 2.0 Mini",
    hint: "⭐ Meilleur rapport qualité/prix",
    pricePerSec: { "480p": 0.046, "720p": 0.092 },
  },
  "seedance-2-fast-less-restriction": {
    label: "Seedance 2.0 Fast",
    hint: "Mouvement plus fluide que le Mini",
    pricePerSec: { "480p": 0.07, "720p": 0.141 },
  },
  "seedance-2-less-restriction": {
    label: "Seedance 2.0 Pro",
    hint: "Qualité maximale, seul tier en 1080p",
    pricePerSec: { "480p": 0.11, "720p": 0.22, "1080p": 0.55 },
  },
  "seedance-2-mini": {
    label: "Seedance 2.0 Mini (strict)",
    hint: "⚠️ Refuse les références de personnes réalistes — texte seul",
    pricePerSec: { "480p": 0.042, "720p": 0.084 },
  },
  "seedance-2-fast": {
    label: "Seedance 2.0 Fast (strict)",
    hint: "⚠️ Refuse les références de personnes réalistes — texte seul",
    pricePerSec: { "480p": 0.064, "720p": 0.128 },
  },
  "seedance-2": {
    label: "Seedance 2.0 Pro (strict)",
    hint: "⚠️ Refuse les références de personnes réalistes — texte seul",
    pricePerSec: { "480p": 0.1, "720p": 0.2, "1080p": 0.5 },
  },
};

// Référence qualité validée par l'utilisateur le 4 sept. 2026 (720p par défaut, 1080p en option).
export const DEFAULT_SEEDANCE_MODEL: SeedanceTaskType = "seedance-2.5-less-restriction";
export const isSeedance25 = (taskType: SeedanceTaskType): boolean => taskType.startsWith("seedance-2.5");

/** Les variantes -less-restriction acceptent les assets (personnes réalistes). */
export function isLessRestriction(taskType: SeedanceTaskType): boolean {
  return taskType.endsWith("-less-restriction");
}

/** Variante -less-restriction d'un modèle (repli après un refus de modération sur une référence réaliste). */
export function toLessRestriction(taskType: SeedanceTaskType): SeedanceTaskType {
  return isLessRestriction(taskType) ? taskType : (`${taskType}-less-restriction` as SeedanceTaskType);
}
export const DEFAULT_SEEDANCE_RESOLUTION: SeedanceResolution = "720p";
/** Durée max d'un segment (limite API : 4–15 s, entier ; entrées vidéo ≤ 15,4 s). */
export const SEGMENT_MAX_SECONDS = 15;
export const SEGMENT_MIN_SECONDS = 4;

export function isSeedanceModel(v: unknown): v is SeedanceTaskType {
  return typeof v === "string" && v in SEEDANCE_MODELS;
}

/** Résolution valide pour ce tier, sinon repli 720p (1080p = 2.5 et 2.0 pro uniquement). */
export function clampResolution(taskType: SeedanceTaskType, resolution: string): SeedanceResolution {
  const def = SEEDANCE_MODELS[taskType];
  if (def.pricePerSec[resolution as SeedanceResolution] !== undefined) return resolution as SeedanceResolution;
  return "720p";
}

/** Durée entière valide : 4 à 15 s (2.0) ou 4 à 30 s (2.5) selon le modèle. */
export function clampDuration(seconds: number, taskType?: SeedanceTaskType): number {
  const max = (taskType && SEEDANCE_MODELS[taskType]?.maxSeconds) || SEGMENT_MAX_SECONDS;
  return Math.min(max, Math.max(SEGMENT_MIN_SECONDS, Math.round(seconds || max)));
}

/**
 * Coût d'un segment en USD (formule officielle PiAPI) :
 *   sans vidéo d'entrée : prix × durée_sortie
 *   avec vidéos d'entrée : + (prix / 2) × durée_totale_des_vidéos_d'entrée
 */
export function seedanceCost(
  taskType: SeedanceTaskType,
  resolution: SeedanceResolution,
  outputSeconds: number,
  inputVideoSeconds = 0,
): number {
  const unit = SEEDANCE_MODELS[taskType]?.pricePerSec[resolution] ?? 0;
  return Math.round((unit * outputSeconds + (unit / 2) * inputVideoSeconds) * 1000) / 1000;
}

/**
 * Estimation d'une production complète : N segments enchaînés par extension vidéo.
 * Le segment N reçoit le segment N-1 EN ENTIER comme référence @video1
 * (facturé à prix/2 par seconde d'entrée).
 */
export function estimateProductionCost(
  taskType: SeedanceTaskType,
  resolution: SeedanceResolution,
  segmentSeconds: number[],
): { total: number; segments: number[] } {
  const segments = segmentSeconds.map((sec, i) =>
    seedanceCost(taskType, resolution, clampDuration(sec, taskType), i > 0 ? clampDuration(segmentSeconds[i - 1]!, taskType) : 0),
  );
  return { total: Math.round(segments.reduce((a, b) => a + b, 0) * 100) / 100, segments };
}

// ── Appels HTTP ──────────────────────────────────────────────

export async function piapiFetch(path: string, init?: RequestInit): Promise<any> {
  if (!piapiConfigured()) throw new Error("PiAPI non configuré (PIAPI_API_KEY manquante).");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(120_000), // une socket pendue ne doit pas bloquer un job indéfiniment
    headers: { "x-api-key": config.PIAPI_API_KEY ?? "", "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    // Les réponses d'erreur PiAPI placent souvent la vraie cause dans data.logs,
    // après un gros objet de tâche : la simple troncature du JSON la masquait.
    let detail = text.slice(0, 500);
    try {
      const body = JSON.parse(text) as { message?: string; data?: { logs?: unknown; error?: { message?: string } } };
      const logs = Array.isArray(body.data?.logs) ? body.data.logs.map(String).filter(Boolean).join("; ") : "";
      detail = logs || body.data?.error?.message || body.message || detail;
    } catch { /* conserver le corps brut */ }
    throw new Error(`piapi ${path} ${res.status}: ${detail}`);
  }
  const body = JSON.parse(text) as { code?: number; data?: any; message?: string };
  // PiAPI renvoie 200 HTTP même sur erreur applicative → le vrai statut est dans `code`.
  if (body.code !== 200) throw new Error(`piapi ${path}: ${body.message ?? `code ${body.code}`}`);
  return body.data;
}

export interface SeedanceSegmentInput {
  prompt: string; // action + dialogue (le texte parlé est écrit dans le prompt)
  imageUrls?: string[]; // identité : portrait + character sheet
  videoUrls?: string[]; // extension : extrait de fin du segment précédent
  audioUrls?: string[]; // timbre : les 2 échantillons de voix mp3
  duration: number; // 4–15 s
  resolution: SeedanceResolution;
  taskType: SeedanceTaskType;
  aspectRatio?: string; // défaut 9:16 (réseaux)
}

/**
 * Raccourcit uniquement la description visuelle centrale. Le début (identité,
 * produit, action) et surtout la fin (dialogue exact et contraintes) sont conservés.
 */
export function fitSeedancePrompt(prompt: string): string {
  if (prompt.length <= SEEDANCE_PROMPT_MAX_CHARS) return prompt;
  const audioAt = prompt.lastIndexOf(" Audio:");
  if (audioAt < 0) return prompt.slice(0, SEEDANCE_PROMPT_MAX_CHARS);
  const suffix = prompt.slice(audioAt + 1);
  const headBudget = SEEDANCE_PROMPT_MAX_CHARS - suffix.length - 34;
  if (headBudget <= 200) return prompt.slice(0, SEEDANCE_PROMPT_MAX_CHARS);
  const rawHead = prompt.slice(0, headBudget);
  const sentenceEnd = Math.max(rawHead.lastIndexOf(". "), rawHead.lastIndexOf("; "));
  const head = sentenceEnd > headBudget * 0.7 ? rawHead.slice(0, sentenceEnd + 1) : rawHead;
  return `${head} [Visual details shortened.] ${suffix}`.slice(0, SEEDANCE_PROMPT_MAX_CHARS);
}

/** Soumet un segment Seedance 2.0 (mode omni_reference). Renvoie le task_id PiAPI. */
export async function submitSeedanceSegment(input: SeedanceSegmentInput): Promise<string> {
  const images = (input.imageUrls ?? []).filter(Boolean);
  const videos = (input.videoUrls ?? []).filter(Boolean);
  const audios = (input.audioUrls ?? []).filter(Boolean);
  const refs = images.length + videos.length + audios.length;
  if (refs < 1 || refs > 9) throw new Error(`seedance: ${refs} références (1 à 9 requises)`);

  const data = await piapiFetch("/api/v1/task", {
    method: "POST",
    body: JSON.stringify({
      model: "seedance",
      task_type: input.taskType,
      input: {
        prompt: fitSeedancePrompt(input.prompt),
        mode: "omni_reference",
        ...(images.length ? { image_urls: images } : {}),
        ...(videos.length ? { video_urls: videos } : {}),
        ...(audios.length ? { audio_urls: audios } : {}),
        duration: clampDuration(input.duration, input.taskType),
        aspect_ratio: input.aspectRatio ?? "9:16",
        resolution: clampResolution(input.taskType, input.resolution),
        // Nos références contiennent une personne réaliste (l'avatar) → elles doivent
        // passer par la bibliothèque d'assets. Réservé aux variantes -less-restriction.
        ...(isLessRestriction(input.taskType) ? { auto_upload_assets: true } : {}),
      },
    }),
  });

  const taskId = data?.task_id as string | undefined;
  if (!taskId) throw new Error("piapi: pas de task_id dans la réponse");
  logger.info("seedance_submit", {
    taskId,
    taskType: input.taskType,
    resolution: input.resolution,
    duration: input.duration,
    refs: { images: images.length, videos: videos.length, audios: audios.length },
  });
  return taskId;
}

export interface PiapiPollResult {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
}

export async function piapiPoll(taskId: string): Promise<PiapiPollResult> {
  const data = await piapiFetch(`/api/v1/task/${taskId}`);
  // Statuts documentés : pending, starting, "processing\t" (avec tab !), success, failed, retry.
  // Les exemples Seedance renvoient aussi "completed" → on accepte les deux formes de succès.
  const status = String(data?.status ?? "").trim().toLowerCase();

  if (status === "completed" || status === "success") {
    const videoUrl = data?.output?.video as string | undefined;
    if (!videoUrl) return { status: "failed", error: "vidéo absente de la réponse PiAPI" };
    return { status: "ready", videoUrl };
  }
  if (status === "failed") {
    const err = data?.error as { message?: string; raw_message?: string } | undefined;
    return { status: "failed", error: String(err?.message || err?.raw_message || "échec inconnu").slice(0, 300) };
  }
  return { status: "processing" };
}

// ── Historique d'utilisation ─────────────────────────────────

/** 10 000 000 « points » PiAPI = 1 USD (vérifié empiriquement sur des tâches réelles). */
const POINTS_PER_USD = 10_000_000;

export interface PiapiHistoryEntry {
  task_id: string;
  created_at: string;
  model: string; // task_type (ex. seedance-2-mini-less-restriction)
  status: string; // finished | failed | …
  cost_usd: number;
  video_url: string | null;
}

/** Historique des tâches du compte (GET /api/open/tasks/histories), le plus récent d'abord. */
export async function piapiHistory(pageSize = 100): Promise<{ total: number; items: PiapiHistoryEntry[] }> {
  const data = await piapiFetch(`/api/open/tasks/histories?page=1&page_size=${Math.min(100, pageSize)}`);
  const rows = (data?.data ?? []) as Array<{
    task_id?: string;
    created_at?: string;
    action?: string;
    task_model?: string;
    status?: string;
    usage?: number;
    detail?: { output?: string };
  }>;
  return {
    total: Number(data?.total ?? rows.length),
    items: rows.map((r) => ({
      task_id: String(r.task_id ?? ""),
      created_at: String(r.created_at ?? ""),
      model: String(r.action ?? r.task_model ?? "?"),
      status: String(r.status ?? "?"),
      cost_usd: Math.round(((Number(r.usage) || 0) / POINTS_PER_USD) * 100) / 100,
      video_url: r.detail?.output ? String(r.detail.output) : null,
    })),
  };
}

// ── Compte / solde ───────────────────────────────────────────

export interface PiapiAccountInfo {
  configured: boolean;
  account_name?: string;
  credits?: number; // crédits disponibles (comptes pay-per-use à packs de crédits)
  balance_usd?: number; // solde en USD (equivalent_in_usd si fourni, sinon crédits × taux)
}

/** Taux public PiAPI : 500 crédits = 1 USD. */
const CREDITS_PER_USD = 500;

export async function piapiAccountInfo(): Promise<PiapiAccountInfo> {
  if (!piapiConfigured()) return { configured: false };
  try {
    const data = await piapiFetch("/account/info");
    // Deux formes selon le type de compte : equivalent_in_usd (doc) ou credit_pack_info (ppu).
    const usdDirect = Number(data?.quota?.equivalent_in_usd ?? data?.equivalent_in_usd ?? NaN);
    const credits = Number(data?.credit_pack_info?.available_credits ?? NaN);
    const usd = Number.isFinite(usdDirect) ? usdDirect : Number.isFinite(credits) ? credits / CREDITS_PER_USD : NaN;
    return {
      configured: true,
      account_name: data?.name ? String(data.name) : undefined,
      credits: Number.isFinite(credits) ? credits : undefined,
      balance_usd: Number.isFinite(usd) ? Math.round(usd * 100) / 100 : undefined,
    };
  } catch (err) {
    logger.warn("piapi_account_info_failed", { err: String((err as Error)?.message ?? err) });
    return { configured: true };
  }
}
