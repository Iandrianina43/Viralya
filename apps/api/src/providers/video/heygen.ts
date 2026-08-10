import { logger } from "../../logger";
import type { AvatarInfo, VideoPollResult, VideoProvider, VideoSubmitInput, VoiceInfo } from "./types";

// HeyGen API v3 (mono-scène : un avatar + un script + sous-titres SRT).
// Réf : https://developers.heygen.com/reference/create-video

function toBackground(bg: string): Record<string, string> {
  if (/^https?:\/\//i.test(bg)) return { type: "image", url: bg };
  return { type: "color", value: bg };
}

export class HeyGenProvider implements VideoProvider {
  readonly name = "heygen" as const;
  constructor(private apiKey: string) {}

  async submit(input: VideoSubmitInput): Promise<{ externalId: string }> {
    if (!input.avatarId) throw new Error("heygen: avatar_id manquant (créer le Photo Avatar d'abord)");
    if (!input.voiceId) throw new Error("heygen: voice_id manquant (assigner une voix HeyGen)");

    const bg = input.scenes?.[0]?.background ?? null;
    const body: Record<string, unknown> = {
      type: "avatar",
      avatar_id: input.avatarId,
      aspect_ratio: "9:16",
      resolution: "1080p",
      output_format: "mp4",
      engine: { type: "avatar_iv" },
      script: input.script,
      voice_id: input.voiceId,
    };
    if (input.captions !== false) body.caption = { file_format: "srt", style: "default" };
    if (bg) body.background = toBackground(bg);

    const res = await fetch("https://api.heygen.com/v3/videos", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`heygen submit ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { video_id?: string } };
    const id = data.data?.video_id;
    if (!id) throw new Error("heygen: video_id absent");
    return { externalId: id };
  }

  async poll(externalId: string): Promise<VideoPollResult> {
    const res = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(externalId)}`, {
      headers: { "x-api-key": this.apiKey },
    });
    if (!res.ok) throw new Error(`heygen poll ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      data?: { status?: string; video_url?: string; failure_message?: string };
    };
    const s = data.data?.status;
    if (s === "completed") return { status: "ready", videoUrl: data.data?.video_url };
    if (s === "failed") return { status: "failed", error: data.data?.failure_message ?? "heygen failed" };
    return { status: "processing" };
  }
}

export async function listHeygenVoices(apiKey: string): Promise<VoiceInfo[]> {
  try {
    const res = await fetch("https://api.heygen.com/v3/voices", { headers: { "x-api-key": apiKey } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ voice_id: string; name?: string; language?: string; gender?: string }>;
    };
    const all = (data.data ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name ?? v.voice_id,
      category: [v.language, v.gender].filter(Boolean).join(" · "),
    }));
    const fr = all.filter((v) => /fran|french/i.test(v.category ?? ""));
    return fr.length ? fr : all;
  } catch (err) {
    logger.warn("heygen_voices_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}

export async function listHeygenAvatars(apiKey: string): Promise<AvatarInfo[]> {
  try {
    const res = await fetch("https://api.heygen.com/v2/avatars", { headers: { "x-api-key": apiKey } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { avatars?: Array<{ avatar_id: string; avatar_name?: string; preview_image_url?: string }> };
    };
    return (data.data?.avatars ?? []).map((a) => ({
      avatar_id: a.avatar_id,
      name: a.avatar_name ?? a.avatar_id,
      preview_image_url: a.preview_image_url,
    }));
  } catch (err) {
    logger.warn("heygen_avatars_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}
