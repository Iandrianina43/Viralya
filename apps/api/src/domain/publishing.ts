import { logger } from "../logger";
import type { PublishResult } from "../providers/publisher";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// PUBLICATION RÉELLE — état d'un contenu chez le fournisseur (Zernio), partagé par le job `publish`
// et par le webhook. Règle : jamais de faux « publié » ; un échec laisse le contenu en « scheduled »
// avec l'erreur, une publication en cours garde `payload.publish_state = "publishing"`.
// ─────────────────────────────────────────────────────────────

export interface ConnectionRow {
  id: string;
  org_id: string;
  avatar_id: string | null;
  provider: "zernio" | "ayrshare" | "simulated";
  profile_key: string | null;
  networks: string[];
  display_name: string | null;
  status: "active" | "disabled" | "error";
  meta: Record<string, unknown>;
  external_account_id?: string | null;
  handle?: string | null;
  profile_url?: string | null;
  picture_url?: string | null;
  followers?: number | null;
  last_synced_at?: string | null;
  consent?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

/** Connexion réelle active de l'influenceur sur un réseau (null si aucune, ou si la migration 0019 manque). */
export async function activeConnection(avatarId: string, network: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from("social_connections")
    .select("*")
    .eq("avatar_id", avatarId)
    .eq("provider", "zernio")
    .eq("status", "active")
    .contains("networks", [network])
    .not("external_account_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logger.warn("active_connection_query_failed", { err: error.message.slice(0, 160) });
    return null;
  }
  return (data?.[0] as ConnectionRow | undefined) ?? null;
}

const ZERO = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers_gained: 0 };
const STATS_SCHEDULE_HOURS = [1, 6, 24, 72, 168]; // docs/RECHERCHE-PUBLICATION.md (Instagram : jusqu'à 48 h de retard)

function withoutPublishState(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const p = { ...(payload ?? {}) };
  delete p.publish_state;
  return p;
}

/** Publication soumise, en cours chez le fournisseur. */
export async function markPublishing(itemId: string, provider: string, postId: string): Promise<void> {
  const { data: item } = await supabase.from("content_items").select("payload").eq("id", itemId).maybeSingle();
  await supabase
    .from("content_items")
    .update({ publish_provider: provider, external_post_id: postId, error: null, payload: { ...((item?.payload as Record<string, unknown>) ?? {}), publish_state: "publishing" } })
    .eq("id", itemId);
}

/** Publication confirmée : statut publié, identifiants externes, remontée des statistiques planifiée. Idempotent. */
export async function finalizeRealPublish(itemId: string, provider: string, r: Pick<PublishResult, "postId" | "url" | "platformPostId">): Promise<void> {
  const { data: item } = await supabase.from("content_items").select("id, status, avatar_id, stats, payload, external_url, external_post_id").eq("id", itemId).maybeSingle();
  if (!item) return;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    publish_provider: provider,
    external_post_id: r.postId ?? item.external_post_id ?? null,
    external_url: r.url ?? item.external_url ?? null,
    error: null,
    payload: { ...withoutPublishState(item.payload as Record<string, unknown>), ...(r.platformPostId ? { platform_post_id: r.platformPostId } : {}) },
  };
  const first = item.status !== "published";
  if (first) {
    patch.status = "published";
    patch.published_at = now;
    patch.stats = { ...((item.stats as Record<string, unknown>) ?? {}), real: { ...ZERO } };
  }
  const { error } = await supabase.from("content_items").update(patch).eq("id", itemId);
  if (error) throw new Error(`finalize publish: ${error.message}`);
  if (!first) return;
  await supabase.from("plan_entries").update({ status: "published", updated_at: now }).eq("content_item_id", itemId);
  logger.info("content_published_real", { itemId, provider, externalId: r.postId, url: r.url });
  for (const h of STATS_SCHEDULE_HOURS) {
    await enqueue("sync_stats", { avatar_id: item.avatar_id }, { avatarId: String(item.avatar_id), runAfterMs: h * 3_600_000, label: `Statistiques +${h} h` }).catch(() => {});
  }
}

/** Échec chez le fournisseur : l'erreur est visible, le statut reste « scheduled » (relance possible). */
export async function failRealPublish(itemId: string, provider: string, message: string, postId?: string | null): Promise<void> {
  const { data: item } = await supabase.from("content_items").select("payload, status").eq("id", itemId).maybeSingle();
  if (!item || item.status === "published") return;
  await supabase
    .from("content_items")
    .update({
      error: `Publication réelle échouée : ${message.slice(0, 280)}`,
      publish_provider: provider,
      ...(postId ? { external_post_id: postId } : {}),
      payload: withoutPublishState(item.payload as Record<string, unknown>),
    })
    .eq("id", itemId);
  logger.warn("publish_real_failed", { itemId, provider, err: message.slice(0, 200) });
}

/** Lien public arrivé après coup (TikTok livre l'URL de manière asynchrone). */
export async function setExternalUrl(itemId: string, url: string): Promise<void> {
  await supabase.from("content_items").update({ external_url: url }).eq("id", itemId);
}

/** Contenu Viralya correspondant à une publication du fournisseur (métadonnées renvoyées, sinon identifiant externe). */
export async function findItemForPost(provider: string, postId: string, metadata?: Record<string, unknown> | null): Promise<{ id: string; status: string; network: string } | null> {
  const metaId = typeof metadata?.viralya_content_id === "string" ? metadata.viralya_content_id : null;
  if (metaId) {
    const { data } = await supabase.from("content_items").select("id, status, network").eq("id", metaId).maybeSingle();
    if (data) return data as { id: string; status: string; network: string };
  }
  const { data } = await supabase.from("content_items").select("id, status, network").eq("publish_provider", provider).eq("external_post_id", postId).limit(1);
  return (data?.[0] as { id: string; status: string; network: string } | undefined) ?? null;
}
