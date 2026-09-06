// L'API est servie sous /api (le front occupe les mêmes chemins en production).
// Chaque appel porte la session (Bearer) et l'organisation active (x-org-id).
import { authHeaders, signalUnauthorized } from "./lib/authToken";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export type VideoProviderName = "piapi" | "stub";

/** Fiche portrait structurée (valeurs EN, pré-remplie par l'IA, ajustable). */
export type PortraitSpec = Record<string, string>;

export interface Avatar {
  id: string;
  org_id?: string | null;
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
  ref_image_url: string | null;
  portrait_spec: PortraitSpec | null;
  character_sheet_url: string | null;
  voice_sample_urls: string[];
  eleven_voice_id: string | null;
  eleven_voice_name: string | null;
}

export interface ContentItem {
  id: string;
  avatar_id: string;
  avatar_name?: string | null;
  title?: string | null;
  type: string;
  network: string;
  ratio_class: "value" | "proof" | "sale";
  status: string;
  payload: Record<string, unknown>;
  assets: Record<string, unknown>;
  error: string | null;
  current_version?: number;
  scheduled_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ContentVersion {
  id: string;
  content_item_id: string;
  version_no: number;
  status: string | null;
  payload: Record<string, unknown>;
  assets: Record<string, unknown>;
  note: string | null;
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

export interface Setup {
  llm: { configured: boolean; provider: string };
  image: { configured: boolean };
  piapi: { configured: boolean };
  elevenlabs: { configured: boolean };
  default_video_provider: string;
}
export interface Stats { avatars: number; content_total: number; content_live: number; in_progress?: number; to_review?: number; failed?: number }
export interface PiapiBalance { configured: boolean; account_name?: string; credits?: number; balance_usd?: number }
export interface PiapiHistoryEntry { task_id: string; created_at: string; model: string; status: string; cost_usd: number; video_url: string | null }
export interface PiapiHistory {
  total_tasks: number;
  totals: { today: number; week: number; month: number; all_listed: number };
  items: PiapiHistoryEntry[];
}

// ── Organisations & Task Center ──────────────────────────────
export interface Org { id: string; name: string; role: "owner" | "admin" | "member" }
export interface OrgMember { user_id: string; role: string; created_at: string; email: string; name: string }

export type TaskState = "running" | "upcoming" | "review" | "done" | "failed";
export interface TaskLog { t: string; msg: string }
export interface TaskJob { id: string; type: string; label: string; status: string; attempts: number; max_attempts: number; run_after: string; error: string | null }
export interface TaskView {
  id: string;
  kind: "content";
  state: TaskState;
  title: string;
  subtitle: string;
  avatar: { id: string; name: string; image: string | null } | null;
  content_item_id: string;
  content_type: string;
  status: string;
  progress: number;
  started_at: string;
  updated_at: string;
  scheduled_at: string | null;
  error: string | null;
  logs: TaskLog[];
  video_url: string | null;
  image_urls: string[];
  cost_usd: number | null;
  version: number;
  job: TaskJob | null;
  can_retry: boolean;
  can_cancel: boolean;
}
export interface TasksResult { tasks: TaskView[]; counts: Record<TaskState, number> }

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface AvatarDraft {
  name?: string; niche?: string; sex_age?: string; nationality?: string; city?: string; timezone?: string;
  personality?: string[]; tone_of_voice?: string; values?: string[]; backstory?: string;
  business_positioning?: string; target_audience?: string; products?: string[];
  // Étape 2 (visage)
  ref_image_url?: string | null; // portrait choisi
  face_options?: string[]; // portraits générés (galerie)
  portrait_spec?: PortraitSpec | null; // fiche portrait structurée
  // Étape 3 (voix ElevenLabs)
  eleven_voice_id?: string | null;
  eleven_voice_name?: string | null;
}

// ── Character Bible ──────────────────────────────────────────
export interface AvatarReference {
  id: string; avatar_id: string; kind: string; label: string | null; url: string; prompt: string | null;
  model: string | null; face_score: number | null; validated: boolean; is_primary: boolean; version: number; created_at: string;
}
export interface WardrobeItem { id: string; avatar_id: string; name: string; description_en: string; ref_url: string | null; is_default: boolean; created_at: string }
export type ImageQuality = "1K" | "2K";
export interface ImageModelInfo { id: string; label: string; hint: string; price_per_image: Record<ImageQuality, number>; max_refs: number }
export interface ImageModelsCatalog { models: ImageModelInfo[]; default: string }
export type ImageAspect = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export interface PhotoRequest { avatar_id: string; scene: string; location_key?: string | null; outfit_id?: string | null; model?: string; aspect?: ImageAspect; framing?: string; network?: string }
export interface PhotoQc { face_score: number | null; faces: number; verdict: "pass" | "review" | "fail" | "unknown"; attempt: number }
export type KeyframeFraming = "medium" | "close" | "full" | "selfie";
export interface KeyframeFramingInfo { id: KeyframeFraming; label: string; aspect: ImageAspect }
export interface AvatarKeyframe {
  id: string; avatar_id: string; location_id: string | null; outfit_id: string | null; framing: string | null; url: string; prompt: string | null;
  model: string | null; face_score: number | null; validated: boolean; created_at: string; location_name: string | null; location_key: string | null; outfit_name: string | null;
}

// Univers de lieux persistants
export type SeedanceResolution = "480p" | "720p" | "1080p";
export interface VideoModelInfo { id: string; label: string; hint: string; price_per_sec: Partial<Record<SeedanceResolution, number>> }
export interface VideoModelsCatalog { models: VideoModelInfo[]; default: string; default_resolution: SeedanceResolution; duration: { min: number; max: number; default: number } }
export type LocationScope = "permanent" | "oneoff";
export interface AvatarLocation { id: string; key: string; name: string; description: string; ref_image_url: string | null; scope?: LocationScope }

// Production vlog (réalisateur IA) — Seedance 2.0 : un segment par scène.
export interface SceneShot { t: string; desc: string }
/** Insert photo (hybride) : image incrustée 1,5-3 s pendant la parole, ancrée sur des mots du texte. */
export type InsertFraming = "illustration" | "location" | "close" | "full" | "selfie";
export interface SceneInsert { anchor: string; framing: InsertFraming; desc?: string }
export interface VlogScene {
  titre: string; mode: "talk" | "voiceover"; texte: string; duration_sec: number;
  action: string; shots: SceneShot[]; scene_desc: string; camera: string;
  lighting: string; audio_ambiance: string; constraints: string;
  inserts?: SceneInsert[];
  location_key?: string;
  new_location?: { key: string; name: string; description: string; scope?: LocationScope };
}
export interface VlogProduction { title: string; story: string; caption: string; hashtags: string[]; scenes: VlogScene[] }
export interface SegmentState { idx: number; phase: "waiting" | "video" | "done" | "failed"; titre: string; duration: number; clip_url?: string; prompt?: string; error?: string }
export interface VlogLogEntry { t: string; msg: string }

// Vidéo v2 hybride : voix ElevenLabs → plans parlés (avatar en lip-sync) + b-roll Seedance muet → montage.
export type VideoFormat = "hybrid" | "seedance";
export type TalkProvider = "seedance-2.5" | "omnihuman" | "kling-avatar";
export type TalkMode = "std" | "pro";
export interface TalkProviderInfo { id: TalkProvider; label: string; hint: string; price_per_sec: Record<TalkMode, number>; modes: TalkMode[] }
export interface TalkProvidersCatalog { providers: TalkProviderInfo[]; default: TalkProvider; default_mode: TalkMode; elevenlabs_configured: boolean }
export interface ShotWord { w: string; s: number; e: number }
export interface InsertState extends SceneInsert { url?: string | null; keyframe_id?: string | null; cost_usd?: number; at?: number | null; len?: number | null; error?: string }
export interface ShotState {
  idx: number; role: "talk" | "broll"; titre: string; texte: string;
  phase: "waiting" | "voice" | "video" | "done" | "failed"; duration: number; version?: number;
  inserts?: InsertState[] | null;
  audio_url?: string | null; audio_seconds?: number | null; words?: ShotWord[] | null; tts_model?: string | null;
  provider?: TalkProvider | "seedance"; native_voice?: boolean; transcript?: string | null; dialogue_score?: number | null;
  task_id?: string; clip_url?: string; prompt?: string;
  keyframe_url?: string | null; framing?: string | null;
  qc?: { face_score: number | null; face_height?: number | null; verdict: string; note?: string } | null;
  cost_usd?: number; error?: string;
}
export interface ProduceOptions { format?: VideoFormat; talkProvider?: TalkProvider; talkMode?: TalkMode; subtitles?: boolean; music?: boolean }

export interface ElevenVoice { voice_id: string; name: string; preview_url: string | null; description: string; gender: string | null; language: string | null }
export interface ChatResult { reply: string; draft: AvatarDraft; ready: boolean }

export interface DraftRecord { id: string; title: string; messages: ChatMessage[]; fiche: AvatarDraft; ready: boolean; updated_at: string }
export interface DraftSummary { id: string; title: string; ready: boolean; updated_at: string }
export interface DraftBody { title: string; messages: ChatMessage[]; fiche: AvatarDraft; ready: boolean }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...authHeaders() };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  if (res.status === 401 && !path.startsWith("/auth/")) signalUnauthorized();
  if (!res.ok) {
    let msg = await res.text();
    try { msg = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /* texte brut */ }
    throw new Error(msg || `Erreur ${res.status}`);
  }
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

/** Lecture d'un flux SSE (data: {...}\n\n) avec un gestionnaire par événement. */
async function readSse(res: Response, onEvent: (evt: Record<string, any>) => void): Promise<void> {
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
      onEvent(JSON.parse(line.slice(5).trim()) as Record<string, any>);
    }
  }
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

// ── Comptes & session ────────────────────────────────────────
export interface AuthUser { id: string; email: string; name: string; role: "admin" | "user" }
export interface SessionResult { token: string; expires_at: number | null; user: AuthUser }
export interface ManagedUser { id: string; email: string; name: string; role: "admin" | "user"; created_at: string; last_sign_in_at: string | null; banned: boolean }

export const api = {
  // Auth
  login: (email: string, password: string) => req<SessionResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (name: string, email: string, password: string) => req<SessionResult>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  me: () => req<{ user: AuthUser; orgs: Org[] }>("/auth/me"),
  updateProfile: (name: string) => req<{ ok: boolean; user: AuthUser }>("/auth/profile", { method: "PUT", body: JSON.stringify({ name }) }),
  changePassword: (current_password: string, new_password: string) => req<{ ok: boolean }>("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
  listUsers: () => req<{ users: ManagedUser[]; signup_open: boolean }>("/auth/admin/users"),
  updateUser: (id: string, patch: { role?: "admin" | "user"; banned?: boolean }) => req<{ ok: boolean }>(`/auth/admin/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteUser: (id: string) => req<void>(`/auth/admin/users/${id}`, { method: "DELETE" }),

  // Organisations
  listOrgs: () => req<{ orgs: Org[] }>("/orgs"),
  createOrg: (name: string) => req<{ org: Org }>("/orgs", { method: "POST", body: JSON.stringify({ name }) }),
  renameOrg: (id: string, name: string) => req<{ ok: boolean }>(`/orgs/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  orgMembers: (id: string) => req<{ members: OrgMember[] }>(`/orgs/${id}/members`),
  addOrgMember: (id: string, email: string, role: "admin" | "member" = "member") => req<{ ok: boolean }>(`/orgs/${id}/members`, { method: "POST", body: JSON.stringify({ email, role }) }),
  removeOrgMember: (id: string, userId: string) => req<void>(`/orgs/${id}/members/${userId}`, { method: "DELETE" }),

  chatAvatar: (messages: ChatMessage[], draft: AvatarDraft) =>
    req<ChatResult>("/avatars/chat", { method: "POST", body: JSON.stringify({ messages, draft }) }),

  // Streaming (SSE) : onToken() à chaque bout de réponse ; renvoie la fiche finale.
  chatAvatarStream: async (
    messages: ChatMessage[],
    draft: AvatarDraft,
    onToken: (t: string) => void,
  ): Promise<{ draft: AvatarDraft; ready: boolean }> => {
    const res = await post("/avatars/chat/stream", { messages, draft });
    if (res.status === 401) signalUnauthorized();
    let result: { draft: AvatarDraft; ready: boolean } = { draft, ready: false };
    await readSse(res, (evt) => {
      if (evt.type === "token") onToken(evt.text ?? "");
      else if (evt.type === "done") result = { draft: evt.draft ?? draft, ready: Boolean(evt.ready) };
      else if (evt.type === "error") throw new Error(evt.error ?? "stream error");
    });
    return result;
  },

  // Fiche portrait structurée : pré-remplie par l'IA, puis génération de l'image.
  draftPortraitSpec: (fiche: AvatarDraft, brief?: string) =>
    req<{ spec: PortraitSpec }>("/avatars/portrait-spec", { method: "POST", body: JSON.stringify({ fiche, brief }) }),
  generateFace: (fiche: AvatarDraft, spec?: PortraitSpec | null, prompt?: string) =>
    req<{ imageUrl: string; prompt: string; spec: PortraitSpec }>("/avatars/generate-face", { method: "POST", body: JSON.stringify({ fiche, spec, prompt }) }),
  generateCharacterSheet: (avatarId: string) =>
    req<{ character_sheet_url: string }>(`/avatars/${avatarId}/character-sheet/generate`, { method: "POST", body: "{}" }),
  generateVoiceSamples: (avatarId: string) =>
    req<{ voice_sample_urls: string[] }>(`/avatars/${avatarId}/voice-samples/generate`, { method: "POST", body: "{}" }),
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
  listLocations: (id: string, scope?: LocationScope | "all") => req<{ locations: AvatarLocation[] }>(`/avatars/${id}/locations${scope ? `?scope=${scope}` : ""}`),
  generateUniverse: (id: string) => req<{ locations: AvatarLocation[] }>(`/avatars/${id}/locations/generate`, { method: "POST", body: "{}" }),
  createLocation: (id: string, b: { name: string; description: string }) => req<{ location: AvatarLocation }>(`/avatars/${id}/locations`, { method: "POST", body: JSON.stringify(b) }),
  regenerateLocation: (id: string, locId: string, prompt?: string) => req<{ location: AvatarLocation }>(`/avatars/${id}/locations/${locId}/regenerate`, { method: "POST", body: JSON.stringify({ prompt }) }),
  deleteLocation: (id: string, locId: string) => req<void>(`/avatars/${id}/locations/${locId}`, { method: "DELETE" }),

  // Character Bible : références d'identité et garde-robe
  listReferences: (id: string) => req<{ references: AvatarReference[] }>(`/avatars/${id}/references`),
  generateReferences: (id: string, b?: { kinds?: string[]; labels?: string[]; model?: string }) =>
    req<{ references: AvatarReference[] }>(`/avatars/${id}/references/generate`, { method: "POST", body: JSON.stringify(b ?? {}) }),
  updateReference: (id: string, refId: string, b: { validated?: boolean; label?: string }) =>
    req<{ reference: AvatarReference }>(`/avatars/${id}/references/${refId}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteReference: (id: string, refId: string) => req<void>(`/avatars/${id}/references/${refId}`, { method: "DELETE" }),
  listWardrobe: (id: string) => req<{ wardrobe: WardrobeItem[] }>(`/avatars/${id}/wardrobe`),
  generateWardrobe: (id: string, b?: { count?: number; with_images?: boolean; model?: string }) =>
    req<{ wardrobe: WardrobeItem[] }>(`/avatars/${id}/wardrobe/generate`, { method: "POST", body: JSON.stringify(b ?? {}) }),
  createOutfit: (id: string, b: { name: string; description_en: string; is_default?: boolean }) =>
    req<{ outfit: WardrobeItem }>(`/avatars/${id}/wardrobe`, { method: "POST", body: JSON.stringify(b) }),
  updateOutfit: (id: string, outfitId: string, b: { name?: string; description_en?: string; is_default?: boolean }) =>
    req<{ outfit: WardrobeItem }>(`/avatars/${id}/wardrobe/${outfitId}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteOutfit: (id: string, outfitId: string) => req<void>(`/avatars/${id}/wardrobe/${outfitId}`, { method: "DELETE" }),
  listImageModels: () => req<ImageModelsCatalog>("/studio/image-models"),
  createPhoto: (b: PhotoRequest) => req<{ ok: boolean; job_id: string; content_item_id: string }>("/studio/photo", { method: "POST", body: JSON.stringify(b) }),
  listKeyframes: (id: string) => req<{ keyframes: AvatarKeyframe[]; framings: KeyframeFramingInfo[] }>(`/avatars/${id}/keyframes`),
  generateKeyframe: (id: string, b: { location_id: string; outfit_id?: string | null; framing?: KeyframeFraming; model?: string; force?: boolean }) =>
    req<{ keyframe: AvatarKeyframe; cached: boolean; cost_usd: number }>(`/avatars/${id}/keyframes/generate`, { method: "POST", body: JSON.stringify(b) }),
  updateKeyframe: (id: string, kfId: string, b: { validated: boolean }) =>
    req<{ keyframe: AvatarKeyframe }>(`/avatars/${id}/keyframes/${kfId}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteKeyframe: (id: string, kfId: string) => req<void>(`/avatars/${id}/keyframes/${kfId}`, { method: "DELETE" }),

  getMemory: (id: string) => req<{ memory: MemoryEntry[] }>(`/avatars/${id}/memory`),
  addMemory: (id: string, b: { kind: string; summary: string; importance?: number; status?: string }) =>
    req<{ ok: boolean }>(`/avatars/${id}/memory`, { method: "POST", body: JSON.stringify(b) }),
  deleteMemory: (id: string, mid: string) => req<void>(`/avatars/${id}/memory/${mid}`, { method: "DELETE" }),

  // Contenus
  listContent: (p?: { avatar_id?: string; status?: string; type?: string; limit?: number }) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))).toString();
    return req<{ content: ContentItem[] }>(`/content${q ? `?${q}` : ""}`);
  },
  getContent: (id: string) => req<{ item: ContentItem }>(`/content/${id}`),
  cancelContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/cancel`, { method: "POST", body: "{}" }),
  approveContent: (id: string, scheduledAt?: string) => req<{ ok: boolean }>(`/content/${id}/approve`, { method: "POST", body: JSON.stringify(scheduledAt ? { scheduled_at: scheduledAt } : {}) }),
  rejectContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/reject`, { method: "POST", body: "{}" }),
  retryContent: (id: string) => req<{ ok: boolean }>(`/content/${id}/retry`, { method: "POST", body: "{}" }),
  listVersions: (id: string) => req<{ current_version: number; versions: ContentVersion[] }>(`/content/${id}/versions`),
  restoreVersion: (id: string, no: number) => req<{ ok: boolean; restored: number; previous_saved_as: number }>(`/content/${id}/versions/${no}/restore`, { method: "POST", body: "{}" }),

  // Studio (production, dans le périmètre de l'organisation)
  planDay: (avatarId: string) => req<{ ok: boolean; job_id: string }>("/studio/plan-day", { method: "POST", body: JSON.stringify({ avatar_id: avatarId }) }),
  generateClip: (avatarId: string, preset: string) => req<{ ok: boolean; job_id: string; content_item_id: string }>("/studio/generate-clip", { method: "POST", body: JSON.stringify({ avatar_id: avatarId, preset }) }),

  // Étape 1 : l'histoire s'écrit en direct (SSE), avec affinage possible.
  vlogStory: async (
    avatarId: string,
    opts: { preset?: string; brief?: string; previousStory?: string; instruction?: string },
    onToken: (t: string) => void,
  ): Promise<{ title: string; story: string; caption: string; hashtags: string[] }> => {
    const res = await post("/studio/vlog/story", {
      avatar_id: avatarId, preset: opts.preset, brief: opts.brief,
      previous_story: opts.previousStory, instruction: opts.instruction,
    });
    let out = { title: "", story: "", caption: "", hashtags: [] as string[] };
    await readSse(res, (evt) => {
      if (evt.type === "token") onToken(evt.text ?? "");
      else if (evt.type === "story" && evt.result) out = evt.result;
      else if (evt.type === "error") throw new Error(evt.error ?? "story error");
    });
    return out;
  },

  // Étape 2 : découpage en scènes (durée cible + affinage).
  vlogScenes: (avatarId: string, story: string, durationSec: number, opts?: { previousScenes?: VlogScene[]; instruction?: string; format?: VideoFormat }) =>
    req<{ scenes: VlogScene[] }>("/studio/vlog/scenes", {
      method: "POST",
      body: JSON.stringify({ avatar_id: avatarId, story, duration_sec: durationSec, previous_scenes: opts?.previousScenes, instruction: opts?.instruction, format: opts?.format ?? "hybrid" }),
    }),

  // Étape 3 : lancer la production Seedance (modèle + résolution choisis).
  listTalkProviders: () => req<TalkProvidersCatalog>("/studio/talk-providers"),
  vlogEstimate: (b: { format: VideoFormat; scenes?: Array<Pick<VlogScene, "mode" | "texte" | "duration_sec"> & { inserts?: SceneInsert[] }>; durations?: number[]; video_model?: string; resolution?: SeedanceResolution; talk_provider?: TalkProvider; talk_mode?: TalkMode; music?: boolean }) =>
    req<{ format: VideoFormat; total_usd: number; per_segment_usd: number[] }>("/studio/vlog/estimate", { method: "POST", body: JSON.stringify(b) }),
  regenerateShot: (id: string, idx: number, b: { texte?: string; talk_provider?: TalkProvider } = {}) =>
    req<{ ok: boolean; job_id: string; voice_regenerated: boolean }>(`/content/${id}/shots/${idx}/regenerate`, { method: "POST", body: JSON.stringify(b) }),
  vlogProduce: (avatarId: string, production: VlogProduction, locationScopes?: Record<string, LocationScope>, videoModel?: string, resolution?: SeedanceResolution, opts: ProduceOptions = {}) =>
    req<{ ok: boolean; content_item_id: string; estimated_cost_usd: number }>("/studio/vlog/produce", {
      method: "POST",
      body: JSON.stringify({
        avatar_id: avatarId, production, location_scopes: locationScopes, video_model: videoModel, resolution,
        format: opts.format ?? "hybrid", talk_provider: opts.talkProvider, talk_mode: opts.talkMode, subtitles: opts.subtitles, music: opts.music,
      }),
    }),

  listVideoModels: () => req<VideoModelsCatalog>("/studio/video-models"),
  piapiBalance: () => req<PiapiBalance>("/studio/piapi-balance"),
  piapiHistory: () => req<PiapiHistory>("/studio/piapi-history"),

  // Prompts finaux Seedance de chaque segment (prévisualisation avant lancement).
  vlogPreviewPrompts: (avatarId: string, production: VlogProduction) =>
    req<{ prompts: string[] }>("/studio/vlog/preview-prompts", { method: "POST", body: JSON.stringify({ avatar_id: avatarId, production }) }),
  // Prépare un décor AVANT paiement : crée le lieu inédit (avec image) ou régénère l'image manquante.
  vlogPrepareLocation: (avatarId: string, b: { key: string; name?: string; description?: string; scope?: LocationScope }) =>
    req<{ location: AvatarLocation }>("/studio/vlog/prepare-location", { method: "POST", body: JSON.stringify({ avatar_id: avatarId, ...b }) }),

  // Moteur vlog complet (SSE) : l'histoire streame, puis la production part en file.
  generateVlogStream: async (
    avatarId: string,
    preset: string,
    h: { onStep?: (label: string) => void; onToken?: (t: string) => void; onProduction?: (p: VlogProduction) => void; onEnqueued?: (contentItemId: string) => void },
  ): Promise<void> => {
    const res = await post("/studio/generate-vlog", { avatar_id: avatarId, preset });
    await readSse(res, (evt) => {
      if (evt.type === "token") h.onToken?.(evt.text ?? "");
      else if (evt.type === "step") h.onStep?.(evt.label ?? "");
      else if (evt.type === "production") evt.production && h.onProduction?.(evt.production);
      else if (evt.type === "enqueued") evt.content_item_id && h.onEnqueued?.(evt.content_item_id);
      else if (evt.type === "error") throw new Error(evt.error ?? "vlog stream error");
    });
  },

  // Task Center
  tasks: (avatarId?: string) => req<TasksResult>(`/studio/tasks${avatarId ? `?avatar_id=${encodeURIComponent(avatarId)}` : ""}`),
  retryJob: (id: string) => req<{ ok: boolean }>(`/studio/jobs/${id}/retry`, { method: "POST", body: "{}" }),

  setup: () => req<Setup>("/studio/setup"),
  stats: () => req<Stats>("/studio/stats"),

  // ── Phase 3 : calendrier éditorial ──
  listPlans: (avatarId: string) => req<{ plans: ContentPlan[] }>(`/calendar/avatars/${avatarId}/plans`),
  getPlan: (avatarId: string, month: string) => req<{ plan: ContentPlan | null }>(`/calendar/avatars/${avatarId}/plans/${month}`),
  generatePlan: (avatarId: string, b: { month: string; posts_per_week?: number; brief?: string; arcs?: string[] }) =>
    req<{ ok: boolean; job_id: string; month: string }>(`/calendar/avatars/${avatarId}/plans/generate`, { method: "POST", body: JSON.stringify(b) }),
  addPlanEntry: (avatarId: string, month: string, b: Partial<PlanEntry> & { day: string; title: string; brief: string }) =>
    req<{ entry: PlanEntry }>(`/calendar/avatars/${avatarId}/plans/${month}/entries`, { method: "POST", body: JSON.stringify(b) }),
  updatePlanEntry: (entryId: string, b: Partial<PlanEntry>) => req<{ entry: PlanEntry }>(`/calendar/entries/${entryId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deletePlanEntry: (entryId: string) => req<{ ok: boolean }>(`/calendar/entries/${entryId}`, { method: "DELETE" }),
  producePlanEntry: (entryId: string, b: { resolution?: string; talk_mode?: string; music?: boolean } = {}) =>
    req<{ ok: boolean; content_item_id: string; estimated_cost_usd: number }>(`/calendar/entries/${entryId}/produce`, { method: "POST", body: JSON.stringify(b) }),
  upcomingEntries: () => req<{ entries: Array<PlanEntry & { avatar_name: string | null }> }>("/calendar/upcoming"),

  // ── Phase 3 : compte social (simulé) + publication ──
  socialProfile: (avatarId: string, network: string) => req<{ profile: SocialProfile }>(`/social/avatars/${avatarId}/profile?network=${network}`),
  updateSocialProfile: (avatarId: string, b: { network: string; handle?: string; display_name?: string; bio?: string; link?: string | null }) =>
    req<{ profile: SocialProfile }>(`/social/avatars/${avatarId}/profile`, { method: "PATCH", body: JSON.stringify(b) }),
  socialFeed: (avatarId: string, network: string) => req<SocialFeed>(`/social/avatars/${avatarId}/feed?network=${network}`),
  publishNow: (contentId: string) => req<{ ok: boolean; mode: "simulated" | "real"; post?: SocialPost; job_id?: string }>(`/social/content/${contentId}/publish-now`, { method: "POST", body: "{}" }),
  listConnections: () => req<{ connections: SocialConnection[]; provider_configured: boolean }>("/social/connections"),
  createConnection: (b: { provider: "ayrshare" | "simulated"; avatar_id?: string | null; profile_key?: string; networks: string[]; display_name?: string }) =>
    req<{ connection: SocialConnection }>("/social/connections", { method: "POST", body: JSON.stringify(b) }),
  deleteConnection: (id: string) => req<{ ok: boolean }>(`/social/connections/${id}`, { method: "DELETE" }),
  syncStats: (avatarId?: string) => req<{ ok: boolean; job_id: string }>("/social/sync-stats", { method: "POST", body: JSON.stringify(avatarId ? { avatar_id: avatarId } : {}) }),

  // ── Phase 3 : campagnes UGC ──
  listCampaigns: () => req<{ campaigns: UgcCampaign[] }>("/ugc/campaigns"),
  getCampaign: (id: string) => req<{ campaign: UgcCampaign }>(`/ugc/campaigns/${id}`),
  estimateCampaign: (b: UgcCampaignInput & { resolution?: string }) => req<UgcEstimate>("/ugc/campaigns/estimate", { method: "POST", body: JSON.stringify(b) }),
  createCampaign: (b: UgcCampaignInput) => req<{ campaign: UgcCampaign }>("/ugc/campaigns", { method: "POST", body: JSON.stringify(b) }),
  deleteCampaign: (id: string) => req<{ ok: boolean }>(`/ugc/campaigns/${id}`, { method: "DELETE" }),
  updateVariant: (id: string, b: { script?: UgcScript; hook?: string; cta?: string | null; status?: "archived" | "scripted" }) =>
    req<{ variant: UgcVariant }>(`/ugc/variants/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  produceVariant: (id: string, b: { resolution?: string; talk_mode?: string; music?: boolean } = {}) =>
    req<{ ok: boolean; content_item_id: string; estimated_cost_usd: number }>(`/ugc/variants/${id}/produce`, { method: "POST", body: JSON.stringify(b) }),
};

// ── Types phase 3 ────────────────────────────────────────────
export type PlanEntryType = "video" | "photo" | "carousel" | "story" | "ugc";
export type PlanEntryStatus = "planned" | "generating" | "ready" | "scheduled" | "published" | "skipped" | "failed";
export interface PlanArc { name: string; start: string; end: string; summary: string }
export interface PlanStrategy { pillars: string[]; series: Array<{ name: string; description: string; cadence: string }>; arcs: PlanArc[]; objectives: string; mix: Record<string, number>; voice?: string }
export interface PlanEntry {
  id: string; plan_id: string; avatar_id: string; day: string; slot: "matin" | "midi" | "soir"; type: PlanEntryType; format: string | null;
  network: string; ratio_class: "value" | "proof" | "sale"; pillar: string | null; series: string | null; arc: string | null;
  title: string; brief: string; location_key: string | null; status: PlanEntryStatus; content_item_id: string | null; position: number; created_at: string;
}
export interface ContentPlan { id: string; avatar_id: string; month: string; status: "draft" | "active" | "archived"; brief: string | null; strategy: PlanStrategy; cost_usd: number; created_at: string; entries?: PlanEntry[] }

export interface SocialProfile { id: string; avatar_id: string; network: string; handle: string; display_name: string; bio: string; link: string | null; base_followers: number; following: number; created_at: string }
export interface PostStats { views: number; likes: number; comments: number; shares: number; saves: number; followers_gained: number }
export interface SocialPost {
  id: string; type: string; network: string; title: string | null; caption: string; hashtags: string[]; published_at: string | null; scheduled_at: string | null; status: string;
  cover_url: string | null; video_url: string | null; image_urls: string[]; stats: PostStats; real: boolean; ai_label: boolean; external_url: string | null;
}
export interface SocialFeed { profile: SocialProfile & { followers: number; posts: number; total_views: number; total_likes: number; engagement_rate: number }; posts: SocialPost[]; upcoming: SocialPost[] }
export interface SocialConnection { id: string; org_id: string; avatar_id: string | null; provider: "ayrshare" | "simulated"; profile_key: string | null; networks: string[]; display_name: string | null; status: string; created_at: string }

export interface UgcProduct { name: string; description: string; image_url?: string | null; url?: string | null; price?: string | null; key_benefits?: string[] }
export interface UgcBeat { beat: "hook" | "problem" | "product" | "demo" | "benefits" | "proof" | "cta"; seconds: number; line: string; action: string }
export interface UgcScript { beats: UgcBeat[]; caption: string; hashtags: string[]; hook_type?: string }
export interface UgcCampaignInput { name?: string; brand: string; product: UgcProduct; objective?: string; target?: string; tone?: string; avatar_ids: string[]; angles: string[]; hooks_per_angle?: number; durations?: number[]; ctas?: string[] }
export interface UgcVariant { id: string; campaign_id: string; avatar_id: string; label: string; angle: string; hook: string; duration_sec: number; cta: string | null; script: UgcScript; status: "scripted" | "generating" | "ready" | "failed" | "archived"; content_item_id: string | null; est_cost_usd: number; created_at: string }
export interface UgcCampaign { id: string; org_id: string; name: string; brand: string; product: UgcProduct; objective: string; target: string | null; tone: string | null; language: string; matrix: { avatar_ids: string[]; angles: string[]; hooks_per_angle: number; durations: number[]; ctas: string[] }; status: string; cost_usd: number; created_at: string; variants?: UgcVariant[] }
export interface UgcEstimate { variants: number; scripts_cost_usd: number; production_cost_usd: number; budget: Array<{ duration: number; beats: Record<string, number> }> }
