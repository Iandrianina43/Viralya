import { config } from "../config";
import { uploadBytes } from "../lib/storage";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Provider image — OpenAI gpt-image-1 (modèle actuel ; dall-e-3 retiré).
// gpt-image-1 renvoie l'image en base64 → on l'upload dans le Storage
// et on renvoie l'URL publique. Stub si pas de clé.
// ─────────────────────────────────────────────────────────────

export async function generateImage(
  prompt: string,
  storagePathBase: string,
): Promise<{ imageUrl: string }> {
  if (config.IMAGE_PROVIDER !== "openai" || !config.OPENAI_API_KEY) {
    logger.warn("image_stub_used");
    return { imageUrl: "https://placehold.co/1080x1080/png?text=VIRALYA" };
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
  });
  if (!res.ok) throw new Error(`openai image ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = data.data?.[0];

  if (first?.b64_json) {
    const bytes = Buffer.from(first.b64_json, "base64");
    const imageUrl = await uploadBytes(`${storagePathBase}.png`, bytes, "image/png");
    return { imageUrl };
  }
  if (first?.url) return { imageUrl: first.url };
  throw new Error("openai image: ni b64_json ni url dans la réponse");
}
