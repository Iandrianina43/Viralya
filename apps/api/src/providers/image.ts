import { config } from "../config";
import { uploadBytes } from "../lib/storage";
import { logger } from "../logger";
import { DEFAULT_IMAGE_MODEL, isPiapiImageModel, PIAPI_IMAGE_MODELS, piapiImageToStorage, type ImageAspect, type PiapiImageModel } from "./piapiImage";

// ─────────────────────────────────────────────────────────────
// Provider image unifié.
//   IMAGE_PROVIDER=piapi  (défaut) → Seedream 5 Pro / Nano Banana 2 via PiAPI (multi-référence)
//   IMAGE_PROVIDER=openai          → GPT Image 2 (repli gpt-image-1) : conservé en option
//   IMAGE_PROVIDER=stub            → image de remplacement (environnements sans clé)
// Les deux fonctions publiques gardent leur signature historique.
// ─────────────────────────────────────────────────────────────

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
const SIZE_TO_ASPECT: Record<ImageSize, ImageAspect> = { "1024x1024": "1:1", "1024x1536": "3:4", "1536x1024": "4:3" };
const STUB_URL = "https://placehold.co/1024x1536/png?text=VIRALYA";

export function imageConfigured(): boolean {
  if (config.IMAGE_PROVIDER === "piapi") return !!config.PIAPI_API_KEY;
  if (config.IMAGE_PROVIDER === "openai") return !!config.OPENAI_API_KEY;
  return false;
}
/** Compat : anciens appels qui testaient spécifiquement OpenAI. */
export function openAiImageConfigured(): boolean {
  return config.IMAGE_PROVIDER === "openai" && !!config.OPENAI_API_KEY;
}

function resolveModel(override?: string): PiapiImageModel {
  if (isPiapiImageModel(override)) return override;
  if (isPiapiImageModel(config.IMAGE_MODEL)) return config.IMAGE_MODEL;
  return DEFAULT_IMAGE_MODEL;
}

/** Texte → image (sans référence). */
export async function generateImage(
  prompt: string,
  storagePathBase: string,
  size: ImageSize = "1024x1024",
  modelOverride?: string,
): Promise<{ imageUrl: string }> {
  if (config.IMAGE_PROVIDER === "piapi" && config.PIAPI_API_KEY) {
    const { imageUrl } = await piapiImageToStorage({ prompt, aspect: SIZE_TO_ASPECT[size], model: resolveModel(modelOverride) }, storagePathBase);
    return { imageUrl };
  }
  if (config.IMAGE_PROVIDER === "openai" && config.OPENAI_API_KEY) return openaiGenerate(prompt, storagePathBase, size, modelOverride);
  logger.warn("image_stub_used");
  return { imageUrl: STUB_URL };
}

/**
 * Image multi-référence : visage(s) de l'avatar + éventuellement le décor.
 * Le prompt reçoit automatiquement le rôle de chaque référence (identité, puis décor en dernier).
 */
export async function composeKeyframe(
  faceUrls: string | string[],
  locationUrl: string | null,
  prompt: string,
  storagePathBase: string,
  size: ImageSize = "1024x1536",
  opts: { model?: string } = {},
): Promise<{ imageUrl: string }> {
  const faces = (Array.isArray(faceUrls) ? faceUrls : [faceUrls]).filter(Boolean);
  if (faces.length === 0) throw new Error("aucune référence de visage");

  if (config.IMAGE_PROVIDER === "piapi" && config.PIAPI_API_KEY) {
    const model = resolveModel(opts.model);
    const max = PIAPI_IMAGE_MODELS[model].maxRefs;
    const refs = [...faces.slice(0, Math.max(1, max - (locationUrl ? 1 : 0))), ...(locationUrl ? [locationUrl] : [])];
    const roles = [
      refs.length > 1 || locationUrl
        ? `Reference images 1${faces.length > 1 ? `-${Math.min(faces.length, refs.length - (locationUrl ? 1 : 0))}` : ""}: the same person (identity, face, hair, body).`
        : "Reference image 1: the person (identity, face, hair, body).",
      locationUrl ? "The LAST reference image is the exact location: reuse its walls, furniture, colors and layout." : "",
    ].filter(Boolean).join(" ");
    const { imageUrl } = await piapiImageToStorage({ prompt: `${roles} ${prompt}`, refs, aspect: SIZE_TO_ASPECT[size], model }, storagePathBase);
    return { imageUrl };
  }
  if (config.IMAGE_PROVIDER === "openai" && config.OPENAI_API_KEY) return openaiEdit(faces.slice(0, 6), locationUrl, prompt, storagePathBase, size);
  logger.warn("image_stub_used");
  return { imageUrl: STUB_URL };
}

/** Stocke une image générée en JPEG (les PNG bruts pèsent ~3 Mo → ~250 Ko en JPEG). */
export async function storeAsJpeg(png: Buffer, storagePathBase: string): Promise<string> {
  try {
    const { toJpeg } = await import("../lib/ffmpeg");
    const jpg = await toJpeg(png);
    return await uploadBytes(`${storagePathBase}.jpg`, jpg, "image/jpeg");
  } catch (err) {
    logger.warn("jpeg_encode_failed", { err: String((err as Error)?.message ?? err) });
    return uploadBytes(`${storagePathBase}.png`, png, "image/png");
  }
}

// ── OpenAI (option) ──────────────────────────────────────────
let openaiModel = "gpt-image-2";

async function callOpenAIImage(model: string, prompt: string, size: string): Promise<Response> {
  return fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
}

async function openaiGenerate(prompt: string, storagePathBase: string, size: ImageSize, modelOverride?: string): Promise<{ imageUrl: string }> {
  if (modelOverride === "gpt-image-1" || modelOverride === "gpt-image-2") openaiModel = modelOverride;
  let res = await callOpenAIImage(openaiModel, prompt, size);
  if (!res.ok && openaiModel === "gpt-image-2") {
    const errText = await res.text();
    logger.warn("gpt_image_2_fallback", { status: res.status, err: errText.slice(0, 200) });
    openaiModel = "gpt-image-1";
    res = await callOpenAIImage(openaiModel, prompt, size);
  }
  if (!res.ok) throw new Error(`openai image ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = data.data?.[0];
  if (first?.b64_json) return { imageUrl: await storeAsJpeg(Buffer.from(first.b64_json, "base64"), storagePathBase) };
  if (first?.url) return { imageUrl: first.url };
  throw new Error("openai image: réponse sans image");
}

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ref download ${res.status}: ${url.slice(0, 100)}`);
  return new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") ?? "image/png" });
}

async function openaiEdit(faces: string[], locationUrl: string | null, prompt: string, storagePathBase: string, size: ImageSize): Promise<{ imageUrl: string }> {
  const form = new FormData();
  form.append("model", openaiModel);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("n", "1");
  for (let i = 0; i < faces.length; i++) form.append("image[]", await fetchAsBlob(faces[i]!), `face${i}.png`);
  if (locationUrl) form.append("image[]", await fetchAsBlob(locationUrl), "location.png");

  const send = () => fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` }, body: form });
  let res = await send();
  if (!res.ok && openaiModel === "gpt-image-2") {
    const errText = await res.text();
    logger.warn("gpt_image_2_edits_fallback", { status: res.status, err: errText.slice(0, 200) });
    openaiModel = "gpt-image-1";
    form.set("model", openaiModel);
    res = await send();
  }
  if (!res.ok) throw new Error(`openai edits ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai edits: réponse sans image");
  return { imageUrl: await storeAsJpeg(Buffer.from(b64, "base64"), storagePathBase) };
}
