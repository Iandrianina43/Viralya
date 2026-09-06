import { randomBytes } from "node:crypto";
import { Router } from "express";
import { invalidateOrgCache, listUserOrgs, type OrgRole } from "../auth/org";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { auditLog } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/httpError";
import { emailConfigured, emailLayout, sendEmail } from "../providers/email";
import { supabase } from "../supabase";

/** Nom d'espace : 2 à 60 caractères, sans caractères de contrôle. */
function cleanName(raw: unknown): string {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  if (name.length < 2) throw badRequest("Nom requis (2 caractères min).");
  return name;
}

async function isOrgOwner(userId: string, orgId: string, platformAdmin: boolean): Promise<boolean> {
  if (platformAdmin) return true;
  return (await listUserOrgs(userId)).find((o) => o.id === orgId)?.role === "owner";
}

// Organisations de l'utilisateur connecté : liste, création, membres.
export const orgsRouter = Router();

async function requireOrgRole(userId: string, orgId: string, roles: OrgRole[], platformAdmin: boolean) {
  if (platformAdmin) return;
  const orgs = await listUserOrgs(userId);
  const mine = orgs.find((o) => o.id === orgId);
  if (!mine) throw notFound("Organisation");
  if (!roles.includes(mine.role)) throw forbidden("Réservé aux propriétaires de l'organisation.");
}

orgsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ orgs: await listUserOrgs(req.user!.id) });
  }),
);

orgsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = cleanName(req.body?.name);
    // Quota : un espace neuf repart avec le budget par défaut ; sans plafond, créer des espaces = budget infini.
    const { count } = await supabase.from("organizations").select("id", { count: "exact", head: true }).eq("created_by", req.user!.id);
    if ((count ?? 0) >= config.MAX_ORGS_PER_USER && req.user!.role !== "admin") throw badRequest(`Limite de ${config.MAX_ORGS_PER_USER} espaces par compte atteinte.`);
    const { data: org, error } = await supabase.from("organizations").insert({ name, created_by: req.user!.id }).select("id, name").single();
    if (error || !org) throw new Error(`org create: ${error?.message ?? ""}`);
    const { error: mErr } = await supabase.from("memberships").insert({ org_id: org.id, user_id: req.user!.id, role: "owner" });
    if (mErr) throw new Error(mErr.message);
    invalidateOrgCache(req.user!.id);
    res.status(201).json({ org: { id: org.id, name: org.name, role: "owner" } });
  }),
);

orgsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    const name = cleanName(req.body?.name);
    const { error } = await supabase.from("organizations").update({ name }).eq("id", orgId);
    if (error) throw new Error(error.message);
    invalidateOrgCache();
    await auditLog("org_renamed", { orgId, userId: req.user!.id, details: { name } });
    res.json({ ok: true });
  }),
);

orgsRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin", "member"], req.user!.role === "admin");
    const [{ data: rows, error }, { data: users }] = await Promise.all([
      supabase.from("memberships").select("user_id, role, created_at").eq("org_id", orgId),
      supabase.auth.admin.listUsers({ page: 1, perPage: 500 }),
    ]);
    if (error) throw new Error(error.message);
    const byId = new Map((users?.users ?? []).map((u) => [u.id, u]));
    res.json({
      members: (rows ?? []).map((m) => {
        const u = byId.get(String(m.user_id));
        return { user_id: m.user_id, role: m.role, created_at: m.created_at, email: u?.email ?? "", name: String(u?.user_metadata?.name ?? "") };
      }),
    });
  }),
);

orgsRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Email invalide.");
    const callerOwner = await isOrgOwner(req.user!.id, orgId, req.user!.role === "admin");
    // Le rôle « propriétaire » ne se donne qu'entre propriétaires (transfert) ; un admin d'espace ne peut
    // ni promouvoir ni rétrograder un propriétaire (audit du 7 sept. : prise de contrôle silencieuse).
    const wanted = String(req.body?.role ?? "member");
    if (wanted === "owner" && !callerOwner) throw forbidden("Seul un propriétaire peut nommer un propriétaire.");
    const role: OrgRole = wanted === "owner" ? "owner" : wanted === "admin" ? "admin" : "member";
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (!user) {
      if (!emailConfigured()) throw notFound("Aucun compte avec cet email — la personne doit d'abord créer son compte (l'envoi d'invitations par e-mail n'est pas activé)");
      // Invitation : la personne crée son compte avec cette adresse et rejoint l'espace automatiquement.
      const token = randomBytes(24).toString("hex");
      const { error: invErr } = await supabase.from("org_invites").insert({ org_id: orgId, email, role: role === "owner" ? "admin" : role, token, invited_by: req.user!.id });
      if (invErr) throw new Error(/org_invites/.test(invErr.message) ? "Applique la migration 0018 pour activer les invitations." : invErr.message);
      const { data: orgRow } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      const site = config.WEB_BASE_URL.replace(/\/$/, "");
      await sendEmail([email], `Invitation à rejoindre ${orgRow?.name ?? "un espace"} sur Viralya`, emailLayout(
        `${req.user!.name || req.user!.email} t'invite sur Viralya`,
        `<p>Tu es invité·e à rejoindre l'espace <strong>${orgRow?.name ?? ""}</strong>. Crée ton compte avec cette adresse (${email}) et tu y auras accès immédiatement.</p>`,
        { label: "Créer mon compte", url: `${site}/?invite=${token}&email=${encodeURIComponent(email)}` },
      ));
      await auditLog("member_invited", { orgId, userId: req.user!.id, details: { email, role } });
      res.status(201).json({ ok: true, invited: true });
      return;
    }
    const { data: existing } = await supabase.from("memberships").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (existing?.role === "owner" && !callerOwner) throw forbidden("Seul un propriétaire peut modifier un autre propriétaire.");
    const { error } = await supabase.from("memberships").upsert({ org_id: orgId, user_id: user.id, role }, { onConflict: "org_id,user_id" });
    if (error) throw new Error(error.message);
    invalidateOrgCache(user.id);
    await auditLog(existing ? "member_role_changed" : "member_added", { orgId, userId: req.user!.id, details: { target: user.id, email, role } });
    res.status(201).json({ ok: true, invited: false });
  }),
);

orgsRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    const target = String(req.params.userId);
    const self = target === req.user!.id;
    // Quitter l'espace (soi-même) est ouvert à tout membre ; retirer quelqu'un d'autre demande owner/admin.
    if (!self) await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    const { data: owners } = await supabase.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "owner");
    if ((owners ?? []).length === 1 && owners![0]!.user_id === target) throw badRequest(self ? "Tu es le dernier propriétaire : nomme un autre propriétaire ou supprime l'espace." : "Impossible de retirer le dernier propriétaire.");
    if (!self && (owners ?? []).some((o) => o.user_id === target) && !(await isOrgOwner(req.user!.id, orgId, req.user!.role === "admin"))) throw forbidden("Seul un propriétaire peut retirer un propriétaire.");
    const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", target);
    if (error) throw new Error(error.message);
    invalidateOrgCache(target);
    await auditLog(self ? "member_left" : "member_removed", { orgId, userId: req.user!.id, details: { target } });
    res.status(204).end();
  }),
);

// Invitations en attente (owner/admin) et annulation.
orgsRouter.get(
  "/:id/invites",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    const { data } = await supabase.from("org_invites").select("id, email, role, expires_at, created_at").eq("org_id", orgId).is("accepted_at", null).order("created_at", { ascending: false });
    res.json({ invites: data ?? [] });
  }),
);

orgsRouter.delete(
  "/:id/invites/:inviteId",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    await supabase.from("org_invites").delete().eq("org_id", orgId).eq("id", String(req.params.inviteId));
    res.status(204).end();
  }),
);

// Suppression d'un espace (propriétaire) : le nom doit être retapé ; tout son contenu part avec lui.
orgsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    if (!(await isOrgOwner(req.user!.id, orgId, req.user!.role === "admin"))) throw forbidden("Réservé au propriétaire de l'espace.");
    const { data: org } = await supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
    if (!org) throw notFound("Organisation");
    if (String(req.body?.confirm ?? "").trim().toLowerCase() !== String(org.name).trim().toLowerCase()) throw badRequest("Retape le nom exact de l'espace pour confirmer.");
    const { error } = await supabase.from("organizations").delete().eq("id", orgId);
    if (error) throw new Error(error.message);
    invalidateOrgCache();
    await auditLog("org_deleted", { orgId, userId: req.user!.id, details: { name: org.name } });
    res.status(204).end();
  }),
);
