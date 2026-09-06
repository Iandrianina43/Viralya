import { Router } from "express";
import {
  adminRequired,
  authConfigured,
  authRequired,
  countUsers,
  invalidateToken,
  invalidateUserTokens,
  rateLimit,
  supabaseAuth,
  userFromToken,
} from "../auth/auth";
import { acceptInvites, ensurePersonalOrg, invalidateOrgCache, listUserOrgs } from "../auth/org";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { auditLog } from "../lib/audit";
import { logger } from "../logger";
import { emailConfigured, emailLayout, sendEmail } from "../providers/email";
import { supabase } from "../supabase";

const site = () => config.WEB_BASE_URL.replace(/\/$/, "");

/** Départ d'un utilisateur : ses espaces dont il est le seul propriétaire sont supprimés, ses autres appartenances retirées. */
async function purgeUserData(userId: string): Promise<{ deletedOrgs: number }> {
  const { data: rows } = await supabase.from("memberships").select("org_id, role").eq("user_id", userId);
  let deletedOrgs = 0;
  for (const m of rows ?? []) {
    if (m.role === "owner") {
      const { data: owners } = await supabase.from("memberships").select("user_id").eq("org_id", m.org_id).eq("role", "owner");
      if ((owners ?? []).length <= 1) {
        await supabase.from("organizations").delete().eq("id", m.org_id);
        deletedOrgs++;
        continue;
      }
    }
    await supabase.from("memberships").delete().eq("org_id", m.org_id).eq("user_id", userId);
  }
  invalidateOrgCache();
  return { deletedOrgs };
}

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionPayload(session: { access_token: string; refresh_token?: string; expires_at?: number }, user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  return {
    token: session.access_token,
    refresh_token: session.refresh_token ?? null,
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

    // Le premier compte devient admin plateforme UNIQUEMENT hors production (en prod : ADMIN_EMAIL / ADMIN_PASSWORD).
    const role = config.NODE_ENV !== "production" && (await countUsers()) === 0 ? "admin" : "user";
    const metadata = { name, role, terms_accepted_at: new Date().toISOString() };
    const exists = (e: { message: string; code?: string }) => e.code === "email_exists" || /already|exists|registered/i.test(e.message);

    // Avec un service d'e-mail : le compte est créé NON confirmé et reçoit un lien de confirmation.
    if (emailConfigured()) {
      const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({ type: "signup", email, password, options: { data: metadata, redirectTo: `${site()}/?confirmed=1` } });
      if (linkErr) { res.status(400).json({ error: exists(linkErr) ? "Un compte existe déjà avec cet email." : linkErr.message }); return; }
      const url = link.properties?.action_link;
      if (url) {
        await sendEmail([email], "Confirme ton adresse Viralya", emailLayout("Bienvenue sur Viralya", `<p>Bonjour ${name}, confirme ton adresse e-mail pour activer ton compte.</p>`, { label: "Confirmer mon e-mail", url }))
          .catch((err) => logger.warn("signup_mail_failed", { email, err: String((err as Error)?.message ?? err) }));
      }
      if (link.user) {
        await ensurePersonalOrg({ id: link.user.id, name, email }).catch(() => {});
        await acceptInvites(link.user.id, email).catch(() => {});
      }
      logger.info("user_signup_pending", { email });
      res.status(201).json({ confirm_required: true });
      return;
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // pas de service d'e-mail : compte actif immédiatement
      user_metadata: metadata,
    });
    if (createErr) {
      res.status(400).json({ error: exists(createErr) ? "Un compte existe déjà avec cet email." : createErr.message });
      return;
    }
    // Chaque nouveau compte reçoit son espace (organisation) personnel, plus les invitations en attente.
    if (created?.user) {
      await ensurePersonalOrg({ id: created.user.id, name, email }).catch((err) =>
        logger.warn("personal_org_failed", { email, err: String((err as Error)?.message ?? err) }),
      );
      await acceptInvites(created.user.id, email).catch(() => {});
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
      if (error && /not confirmed/i.test(error.message)) { res.status(403).json({ error: "Confirme d'abord ton adresse e-mail (lien envoyé à l'inscription)." }); return; }
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }
    await acceptInvites(data.user.id, email).catch(() => {});
    res.json(sessionPayload(data.session, data.user));
  }),
);

// ── Rafraîchissement de session (le jeton d'accès Supabase expire en 1 h) ──
authRouter.post(
  "/refresh",
  rateLimit(60, 15 * 60_000),
  asyncHandler(async (req, res) => {
    const refresh = String(req.body?.refresh_token ?? "");
    if (!refresh) { res.status(400).json({ error: "refresh_token requis" }); return; }
    const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refresh });
    if (error || !data.session || !data.user) { res.status(401).json({ error: "session_expired" }); return; }
    res.json(sessionPayload(data.session, data.user));
  }),
);

// ── Déconnexion : révoque la session côté serveur ──
authRouter.post(
  "/logout",
  authRequired,
  asyncHandler(async (req, res) => {
    const token = (req.headers.authorization ?? "").slice(7);
    invalidateToken(token);
    try { await supabase.auth.admin.signOut(token); } catch { /* jeton déjà expiré */ }
    res.status(204).end();
  }),
);

// ── Mot de passe oublié (lien par e-mail, réponse identique que le compte existe ou non) ──
authRouter.post(
  "/forgot-password",
  rateLimit(5, 15 * 60_000),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: "Email invalide." }); return; }
    if (!emailConfigured()) { res.status(400).json({ error: "La réinitialisation par e-mail n'est pas activée : contacte l'administrateur, il peut définir un nouveau mot de passe." }); return; }
    const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${site()}/reset` } });
    if (!error && data.properties?.action_link) {
      await sendEmail([email], "Réinitialise ton mot de passe Viralya", emailLayout("Nouveau mot de passe", "<p>Clique sur le bouton pour choisir un nouveau mot de passe. Le lien expire rapidement ; si tu n'es pas à l'origine de cette demande, ignore cet e-mail.</p>", { label: "Choisir un nouveau mot de passe", url: data.properties.action_link }))
        .catch((err) => logger.warn("recovery_mail_failed", { email, err: String((err as Error)?.message ?? err) }));
    }
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/reset-password",
  rateLimit(10, 15 * 60_000),
  asyncHandler(async (req, res) => {
    const accessToken = String(req.body?.access_token ?? "");
    const next = String(req.body?.new_password ?? "");
    if (next.length < 8) { res.status(400).json({ error: "Mot de passe : 8 caractères minimum." }); return; }
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) { res.status(401).json({ error: "Lien invalide ou expiré : refais une demande." }); return; }
    const { error: upErr } = await supabase.auth.admin.updateUserById(data.user.id, { password: next });
    if (upErr) throw new Error(upErr.message);
    invalidateUserTokens(data.user.id);
    logger.info("password_reset", { userId: data.user.id });
    res.json({ ok: true });
  }),
);

// ── Configuration publique (page de connexion) ──
authRouter.get("/public-config", (_req, res) => {
  res.json({ signup_open: config.ALLOW_SIGNUP, email_configured: emailConfigured(), legal_editor: config.LEGAL_EDITOR ?? null });
});

// ── Suppression de son propre compte (RGPD) : mot de passe exigé ──
authRouter.delete(
  "/me",
  authRequired,
  rateLimit(5, 15 * 60_000),
  asyncHandler(async (req, res) => {
    const password = String(req.body?.password ?? "");
    const { error: verifyErr } = await supabaseAuth.auth.signInWithPassword({ email: req.user!.email, password });
    if (verifyErr) { res.status(401).json({ error: "Mot de passe incorrect." }); return; }
    const purge = await purgeUserData(req.user!.id);
    const { error } = await supabase.auth.admin.deleteUser(req.user!.id);
    if (error) throw new Error(error.message);
    invalidateUserTokens(req.user!.id);
    await auditLog("account_deleted", { userId: req.user!.id, details: { email: req.user!.email, deletedOrgs: purge.deletedOrgs } });
    res.status(204).end();
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
    const { data: current } = await supabase.auth.admin.getUserById(req.user!.id);
    const { error } = await supabase.auth.admin.updateUserById(req.user!.id, {
      user_metadata: { ...(current?.user?.user_metadata ?? {}), name, role: req.user!.role },
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
    // Les autres sessions (autres appareils) tombent ; celle-ci reste valide.
    invalidateUserTokens(req.user!.id);
    try { await supabase.auth.admin.signOut((req.headers.authorization ?? "").slice(7), "others"); } catch { /* ignoré */ }
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
    // Nouveau mot de passe défini par l'admin (dépannage sans service d'e-mail).
    if (typeof req.body?.password === "string" && req.body.password.length >= 8) patch.password = req.body.password;
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Rien à modifier." }); return; }
    const { error } = await supabase.auth.admin.updateUserById(id, patch);
    if (error) throw new Error(error.message);
    invalidateUserTokens(id); // effet immédiat (bannissement, rôle, mot de passe)
    await auditLog("user_admin_update", { userId: req.user!.id, details: { target: id, keys: Object.keys(patch) } });
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
    const purge = await purgeUserData(id);
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
    invalidateUserTokens(id);
    await auditLog("user_admin_deleted", { userId: req.user!.id, details: { target: id, deletedOrgs: purge.deletedOrgs } });
    res.status(204).end();
  }),
);
