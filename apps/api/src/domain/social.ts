import { logger } from "../logger";
import { generateText } from "../providers/llm";
import { supabase } from "../supabase";
import { activeConnection } from "./publishing";

// ─────────────────────────────────────────────────────────────
// COMPTE SOCIAL SIMULÉ (BRIEF § 9) — chaque influenceur a son profil par réseau
// (handle, bio, audience), son feed (contenus publiés) et des statistiques.
// Simulation : audience de départ + effet de chaque publication, déterministe (graine =
// id du contenu) et qui « monte » dans le temps (courbe logarithmique sur 72 h) — le
// compte vit, sans nombres aléatoires qui changent à chaque affichage.
// Quand une connexion réelle existe (phase 4), les statistiques réelles remplacent la simulation.
// ─────────────────────────────────────────────────────────────

export type SocialNetwork = "instagram" | "tiktok" | "youtube" | "x" | "facebook";

export interface SocialProfile {
  id: string;
  avatar_id: string;
  network: SocialNetwork;
  handle: string;
  display_name: string;
  bio: string;
  link: string | null;
  base_followers: number;
  following: number;
  created_at: string;
}

export interface PostStats { views: number; likes: number; comments: number; shares: number; saves: number; followers_gained: number }

export interface SocialPost {
  id: string;
  type: string;
  network: string;
  title: string | null;
  caption: string;
  hashtags: string[];
  published_at: string | null;
  scheduled_at: string | null;
  status: string;
  cover_url: string | null;
  video_url: string | null;
  image_urls: string[];
  stats: PostStats;
  real: boolean;
  ai_label: boolean;
  external_url: string | null;
}

// ── PRNG déterministe (mulberry32) ────────────────────────────
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 18);

/** Statistiques FINALES simulées d'un contenu (atteintes après ≈ 72 h). */
export function simulateFinalStats(itemId: string, type: string, followers: number, ratioClass: string): PostStats {
  const r = rng(seedFrom(itemId));
  const base = Math.max(300, followers);
  // Portée : les vidéos dépassent l'audience (Reels/TikTok), les photos restent proches de l'audience.
  const reach = type === "video" ? between(r, 1.2, 5.5) : type === "carousel" ? between(r, 0.6, 1.6) : type === "story" ? between(r, 0.25, 0.6) : between(r, 0.45, 1.3);
  const salePenalty = ratioClass === "sale" ? 0.7 : 1;
  const views = Math.round(base * reach * salePenalty);
  const likeRate = type === "video" ? between(r, 0.035, 0.09) : between(r, 0.06, 0.13);
  const likes = Math.round(views * likeRate);
  const comments = Math.round(likes * between(r, 0.015, 0.06));
  const shares = Math.round(views * (type === "video" ? between(r, 0.006, 0.02) : between(r, 0.002, 0.008)));
  const saves = Math.round(views * (type === "carousel" ? between(r, 0.03, 0.07) : between(r, 0.008, 0.025)));
  const followers_gained = Math.round(views * between(r, 0.0015, 0.006));
  return { views, likes, comments, shares, saves, followers_gained };
}

/** Progression dans le temps : part des statistiques finales atteinte `hours` heures après publication. */
export function growthFactor(hours: number): number {
  if (hours <= 0) return 0.03;
  return Math.min(1, Math.log1p(hours) / Math.log1p(72));
}

export function statsNow(final: PostStats, publishedAt: string | null): PostStats {
  const hours = publishedAt ? (Date.now() - Date.parse(publishedAt)) / 3_600_000 : 0;
  const f = growthFactor(hours);
  const scale = (n: number) => Math.round(n * f);
  return { views: scale(final.views), likes: scale(final.likes), comments: scale(final.comments), shares: scale(final.shares), saves: scale(final.saves), followers_gained: scale(final.followers_gained) };
}

const BIO_SYSTEM = `Tu écris la bio Instagram/TikTok d'un influenceur (FR, 2 lignes max, 120 caractères, 1-2 emojis, pas de hashtag, pas de « bienvenue »). Réponds UNIQUEMENT par la bio.`;

/** Profil de l'influenceur sur un réseau, créé au premier accès (handle, bio, audience de départ). */
export async function ensureProfile(avatarId: string, network: SocialNetwork): Promise<SocialProfile> {
  const { data: existing } = await supabase.from("social_profiles").select("*").eq("avatar_id", avatarId).eq("network", network).maybeSingle();
  if (existing) return existing as SocialProfile;
  const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, system_prompt").eq("id", avatarId).single();
  if (!avatar) throw new Error("avatar introuvable");
  const r = rng(seedFrom(`${avatarId}:${network}`));
  const handle = `${slug(String(avatar.name))}${network === "tiktok" ? ".off" : ""}` || `viralya${Math.floor(r() * 9000 + 1000)}`;
  let bio = `${avatar.niche ?? "Créatrice de contenu"} · ${avatar.city ?? ""}`.trim();
  try {
    const b = await generateText(BIO_SYSTEM, `Nom : ${avatar.name}. Niche : ${avatar.niche ?? "lifestyle"}. Ville : ${avatar.city ?? "?"}.\nPersonnalité : ${String(avatar.system_prompt ?? "").slice(0, 600)}`, 120);
    if (b && b.trim().length > 5) bio = b.trim().replace(/^["']|["']$/g, "").slice(0, 150);
  } catch (err) {
    logger.warn("social_bio_failed", { err: String((err as Error)?.message ?? err) });
  }
  const { data, error } = await supabase
    .from("social_profiles")
    .insert({ avatar_id: avatarId, network, handle, display_name: String(avatar.name), bio, base_followers: Math.round(between(r, 900, 4800)), following: Math.round(between(r, 120, 640)) })
    .select("*")
    .single();
  if (error || !data) {
    // Course entre deux appels : relit.
    const { data: again } = await supabase.from("social_profiles").select("*").eq("avatar_id", avatarId).eq("network", network).maybeSingle();
    if (again) return again as SocialProfile;
    throw new Error(`profile insert: ${error?.message ?? ""}`);
  }
  return data as SocialProfile;
}

export async function updateProfile(avatarId: string, network: SocialNetwork, patch: Partial<Pick<SocialProfile, "handle" | "display_name" | "bio" | "link">>): Promise<SocialProfile> {
  await ensureProfile(avatarId, network);
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.handle === "string") clean.handle = patch.handle.replace(/^@/, "").slice(0, 30);
  if (typeof patch.display_name === "string") clean.display_name = patch.display_name.slice(0, 60);
  if (typeof patch.bio === "string") clean.bio = patch.bio.slice(0, 300);
  if (patch.link !== undefined) clean.link = patch.link;
  const { data, error } = await supabase.from("social_profiles").update(clean).eq("avatar_id", avatarId).eq("network", network).select("*").single();
  if (error || !data) throw new Error(`profile update: ${error?.message ?? ""}`);
  return data as SocialProfile;
}

function mediaOf(item: Record<string, any>): { cover: string | null; video: string | null; images: string[] } {
  const a = item.assets ?? {};
  const video = (a.video_url as string) ?? null;
  const images: string[] = Array.isArray(a.image_urls) ? a.image_urls : a.image_url ? [a.image_url] : Array.isArray(a.images) ? a.images.map((x: any) => (typeof x === "string" ? x : x?.url)).filter(Boolean) : [];
  const shots = Array.isArray(a.shots) ? (a.shots as Array<{ keyframe_url?: string }>) : [];
  const cover = images[0] ?? (a.cover_url as string) ?? shots.find((s) => s.keyframe_url)?.keyframe_url ?? null;
  return { cover, video, images };
}

function toPost(item: Record<string, any>, followers: number): SocialPost {
  const p = item.payload ?? {};
  const st = item.stats ?? {};
  const real = !!st.real;
  const final: PostStats = st.real ?? st.simulated ?? simulateFinalStats(item.id, item.type, followers, item.ratio_class);
  const media = mediaOf(item);
  return {
    id: item.id, type: item.type, network: item.network, title: item.title ?? null,
    caption: String(p.caption ?? p.hook ?? p.text ?? ""), hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    published_at: item.published_at ?? null, scheduled_at: item.scheduled_at ?? null, status: item.status,
    cover_url: media.cover, video_url: media.video, image_urls: media.images,
    stats: real ? final : statsNow(final, item.published_at ?? null), real, ai_label: item.ai_label !== false, external_url: item.external_url ?? null,
  };
}

export interface SocialFeed {
  profile: SocialProfile & { followers: number; posts: number; total_views: number; total_likes: number; engagement_rate: number };
  posts: SocialPost[];
  upcoming: SocialPost[];
  /** Compte réel connecté sur ce réseau (Zernio), sinon null : les abonnés affichés sont alors les vrais. */
  connection: { id: string; handle: string | null; profile_url: string | null; picture_url: string | null; followers: number | null; status: string } | null;
}

/** Profil + feed publié + à venir, avec les statistiques du moment. */
export async function getFeed(avatarId: string, network: SocialNetwork): Promise<SocialFeed> {
  const profile = await ensureProfile(avatarId, network);
  const conn = await activeConnection(avatarId, network);
  const { data: rows } = await supabase
    .from("content_items")
    .select("*")
    .eq("avatar_id", avatarId)
    .eq("network", network)
    .in("status", ["published", "scheduled"])
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const items = (rows ?? []) as Array<Record<string, any>>;
  const posts = items.filter((i) => i.status === "published").map((i) => toPost(i, profile.base_followers));
  const upcoming = items.filter((i) => i.status === "scheduled").map((i) => toPost(i, profile.base_followers)).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const gained = posts.reduce((a, p) => a + p.stats.followers_gained, 0);
  const total_views = posts.reduce((a, p) => a + p.stats.views, 0);
  const total_likes = posts.reduce((a, p) => a + p.stats.likes, 0);
  const inter = posts.reduce((a, p) => a + p.stats.likes + p.stats.comments + p.stats.shares + p.stats.saves, 0);
  // Compte réel connecté : les abonnés viennent du réseau (rafraîchis par sync_stats), sinon simulation.
  const followers = typeof conn?.followers === "number" ? conn.followers : profile.base_followers + gained;
  return {
    profile: { ...profile, followers, posts: posts.length, total_views, total_likes, engagement_rate: followers ? Math.round((inter / Math.max(1, posts.length) / followers) * 10000) / 100 : 0 },
    posts,
    upcoming,
    connection: conn ? { id: conn.id, handle: conn.handle ?? null, profile_url: conn.profile_url ?? null, picture_url: conn.picture_url ?? null, followers: conn.followers ?? null, status: conn.status } : null,
  };
}

/** Publication SIMULÉE : statut publié, statistiques finales figées, entrée du calendrier synchronisée. */
export async function publishSimulated(itemId: string): Promise<SocialPost> {
  const { data: item } = await supabase.from("content_items").select("*").eq("id", itemId).single();
  if (!item) throw new Error("contenu introuvable");
  const profile = await ensureProfile(item.avatar_id, item.network as SocialNetwork);
  const publishedAt = new Date().toISOString();
  const simulated = simulateFinalStats(item.id, item.type, profile.base_followers, item.ratio_class);
  const { error } = await supabase
    .from("content_items")
    .update({ status: "published", published_at: publishedAt, publish_provider: "simulated", stats: { ...(item.stats ?? {}), simulated }, error: null })
    .eq("id", itemId);
  if (error) throw new Error(`publish: ${error.message}`);
  await supabase.from("plan_entries").update({ status: "published", updated_at: publishedAt }).eq("content_item_id", itemId);
  logger.info("content_published_simulated", { itemId, network: item.network, views: simulated.views });
  return toPost({ ...item, status: "published", published_at: publishedAt, stats: { simulated } }, profile.base_followers);
}
