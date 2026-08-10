import { logger } from "../../logger";
import type { AvatarInfo, VideoPollResult, VideoProvider, VideoScene, VideoSubmitInput, VoiceInfo } from "./types";

// Argil API v1 (multi-scènes via "moments").
// Réf : https://docs.argil.ai/api-reference/endpoint/videos.create
//   POST /v1/videos  → { id, status } (IDLE)
//   POST /v1/videos/{id}/render → déclenche le rendu
//   GET  /v1/videos/{id} → status DONE + videoUrl(Subtitled)

const BASE = "https://api.argil.ai/v1";
const MAX_TRANSCRIPT = 480; // Argil : 500 chars max/moment

// Découpe un texte en morceaux ≤ MAX_TRANSCRIPT (par phrases).
function chunk(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length > MAX_TRANSCRIPT) {
      if (buf) out.push(buf.trim());
      buf = s;
    } else {
      buf = (buf + " " + s).trim();
    }
  }
  if (buf) out.push(buf.trim());
  return out.length ? out : [text.slice(0, MAX_TRANSCRIPT)];
}

export class ArgilProvider implements VideoProvider {
  readonly name = "argil" as const;
  constructor(private apiKey: string) {}

  private headers() {
    return { "content-type": "application/json", "x-api-key": this.apiKey };
  }

  async submit(input: VideoSubmitInput): Promise<{ externalId: string }> {
    if (!input.avatarId) throw new Error("argil: avatarId manquant");
    if (!input.voiceId) throw new Error("argil: voiceId manquant");

    const texts: string[] =
      input.scenes && input.scenes.length > 0
        ? input.scenes.map((s: VideoScene) => s.text.slice(0, MAX_TRANSCRIPT))
        : chunk(input.script);

    const moments = texts.map((t) => ({
      transcript: t,
      avatarId: input.avatarId,
      voice: { id: input.voiceId },
    }));

    // 1) Créer la vidéo
    const createRes = await fetch(`${BASE}/videos`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name: `viralya-${Date.now()}`,
        moments,
        aspectRatio: "9:16",
        subtitles: { enable: input.captions !== false },
      }),
    });
    if (!createRes.ok) throw new Error(`argil create ${createRes.status}: ${await createRes.text()}`);
    const created = (await createRes.json()) as { id?: string };
    const id = created.id;
    if (!id) throw new Error("argil: id absent de la réponse create");

    // 2) Déclencher le rendu
    const renderRes = await fetch(`${BASE}/videos/${id}/render`, { method: "POST", headers: this.headers() });
    if (!renderRes.ok) throw new Error(`argil render ${renderRes.status}: ${await renderRes.text()}`);

    return { externalId: id };
  }

  async poll(externalId: string): Promise<VideoPollResult> {
    const res = await fetch(`${BASE}/videos/${encodeURIComponent(externalId)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`argil poll ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      status?: string;
      videoUrl?: string;
      videoUrlSubtitled?: string;
    };
    if (data.status === "DONE") return { status: "ready", videoUrl: data.videoUrlSubtitled ?? data.videoUrl };
    if (data.status === "FAILED") return { status: "failed", error: "argil failed" };
    return { status: "processing" }; // IDLE | GENERATING_AUDIO | GENERATING_VIDEO
  }
}

// ── Listes (défensif : Argil peut renvoyer un tableau, .data ou .items) ──
function asArray(j: unknown): any[] {
  if (Array.isArray(j)) return j;
  const o = j as { data?: unknown[]; items?: unknown[] };
  return o?.data ?? o?.items ?? [];
}

export async function listArgilVoices(apiKey: string): Promise<VoiceInfo[]> {
  try {
    const res = await fetch(`${BASE}/voices`, { headers: { "x-api-key": apiKey } });
    if (!res.ok) return [];
    const arr = asArray(await res.json());
    return arr.map((v) => ({
      voice_id: String(v.id ?? v.voiceId ?? ""),
      name: String(v.name ?? v.displayName ?? v.id ?? ""),
      category: v.language ? String(v.language) : undefined,
    })).filter((v) => v.voice_id);
  } catch (err) {
    logger.warn("argil_voices_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}

export async function listArgilAvatars(apiKey: string): Promise<AvatarInfo[]> {
  try {
    const res = await fetch(`${BASE}/avatars`, { headers: { "x-api-key": apiKey } });
    if (!res.ok) return [];
    const arr = asArray(await res.json());
    return arr.map((a) => ({
      avatar_id: String(a.id ?? a.avatarId ?? ""),
      name: String(a.name ?? a.displayName ?? a.id ?? ""),
      preview_image_url: a.thumbnailUrl ?? a.previewUrl ?? undefined,
    })).filter((a) => a.avatar_id);
  } catch (err) {
    logger.warn("argil_avatars_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}
