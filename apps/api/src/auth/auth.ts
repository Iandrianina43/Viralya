import { createClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";
import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Authentification — Supabase Auth (email + mot de passe).
//  - login/signup côté serveur (le front ne parle jamais à Supabase directement)
//  - session = access_token (Bearer) vérifié à chaque requête (cache 5 min)
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

export const authRequired: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "auth_required" });
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
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (data.users.some((u) => (u.email ?? "").toLowerCase() === email.toLowerCase())) return;
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
