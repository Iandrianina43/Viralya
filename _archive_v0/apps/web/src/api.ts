export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const BASE = API_BASE;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "dev-admin-key";

export interface Avatar {
  id: string;
  name: string;
  niche: string;
  sex_age: string;
  status: "draft" | "active" | "paused";
  is_ai_disclosed: boolean;
  system_prompt: string;
  priority_networks: string[];
  affiliate_products: string[];
  voice_id: string | null;
  heygen_avatar_id: string | null;
  city: string;
  timezone: string;
}

export interface Memory {
  id: string;
  avatar_id: string;
  kind: "fact" | "storyline" | "life_event" | "content_ref";
  summary: string;
  status: string;
  importance: number;
  occurred_on: string;
  created_at: string;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
}

export interface HeygenAvatarInfo {
  avatar_id: string;
  name: string;
  preview_image_url?: string;
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
  scheduled_at: string | null;
  error: string | null;
  created_at: string;
}

export interface Stats {
  avatars: number;
  leads_confirmed: number;
  content_live: number;
  revenue_cents: number;
}

export interface SetupItem {
  configured: boolean;
  provider?: string;
  model?: string;
}

export interface SetupStatus {
  llm: SetupItem;
  voice: SetupItem;
  video: SetupItem;
  image: SetupItem;
  stripe: SetupItem;
  email: SetupItem;
  scheduler: SetupItem;
}

async function req<T>(path: string, init?: RequestInit & { admin?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.admin) headers["x-admin-key"] = ADMIN_KEY;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

export const api = {
  // Avatars
  listAvatars: () => req<{ avatars: Avatar[] }>("/avatars"),
  getAvatar: (id: string) => req<{ avatar: Avatar }>(`/avatars/${id}`),
  createAvatar: (body: Partial<Avatar>) =>
    req<{ avatar: Avatar }>("/avatars", { method: "POST", body: JSON.stringify(body) }),
  updateAvatar: (id: string, body: Partial<Avatar>) =>
    req<{ avatar: Avatar }>(`/avatars/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  // Mémoire narrative (écosystème vivant)
  getMemory: (avatarId: string) => req<{ memory: Memory[] }>(`/avatars/${avatarId}/memory`),
  addMemory: (avatarId: string, body: Partial<Memory>) =>
    req<{ ok: boolean }>(`/avatars/${avatarId}/memory`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteMemory: (avatarId: string, memoryId: string) =>
    req<void>(`/avatars/${avatarId}/memory/${memoryId}`, { method: "DELETE" }),

  // Content
  listContent: (params?: { avatar_id?: string; status?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return req<{ content: ContentItem[] }>(`/content${q ? `?${q}` : ""}`);
  },
  approveContent: (id: string) =>
    req<{ ok: boolean }>(`/content/${id}/approve`, { method: "POST", body: "{}" }),
  rejectContent: (id: string) =>
    req<{ ok: boolean }>(`/content/${id}/reject`, { method: "POST", body: "{}" }),
  retryContent: (id: string) =>
    req<{ ok: boolean }>(`/content/${id}/retry`, { method: "POST", body: "{}" }),

  // Admin
  stats: () => req<Stats>("/admin/stats", { admin: true }),
  setup: () => req<SetupStatus>("/admin/setup", { admin: true }),
  listVoices: () =>
    req<{ configured: boolean; voices: VoiceInfo[] }>("/admin/voices", { admin: true }),
  listHeygenAvatars: () =>
    req<{ configured: boolean; avatars: HeygenAvatarInfo[] }>("/admin/heygen-avatars", {
      admin: true,
    }),
  planDay: (avatarId: string) =>
    req<{ ok: boolean; job_id: string }>("/admin/plan-day", {
      admin: true,
      method: "POST",
      body: JSON.stringify({ avatar_id: avatarId }),
    }),
};
