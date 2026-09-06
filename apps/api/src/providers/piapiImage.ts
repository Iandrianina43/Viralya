import { config } from "../config";
import { toJpeg } from "../lib/ffmpeg";
import { uploadBytes } from "../lib/storage";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// PiAPI — génération d'IMAGES multi-référence (Character Bible, photos, décors).
// Choix issu du banc d'essai du 3 septembre 2026 (docs/PLAN-REFONTE.md §2.1) :
//   défaut  = Seedream 5 Pro (fidélité du visage 0,72, 0,071 $/img, suit une tenue imposée)
//   second  = Nano Banana 2  (scènes les plus naturelles, 0,06 $/img)
// API unifiée : POST /api/v1/task → { data.task_id } ; GET /api/v1/task/{id} → { data.status, data.output }
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.piapi.ai";
const POLL_MS = 4_000;
const MAX_WAIT_MS = 8 * 60_000;

export type PiapiImageModel = "seedream-5-pro" | "seedream-5-lite" | "nano-banana-2" | "nano-banana-pro";
export type ImageAspect = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageQuality = "1K" | "2K";

export interface PiapiImageModelDef {
  label: string;
  hint: string;
  model: string;
  taskType: string;
  maxRefs: number;
  /** USD par image (pages PiAPI, 3 septembre 2026). */
  price: Record<ImageQuality, number>;
  /** Coût de chaque référence au-delà de la première (Seedream 5 Pro). */
  extraRefPrice: number;
}

export const PIAPI_IMAGE_MODELS: Record<PiapiImageModel, PiapiImageModelDef> = {
  "seedream-5-pro": {
    label: "Seedream 5 Pro", hint: "⭐ Visage le plus fidèle (banc du 3 sept.)",
    model: "seedream", taskType: "seedream-5-pro", maxRefs: 10, price: { "1K": 0.068, "2K": 0.136 }, extraRefPrice: 0.003,
  },
  "nano-banana-2": {
    label: "Nano Banana 2", hint: "Scènes les plus naturelles, visage un peu moins fidèle",
    model: "gemini", taskType: "nano-banana-2", maxRefs: 14, price: { "1K": 0.06, "2K": 0.08 }, extraRefPrice: 0,
  },
  "seedream-5-lite": {
    label: "Seedream 5 Lite", hint: "Moins cher, plus irrégulier",
    model: "seedream", taskType: "seedream-5-lite", maxRefs: 10, price: { "1K": 0.052, "2K": 0.052 }, extraRefPrice: 0,
  },
  "nano-banana-pro": {
    label: "Nano Banana Pro", hint: "Pas de gain sur l'identité, prix double",
    model: "gemini", taskType: "nano-banana-pro", maxRefs: 14, price: { "1K": 0.105, "2K": 0.105 }, extraRefPrice: 0,
  },
};

export const DEFAULT_IMAGE_MODEL: PiapiImageModel = "seedream-5-pro";

export function isPiapiImageModel(v: unknown): v is PiapiImageModel {
  return typeof v === "string" && v in PIAPI_IMAGE_MODELS;
}

export interface PiapiImageRequest {
  prompt: string;
  /** Images de référence (identité, tenue, décor…) — l'ordre compte, le prompt doit dire le rôle de chacune. */
  refs?: string[];
  model?: PiapiImageModel;
  aspect?: ImageAspect;
  quality?: ImageQuality;
}

export interface PiapiImageResult {
  url: string; // URL éphémère du fournisseur
  taskId: string;
  model: PiapiImageModel;
  cost: number;
  ms: number;
}

function buildInput(def: PiapiImageModelDef, key: PiapiImageModel, req: PiapiImageRequest, refs: string[]): Record<string, unknown> {
  const aspect = req.aspect ?? "3:4";
  const quality = req.quality ?? "1K";
  const base: Record<string, unknown> = { prompt: req.prompt, aspect_ratio: aspect };
  if (refs.length) base.image_urls = refs;
  switch (key) {
    case "seedream-5-pro":
      return { ...base, size: quality, output_format: "png" };
    case "seedream-5-lite":
      return { ...base, size: quality === "2K" ? "3K" : "2K", output_format: "png" };
    case "nano-banana-2":
      return { ...base, resolution: quality, output_format: "jpg" };
    case "nano-banana-pro":
      return { ...base, resolution: quality, output_format: "png", safety_level: "medium" };
  }
}

export function estimateImageCost(model: PiapiImageModel, refs = 0, quality: ImageQuality = "1K"): number {
  const def = PIAPI_IMAGE_MODELS[model];
  return def.price[quality] + Math.max(0, refs - 1) * def.extraRefPrice;
}

/** Soumet une génération d'image et attend le résultat (URL éphémère du fournisseur). */
export async function piapiGenerateImage(req: PiapiImageRequest): Promise<PiapiImageResult> {
  if (!config.PIAPI_API_KEY) throw new Error("PiAPI non configuré (PIAPI_API_KEY manquante).");
  const model = req.model ?? DEFAULT_IMAGE_MODEL;
  const def = PIAPI_IMAGE_MODELS[model];
  const refs = (req.refs ?? []).filter(Boolean).slice(0, def.maxRefs);
  const t0 = Date.now();

  const res = await fetch(`${BASE}/api/v1/task`, {
    method: "POST",
    headers: { "x-api-key": config.PIAPI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: def.model, task_type: def.taskType, input: buildInput(def, model, req, refs) }),
  });
  const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { task_id?: string } };
  if (!res.ok || !j.data?.task_id) throw new Error(`piapi image submit ${res.status}: ${j.message ?? JSON.stringify(j).slice(0, 200)}`);
  const taskId = j.data.task_id;

  for (;;) {
    const p = await fetch(`${BASE}/api/v1/task/${taskId}`, { headers: { "x-api-key": config.PIAPI_API_KEY } });
    const pj = (await p.json().catch(() => ({}))) as { data?: { status?: string; output?: Record<string, unknown>; error?: { message?: string } } };
    const status = String(pj.data?.status ?? "").toLowerCase();
    if (status === "completed" || status === "success") {
      const out = pj.data?.output ?? {};
      const urls = Array.isArray(out.image_urls) ? (out.image_urls as string[])
        : typeof out.image_urls === "string" ? [out.image_urls]
          : typeof out.image_url === "string" ? [out.image_url] : [];
      if (!urls.length) throw new Error(`piapi image: tâche terminée sans image (${JSON.stringify(out).slice(0, 160)})`);
      const cost = estimateImageCost(model, refs.length, req.quality ?? "1K");
      logger.info("piapi_image_done", { model, taskId, ms: Date.now() - t0, refs: refs.length, cost });
      return { url: urls[0]!, taskId, model, cost, ms: Date.now() - t0 };
    }
    if (status === "failed") throw new Error(`piapi image (${model}) : ${pj.data?.error?.message ?? "échec du rendu"}`);
    if (Date.now() - t0 > MAX_WAIT_MS) throw new Error(`piapi image (${model}) : délai dépassé`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Génère puis archive dans Storage en JPEG (les PNG 1K-2K pèsent 1,5 à 4 Mo). */
export async function piapiImageToStorage(req: PiapiImageRequest, storagePathBase: string): Promise<{ imageUrl: string; cost: number; model: PiapiImageModel; ms: number }> {
  const r = await piapiGenerateImage(req);
  const dl = await fetch(r.url);
  if (!dl.ok) throw new Error(`piapi image download ${dl.status}`);
  const raw = Buffer.from(await dl.arrayBuffer());
  let imageUrl: string;
  try {
    imageUrl = await uploadBytes(`${storagePathBase}.jpg`, await toJpeg(raw), "image/jpeg");
  } catch (err) {
    logger.warn("jpeg_encode_failed", { err: String((err as Error)?.message ?? err) });
    const type = dl.headers.get("content-type") ?? "image/png";
    imageUrl = await uploadBytes(`${storagePathBase}.${type.includes("jpeg") || type.includes("jpg") ? "jpg" : "png"}`, raw, type);
  }
  return { imageUrl, cost: r.cost, model: r.model, ms: r.ms };
}
