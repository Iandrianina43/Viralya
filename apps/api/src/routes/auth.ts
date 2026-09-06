import { Router } from "express";
import {
  adminRequired,
  authConfigured,
  authRequired,
  countUsers,
  invalidateToken,
  rateLimit,
  supabaseAuth,
  userFromToken,
} from "../auth/auth";
import { ensurePersonalOrg, listUserOrgs } from "../auth/org";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../logger";
import { supabase } from "../supabase";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionPayload(session: { access_token: string; expires_at?: number }, user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  return {
    token: session.access_token,
    expires_at: session.expires_at ?? null,
    user: {
      id: user.id,
      email: user.email ?? "",
      name: String(user.user_metadata?.name ?? ""),
      role: user.user_metadata?.role === "admin" ? "admin" : "user",
    },
  };
}

// ── Inscription ──────────────────────────────────────────────
// Le premier compte créé devient automatiquement administrateur.
authRouter.post(
  "/signup",
  rateLimit(8, 15 * 60_000),
  asyncHandler(async (req, res) => {
    if (!authConfigured()) { res.status(500).json({ error: "Auth non configurée (SUPABASE_ANON_KEY manquante)" }); return; }
    if (!config.ALLOW_SIGNUP) { res.status(403).json({ error: "Les inscriptions sont fermées." }); return; }

    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (name.length < 2) { res.status(400).json({ error: "Nom requis (2 caractères min)." }); return; }
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: "Email invalide." }); return; }
    if (password.length < 8) { res.status(400).json({ error: "Mot de passe : 8 caractères minimum." }); return; }
    // Conditions d'utilisation et politique de confidentialité (pages /cgu et /confidentialite).
    if (req.body?.terms !== true) { res.status(400).json({ error: "Tu dois accepter les conditions d'utilisation." }); return; }

    const role = (await countUsers()) === 0 ? "admin" : "user";
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // pas de SMTP requis
      user_metadata: { name, role, terms_accepted_at: new Date().toISOString() },
    });
    if (createErr) {
      const msg = /already/i.test(createErr.message) ? "Un compte existe déjà avec cet email." : createErr.message;
      res.status(400).json({ error: msg });
      return;
    }
    // Chaque nouveau compte reçoit son espace (organisation) personnel.
    if (created?.user) {
      await ensurePersonalOrg({ id: created.user.id, name, email }).catch((err) =>
        logger.warn("personal_org_failed", { email, err: String((err as Error)?.message ?? err) }),
      );
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) { res.status(500).json({ error: "Compte créé mais connexion impossible — connecte-toi." }); return; }
    logger.info("user_signup", { email, role });
    res.status(201).json(sessionPayload(data.session, data.user));
  }),
);

// ── Connexion ────────────────────────────────────────────────
authRouter.post(
  "/login",
  rateLimit(10, 15 * 60_000),
  asyncHandler(async (req, res) => {
    if (!authConfigured()) { res.status(500).json({ error: "Auth non configurée (SUPABASE_ANON_KEY manquante)" }); return; }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }
    res.json(sessionPayload(data.session, data.user));
  }),
);

// ── Session courante ─────────────────────────────────────────
authRouter.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    let orgs = await listUserOrgs(req.user!.id);
    if (orgs.length === 0) orgs = [await ensurePersonalOrg(req.user!)];
    res.json({ user: req.user, orgs });
  }),
);

// ── Profil (nom) ─────────────────────────────────────────────
authRouter.put(
  "/profile",
  authRequired,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2) { res.status(400).json({ error: "Nom requis (2 caractères min)." }); return; }
    const { error } = await supabase.auth.admin.updateUserById(req.user!.id, {
      user_metadata: { name, role: req.user!.role },
    });
    if (error) throw new Error(error.message);
    const token = (req.headers.authorization ?? "").slice(7);
    invalidateToken(token);
    res.json({ ok: true, user: { ...req.user!, name } });
  }),
);

// ── Changement de mot de passe ───────────────────────────────
authRouter.post(
  "/change-password",
  authRequired,
  rateLimit(10, 15 * 60_000),
  asyncHandler(async (req, res) => {
    const current = String(req.body?.current_password ?? "");
    const next = String(req.body?.new_password ?? "");
    if (next.length < 8) { res.status(400).json({ error: "Nouveau mot de passe : 8 caractères minimum." }); return; }
    // Vérifie l'ancien mot de passe avant de changer.
    const { error: verifyErr } = await supabaseAuth.auth.signInWithPassword({ email: req.user!.email, password: current });
    if (verifyErr) { res.status(401).json({ error: "Mot de passe actuel incorrect." }); return; }
    const { error } = await supabase.auth.admin.updateUserById(req.user!.id, { password: next });
    if (error) throw new Error(error.message);
    logger.info("password_changed", { userId: req.user!.id });
    res.json({ ok: true });
  }),
);

// ── Administration des utilisateurs (admin uniquement) ───────
authRouter.get(
  "/admin/users",
  authRequired,
  adminRequired,
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    res.json({
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        name: String(u.user_metadata?.name ?? ""),
        role: u.user_metadata?.role === "admin" ? "admin" : "user",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned: !!(u as unknown as { banned_until?: string }).banned_until && new Date((u as unknown as { banned_until: string }).banned_until) > new Date(),
      })),
      signup_open: config.ALLOW_SIGNUP,
    });
  }),
);

authRouter.put(
  "/admin/users/:id",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user!.id && (req.body?.role === "user" || req.body?.banned === true)) {
      res.status(400).json({ error: "Impossible de te rétrograder ou te bannir toi-même." });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (req.body?.role === "admin" || req.body?.role === "user") {
      const { data: current } = await supabase.auth.admin.getUserById(id);
      patch.user_metadata = { ...(current?.user?.user_metadata ?? {}), role: req.body.role };
    }
    if (typeof req.body?.banned === "boolean") {
      patch.ban_duration = req.body.banned ? "876000h" : "none"; // ~100 ans / lever le ban
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Rien à modifier." }); return; }
    const { error } = await supabase.auth.admin.updateUserById(id, patch);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  }),
);

authRouter.delete(
  "/admin/users/:id",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user!.id) { res.status(400).json({ error: "Impossible de supprimer ton propre compte." }); return; }
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
    res.status(204).end();
  }),
);
