import { supabase } from "../supabase";
import { HttpError } from "./httpError";

// ─────────────────────────────────────────────────────────────
// Versions de contenu : instantané (payload + assets + statut) pris à chaque
// génération terminée, avant chaque régénération et avant chaque retour arrière.
// L'utilisateur peut revenir à n'importe quelle version.
// ─────────────────────────────────────────────────────────────

export interface ContentVersion {
  id: string;
  content_item_id: string;
  version_no: number;
  status: string | null;
  payload: Record<string, unknown>;
  assets: Record<string, unknown>;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

async function loadItem(itemId: string) {
  const { data, error } = await supabase.from("content_items").select("id, status, payload, assets, current_version").eq("id", itemId).single();
  if (error || !data) throw new Error(`content_item ${itemId} introuvable`);
  return data as { id: string; status: string; payload: Record<string, unknown>; assets: Record<string, unknown>; current_version: number };
}

/** Fige l'état courant du contenu dans une nouvelle version. Renvoie son numéro. */
export async function snapshotVersion(itemId: string, note: string, createdBy?: string | null): Promise<number> {
  const item = await loadItem(itemId);
  const hasSomething = Object.keys(item.payload ?? {}).length > 0 || Object.keys(item.assets ?? {}).length > 0;
  if (!hasSomething) return item.current_version ?? 0;
  const next = (item.current_version ?? 0) + 1;
  const { error } = await supabase.from("content_versions").insert({
    content_item_id: itemId,
    version_no: next,
    status: item.status,
    payload: item.payload ?? {},
    assets: item.assets ?? {},
    note: note.slice(0, 200),
    created_by: createdBy ?? null,
  });
  if (error) throw new Error(`version insert: ${error.message}`);
  await supabase.from("content_items").update({ current_version: next }).eq("id", itemId);
  return next;
}

export async function listVersions(itemId: string): Promise<ContentVersion[]> {
  const { data, error } = await supabase
    .from("content_versions")
    .select("*")
    .eq("content_item_id", itemId)
    .order("version_no", { ascending: false });
  if (error) throw new Error(`versions list: ${error.message}`);
  return (data ?? []) as ContentVersion[];
}

/** Restaure une version : l'état courant est d'abord figé, puis remplacé. */
export async function restoreVersion(itemId: string, versionNo: number, userId?: string | null): Promise<number> {
  const { data: v } = await supabase
    .from("content_versions")
    .select("*")
    .eq("content_item_id", itemId)
    .eq("version_no", versionNo)
    .maybeSingle();
  if (!v) throw new HttpError(404, `Version ${versionNo} introuvable`);
  const current = await snapshotVersion(itemId, `Avant retour à la version ${versionNo}`, userId);
  const assets = (v.assets ?? {}) as Record<string, unknown>;
  const restoredStatus = assets.video_url || (Array.isArray(assets.image_urls) && assets.image_urls.length) ? "needs_review" : String(v.status ?? "needs_review");
  const { error } = await supabase
    .from("content_items")
    .update({ payload: v.payload ?? {}, assets, status: restoredStatus, error: null })
    .eq("id", itemId);
  if (error) throw new Error(`version restore: ${error.message}`);
  return current;
}
