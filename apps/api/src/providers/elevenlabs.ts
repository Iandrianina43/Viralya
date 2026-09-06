import { config } from "../config";
import { logger } from "../logger";

// Provider voix ElevenLabs — voix du compte + bibliothèque partagée (français),
// avec URL d'aperçu pour l'écoute. Les voix sont multilingues (parlent français
// même si l'accent d'origine diffère).
export interface ElevenVoice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  description: string;
  gender: string | null; // "male" | "female"
  language: string | null; // "en", "fr", …
}

function headers() {
  return { "xi-api-key": config.ELEVENLABS_API_KEY as string };
}

// Voix ajoutées au compte de l'utilisateur (GET /v1/voices).
async function fetchAccountVoices(): Promise<ElevenVoice[]> {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: headers() });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    voices?: Array<{ voice_id: string; name: string; preview_url?: string; labels?: Record<string, string> }>;
  };
  return (data.voices ?? []).map((v) => {
    const l = v.labels ?? {};
    return {
      voice_id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url ?? null,
      gender: (l.gender ?? "").toLowerCase() || null,
      language: l.language ?? null,
      description: Object.values(l).filter(Boolean).join(" · "),
    };
  });
}

// Bibliothèque partagée filtrée par langue (GET /v1/shared-voices).
async function fetchSharedVoices(language: string, pageSize = 100): Promise<ElevenVoice[]> {
  const url = `https://api.elevenlabs.io/v1/shared-voices?language=${encodeURIComponent(language)}&page_size=${pageSize}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    voices?: Array<{ voice_id: string; name: string; preview_url?: string; language?: string; gender?: string; accent?: string; age?: string; use_case?: string; descriptive?: string }>;
  };
  return (data.voices ?? []).map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    gender: (v.gender ?? "").toLowerCase() || null,
    language: v.language ?? language,
    description: [v.accent, v.age, v.descriptive, v.use_case].filter(Boolean).join(" · "),
  }));
}

// ── Dialogue horodaté (vidéo v2) ─────────────────────────────
// Eleven v3 (GA, 70+ langues, tags [cheerful]…) pour les répliques ; repli automatique
// sur multilingual_v2 si v3 refuse. L'alignement caractère → mots sert aux sous-titres.
export type TtsModel = "eleven_v3" | "eleven_multilingual_v2";
export const DEFAULT_TTS_MODEL: TtsModel = "eleven_v3";
export interface TtsWord { w: string; s: number; e: number }
export interface TtsResult { mp3: Buffer; seconds: number; words: TtsWord[]; model: TtsModel }

interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }

function settingsFor(model: TtsModel) {
  // v3 : stability ∈ {0, 0.5, 1} (Creative / Natural / Robust).
  return model === "eleven_v3" ? { stability: 0.5, similarity_boost: 0.8 } : { stability: 0.45, similarity_boost: 0.8, style: 0.3 };
}

/** Regroupe l'alignement caractère par caractère en mots horodatés (les tags [xxx] sont ignorés). */
function wordsFromAlignment(al: Alignment): TtsWord[] {
  const words: TtsWord[] = [];
  let cur = "";
  let s = 0;
  let e = 0;
  const flush = () => {
    const w = cur.trim();
    if (w && !/^\[.*\]$/.test(w)) words.push({ w, s: Math.round(s * 1000) / 1000, e: Math.round(e * 1000) / 1000 });
    cur = "";
  };
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { flush(); return; }
    if (!cur) s = al.character_start_times_seconds[i] ?? e;
    cur += ch;
    e = al.character_end_times_seconds[i] ?? e;
  });
  flush();
  return words;
}

/** Durée parlée estimée (français ≈ 14 caractères/s) quand l'alignement manque. */
export function estimateSpeechSeconds(text: string): number {
  return Math.max(1.5, Math.round((text.replace(/\[[^\]]*\]/g, "").trim().length / 14) * 10) / 10);
}

export async function ttsWithTimestamps(voiceId: string, text: string, model: TtsModel = DEFAULT_TTS_MODEL): Promise<TtsResult> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY manquante");
  const call = async (m: TtsModel) => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: m, voice_settings: settingsFor(m) }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${m} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { audio_base64: string; alignment?: Alignment | null; normalized_alignment?: Alignment | null };
  };
  let used = model;
  let data: Awaited<ReturnType<typeof call>>;
  try {
    data = await call(model);
  } catch (err) {
    if (model !== "eleven_v3") throw err;
    logger.warn("eleven_v3_fallback", { err: String((err as Error)?.message ?? err) });
    used = "eleven_multilingual_v2";
    data = await call(used);
  }
  const mp3 = Buffer.from(data.audio_base64, "base64");
  const al = data.alignment ?? data.normalized_alignment ?? null;
  const words = al ? wordsFromAlignment(al) : [];
  const ends = al?.character_end_times_seconds ?? [];
  const seconds = ends.length ? Math.round(ends[ends.length - 1]! * 100) / 100 : estimateSpeechSeconds(text);
  return { mp3, seconds, words, model: used };
}

// ── Musique de fond (Eleven Music) ───────────────────────────
// POST /v1/music — 0,15 $/min en API (page tarifaire, sept. 2026) ; droits commerciaux
// inclus à partir du plan Starter (compte vérifié : plan Creator). Testé le 4 sept. :
// 15 s instrumentales → mp3 128 kbps en ≈ 20 s. Toujours instrumental (pas de paroles
// qui se battraient avec la voix), jamais de nom d'artiste dans le prompt (CGU).
export const MUSIC_PRICE_PER_MIN = 0.15;
export interface MusicResult { mp3: Buffer; seconds: number; costUsd: number }

export async function generateMusic(prompt: string, seconds: number): Promise<MusicResult> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY manquante");
  const len = Math.max(3, Math.min(120, Math.round(seconds)));
  const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 500), music_length_ms: len * 1000, force_instrumental: true }),
  });
  if (!res.ok) throw new Error(`elevenlabs music ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const mp3 = Buffer.from(await res.arrayBuffer());
  return { mp3, seconds: len, costUsd: Math.round((len / 60) * MUSIC_PRICE_PER_MIN * 1000) / 1000 };
}

// ── Transcription horodatée (Scribe) ─────────────────────────
// POST /v1/speech-to-text (multipart, `source_url` = clip hébergé) → mots avec start/end.
// Sert aux clips dont la voix est synthétisée par Seedance 2.5 : sous-titres karaoké,
// ancrage des inserts et contrôle du texte réellement prononcé.
export interface TranscriptResult { text: string; words: TtsWord[]; model: string }

export async function transcribeWords(sourceUrl: string, languageCode = "fra"): Promise<TranscriptResult> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY manquante");
  const call = async (modelId: string) => {
    const form = new FormData();
    form.set("model_id", modelId);
    form.set("source_url", sourceUrl);
    form.set("language_code", languageCode);
    form.set("timestamps_granularity", "word");
    form.set("diarize", "false");
    form.set("tag_audio_events", "false");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: headers(), body: form });
    if (!res.ok) throw new Error(`elevenlabs stt ${modelId} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { text?: string; words?: Array<{ text: string; type: string; start: number; end: number }> };
  };
  let model = "scribe_v2";
  let data: Awaited<ReturnType<typeof call>>;
  try {
    data = await call(model);
  } catch (err) {
    logger.warn("scribe_v2_fallback", { err: String((err as Error)?.message ?? err) });
    model = "scribe_v1";
    data = await call(model);
  }
  const words: TtsWord[] = (data.words ?? [])
    .filter((w) => w.type === "word" && String(w.text).trim())
    .map((w) => ({ w: String(w.text).trim(), s: Math.round(Number(w.start) * 1000) / 1000, e: Math.round(Number(w.end) * 1000) / 1000 }));
  return { text: String(data.text ?? "").trim(), words, model };
}

// Synthèse vocale → mp3 dans le Storage (Seedance accepte mp3/wav directement).
// model eleven_multilingual_v2 = le plus naturel en français.
async function ttsMp3(voiceId: string, text: string): Promise<Buffer> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY manquante");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Les 2 échantillons de TIMBRE passés à Seedance 2.0 en @audio1/@audio2.
// Contrainte API : mp3/wav, ≤15 s CUMULÉES → deux phrases courtes (~5-6 s parlées).
// Phrases neutres et expressives : elles donnent la voix, pas le contenu.
const SAMPLE_TEXTS = [
  "Coucou, c'est moi ! Bienvenue dans ma journée, je suis trop contente de te retrouver.",
  "Franchement, tu vas adorer ce que je te montre aujourd'hui. Allez, viens, on y va !",
];

/** Génère les 2 mp3 de référence de timbre d'un avatar → URLs Storage. */
export async function generateVoiceSamples(voiceId: string, avatarId: string): Promise<string[]> {
  const { uploadBytes } = await import("../lib/storage");
  const urls: string[] = [];
  for (let i = 0; i < SAMPLE_TEXTS.length; i++) {
    const mp3 = await ttsMp3(voiceId, SAMPLE_TEXTS[i]!);
    urls.push(await uploadBytes(`${avatarId}/voice/sample${i + 1}.mp3`, mp3, "audio/mpeg"));
  }
  return urls;
}

export async function listElevenVoices(): Promise<{ configured: boolean; voices: ElevenVoice[] }> {
  if (!config.ELEVENLABS_API_KEY) return { configured: false, voices: [] };
  try {
    const [account, sharedFr] = await Promise.all([fetchAccountVoices(), fetchSharedVoices("fr")]);
    const seen = new Set<string>();
    const voices = [...account, ...sharedFr].filter((v) => v.voice_id && !seen.has(v.voice_id) && seen.add(v.voice_id));
    return { configured: true, voices };
  } catch (err) {
    logger.warn("eleven_voices_failed", { err: String((err as Error)?.message ?? err) });
    return { configured: true, voices: [] };
  }
}
