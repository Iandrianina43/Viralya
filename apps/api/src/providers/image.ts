import { config } from "../config";
import { uploadBytes } from "../lib/storage";
import { logger } from "../logger";

// Provider image — OpenAI gpt-image-2 (dernier modèle, avril 2026), fallback
// automatique gpt-image-1 si la clé n'y a pas accès. base64 → upload Storage.
let imageModel = "gpt-image-2";

async function callOpenAIImage(model: string, prompt: string, size: string): Promise<Response> {
  return fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
}

export async function generateImage(
  prompt: string,
  storagePathBase: string,
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1024",
  modelOverride?: string,
): Promise<{ imageUrl: string }> {
  if (config.IMAGE_PROVIDER !== "openai" || !config.OPENAI_API_KEY) {
    logger.warn("image_stub_used");
    return { imageUrl: "https://placehold.co/1024x1536/png?text=VIRALYA" };
  }
  if (modelOverride === "gpt-image-1" || modelOverride === "gpt-image-2") imageModel = modelOverride;
  let res = await callOpenAIImage(imageModel, prompt, size);
  if (!res.ok && imageModel === "gpt-image-2") {
    // Modèle indisponible pour cette clé (403/404…) → bascule durable sur gpt-image-1.
    const errText = await res.text();
    logger.warn("gpt_image_2_fallback", { status: res.status, err: errText.slice(0, 200) });
    imageModel = "gpt-image-1";
    res = await callOpenAIImage(imageModel, prompt, size);
  }
  if (!res.ok) throw new Error(`openai image ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = data.data?.[0];
  if (first?.b64_json) {
    return { imageUrl: await storeAsJpeg(Buffer.from(first.b64_json, "base64"), storagePathBase) };
  }
  if (first?.url) return { imageUrl: first.url };
  throw new Error("openai image: réponse sans image");
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

// ── Keyframe multi-références (visage + lieu) ────────────────
// GPT Image accepte plusieurs images d'entrée sur /v1/images/edits :
// image 1 = le visage de l'avatar, image 2 = le lieu de référence.
// → même personne DANS le même décor, scène après scène.
async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ref download ${res.status}: ${url.slice(0, 100)}`);
  return new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") ?? "image/png" });
}

export function openAiImageConfigured(): boolean {
  return config.IMAGE_PROVIDER === "openai" && !!config.OPENAI_API_KEY;
}

export async function composeKeyframe(
  faceUrls: string | string[],
  locationUrl: string | null,
  prompt: string,
  storagePathBase: string,
): Promise<{ imageUrl: string }> {
  if (!openAiImageConfigured()) throw new Error("OpenAI image non configuré");

  // Plusieurs angles du visage = identité bien plus stable (GPT Image accepte
  // jusqu'à 16 références). On garde une marge pour l'image du lieu.
  const faces = (Array.isArray(faceUrls) ? faceUrls : [faceUrls]).filter(Boolean).slice(0, 6);
  if (faces.length === 0) throw new Error("aucune référence de visage");

  const form = new FormData();
  form.append("model", imageModel);
  form.append("prompt", prompt);
  form.append("size", "1024x1536");
  form.append("n", "1");
  for (let i = 0; i < faces.length; i++) {
    form.append("image[]", await fetchAsBlob(faces[i]!), `face${i}.png`);
  }
  if (locationUrl) form.append("image[]", await fetchAsBlob(locationUrl), "location.png");

  let res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok && imageModel === "gpt-image-2") {
    const errText = await res.text();
    logger.warn("gpt_image_2_edits_fallback", { status: res.status, err: errText.slice(0, 200) });
    imageModel = "gpt-image-1";
    form.set("model", imageModel);
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
      body: form,
    });
  }
  if (!res.ok) throw new Error(`openai edits ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai edits: réponse sans image");
  return { imageUrl: await storeAsJpeg(Buffer.from(b64, "base64"), storagePathBase) };
}
