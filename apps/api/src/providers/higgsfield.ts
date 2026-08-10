import { config } from "../config";

// Moteur vidéo CINÉMATIQUE (Higgsfield) : perso cohérent en scène (Soul) → clip animé (DoP).
// API async : POST {params} → { id } (job_set) ; GET /requests/{id}/status → { status, images?, video? }.
const BASE = "https://platform.higgsfield.ai";
const VERTICAL = "1152x2048"; // 9:16 vertical (réseaux)

export function higgsfieldConfigured(): boolean {
  return !!(config.HIGGSFIELD_API_KEY && config.HIGGSFIELD_API_SECRET);
}
function authHeader(): string {
  return `Key ${config.HIGGSFIELD_API_KEY}:${config.HIGGSFIELD_API_SECRET}`;
}

async function hfPost(path: string, params: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`higgsfield ${path} ${res.status}: ${text.slice(0, 300)}`);
  const id = (JSON.parse(text) as { id?: string }).id;
  if (!id) throw new Error(`higgsfield ${path}: pas d'id de job_set`);
  return id;
}

export interface HfPollResult {
  status: "processing" | "ready" | "failed";
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
}

export async function hfPoll(jobSetId: string): Promise<HfPollResult> {
  const res = await fetch(`${BASE}/requests/${jobSetId}/status`, { headers: { Authorization: authHeader() } });
  const text = await res.text();
  if (!res.ok) throw new Error(`higgsfield poll ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { status: string; images?: { url: string }[]; video?: { url: string } };
  if (data.status === "completed") return { status: "ready", imageUrl: data.images?.[0]?.url, videoUrl: data.video?.url };
  if (data.status === "failed" || data.status === "nsfw") return { status: "failed", error: data.status };
  return { status: "processing" };
}

// Étape 1 : keyframe du perso dans la scène. L'identité est portée par l'image de référence (portrait).
export async function submitSoulKeyframe(scenePrompt: string, refImageUrl?: string | null): Promise<string> {
  return hfPost("/v1/text2image/soul", {
    prompt: scenePrompt,
    width_and_height: VERTICAL,
    quality: "1080p",
    batch_size: 1,
    enhance_prompt: true,
    ...(refImageUrl
      ? { image_reference: { type: "image_url", image_url: refImageUrl }, custom_reference_strength: 0.7 }
      : {}),
  });
}

// ── Moteurs d'animation disponibles (contrat vérifié en direct sur l'API) ──
// Le coût en crédits est indicatif (source : tarifs publics Higgsfield).
export interface VideoModelDef {
  label: string;
  credits: string; // ordre de grandeur par clip
  hint: string;
  build: (imageUrl: string, prompt: string) => { path: string; params: Record<string, unknown> };
}

export const VIDEO_MODELS: Record<string, VideoModelDef> = {
  "dop-lite": {
    label: "DoP Lite",
    credits: "éco",
    hint: "Le plus rapide et le moins cher",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/dop",
      params: { model: "dop-lite", prompt, input_images: [{ type: "image_url", image_url }], enhance_prompt: true },
    }),
  },
  "dop-standard": {
    label: "DoP Standard",
    credits: "éco+",
    hint: "Meilleur rendu que le Lite",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/dop",
      params: { model: "dop-standard", prompt, input_images: [{ type: "image_url", image_url }], enhance_prompt: true },
    }),
  },
  kling: {
    label: "Kling 2.1",
    credits: "~6-14",
    hint: "⭐ Meilleur rapport qualité/prix",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/kling",
      params: { model: "kling-v2-1", prompt, input_image: { type: "image_url", image_url }, duration: 5 },
    }),
  },
  "kling-master": {
    label: "Kling 2.1 Master",
    credits: "~14-25",
    hint: "Kling haut de gamme",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/kling",
      params: { model: "kling-v2-1-master", prompt, input_image: { type: "image_url", image_url }, duration: 5 },
    }),
  },
  "seedance-lite": {
    label: "Seedance Lite 720p",
    credits: "~22",
    hint: "Très bon réalisme",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/seedance",
      params: { model: "seedance_lite", prompt, input_image: { type: "image_url", image_url }, duration: 5, resolution: "720" },
    }),
  },
  "seedance-pro": {
    label: "Seedance Pro 1080p",
    credits: "~45",
    hint: "Qualité maximale",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/seedance",
      params: { model: "seedance_pro", prompt, input_image: { type: "image_url", image_url }, duration: 5, resolution: "1080" },
    }),
  },
  "veo3-fast": {
    label: "Veo 3 Fast",
    credits: "~22",
    hint: "Google Veo, rendu cinéma",
    build: (image_url, prompt) => ({
      path: "/v1/image2video/veo3",
      params: { model: "veo-3-fast", prompt, input_image: { type: "image_url", image_url }, resolution: "720" },
    }),
  },
};

export const DEFAULT_VIDEO_MODEL = "kling";

// Étape 2 : anime le keyframe en clip cinématique avec le moteur choisi.
export async function submitImageToVideo(imageUrl: string, motionPrompt: string, modelId = DEFAULT_VIDEO_MODEL): Promise<string> {
  const def = VIDEO_MODELS[modelId] ?? VIDEO_MODELS[DEFAULT_VIDEO_MODEL]!;
  const { path, params } = def.build(imageUrl, motionPrompt);
  return hfPost(path, params);
}

// Étape 2bis : plan "elle parle" — lip-sync image + audio (ElevenLabs) → vidéo parlée.
// duration ∈ {5,10,15} : on prend la plus petite ≥ durée de l'audio (approx. par le texte).
export async function submitSpeak(imageUrl: string, audioUrl: string, prompt: string, duration: 5 | 10 | 15): Promise<string> {
  return hfPost("/v1/speak/higgsfield", {
    input_image: { type: "image_url", image_url: imageUrl },
    input_audio: { type: "audio_url", audio_url: audioUrl },
    prompt,
    quality: "mid",
    duration,
  });
}

/** Durée Speak autorisée (5/10/15s) estimée depuis le texte (~14 caractères/s en FR parlé). */
export function speakDuration(text: string): 5 | 10 | 15 {
  const sec = Math.ceil(text.length / 14);
  if (sec <= 5) return 5;
  if (sec <= 10) return 10;
  return 15;
}

// Presets vlog "vraie vie" → indice de scène (Soul) + cadrage (shot) + mouvement (DoP).
export const VLOG_PRESETS: Record<string, { scene: string; shot: string; motion: string; label: string }> = {
  grwm: {
    label: "Get Ready With Me",
    scene: "getting ready in a bright modern bathroom, holding makeup, morning routine, cozy",
    shot: "medium shot, framed from the head to the waist, the bathroom clearly visible around her",
    motion: "she does her morning routine looking at the mirror, gentle handheld camera, cinematic vlog",
  },
  coffee: {
    label: "Prends un café avec moi",
    scene: "sitting at a cozy café terrace with a cup of coffee, warm light, relaxed, urban background",
    shot: "medium shot at a café table, her upper body and the table with the coffee cup visible, café in the background",
    motion: "she sips her coffee and smiles softly, subtle camera push-in, cinematic",
  },
  walk: {
    label: "Balade dans la rue",
    scene: "walking through a charming city street, casual outfit, natural daylight, lively background",
    shot: "wide full-body shot, her entire figure from head to toe visible, the whole street around her",
    motion: "she walks slowly through the street, smooth handheld tracking shot, cinematic",
  },
  vlog: {
    label: "Mini-vlog du jour",
    scene: "candid lifestyle moment in a stylish setting, natural light, authentic influencer vibe",
    shot: "medium-wide shot, well composed, her upper body and the environment visible",
    motion: "natural subtle movement, cinematic camera, lifelike",
  },
};

// Prompt de scène ancré sur l'avatar (niche/ville) + indice + cadrage explicite (évite le gros plan visage).
export function buildScenePrompt(opts: { niche?: string | null; city?: string | null; hint: string; shot?: string }): string {
  const loc = opts.city ? ` in ${opts.city}` : "";
  const vibe = opts.niche ? `, ${opts.niche} lifestyle` : "";
  const shot = opts.shot ?? "medium-wide cinematic shot, framed from head to waist with the surroundings clearly visible, well composed with headroom";
  return `Photorealistic vertical 9:16 ${shot}. The same young woman${loc}${vibe}, ${opts.hint}. Full scene framing, NOT a tight face close-up. Candid, natural light, shot on a real camera, film look, high detail.`;
}
