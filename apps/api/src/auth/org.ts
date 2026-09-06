import type { RequestHandler } from "express";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Organisation active (tenant). Résolution à chaque requête :
//  - en-tête x-org-id si l'utilisateur en est membre (ou admin plateforme) ;
//  - sinon sa première organisation ;
//  - sans aucune organisation → création d'un espace personnel.
// Les appartenances sont mises en cache 60 s.
// ─────────────────────────────────────────────────────────────

export type OrgRole = "owner" | "admin" | "member";
export interface OrgContext {
  id: string;
  name: string;
  role: OrgRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      org?: OrgContext;
    }
  }
}

const cache = new Map<string, { orgs: OrgContext[]; exp: number }>();

export function invalidateOrgCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

function toRole(v: unknown): OrgRole {
  return v === "owner" || v === "admin" ? v : "member";
}

export async function listUserOrgs(userId: string): Promise<OrgContext[]> {
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.orgs;
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, created_at, organizations(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`memberships: ${error.message}`);
  const orgs: OrgContext[] = (data ?? []).map((r: any) => ({
    id: String(r.org_id),
    name: String(r.organizations?.name ?? "Organisation"),
    role: toRole(r.role),
  }));
  // TTL court : une invitation ajoutée depuis un autre processus (worker, SQL) devient visible vite.
  cache.set(userId, { orgs, exp: Date.now() + 15_000 });
  return orgs;
}

/** Crée l'espace personnel d'un utilisateur s'il n'appartient à aucune organisation. */
export async function ensurePersonalOrg(user: { id: string; name?: string; email?: string }): Promise<OrgContext> {
  const existing = await listUserOrgs(user.id);
  if (existing.length) return existing[0]!;
  const label = user.name?.trim() || user.email?.split("@")[0] || "Mon espace";
  const { data: org, error } = await supabase
    .from("organizations")
    .insert({ name: `Espace de ${label}`, created_by: user.id })
    .select("id, name")
    .single();
  if (error || !org) throw new Error(`org create: ${error?.message ?? ""}`);
  const { error: mErr } = await supabase.from("memberships").insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (mErr) throw new Error(`membership create: ${mErr.message}`);
  invalidateOrgCache(user.id);
  logger.info("personal_org_created", { userId: user.id, orgId: org.id });
  return { id: String(org.id), name: String(org.name), role: "owner" };
}

export const orgRequired: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return;
    }
    let orgs = await listUserOrgs(user.id);
    if (orgs.length === 0) orgs = [await ensurePersonalOrg(user)];

    const wanted = String(req.header("x-org-id") ?? "").trim();
    let org = wanted ? orgs.find((o) => o.id === wanted) : orgs[0];

    // Admin plateforme : peut ouvrir n'importe quelle organisation (support).
    if (!org && wanted && user.role === "admin") {
      const { data } = await supabase.from("organizations").select("id, name").eq("id", wanted).maybeSingle();
      if (data) org = { id: String(data.id), name: String(data.name), role: "owner" };
    }
    if (!org) {
      res.status(403).json({ error: "Organisation inaccessible." });
      return;
    }
    req.org = org;
    next();
  } catch (err) {
    next(err);
  }
};
