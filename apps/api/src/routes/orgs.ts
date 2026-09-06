import { Router } from "express";
import { invalidateOrgCache, listUserOrgs, type OrgRole } from "../auth/org";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, forbidden, notFound } from "../lib/httpError";
import { supabase } from "../supabase";

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
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2) throw badRequest("Nom d'organisation requis (2 caractères min).");
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
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2) throw badRequest("Nom requis (2 caractères min).");
    const { error } = await supabase.from("organizations").update({ name }).eq("id", orgId);
    if (error) throw new Error(error.message);
    invalidateOrgCache();
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
    const role: OrgRole = req.body?.role === "admin" ? "admin" : "member";
    if (!email) throw badRequest("Email requis.");
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 500 });
    const user = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (!user) throw notFound("Aucun compte avec cet email");
    const { error } = await supabase.from("memberships").upsert({ org_id: orgId, user_id: user.id, role }, { onConflict: "org_id,user_id" });
    if (error) throw new Error(error.message);
    invalidateOrgCache(user.id);
    res.status(201).json({ ok: true });
  }),
);

orgsRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const orgId = String(req.params.id);
    const target = String(req.params.userId);
    await requireOrgRole(req.user!.id, orgId, ["owner", "admin"], req.user!.role === "admin");
    const { data: owners } = await supabase.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "owner");
    if ((owners ?? []).length === 1 && owners![0]!.user_id === target) throw badRequest("Impossible de retirer le dernier propriétaire.");
    const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", target);
    if (error) throw new Error(error.message);
    invalidateOrgCache(target);
    res.status(204).end();
  }),
);
