import { config } from "../config";
import { logger } from "../logger";
import { uploadBytes } from "../lib/storage";

// ─────────────────────────────────────────────────────────────
// Provider voix — ElevenLabs (voix clonée par avatar).
// Fallback stub si pas de clé / pas de voice_id.
// ─────────────────────────────────────────────────────────────

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
}

/** Liste les voix disponibles sur le compte ElevenLabs (pour assignation par avatar). */
export async function listVoices(): Promise<{ configured: boolean; voices: VoiceInfo[] }> {
  if (!config.ELEVENLABS_API_KEY) return { configured: false, voices: [] };
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
  });
  if (!res.ok) throw new Error(`elevenlabs voices ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    voices?: Array<{ voice_id: string; name: string; category?: string }>;
  };
  return {
    configured: true,
    voices: (data.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
    })),
  };
}

export async function synthesizeVoice(
  text: string,
  voiceId: string | null,
  storagePathBase: string,
): Promise<{ audioUrl: string }> {
  if (!config.ELEVENLABS_API_KEY || !voiceId) {
    logger.warn("voice_stub_used", { hasKey: !!config.ELEVENLABS_API_KEY, voiceId });
    return { audioUrl: "https://placehold.co/stub/audio.mp3" };
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
  const bytes = await res.arrayBuffer();
  const audioUrl = await uploadBytes(`${storagePathBase}/voice.mp3`, bytes, "audio/mpeg");
  return { audioUrl };
}
