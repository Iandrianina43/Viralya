/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────
// BANC D'ESSAI IMAGES — cohérence d'identité (phase 1).
// Même personnage, mêmes 5 scènes, plusieurs modèles multi-référence via PiAPI
// + GPT Image 2 (OpenAI) en témoin. Sorties archivées dans Storage `bench/…`,
// résultats dans un JSON (à scorer ensuite avec tools/qc/face_score.py).
//
//   pnpm --filter @viralya/api exec tsx scripts/bench-images.ts <avatar_id> [models] [out.json]
//   models = liste séparée par des virgules parmi : nano-banana-2, nano-banana-pro,
//            seedream-5-lite, seedream-5-pro, gpt-image-2  (défaut : tous)
// ─────────────────────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import { config } from "../src/config";
import { uploadBytes } from "../src/lib/storage";
import { composeKeyframe } from "../src/providers/image";
import { supabase } from "../src/supabase";

const PIAPI = "https://api.piapi.ai";
const avatarId = process.argv[2] ?? "";
const only = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const outFile = process.argv[4] ?? `bench-${Date.now()}.json`;
// Variante "tenue imposée" : BENCH_OUTFIT="black sports bra and grey leggings" ajoute la tenue
// à chaque scène et range les sorties sous <model>-<BENCH_SUFFIX>.
const OUTFIT = process.env.BENCH_OUTFIT?.trim() ?? "";
const SUFFIX = process.env.BENCH_SUFFIX?.trim() ?? (OUTFIT ? "outfit" : "");
if (!avatarId) throw new Error("usage: bench-images.ts <avatar_id> [models] [out.json]");
if (!config.PIAPI_API_KEY) throw new Error("PIAPI_API_KEY manquante");

interface ModelDef {
  key: string;
  model: string;
  taskType: string;
  cost: number; // USD par image (page PiAPI, 3 sept 2026)
  input: (prompt: string, refs: string[]) => Record<string, unknown>;
}
const MODELS: ModelDef[] = [
  {
    key: "nano-banana-2", model: "gemini", taskType: "nano-banana-2", cost: 0.06,
    input: (prompt, refs) => ({ prompt, image_urls: refs, aspect_ratio: "3:4", resolution: "1K", output_format: "jpg" }),
  },
  {
    key: "nano-banana-pro", model: "gemini", taskType: "nano-banana-pro", cost: 0.105,
    input: (prompt, refs) => ({ prompt, image_urls: refs, aspect_ratio: "3:4", resolution: "1K", output_format: "png", safety_level: "medium" }),
  },
  {
    key: "seedream-5-lite", model: "seedream", taskType: "seedream-5-lite", cost: 0.052,
    input: (prompt, refs) => ({ prompt, image_urls: refs, aspect_ratio: "3:4", size: "2K", output_format: "png" }),
  },
  {
    key: "seedream-5-pro", model: "seedream", taskType: "seedream-5-pro", cost: 0.071,
    input: (prompt, refs) => ({ prompt, image_urls: refs, aspect_ratio: "3:4", size: "1K", output_format: "png" }),
  },
];

interface Scene { key: string; label: string; text: (pron: { subj: string; poss: string }) => string }
const SCENES: Scene[] = [
  { key: "kitchen-selfie", label: "Selfie cuisine, matin", text: (p) => `${p.subj} takes a smartphone selfie in ${p.poss} bright kitchen in the morning, holding a mug of coffee, soft window light, slightly messy hair, relaxed smile` },
  { key: "street-walk", label: "Marche en ville, plein pied", text: (p) => `candid full-body photo of ${p.subj} walking down a busy street of ${p.poss} city, caught mid-step, looking slightly away from camera, natural daylight, everyday outfit` },
  { key: "cafe-latte", label: "Café, plan taille", text: (p) => `${p.subj} sits at a small café table with a latte, medium shot, smiling at the camera, warm interior light, blurred background with other customers` },
  { key: "gym-mirror", label: "Selfie miroir salle de sport", text: (p) => `${p.subj} takes a mirror selfie in a gym in sportswear, phone visible in ${p.poss} hand, slightly sweaty skin, fluorescent light, confident expression` },
  { key: "rooftop-night", label: "Rooftop, nuit", text: (p) => `portrait of ${p.subj} on a rooftop at night with city lights bokeh behind, warm tungsten light on the face, jacket, calm expression looking at the camera` },
];

interface Result {
  avatar: string; model: string; scene: string; label: string; url: string | null; ms: number; cost: number; error: string | null; prompt: string;
}

async function submit(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${PIAPI}/api/v1/task`, {
    method: "POST",
    headers: { "x-api-key": config.PIAPI_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  if (!res.ok || !j.data?.task_id) throw new Error(`submit ${res.status}: ${j.message ?? JSON.stringify(j).slice(0, 200)}`);
  return j.data.task_id;
}

async function poll(taskId: string, maxMs = 8 * 60_000): Promise<string[]> {
  const t0 = Date.now();
  for (;;) {
    const res = await fetch(`${PIAPI}/api/v1/task/${taskId}`, { headers: { "x-api-key": config.PIAPI_API_KEY! } });
    const j = (await res.json()) as { data?: { status?: string; output?: Record<string, unknown>; error?: { message?: string } } };
    const status = String(j.data?.status ?? "").toLowerCase();
    if (status === "completed" || status === "success") {
      const out = j.data?.output ?? {};
      const urls = Array.isArray(out.image_urls) ? (out.image_urls as string[]) : typeof out.image_urls === "string" ? [out.image_urls] : typeof out.image_url === "string" ? [out.image_url] : [];
      if (!urls.length) throw new Error(`completed sans image: ${JSON.stringify(out).slice(0, 200)}`);
      return urls;
    }
    if (status === "failed") throw new Error(j.data?.error?.message ?? "failed");
    if (Date.now() - t0 > maxMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function persist(url: string, path: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return uploadBytes(`${path}.${ext}`, await res.arrayBuffer(), type);
}

async function main() {
  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, name, sex_age, city, nationality, ref_image_url, character_sheet_url, portrait_spec")
    .eq("id", avatarId)
    .single();
  if (!avatar?.ref_image_url) throw new Error("avatar sans portrait");
  const spec = (avatar.portrait_spec ?? {}) as Record<string, string>;
  const female = /femme|woman|female/i.test(String(avatar.sex_age ?? ""));
  const pron = { subj: female ? "she" : "he", poss: female ? "her" : "his" };
  const who = female ? "woman" : "man";
  const refs = [avatar.ref_image_url as string, ...(avatar.character_sheet_url ? [avatar.character_sheet_url as string] : [])];

  const identity = [
    `${avatar.name}: ${spec.ethnicity ?? avatar.nationality ?? ""} ${who}, ${spec.age ?? ""} years old`,
    spec.face_shape ? `${spec.face_shape} face` : "",
    spec.eyes ? `${spec.eyes} eyes` : "",
    spec.hair_style ? `${spec.hair_style}, ${spec.hair_color ?? ""} hair` : "",
    spec.skin_tone ? `${spec.skin_tone} skin` : "",
    spec.facial_hair && spec.facial_hair !== "none" ? spec.facial_hair : "",
  ].filter(Boolean).join(", ");

  const buildPrompt = (scene: Scene) => [
    `The first reference image is the face and identity of ${avatar.name}.`,
    refs.length > 1 ? `The second reference image is ${pron.poss} character sheet (body proportions, style).` : "",
    `Create a NEW photo of the SAME person with an identical face: ${scene.text(pron).replace(/^\w/, (c) => c.toUpperCase())}.`,
    OUTFIT ? `${pron.subj.replace(/^\w/, (c) => c.toUpperCase())} is wearing ${OUTFIT} — do NOT copy the clothes from the reference images.` : "",
    `Keep the face, features, hairstyle and skin exactly like the references. ${identity}.`,
    `Photorealistic, natural skin texture, no beauty filter, candid social-media photo, vertical 3:4.`,
  ].filter(Boolean).join(" ");
  const modelDir = (key: string) => (SUFFIX ? `${key}-${SUFFIX}` : key);

  const results: Result[] = [];
  const wanted = MODELS.filter((m) => only.length === 0 || only.includes(m.key));
  const runGpt = only.length === 0 || only.includes("gpt-image-2");

  for (const m of wanted) {
    console.log(`\n▶ ${m.key}`);
    await Promise.all(
      SCENES.map(async (scene) => {
        const prompt = buildPrompt(scene);
        const t0 = Date.now();
        try {
          const taskId = await submit({ model: m.model, task_type: m.taskType, input: m.input(prompt, refs) });
          const [url] = await poll(taskId);
          const stored = await persist(url!, `bench/${avatar.id}/${modelDir(m.key)}/${scene.key}`);
          results.push({ avatar: avatar.name, model: modelDir(m.key), scene: scene.key, label: scene.label, url: stored, ms: Date.now() - t0, cost: m.cost, error: null, prompt });
          console.log(`  ✓ ${scene.key} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          results.push({ avatar: avatar.name, model: modelDir(m.key), scene: scene.key, label: scene.label, url: null, ms: Date.now() - t0, cost: 0, error: msg, prompt });
          console.log(`  ✗ ${scene.key}: ${msg.slice(0, 160)}`);
        }
        writeFileSync(outFile, JSON.stringify(results, null, 2));
      }),
    );
  }

  if (runGpt) {
    console.log(`\n▶ gpt-image-2 (témoin)`);
    await Promise.all(
      SCENES.map(async (scene) => {
        const prompt = buildPrompt(scene);
        const t0 = Date.now();
        try {
          const { imageUrl } = await composeKeyframe(refs, null, prompt, `bench/${avatar.id}/gpt-image-2/${scene.key}`, "1024x1536");
          results.push({ avatar: avatar.name, model: "gpt-image-2", scene: scene.key, label: scene.label, url: imageUrl, ms: Date.now() - t0, cost: 0.08, error: null, prompt });
          console.log(`  ✓ ${scene.key} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          results.push({ avatar: avatar.name, model: "gpt-image-2", scene: scene.key, label: scene.label, url: null, ms: Date.now() - t0, cost: 0, error: msg, prompt });
          console.log(`  ✗ ${scene.key}: ${msg.slice(0, 160)}`);
        }
        writeFileSync(outFile, JSON.stringify(results, null, 2));
      }),
    );
  }

  writeFileSync(outFile, JSON.stringify(results, null, 2));
  const spent = results.reduce((a, r) => a + r.cost, 0);
  console.log(`\nTerminé : ${results.filter((r) => r.url).length}/${results.length} images, ≈ ${spent.toFixed(2)} $ → ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
