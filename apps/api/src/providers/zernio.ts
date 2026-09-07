import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// ZERNIO — client HTTP minimal (spec OpenAPI officielle 1.0.4 lue le 7 sept. 2026,
// https://zernio.com/openapi.yaml ; docs/RECHERCHE-PUBLICATION.md § 5).
//   Base : https://zernio.com/api/v1 · `Authorization: Bearer <clé>` · JSON.
//   Modèle : un PROFIL par influenceur (un seul compte par réseau et par profil) → comptes
//   connectés par OAuth hébergé (GET /connect/{platform}) → POST /posts (publishNow ou scheduledFor).
//   Tarif à l'usage : 2 comptes gratuits, puis 6 $/compte/mois (3-10), 3 $ (11-100), 1 $ (101+).
//   Limite de débit : 60 requêtes/min (gratuit), 600 (payant) ; 25 publications/h par compte.
// ─────────────────────────────────────────────────────────────

const BASE = "https://zernio.com/api/v1";

/** Réseau Viralya → identifiant de plateforme Zernio. */
export const ZERNIO_PLATFORM: Record<string, string> = { instagram: "instagram", tiktok: "tiktok", youtube: "youtube", facebook: "facebook", x: "twitter" };
/** Plateforme Zernio → réseau Viralya (les plateformes publicitaires et de messagerie sont ignorées). */
export const NETWORK_OF_PLATFORM: Record<string, string> = { instagram: "instagram", tiktok: "tiktok", youtube: "youtube", facebook: "facebook", twitter: "x" };

export class ZernioError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly details?: unknown) {
    super(message);
  }
}

export interface ZernioProfile { _id: string; name: string; description?: string; color?: string; isDefault?: boolean }
export interface ZernioAccount {
  _id: string;
  platform: string;
  profileId: string | { _id: string; name?: string };
  username?: string;
  displayName?: string;
  profilePicture?: string | null;
  profileUrl?: string;
  isActive: boolean;
  needsReconnection?: boolean;
  followersCount?: number;
  enabled?: boolean;
}
export interface ZernioPostPlatform {
  platform: string;
  accountId: string | { _id: string; username?: string };
  status: string; // pending | publishing | published | failed
  platformPostId?: string;
  platformPostUrl?: string;
  publishedAt?: string;
  errorMessage?: string;
  errorCategory?: string;
}
export interface ZernioPost {
  _id: string;
  status: string; // draft | scheduled | publishing | published | failed | partial
  platforms: ZernioPostPlatform[];
  publishedAt?: string;
  scheduledFor?: string;
}
export interface ZernioAnalytics {
  impressions?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number; clicks?: number; views?: number; engagementRate?: number; lastUpdated?: string;
}
export interface ZernioWebhook { _id: string; name: string; url: string; events: string[]; isActive: boolean; failureCount?: number }

export const zernioConfigured = (): boolean => !!config.ZERNIO_API_KEY;

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<{ status: number; data: T }> {
  const key = config.ZERNIO_API_KEY;
  if (!key) throw new ZernioError(503, "Publication réelle non configurée sur ce serveur (ZERNIO_API_KEY absente).");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ZernioError(502, `Zernio injoignable : ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = String(data?.error ?? data?.message ?? `HTTP ${res.status}`);
    logger.warn("zernio_error", { method, path: path.split("?")[0], status: res.status, code: data?.code, err: msg.slice(0, 200) });
    throw new ZernioError(res.status, msg, data?.code ?? data?.details?.code, data?.details);
  }
  return { status: res.status, data: data as T };
}

// ── Identité, usage ───────────────────────────────────────────
export async function verifyCredential(): Promise<{ valid: boolean; userId?: string; authType?: string }> {
  return (await call<{ valid: boolean; userId?: string; authType?: string }>("GET", "/auth/verify")).data;
}
export async function usageStats(): Promise<Record<string, unknown>> {
  return (await call<Record<string, unknown>>("GET", "/usage-stats")).data;
}

// ── Profils (un par influenceur) ──────────────────────────────
export async function listProfiles(name?: string): Promise<ZernioProfile[]> {
  const q = name ? `?name=${encodeURIComponent(name)}` : "";
  return (await call<{ profiles: ZernioProfile[] }>("GET", `/profiles${q}`)).data.profiles ?? [];
}

/** Crée le profil (idempotent grâce à `Idempotency-Key`) ; renvoie l'identifiant existant si le nom est déjà pris. */
export async function createProfile(name: string, description: string, idempotencyKey: string): Promise<string> {
  try {
    const { data } = await call<{ profile: ZernioProfile }>("POST", "/profiles", { name, description, color: "#7c3aed" }, { "Idempotency-Key": idempotencyKey });
    return data.profile._id;
  } catch (err) {
    if (err instanceof ZernioError && err.status === 409) {
      const existing = (err.details as { existingProfileId?: string } | undefined)?.existingProfileId;
      if (existing) return existing;
      const found = await listProfiles(name);
      if (found[0]) return found[0]._id;
    }
    throw err;
  }
}

export async function getProfile(profileId: string): Promise<ZernioProfile | null> {
  try {
    return (await call<{ profile: ZernioProfile }>("GET", `/profiles/${profileId}`)).data.profile ?? null;
  } catch (err) {
    if (err instanceof ZernioError && err.status === 404) return null;
    throw err;
  }
}

// ── Connexion des comptes (OAuth hébergé par Zernio) ──────────
/** URL vers laquelle envoyer l'utilisateur ; Zernio revient sur `redirectUrl` avec connected=… ou error=… */
export async function connectUrl(platform: string, profileId: string, redirectUrl: string): Promise<string> {
  const q = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const { data } = await call<{ authUrl: string }>("GET", `/connect/${platform}?${q.toString()}`);
  if (!data?.authUrl) throw new ZernioError(502, "Zernio n'a pas renvoyé d'URL d'autorisation.");
  return data.authUrl;
}

export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  return (await call<{ accounts: ZernioAccount[] }>("GET", `/accounts${q}`)).data.accounts ?? [];
}

/** Déconnecte le compte chez Zernio (la facturation du compte s'arrête, au prorata). 404 = déjà parti. */
export async function disconnectAccount(accountId: string): Promise<void> {
  try {
    await call("DELETE", `/accounts/${accountId}`);
  } catch (err) {
    if (err instanceof ZernioError && err.status === 404) return;
    throw err;
  }
}

export interface TikTokCreatorInfo {
  creator?: { nickname?: string; canPostMore?: boolean };
  privacyLevels?: Array<{ value: string; label?: string }>;
  postingLimits?: { maxVideoDurationSec?: number; interactionSettings?: Record<string, boolean> };
  commercialContentTypes?: Array<{ value: string }>;
}
export async function tiktokCreatorInfo(accountId: string, mediaType: "video" | "photo"): Promise<TikTokCreatorInfo> {
  return (await call<TikTokCreatorInfo>("GET", `/accounts/${accountId}/tiktok/creator-info?mediaType=${mediaType}`)).data;
}

// ── Publications ──────────────────────────────────────────────
/** POST /posts. `requestId` (UUID) = idempotence 5 min : un nouvel envoi renvoie le post existant. Timeout long : Zernio télécharge et envoie la vidéo. */
export async function createPost(body: Record<string, unknown>, requestId: string): Promise<ZernioPost> {
  const { data } = await call<{ post?: ZernioPost; existingPost?: ZernioPost; warnings?: string[] }>("POST", "/posts", body, { "x-request-id": requestId }, 180_000);
  if (data.warnings?.length) logger.info("zernio_post_warnings", { warnings: data.warnings.slice(0, 5) });
  const post = data.post ?? data.existingPost;
  if (!post?._id) throw new ZernioError(502, "Réponse Zernio sans identifiant de publication.");
  return post;
}

export async function getPost(postId: string): Promise<ZernioPost | null> {
  try {
    return (await call<{ post: ZernioPost }>("GET", `/posts/${postId}`)).data.post ?? null;
  } catch (err) {
    if (err instanceof ZernioError && err.status === 404) return null;
    throw err;
  }
}

/** Statistiques d'une publication : null tant que la synchronisation est en attente (202) ou si tout a échoué (424). */
export async function postAnalytics(postId: string): Promise<ZernioAnalytics | null> {
  try {
    const { status, data } = await call<{ analytics?: ZernioAnalytics; syncStatus?: string }>("GET", `/analytics?postId=${encodeURIComponent(postId)}`);
    if (status === 202 || !data?.analytics) return null;
    return data.analytics;
  } catch (err) {
    if (err instanceof ZernioError && (err.status === 424 || err.status === 404 || err.status === 402)) return null;
    throw err;
  }
}

// ── Webhooks ──────────────────────────────────────────────────
export const ZERNIO_EVENTS = ["post.published", "post.failed", "post.partial", "post.platform.published", "post.platform.failed", "post.tiktok.url_resolved", "account.connected", "account.disconnected"];

export async function listWebhooks(): Promise<ZernioWebhook[]> {
  return (await call<{ webhooks: ZernioWebhook[] }>("GET", "/webhooks/settings")).data.webhooks ?? [];
}
export async function createWebhook(url: string, secret: string): Promise<ZernioWebhook> {
  return (await call<{ webhook: ZernioWebhook }>("POST", "/webhooks/settings", { name: "Viralya", url, secret, events: ZERNIO_EVENTS, isActive: true })).data.webhook;
}
export async function updateWebhook(id: string, url: string, secret: string): Promise<ZernioWebhook> {
  return (await call<{ webhook: ZernioWebhook }>("PUT", "/webhooks/settings", { _id: id, url, secret, events: ZERNIO_EVENTS, isActive: true })).data.webhook;
}
