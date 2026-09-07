import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { auditLog } from "../lib/audit";
import { badRequest, HttpError, notFound } from "../lib/httpError";
import { logger } from "../logger";
import * as zernio from "../providers/zernio";
import { supabase } from "../supabase";
import { notifyConnectionLost } from "./notifications";
import { failRealPublish, finalizeRealPublish, findItemForPost, setExternalUrl, type ConnectionRow } from "./publishing";

// ─────────────────────────────────────────────────────────────
// CONNEXIONS DE PUBLICATION (Zernio, 7 sept. 2026)
//   Un profil Zernio par influenceur (`avatars.publisher_profile_id`), un compte par réseau dans ce
//   profil (règle Zernio), une ligne `social_connections` par compte connecté (provider = zernio).
//   Parcours : « Connecter » → URL OAuth hébergée par Zernio → retour sur la page du compte social
//   (`?connect=zernio&connected=…` ou `&error=…`) → synchronisation des comptes du profil.
//   Webhook signé (HMAC-SHA256 hex du corps brut, en-tête X-Zernio-Signature) : publications
//   confirmées/échouées, URL TikTok différée, comptes déconnectés (jeton expiré).
// ─────────────────────────────────────────────────────────────

const PROVIDER = "zernio";
const MIGRATION_HINT = "La migration 0019 (connexions de publication) doit être appliquée dans Supabase.";

/** Une colonne ou une table absente = migration 0019 non appliquée : message clair plutôt qu'une 500. */
function guardMigration(err: { message?: string; code?: string } | null | undefined): void {
  if (!err) return;
  const msg = String(err.message ?? "");
  if (err.code === "42703" || err.code === "42P01" || err.code === "PGRST204" || /does not exist|schema cache/i.test(msg)) throw new HttpError(503, MIGRATION_HINT);
}

export const publisherConfigured = (): boolean => zernio.zernioConfigured();

/** Profil Zernio de l'influenceur, créé au premier besoin (idempotent), recréé s'il a disparu côté Zernio. */
export async function publisherProfileId(avatarId: string): Promise<string> {
  const { data: avatar, error } = await supabase.from("avatars").select("id, name, publisher_profile_id").eq("id", avatarId).single();
  guardMigration(error);
  if (!avatar) throw notFound("Influenceur");
  if (avatar.publisher_profile_id) {
    const existing = await zernio.getProfile(String(avatar.publisher_profile_id));
    if (existing) return existing._id;
    logger.warn("zernio_profile_missing", { avatarId, profileId: avatar.publisher_profile_id });
  }
  const name = `${String(avatar.name ?? "Influenceur").slice(0, 40)} · ${avatarId.slice(0, 8)}`;
  const id = await zernio.createProfile(name, `Influenceur Viralya ${avatarId}`, `viralya-profile-${avatarId}`);
  const { error: e2 } = await supabase.from("avatars").update({ publisher_profile_id: id }).eq("id", avatarId);
  guardMigration(e2);
  logger.info("zernio_profile_created", { avatarId, profileId: id });
  return id;
}

/** URL d'autorisation vers laquelle envoyer l'utilisateur pour connecter un réseau de l'influenceur. */
export async function startConnect(o: { orgId: string; userId?: string | null; avatarId: string; network: string }): Promise<string> {
  const platform = zernio.ZERNIO_PLATFORM[o.network];
  if (!platform) throw badRequest(`Réseau non pris en charge : ${o.network}`);
  if (!publisherConfigured()) throw new HttpError(503, "Publication réelle non configurée sur ce serveur (ZERNIO_API_KEY absente).");
  const profileId = await publisherProfileId(o.avatarId);
  const redirect = `${config.WEB_BASE_URL.replace(/\/$/, "")}/avatars/${o.avatarId}/social?connect=zernio`;
  const url = await zernio.connectUrl(platform, profileId, redirect);
  await auditLog("social.connect_started", { orgId: o.orgId, userId: o.userId ?? null, details: { avatar_id: o.avatarId, network: o.network, consent: true } });
  return url;
}

export async function listConnections(orgId: string, avatarId?: string | null): Promise<ConnectionRow[]> {
  let q = supabase.from("social_connections").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (avatarId) q = q.eq("avatar_id", avatarId);
  const { data, error } = await q;
  if (error) throw new Error(`connections: ${error.message}`);
  return (data ?? []) as ConnectionRow[];
}

/** Relit les comptes du profil Zernio de l'influenceur et aligne `social_connections` (ajouts, états, retraits). */
export async function syncAvatarConnections(avatarId: string): Promise<ConnectionRow[]> {
  const { data: avatar, error } = await supabase.from("avatars").select("id, org_id, publisher_profile_id").eq("id", avatarId).single();
  guardMigration(error);
  if (!avatar) throw notFound("Influenceur");
  const orgId = String(avatar.org_id);
  const profileId = avatar.publisher_profile_id ? String(avatar.publisher_profile_id) : null;
  if (!profileId || !publisherConfigured()) return listConnections(orgId, avatarId);

  const accounts = await zernio.listAccounts(profileId);
  const { data: rows, error: e1 } = await supabase.from("social_connections").select("*").eq("avatar_id", avatarId).eq("provider", PROVIDER);
  guardMigration(e1);
  const existing = new Map<string, ConnectionRow>();
  for (const r of (rows ?? []) as ConnectionRow[]) if (r.external_account_id) existing.set(r.external_account_id, r);

  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const acc of accounts) {
    if (acc.enabled === false) continue; // compte créé en creux par une connexion publicitaire : non publiable
    const network = zernio.NETWORK_OF_PLATFORM[acc.platform];
    if (!network) continue;
    const pid = typeof acc.profileId === "string" ? acc.profileId : acc.profileId?._id;
    if (pid && pid !== profileId) continue;
    seen.add(acc._id);
    const prev = existing.get(acc._id);
    const active = acc.isActive !== false && !acc.needsReconnection;
    const meta: Record<string, unknown> = { ...(prev?.meta ?? {}), platform: acc.platform, needs_reconnection: !!acc.needsReconnection };
    if (active) delete meta.reason;
    const row = {
      org_id: orgId,
      avatar_id: avatarId,
      provider: PROVIDER,
      profile_key: profileId,
      external_account_id: acc._id,
      networks: [network],
      display_name: acc.displayName ?? acc.username ?? null,
      handle: acc.username ? acc.username.replace(/^@/, "") : null,
      profile_url: acc.profileUrl ?? null,
      picture_url: acc.profilePicture ?? null,
      followers: typeof acc.followersCount === "number" ? Math.round(acc.followersCount) : (prev?.followers ?? null),
      status: active ? "active" : "error",
      meta,
      last_synced_at: now,
      updated_at: now,
    };
    if (prev) {
      const { error: e2 } = await supabase.from("social_connections").update(row).eq("id", prev.id);
      guardMigration(e2);
    } else {
      const { error: e3 } = await supabase.from("social_connections").insert({ ...row, consent: { ai_label: true, at: now } });
      guardMigration(e3);
      logger.info("social_connected", { avatarId, network, accountId: acc._id });
    }
  }
  const gone = [...existing.values()].filter((r) => r.external_account_id && !seen.has(r.external_account_id));
  if (gone.length) {
    await supabase.from("social_connections").delete().in("id", gone.map((r) => r.id));
    logger.info("social_connections_removed", { avatarId, count: gone.length });
  }
  return listConnections(orgId, avatarId);
}

/** Déconnexion : chez Zernio (facturation du compte arrêtée) puis chez nous. */
export async function disconnect(o: { orgId: string; userId?: string | null; connectionId: string }): Promise<void> {
  const { data: row } = await supabase.from("social_connections").select("*").eq("org_id", o.orgId).eq("id", o.connectionId).maybeSingle();
  if (!row) throw notFound("Connexion");
  const r = row as ConnectionRow;
  if (r.provider === PROVIDER && r.external_account_id && publisherConfigured()) await zernio.disconnectAccount(r.external_account_id);
  await supabase.from("social_connections").delete().eq("id", r.id);
  await auditLog("social.disconnect", { orgId: o.orgId, userId: o.userId ?? null, details: { avatar_id: r.avatar_id, networks: r.networks, account_id: r.external_account_id } });
  logger.info("social_disconnected", { connectionId: r.id, networks: r.networks });
}

/** Le fournisseur signale un compte mort (jeton expiré/révoqué) : la connexion passe en erreur, l'équipe est prévenue. */
export async function markDisconnected(accountId: string, reason: string, intentional: boolean): Promise<void> {
  const { data: row } = await supabase.from("social_connections").select("id, org_id, avatar_id, networks, meta, status").eq("provider", PROVIDER).eq("external_account_id", accountId).maybeSingle();
  if (!row) return;
  if (intentional) {
    await supabase.from("social_connections").delete().eq("id", row.id);
    return;
  }
  if (row.status === "error") return;
  await supabase.from("social_connections").update({ status: "error", meta: { ...((row.meta as Record<string, unknown>) ?? {}), needs_reconnection: true, reason }, updated_at: new Date().toISOString() }).eq("id", row.id);
  await notifyConnectionLost(String(row.id)).catch(() => {});
}

// ── Webhook ───────────────────────────────────────────────────
export function verifyZernioSignature(raw: Buffer, signature: string | undefined): boolean {
  const secret = config.ZERNIO_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const given = Buffer.from(String(signature).trim().replace(/^sha256=/i, "").toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Journal d'idempotence des événements (table integration_events, migration 0019). false = déjà vu. */
export async function recordEvent(eventId: string, type: string): Promise<boolean> {
  const { error } = await supabase.from("integration_events").insert({ id: `${PROVIDER}:${eventId}`, provider: PROVIDER, type });
  if (!error) return true;
  if (error.code === "23505") return false;
  logger.warn("integration_events_unavailable", { err: error.message.slice(0, 120) });
  return true;
}

interface PostEvent {
  id?: string;
  event: string;
  post?: { id: string; status?: string; metadata?: Record<string, unknown>; platforms?: Array<{ platform: string; status: string; platformPostId?: string; publishedUrl?: string; error?: string }> };
  platform?: { name: string; status: string; platformPostId?: string; publishedUrl?: string; error?: string };
  account?: { accountId: string; profileId?: string; platform?: string; username?: string; disconnectionType?: string; reason?: string };
}

export async function handleZernioEvent(ev: PostEvent): Promise<void> {
  const type = String(ev?.event ?? "");
  if (type.startsWith("post.") && ev.post?.id) {
    const item = await findItemForPost(PROVIDER, ev.post.id, ev.post.metadata);
    if (!item) { logger.info("zernio_event_unmatched", { type, postId: ev.post.id }); return; }
    const platform = zernio.ZERNIO_PLATFORM[item.network] ?? item.network;
    const entry = ev.platform ? { status: ev.platform.status, platformPostId: ev.platform.platformPostId, url: ev.platform.publishedUrl, error: ev.platform.error }
      : (() => { const p = (ev.post!.platforms ?? []).find((x) => x.platform === platform) ?? ev.post!.platforms?.[0]; return p ? { status: p.status, platformPostId: p.platformPostId, url: p.publishedUrl, error: p.error } : null; })();
    if (type === "post.tiktok.url_resolved") {
      if (entry?.url) await setExternalUrl(item.id, entry.url);
      return;
    }
    const published = type === "post.published" || type === "post.platform.published" || entry?.status === "published";
    const failed = type === "post.failed" || type === "post.platform.failed" || entry?.status === "failed";
    if (published) await finalizeRealPublish(item.id, PROVIDER, { postId: ev.post.id, url: entry?.url ?? null, platformPostId: entry?.platformPostId ?? null });
    else if (failed) await failRealPublish(item.id, PROVIDER, entry?.error ?? "échec signalé par le fournisseur", ev.post.id);
    return;
  }
  if (type === "account.disconnected" && ev.account?.accountId) {
    await markDisconnected(ev.account.accountId, String(ev.account.reason ?? "jeton expiré"), ev.account.disconnectionType === "intentional");
    return;
  }
  if (type === "account.connected" && ev.account?.profileId) {
    const { data: avatar } = await supabase.from("avatars").select("id").eq("publisher_profile_id", ev.account.profileId).maybeSingle();
    if (avatar) await syncAvatarConnections(String(avatar.id));
  }
}

/** Enregistre (ou met à jour) le webhook Zernio vers cette instance. Silencieux sans clé/secret ou en local. */
export async function ensureZernioWebhook(): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const secret = config.ZERNIO_WEBHOOK_SECRET;
  if (!publisherConfigured() || !secret) return { ok: false, reason: "ZERNIO_API_KEY ou ZERNIO_WEBHOOK_SECRET absente" };
  const isLocal = (u: string) => /localhost|127\.0\.0\.1/.test(u);
  const base = (isLocal(config.API_BASE_URL) ? config.WEB_BASE_URL : config.API_BASE_URL).replace(/\/$/, "");
  if (isLocal(base)) return { ok: false, reason: "URL publique inconnue (localhost) : Zernio ne pourrait pas joindre le webhook" };
  const url = `${base}/api/social/zernio/webhook`;
  const hooks = await zernio.listWebhooks();
  const mine = hooks.find((h) => h.url === url);
  if (mine) await zernio.updateWebhook(mine._id, url, secret);
  else await zernio.createWebhook(url, secret);
  logger.info("zernio_webhook_ready", { url, existing: !!mine });
  return { ok: true, url };
}
