import { createClient, type User } from "@supabase/supabase-js";
import type { Request, RequestHandler, Response } from "express";
import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Authentification — Supabase Auth (email + mot de passe).
//  - login/signup côté serveur (le front ne parle jamais à Supabase directement)
//  - session = access_token vérifié à chaque requête (cache 5 min), porté par un cookie httpOnly
//    (14 sept. 2026, audit P2) ou, pour les scripts, par l'en-tête Authorization: Bearer
//  - rôles dans user_metadata.role : "admin" | "user"
// ─────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Identifiant de requête (journal d'accès, en-tête x-request-id). */
      id?: string;
    }
  }
}

// Client "anon" : sert uniquement à vérifier les mots de passe (signInWithPassword).
export const supabaseAuth = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function authConfigured(): boolean {
  return !!config.SUPABASE_ANON_KEY;
}

// ── Vérification de jeton (avec cache mémoire, TTL 5 min) ────
const tokenCache = new Map<string, { user: AuthUser; exp: number }>();

function toAuthUser(u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): AuthUser {
  return {
    id: u.id,
    email: u.email ?? "",
    name: String(u.user_metadata?.name ?? ""),
    role: u.user_metadata?.role === "admin" ? "admin" : "user",
  };
}

export async function userFromToken(token: string): Promise<AuthUser | null> {
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const user = toAuthUser(data.user);
  tokenCache.set(token, { user, exp: Date.now() + 5 * 60_000 });
  if (tokenCache.size > 500) {
    // purge simple des entrées expirées
    for (const [k, v] of tokenCache) if (v.exp < Date.now()) tokenCache.delete(k);
  }
  return user;
}

export function invalidateToken(token: string): void {
  tokenCache.delete(token);
}

/** Bannissement, suppression, changement de mot de passe : toutes les sessions en cache de l'utilisateur tombent. */
export function invalidateUserTokens(userId: string): void {
  for (const [k, v] of tokenCache) if (v.user.id === userId) tokenCache.delete(k);
}

// ── Cookies de session (14 sept. 2026) ───────────────────────
// Le jeton d'accès et le jeton de renouvellement ne sont plus lisibles par le JavaScript de la page
// (XSS ≠ vol de session). Deux cookies httpOnly, SameSite=Lax (les navigations de retour Stripe/OAuth
// les portent, pas les requêtes lancées depuis un autre site), Secure dès que le site est en https.
export const SESSION_COOKIE = "viralya_session";
export const REFRESH_COOKIE = "viralya_refresh";
const COOKIE_DAYS = 30;
const secureCookies = (): boolean => config.WEB_BASE_URL.startsWith("https://") || config.NODE_ENV === "production";

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieLine(name: string, value: string, path: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}`;
}

/** Pose (ou remplace) les cookies de session après login / signup / refresh. */
export function setSessionCookies(res: Response, session: { access_token: string; refresh_token?: string | null }): void {
  const lines = [cookieLine(SESSION_COOKIE, session.access_token, "/api", COOKIE_DAYS * 86_400)];
  if (session.refresh_token) lines.push(cookieLine(REFRESH_COOKIE, session.refresh_token, "/api/auth", COOKIE_DAYS * 86_400));
  res.setHeader("Set-Cookie", lines);
}

export function clearSessionCookies(res: Response): void {
  res.setHeader("Set-Cookie", [cookieLine(SESSION_COOKIE, "", "/api", 0), cookieLine(REFRESH_COOKIE, "", "/api/auth", 0)]);
}

/** Jeton d'accès de la requête : en-tête Bearer (scripts, tests) sinon cookie httpOnly (navigateur). */
export function tokenOf(req: Request): { token: string; source: "header" | "cookie" | null } {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ") && header.length > 7) return { token: header.slice(7), source: "header" };
  const c = parseCookies(req)[SESSION_COOKIE];
  return c ? { token: c, source: "cookie" } : { token: "", source: null };
}

/** Jeton de renouvellement : cookie dédié, sinon corps JSON (anciennes sessions stockées dans le navigateur). */
export function refreshTokenOf(req: Request): string {
  return parseCookies(req)[REFRESH_COOKIE] || String(req.body?.refresh_token ?? "");
}

const originOf = (u: string): string | null => { try { return new URL(u).origin; } catch { return null; } };
/**
 * Garde CSRF pour les sessions portées par cookie : une requête qui modifie quelque chose doit venir de
 * notre propre origine (en-tête Origin, sinon Referer). SameSite=Lax protège déjà les navigateurs récents ;
 * ceci couvre les autres. Les appels avec Bearer (scripts) ne sont pas concernés.
 */
function sameOrigin(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const src = originOf(String(req.headers.origin ?? "")) ?? originOf(String(req.headers.referer ?? ""));
  if (!src) return true; // ni Origin ni Referer : clients non-navigateur (curl) — le cookie n'y est jamais joint automatiquement
  const allowed = new Set([originOf(config.WEB_BASE_URL), `${req.protocol}://${req.get("host")}`]);
  return allowed.has(src);
}

export const authRequired: RequestHandler = async (req, res, next) => {
  const { token, source } = tokenOf(req);
  if (!token) {
    res.status(401).json({ error: "auth_required" });
    return;
  }
  if (source === "cookie" && !sameOrigin(req)) {
    res.status(403).json({ error: "origine refusée" });
    return;
  }
  const user = await userFromToken(token);
  if (!user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  req.user = user;
  next();
};

export const adminRequired: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "admin_only" });
    return;
  }
  next();
};

// ── Limiteur simple (anti force-brute sur login/signup) ──────
const attempts = new Map<string, number[]>();
export function rateLimit(maxPerWindow: number, windowMs: number, scope: "path" | "ip" = "path"): RequestHandler {
  return (req, res, next) => {
    const key = scope === "ip" ? `ip:${req.ip ?? "?"}` : `${req.path}:${req.ip ?? "?"}`;
    if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.some((t) => Date.now() - t < windowMs)) attempts.delete(k);
    const now = Date.now();
    const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= maxPerWindow) {
      res.status(429).json({ error: "Trop de tentatives — réessaie dans quelques minutes." });
      return;
    }
    list.push(now);
    attempts.set(key, list);
    next();
  };
}

// ── Annuaire des comptes (14 sept. 2026, audit P2) ───────────
// Supabase Auth ne renvoie qu'une page à la fois (1000 max) : ces aides paginent, au lieu de tronquer
// silencieusement au-delà du millième compte.
const PAGE = 1000;
const MAX_PAGES = 50; // 50 000 comptes : bien au-delà du besoin, borne de sécurité

export async function listAllUsers(opts: { max?: number } = {}): Promise<User[]> {
  const max = opts.max ?? PAGE * MAX_PAGES;
  const all: User[] = [];
  for (let page = 1; page <= MAX_PAGES && all.length < max; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`listUsers: ${error.message}`);
    all.push(...data.users);
    if (data.users.length < PAGE) break;
  }
  return all.slice(0, max);
}

/** Compte dont l'adresse correspond (insensible à la casse), quel que soit le nombre de comptes. */
export async function findUserByEmail(email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < PAGE) break;
  }
  return null;
}

/** Comptes par identifiant (membres d'un espace : quelques lectures directes, pas un balayage). */
export async function usersByIds(ids: Iterable<string>): Promise<Map<string, User>> {
  const out = new Map<string, User>();
  const list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const rows = await Promise.all(chunk.map(async (id) => (await supabase.auth.admin.getUserById(id)).data.user ?? null));
    for (const u of rows) if (u) out.set(u.id, u);
  }
  return out;
}

// ── Comptage / bootstrap ─────────────────────────────────────
export async function countUsers(): Promise<number> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return (data as unknown as { total?: number }).total ?? data.users.length;
}

/** Crée le compte admin défini dans .env (ADMIN_EMAIL/ADMIN_PASSWORD) s'il n'existe pas. */
export async function ensureBootstrapAdmin(): Promise<void> {
  const email = config.ADMIN_EMAIL?.trim();
  const password = config.ADMIN_PASSWORD;
  if (!email || !password) return;
  try {
    if (await findUserByEmail(email)) return;
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "Admin", role: "admin" },
    });
    if (error) throw new Error(error.message);
    logger.info("bootstrap_admin_created", { email });
  } catch (err) {
    logger.warn("bootstrap_admin_failed", { err: String((err as Error)?.message ?? err) });
  }
}
