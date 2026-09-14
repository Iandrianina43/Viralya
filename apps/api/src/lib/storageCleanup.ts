import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";
import { storagePathsIn } from "./storage";

// ─────────────────────────────────────────────────────────────
// NETTOYAGE DU STOCKAGE (14 sept. 2026, audit P1) — jusqu'ici rien n'était jamais supprimé.
//   Règle : on ne supprime que ce que PLUS AUCUNE ligne en base ne référence. Les fichiers d'un
//   influenceur ne vivent pas tous sous son préfixe (le portrait est généré sous `<org_id>/faces/` à la
//   création, la photo produit d'une campagne UGC sous l'influenceur qui l'a téléversée) : avant de
//   supprimer, on relit toutes les références encore vivantes et on ne touche qu'à la différence.
//   • suppression d'un influenceur / d'un espace : préfixe `<avatar_id>/` + fichiers qu'il référençait ;
//   • balayage quotidien (scheduler) : sources de clone de plus de 7 jours non utilisées par un contenu
//     en cours ou en attente ;
//   • scripts/storage-cleanup.ts : rapport des préfixes orphelins et purge EXPLICITE.
// ─────────────────────────────────────────────────────────────

const bucket = () => config.SUPABASE_STORAGE_BUCKET;
const ACTIVE_STATUSES = ["queued", "generating", "needs_review", "scheduled"];

export interface StoredFile { path: string; size: number; created_at: string | null }

/** Tous les fichiers sous un préfixe (parcours récursif : les dossiers sont les entrées sans `id`). */
export async function listFilesUnder(prefix: string): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  const folders = [prefix.replace(/\/+$/, "")];
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket()).list(folder, { limit: 1000, offset });
      if (error) throw new Error(`storage list ${folder}: ${error.message}`);
      for (const e of data ?? []) {
        const path = folder ? `${folder}/${e.name}` : e.name;
        if (e.id) out.push({ path, size: Number((e.metadata as { size?: number } | null)?.size ?? 0), created_at: e.created_at ?? null });
        else folders.push(path);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/** Supprime des fichiers par lots ; renvoie le nombre supprimé. */
export async function removePaths(paths: string[]): Promise<number> {
  let n = 0;
  const list = [...new Set(paths)];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(bucket()).remove(chunk);
    if (error) { logger.warn("storage_remove_failed", { count: chunk.length, err: error.message.slice(0, 160) }); continue; }
    n += data?.length ?? 0;
  }
  return n;
}

export async function removePrefix(prefix: string): Promise<number> {
  const files = await listFilesUnder(prefix);
  return files.length ? removePaths(files.map((f) => f.path)) : 0;
}

/** Chemins de stockage encore référencés par une ligne en base (toutes tables qui portent des médias). */
export async function referencedStoragePaths(): Promise<Set<string>> {
  const paths = new Set<string>();
  const add = (v: unknown) => { for (const p of storagePathsIn(v)) paths.add(p); };
  const scan = async (table: string, columns: string, pageSize = 500) => {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
      if (error) { if (!/does not exist|relation|schema cache/i.test(error.message)) logger.warn("storage_scan_failed", { table, err: error.message.slice(0, 120) }); return; }
      for (const row of data ?? []) add(row);
      if (!data || data.length < pageSize) return;
    }
  };
  await scan("avatars", "ref_image_url, character_sheet_url, voice_sample_urls, portrait_spec");
  await scan("avatar_drafts", "*");
  await scan("avatar_references", "url");
  await scan("avatar_wardrobe", "ref_url");
  await scan("avatar_keyframes", "url");
  await scan("avatar_locations", "ref_image_url");
  await scan("content_items", "assets, payload", 200);
  await scan("content_versions", "assets, payload", 200);
  await scan("ugc_campaigns", "product");
  await scan("ugc_variants", "*", 200);
  await scan("social_connections", "picture_url");
  return paths;
}

/** Chemins référencés par un influenceur et ses tables filles (à relever AVANT sa suppression, cascade oblige). */
export async function avatarReferencedPaths(avatarId: string): Promise<Set<string>> {
  const paths = new Set<string>();
  const add = (v: unknown) => { for (const p of storagePathsIn(v)) paths.add(p); };
  const one = async (table: string, columns: string, col = "avatar_id") => {
    const { data } = await supabase.from(table).select(columns).eq(col, avatarId);
    for (const row of data ?? []) add(row);
  };
  await one("avatars", "ref_image_url, character_sheet_url, voice_sample_urls, portrait_spec", "id");
  await one("avatar_references", "url");
  await one("avatar_wardrobe", "ref_url");
  await one("avatar_keyframes", "url");
  await one("avatar_locations", "ref_image_url");
  await one("content_items", "id, assets, payload");
  const { data: items } = await supabase.from("content_items").select("id").eq("avatar_id", avatarId);
  const ids = (items ?? []).map((i) => String(i.id));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("content_versions").select("assets, payload").in("content_item_id", ids.slice(i, i + 200));
    for (const row of data ?? []) add(row);
  }
  return paths;
}

/**
 * Après suppression d'influenceurs (lignes déjà parties) : supprime leurs préfixes et les fichiers qu'ils
 * référençaient, SAUF ce qu'une autre ligne référence encore. Renvoie le nombre de fichiers supprimés.
 */
export async function cleanupDeletedAvatars(snapshots: Array<{ avatarId: string; referenced: Set<string> }>, extraPrefixes: string[] = []): Promise<number> {
  if (!snapshots.length && !extraPrefixes.length) return 0;
  const keep = await referencedStoragePaths();
  const candidates = new Set<string>();
  for (const s of snapshots) {
    for (const f of await listFilesUnder(`${s.avatarId}/`)) candidates.add(f.path);
    for (const p of s.referenced) candidates.add(p);
  }
  // Préfixe de l'espace (`<org_id>/faces/` : portraits générés à la création, avant que l'influenceur existe).
  for (const prefix of extraPrefixes) for (const f of await listFilesUnder(prefix)) candidates.add(f.path);
  const toDelete = [...candidates].filter((p) => !keep.has(p));
  const n = await removePaths(toDelete);
  logger.info("storage_cleanup_avatars", { avatars: snapshots.length, candidates: candidates.size, kept: candidates.size - toDelete.length, deleted: n });
  return n;
}

/** Instantanés des références de tous les influenceurs d'un espace (avant sa suppression). */
export async function snapshotOrgAvatars(orgId: string): Promise<Array<{ avatarId: string; referenced: Set<string> }>> {
  const { data } = await supabase.from("avatars").select("id").eq("org_id", orgId);
  const out: Array<{ avatarId: string; referenced: Set<string> }> = [];
  for (const a of data ?? []) out.push({ avatarId: String(a.id), referenced: await avatarReferencedPaths(String(a.id)) });
  return out;
}

/**
 * Sources de clone (`<avatar>/sources/`) de plus de `days` jours, non utilisées par un contenu en cours
 * ou en attente de validation. Renvoie le nombre de fichiers supprimés.
 */
export async function purgeOldSources(days = 7): Promise<{ deleted: number; bytes: number }> {
  const cutoff = Date.now() - days * 86_400_000;
  const keep = new Set<string>();
  const { data: active } = await supabase.from("content_items").select("payload").in("status", ACTIVE_STATUSES).not("payload->>source_video_url", "is", null);
  for (const row of active ?? []) for (const p of storagePathsIn(row)) keep.add(p);
  const { data: avatars } = await supabase.from("avatars").select("id");
  const victims: StoredFile[] = [];
  for (const a of avatars ?? []) {
    const files = await listFilesUnder(`${a.id}/sources/`).catch(() => [] as StoredFile[]);
    for (const f of files) {
      const created = f.created_at ? Date.parse(f.created_at) : Number.NaN;
      if (Number.isFinite(created) && created < cutoff && !keep.has(f.path)) victims.push(f);
    }
  }
  const deleted = victims.length ? await removePaths(victims.map((f) => f.path)) : 0;
  const bytes = victims.reduce((s, f) => s + f.size, 0);
  if (deleted) logger.info("storage_sources_purged", { deleted, mb: Math.round(bytes / 1e5) / 10, days });
  return { deleted, bytes };
}
