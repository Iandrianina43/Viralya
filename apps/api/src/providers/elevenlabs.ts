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

// Synthèse vocale → conversion WAV (exigé par Higgsfield Speak) → upload Storage.
// model eleven_multilingual_v2 = le plus naturel en français.
export async function ttsToStorage(voiceId: string, text: string, storagePath: string): Promise<string> {
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
  const mp3 = Buffer.from(await res.arrayBuffer());
  const { toWav } = await import("../lib/ffmpeg");
  const wav = await toWav(mp3);
  const { uploadBytes } = await import("../lib/storage");
  return uploadBytes(storagePath.replace(/\.mp3$/i, ".wav"), wav, "audio/wav");
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
