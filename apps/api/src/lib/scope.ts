import { supabase } from "../supabase";
import { HttpError } from "./httpError";

// ─────────────────────────────────────────────────────────────
// Isolation multi-tenant : chaque lecture d'un influenceur ou d'un contenu
// passe par ici et vérifie l'appartenance à l'organisation active (req.org).
// Aucune route ne doit charger un avatar par id sans ce filtre.
// ─────────────────────────────────────────────────────────────

type Row = Record<string, any>;

/** Charge un influenceur de l'organisation, sinon 404. */
export async function requireAvatar<T = Row>(orgId: string, avatarId: string, select = "*"): Promise<T> {
  const { data, error } = await supabase.from("avatars").select(select).eq("id", avatarId).eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`avatar load: ${error.message}`);
  if (!data) throw new HttpError(404, "Influenceur introuvable");
  return data as unknown as T;
}

/** Charge un contenu dont l'influenceur appartient à l'organisation, sinon 404. */
export async function requireContentItem<T = Row>(orgId: string, itemId: string, select = "*"): Promise<T> {
  const { data, error } = await supabase
    .from("content_items")
    .select(`${select}, avatars!inner(org_id)`)
    .eq("id", itemId)
    .eq("avatars.org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`content load: ${error.message}`);
  if (!data) throw new HttpError(404, "Contenu introuvable");
  const { avatars: _join, ...row } = data as Row;
  return row as T;
}

/** Ids des influenceurs de l'organisation (pour les requêtes agrégées). */
export async function orgAvatarIds(orgId: string): Promise<string[]> {
  const { data, error } = await supabase.from("avatars").select("id").eq("org_id", orgId);
  if (error) throw new Error(`avatars of org: ${error.message}`);
  return (data ?? []).map((a) => String(a.id));
}
