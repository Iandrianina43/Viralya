import type { VideoProviderName } from "@viralya/shared";
import { config } from "../../config";
import { logger } from "../../logger";
import { ArgilProvider, listArgilAvatars, listArgilVoices } from "./argil";
import { HeyGenProvider, listHeygenAvatars, listHeygenVoices } from "./heygen";
import type { AvatarInfo, VideoPollResult, VideoProvider, VideoSubmitInput, VoiceInfo } from "./types";

export type { VideoProvider, VideoSubmitInput, VideoPollResult, VideoScene } from "./types";

class StubProvider implements VideoProvider {
  readonly name = "stub" as const;
  async submit(): Promise<{ externalId: string }> {
    logger.warn("video_stub_used");
    return { externalId: `stub-${Date.now()}` };
  }
  async poll(): Promise<VideoPollResult> {
    return { status: "ready", videoUrl: "https://placehold.co/stub/video.mp4" };
  }
}

/** Retourne le moteur vidéo pour un avatar (fallback stub si clé absente). */
export function getVideoProvider(name: VideoProviderName): VideoProvider {
  if (name === "heygen" && config.HEYGEN_API_KEY) return new HeyGenProvider(config.HEYGEN_API_KEY);
  if (name === "argil" && config.ARGIL_API_KEY) return new ArgilProvider(config.ARGIL_API_KEY);
  return new StubProvider();
}

export async function listVoices(
  provider: VideoProviderName,
): Promise<{ configured: boolean; voices: VoiceInfo[] }> {
  if (provider === "heygen") {
    if (!config.HEYGEN_API_KEY) return { configured: false, voices: [] };
    return { configured: true, voices: await listHeygenVoices(config.HEYGEN_API_KEY) };
  }
  if (provider === "argil") {
    if (!config.ARGIL_API_KEY) return { configured: false, voices: [] };
    return { configured: true, voices: await listArgilVoices(config.ARGIL_API_KEY) };
  }
  return { configured: false, voices: [] };
}

export async function listAvatars(
  provider: VideoProviderName,
): Promise<{ configured: boolean; avatars: AvatarInfo[] }> {
  if (provider === "heygen") {
    if (!config.HEYGEN_API_KEY) return { configured: false, avatars: [] };
    return { configured: true, avatars: await listHeygenAvatars(config.HEYGEN_API_KEY) };
  }
  if (provider === "argil") {
    if (!config.ARGIL_API_KEY) return { configured: false, avatars: [] };
    return { configured: true, avatars: await listArgilAvatars(config.ARGIL_API_KEY) };
  }
  return { configured: false, avatars: [] };
}

/** Garantit un voice_id valide pour le moteur (sinon 1re voix dispo). */
export async function resolveVoiceId(
  provider: VideoProviderName,
  preferred: string | null,
): Promise<string | null> {
  const { voices } = await listVoices(provider);
  if (voices.length === 0) return preferred;
  if (preferred && voices.some((v) => v.voice_id === preferred)) return preferred;
  return voices[0]?.voice_id ?? preferred;
}
