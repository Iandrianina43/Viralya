import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Interface VideoProvider — abstraction du moteur talking-head.
// Impl. par défaut = HeyGen API v3 (POST /v3/videos). Swappable.
// Stub = démo/CI sans clé.
//
// Réf : https://developers.heygen.com/reference/create-video
//       https://developers.heygen.com/reference/get-video
// v3 est mono-scène : un avatar_id + un script (ou audio) + sous-titres SRT.
// ─────────────────────────────────────────────────────────────

export interface VideoSubmitInput {
  script: string;
  audioUrl?: string | null; // voix ElevenLabs (URL publique) → prime sur le TTS HeyGen
  background?: string | null; // couleur hex ("#0f1b3d") ou URL d'image
  captions?: boolean; // sous-titres SRT incrustés (défaut true)
  heygenAvatarId?: string | null;
  voiceId?: string | null; // voix HeyGen (fallback si pas d'audio ElevenLabs)
}

export interface VideoPollResult {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface VideoProvider {
  readonly name: string;
  submit(input: VideoSubmitInput): Promise<{ externalId: string }>;
  poll(externalId: string): Promise<VideoPollResult>;
}

// Mappe la valeur "background" (hex ou URL) vers l'objet background HeyGen.
function toBackground(bg: string): Record<string, string> {
  if (/^https?:\/\//i.test(bg)) return { type: "image", url: bg };
  return { type: "color", value: bg };
}

// ── HeyGen v3 ────────────────────────────────────────────────
class HeyGenProvider implements VideoProvider {
  readonly name = "heygen";
  constructor(private apiKey: string) {}

  async submit(input: VideoSubmitInput): Promise<{ externalId: string }> {
    if (!input.heygenAvatarId) {
      throw new Error("heygen: avatar.heygen_avatar_id manquant (créer le Photo Avatar d'abord)");
    }
    if (!input.voiceId && !input.audioUrl) {
      throw new Error(
        "Aucune voix configurée : assigne une voix HeyGen à l'avatar (console → Éditer → champ Voix).",
      );
    }

    const body: Record<string, unknown> = {
      type: "avatar",
      avatar_id: input.heygenAvatarId,
      aspect_ratio: "9:16",
      resolution: "1080p",
      output_format: "mp4",
      engine: { type: "avatar_iv" },
    };

    // Voix : TTS HeyGen (script + voice_id) = fiable, pleine longueur garantie.
    // (v3 ne récupère pas de façon fiable un audio_url externe → vidéo tronquée.)
    if (input.voiceId) {
      body.script = input.script;
      body.voice_id = input.voiceId;
    } else if (input.audioUrl) {
      body.audio_url = input.audioUrl;
    } else {
      body.script = input.script;
    }

    if (input.captions !== false) body.caption = { file_format: "srt", style: "default" };
    if (input.background) body.background = toBackground(input.background);

    const res = await fetch("https://api.heygen.com/v3/videos", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`heygen submit ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { video_id?: string } };
    const externalId = data.data?.video_id;
    if (!externalId) throw new Error("heygen: video_id absent de la réponse");
    return { externalId };
  }

  async poll(externalId: string): Promise<VideoPollResult> {
    const res = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(externalId)}`, {
      headers: { "x-api-key": this.apiKey },
    });
    if (!res.ok) throw new Error(`heygen poll ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      data?: { status?: string; video_url?: string; failure_message?: string };
    };
    const status = data.data?.status;
    if (status === "completed") return { status: "ready", videoUrl: data.data?.video_url };
    if (status === "failed")
      return { status: "failed", error: data.data?.failure_message ?? "heygen failed" };
    return { status: "processing" }; // pending | processing
  }
}

// ── Stub (démo / CI) ─────────────────────────────────────────
class StubVideoProvider implements VideoProvider {
  readonly name = "stub";
  async submit(): Promise<{ externalId: string }> {
    logger.warn("video_stub_used");
    return { externalId: `stub-${Date.now()}` };
  }
  async poll(): Promise<VideoPollResult> {
    return { status: "ready", videoUrl: "https://placehold.co/stub/video.mp4" };
  }
}

export interface HeygenAvatarInfo {
  avatar_id: string;
  name: string;
  preview_image_url?: string;
}

// Liste des avatars HeyGen (confort console). Résilient : en cas d'échec ou
// d'endpoint indisponible, renvoie une liste vide → la console bascule sur la
// saisie manuelle de l'avatar_id (récupéré dans le studio HeyGen).
export async function listHeygenAvatars(): Promise<{
  configured: boolean;
  avatars: HeygenAvatarInfo[];
}> {
  if (!config.HEYGEN_API_KEY) return { configured: false, avatars: [] };
  try {
    const res = await fetch("https://api.heygen.com/v2/avatars", {
      headers: { "x-api-key": config.HEYGEN_API_KEY },
    });
    if (!res.ok) return { configured: true, avatars: [] };
    const data = (await res.json()) as {
      data?: { avatars?: Array<{ avatar_id: string; avatar_name?: string; preview_image_url?: string }> };
    };
    return {
      configured: true,
      avatars: (data.data?.avatars ?? []).map((a) => ({
        avatar_id: a.avatar_id,
        name: a.avatar_name ?? a.avatar_id,
        preview_image_url: a.preview_image_url,
      })),
    };
  } catch (err) {
    logger.warn("heygen_list_avatars_failed", { err: String((err as Error)?.message ?? err) });
    return { configured: true, avatars: [] };
  }
}

export interface HeygenVoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
}

// Liste des voix HeyGen (pour le TTS natif de la vidéo). Résilient.
export async function listHeygenVoices(): Promise<{
  configured: boolean;
  voices: HeygenVoiceInfo[];
}> {
  if (!config.HEYGEN_API_KEY) return { configured: false, voices: [] };
  try {
    // API v3 : GET /v3/voices → { data: [ {voice_id, name, language, gender, ...} ] }
    const res = await fetch("https://api.heygen.com/v3/voices", {
      headers: { "x-api-key": config.HEYGEN_API_KEY },
    });
    if (!res.ok) return { configured: true, voices: [] };
    const data = (await res.json()) as {
      data?: Array<{ voice_id: string; name?: string; language?: string; gender?: string }>;
    };
    const all = (data.data ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name ?? v.voice_id,
      category: [v.language, v.gender].filter(Boolean).join(" · "),
    }));
    // Ne montrer que les voix françaises si présentes (sinon toutes).
    const fr = all.filter((v) => /fran|french/i.test(v.category ?? ""));
    return { configured: true, voices: fr.length ? fr : all };
  } catch (err) {
    logger.warn("heygen_list_voices_failed", { err: String((err as Error)?.message ?? err) });
    return { configured: true, voices: [] };
  }
}

// Garantit un voice_id HeyGen VALIDE : garde le préféré s'il existe dans le
// compte, sinon retombe sur la 1re voix française disponible. Évite les
// erreurs "audio source required" dues à un id étranger (ex : ElevenLabs).
export async function resolveHeygenVoiceId(preferred: string | null): Promise<string | null> {
  const { voices } = await listHeygenVoices();
  if (voices.length === 0) return preferred;
  if (preferred && voices.some((v) => v.voice_id === preferred)) return preferred;
  return voices[0]?.voice_id ?? preferred;
}

let cached: VideoProvider | null = null;
export function getVideoProvider(): VideoProvider {
  if (cached) return cached;
  cached =
    config.VIDEO_PROVIDER === "heygen" && config.HEYGEN_API_KEY
      ? new HeyGenProvider(config.HEYGEN_API_KEY)
      : new StubVideoProvider();
  return cached;
}
