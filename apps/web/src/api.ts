// L'API est servie sous /api (le front occupe les mêmes chemins en production).
import { authHeaders, signalUnauthorized } from "./lib/authToken";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export type VideoProviderName = "heygen" | "argil" | "higgsfield" | "stub";

export interface Avatar {
  id: string;
  name: string;
  niche: string;
  sex_age: string;
  city: string;
  timezone: string;
  status: "draft" | "active" | "paused";
  is_ai_disclosed: boolean;
  system_prompt: string;
  priority_networks: string[];
  products: string[];
  video_provider: VideoProviderName;
  video_avatar_id: string | null;
  voice_id: string | null;
  ref_image_url: string | null;
  eleven_voice_id: string | null;
  eleven_voice_name: string | null;
}

export interface ContentItem {
  id: string;
  avatar_id: string;
  type: string;
  network: string;
  ratio_class: "value" | "proof" | "sale";
  status: string;
  payload: Record<string, unknown>;
  assets: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

export interface MemoryEntry {
  id: string;
  kind: string;
  summary: string;
  status: string;
  importance: number;
  created_at: string;
}

export interface VoiceInfo { voice_id: string; name: string; category?: string }
export interface AvatarInfo { avatar_id: string; name: string; preview_image_url?: string }
export interface Setup {
  llm: { configured: boolean; provider: string };
  image: { configured: boolean };
  heygen: { configured: boolean };
  argil: { configured: boolean };
  default_video_provider: string;
}
export interface Stats { avatars: number; content_total: number; content_live: number }

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface AvatarDraft {
  name?: string; niche?: string; sex_age?: string; nationality?: string; city?: string; timezone?: string;
  personality?: string[]; tone_of_voice?: string; values?: string[]; backstory?: string;
  business_positioning?: string; target_audience?: string; products?: string[];
  // Étape 2 (visage)
  ref_image_url?: string | null; // portrait choisi
  face_options?: string[]; // portraits générés (galerie)
  // Étape 3 (voix ElevenLabs)
  eleven_voice_id?: string | null;
  eleven_voice_name?: string | null;
}

// Univers de lieux persistants
export interface VideoModelInfo { id: string; label: string; credits: string; hint: string }
export type LocationScope = "permanent" | "oneoff";
export interface AvatarLocation { id: string; key: string; name: string; description: string; ref_image_url: string | null; scope?: LocationScope }

// Production vlog (réalisateur IA)
export interface VlogScene {
  titre: string; mode: "talk" | "voiceover"; texte: string; soul_prompt: string; motion_prompt: string;
  location_key?: string;
  new_location?: { key: string; name: string; description: string; scope?: LocationScope };
}
export interface VlogProduction { title: string; story: string; caption: string; hashtags: string[]; scenes: VlogScene[] }
export interface VlogSceneState { idx: number; phase: "waiting" | "soul" | "soul_done" | "video" | "done" | "failed"; keyframe_url?: string; audio_url?: string; clip_url?: string; error?: string }
export interface VlogLogEntry { t: string; msg: string }

export interface ElevenVoice { voice_id: string; name: string; preview_url: string | null; description: string; gender: string | null; language: string | null }
export interface ChatResult { reply: string; draft: AvatarDraft; ready: boolean }

export interface DraftRecord { id: string; title: string; messages: ChatMessage[]; fiche: AvatarDraft; ready: boolean; updated_at: string }
export interface DraftSummary { id: string; title: string; ready: boolean; updated_at: string }
export interface DraftBody { title: string; messages: ChatMessage[]; fiche: AvatarDraft; ready: boolean }

async function req<T>(path: string, init?: RequestInit & { admin?: boolean }): Promise<T> {
  // La session (Bearer) couvre tout, y compris les endpoints /admin.
  const headers: Record<string, string> = { "content-type": "application/json", ...authHeaders() };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (res.status === 401 && !path.startsWith("/auth/")) signalUnauthorized();
  if (!res.ok) {
    let msg = await res.text();
    try { msg = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /* texte brut */ }
    throw new Error(msg || `Erreur ${res.status}`);
  }
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

// ── Comptes & session ────────────────────────────────────────
export interface AuthUser { id: string; email: string; name: string; role: "admin" | "user" }
export interface SessionResult { token: string; expires_at: number | null; user: AuthUser }
export interface ManagedUser { id: string; email: string; name: string; role: "admin" | "user"; created_at: string; last_sign_in_at: string | null; banned: boolean }

export const api = {
  // Auth
  login: (email: string, password: string) => req<SessionResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (name: string, email: string, password: string) => req<SessionResult>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  me: () => req<{ user: AuthUser }>("/auth/me"),
  updateProfile: (name: string) => req<{ ok: boolean; user: AuthUser }>("/auth/profile", { method: "PUT", body: JSON.stringify({ name }) }),
  changePassword: (current_password: string, new_password: string) => req<{ ok: boolean }>("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
  listUsers: () => req<{ users: ManagedUser[]; signup_open: boolean }>("/auth/admin/users"),
  updateUser: (id: string, patch: { role?: "admin" | "user"; banned?: boolean }) => req<{ ok: boolean }>(`/auth/admin/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteUser: (id: string) => req<void>(`/auth/admin/users/${id}`, { method: "DELETE" }),

  chatAvatar: (messages: ChatMessage[], draft: AvatarDraft) =>
    req<ChatResult>("/avatars/chat", { method: "POST", body: JSON.stringify({ messages, draft }) }),

  // Streaming (SSE) : onToken() à chaque bout de réponse ; renvoie la fiche finale.
  chatAvatarStream: async (
    messages: ChatMessage[],
    draft: AvatarDraft,
    onToken: (t: string) => void,
  ): Promise<{ draft: AvatarDraft; ready: boolean }> => {
    const res = await fetch(`${API_BASE}/avatars/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ messages, draft }),
    });
    if (res.status === 401) signalUnauthorized();
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: { draft: AvatarDraft; ready: boolean } = { draft, ready: false };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5).trim()) as { type: string; text?: string; draft?: AvatarDraft; ready?: boolean; error?: string };
        if (evt.type === "token") onToken(evt.text ?? "");
        else if (evt.type === "done") result = { draft: evt.draft ?? draft, ready: Boolean(evt.ready) };
        else if (evt.type === "error") throw new Error(evt.error ?? "stream error");
      }
    }
    return result;
  },

  generateFace: (fiche: AvatarDraft, model: string, prompt?: string) =>
    req<{ imageUrl: string; prompt: string }>("/avatars/generate-face", { method: "POST", body: JSON.stringify({ fiche, model, prompt }) }),
  listElevenVoices: () => req<{ configured: boolean; voices: ElevenVoice[] }>("/avatars/voices"),

  // Brouillons de création (auto-save serveur)
  listDrafts: () => req<{ drafts: DraftSummary[] }>("/avatar-drafts"),
  getDraft: (id: string) => req<{ record: DraftRecord }>(`/avatar-drafts/${id}`),
  createDraft: (b: DraftBody) => req<{ record: DraftRecord }>("/avatar-drafts", { method: "POST", body: JSON.stringify(b) }),
  updateDraft: (id: string, b: DraftBody) => req<{ record: DraftRecord }>(`/avatar-drafts/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteDraft: (id: string) => req<void>(`/avatar-drafts/${id}`, { method: "DELETE" }),
  finalizeDraft: (id: string) => req<{ avatar: Avatar }>(`/avatar-drafts/${id}/finalize`, { method: "POST", body: "{}" }),

  listAvatars: () => req<{ avatars: Avatar[] }>("/avatars"),
  getAvatar: (id: string) => req<{ avatar: Avatar }>(`/avatars/${id}`),
  createAvatar: (b: Partial<Avatar>) => req<{ avatar: Avatar }>("/avatars", { method: "POST", body: JSON.stringify(b) }),
  updateAvatar: (id: string, b: Partial<Avatar>) => req<{ avatar: Avatar }>(`/avatars/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteAvatar: (id: string) => req<void>(`/avatars/${id}`, { method: "DELETE" }),

  // Univers de lieux
  listLocations: (id: string) => req<{ locations: AvatarLocation[] }>(`/avatars/${id}/locations`),
  generateUniverse: (id: string) => req<{ locations: AvatarLocation[] }>(`/avatars/${id}/locations/generate`, { method: "POST", body: "{}" }),
  createLocation: (id: string, b: { name: string; description: string }) => req<{ location: AvatarLocation }>(`/avatars/${id}/locations`, { method: "POST", body: JSON.stringify(b) }),
  regenerateLocation: (id: string, locId: string, prompt?: string) => req<{ location: AvatarLocation }>(`/avatars/${id}/locations/${locId}/regenerate`, { method: "POST", body: JSON.stringify({ prompt }) }),
  deleteLocation: (id: string, locId: string) => req<void>(`/avatars/${id}/locations/${locId}`, { method: "DELETE" }),

  getMemory: (id: string) => req<{ memory: MemoryEntry[] }>(`/avatars/${id}/memory`),
  addMemory: (id: string, b: { kind: string; summary: string; importance?: number; status?: string }) =>
    req<{ ok: boolean }>(`/avatars/${id}/memory`, { method: "POST", body: JSON.stringify(b) }),
  deleteMemory: (id: string, mid: string) => req<void>(`/avatars/${id}/memory/${mid}`, { method: "DELETE" }),

  listContent: (p?: { avatar_id?: string; status?: string }) => {
    const q = new URLSearchParams(p as Record<string, string>).toString();
    return req<{ content: ContentItem[] }>(`/content${q ? `?${q}` : ""}`);
  },
  getContent: (id: string) => req<{ item: ContentItem }>(`/content/${id}`),
  cancelContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/cancel`, { method: "POST", body: "{}" }),
  approveImages: (id: string) => req<{ ok: boolean }>(`/content/${id}/approve-images`, { method: "POST", body: "{}" }),
  regenerateSceneImage: (id: string, idx: number) => req<{ ok: boolean }>(`/content/${id}/scenes/${idx}/regenerate-image`, { method: "POST", body: "{}" }),
  approveContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/approve`, { method: "POST", body: "{}" }),
  rejectContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/reject`, { method: "POST", body: "{}" }),
  retryContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/retry`, { method: "POST", body: "{}" }),

  planDay: (avatarId: string) => req<{ ok: boolean; job_id: string }>("/admin/plan-day", { admin: true, method: "POST", body: JSON.stringify({ avatar_id: avatarId }) }),
  generateClip: (avatarId: string, preset: string) => req<{ ok: boolean; job_id: string; content_item_id: string }>("/admin/generate-clip", { admin: true, method: "POST", body: JSON.stringify({ avatar_id: avatarId, preset }) }),

  // ── Assistant de réalisation (étape par étape) ──
  // Étape 1 : l'histoire s'écrit en direct (SSE), avec affinage possible.
  vlogStory: async (
    avatarId: string,
    opts: { preset?: string; brief?: string; previousStory?: string; instruction?: string },
    onToken: (t: string) => void,
  ): Promise<{ title: string; story: string; caption: string; hashtags: string[] }> => {
    const res = await fetch(`${API_BASE}/admin/vlog/story`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        avatar_id: avatarId, preset: opts.preset, brief: opts.brief,
        previous_story: opts.previousStory, instruction: opts.instruction,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = { title: "", story: "", caption: "", hashtags: [] as string[] };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5).trim()) as { type: string; text?: string; result?: typeof out; error?: string };
        if (evt.type === "token") onToken(evt.text ?? "");
        else if (evt.type === "story" && evt.result) out = evt.result;
        else if (evt.type === "error") throw new Error(evt.error ?? "story error");
      }
    }
    return out;
  },

  // Étape 2 : découpage en scènes (durée cible + affinage).
  vlogScenes: (avatarId: string, story: string, durationSec: number, opts?: { previousScenes?: VlogScene[]; instruction?: string }) =>
    req<{ scenes: VlogScene[] }>("/admin/vlog/scenes", {
      admin: true, method: "POST",
      body: JSON.stringify({ avatar_id: avatarId, story, duration_sec: durationSec, previous_scenes: opts?.previousScenes, instruction: opts?.instruction }),
    }),

  // Étape 3 : lancer la production (pause avant animation par défaut).
  vlogProduce: (avatarId: string, production: VlogProduction, approveImages = true, locationScopes?: Record<string, LocationScope>, videoModel?: string) =>
    req<{ ok: boolean; content_item_id: string }>("/admin/vlog/produce", {
      admin: true, method: "POST",
      body: JSON.stringify({ avatar_id: avatarId, production, approve_images: approveImages, location_scopes: locationScopes, video_model: videoModel }),
    }),

  listVideoModels: () => req<{ models: VideoModelInfo[]; default: string }>("/admin/video-models", { admin: true }),

  // Moteur vlog complet (SSE) : l'histoire streame, puis la production part en file.
  generateVlogStream: async (
    avatarId: string,
    preset: string,
    h: { onStep?: (label: string) => void; onToken?: (t: string) => void; onProduction?: (p: VlogProduction) => void; onEnqueued?: (contentItemId: string) => void },
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/admin/generate-vlog`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ avatar_id: avatarId, preset }),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5).trim()) as { type: string; text?: string; label?: string; production?: VlogProduction; content_item_id?: string; error?: string };
        if (evt.type === "token") h.onToken?.(evt.text ?? "");
        else if (evt.type === "step") h.onStep?.(evt.label ?? "");
        else if (evt.type === "production") evt.production && h.onProduction?.(evt.production);
        else if (evt.type === "enqueued") evt.content_item_id && h.onEnqueued?.(evt.content_item_id);
        else if (evt.type === "error") throw new Error(evt.error ?? "vlog stream error");
      }
    }
  },
  setup: () => req<Setup>("/admin/setup", { admin: true }),
  stats: () => req<Stats>("/admin/stats", { admin: true }),
  listVoices: (provider: string) => req<{ configured: boolean; voices: VoiceInfo[] }>(`/admin/voices?provider=${provider}`, { admin: true }),
  listMediaAvatars: (provider: string) => req<{ configured: boolean; avatars: AvatarInfo[] }>(`/admin/avatars?provider=${provider}`, { admin: true }),
};
