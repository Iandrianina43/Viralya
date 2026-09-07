import { logger } from "../logger";
import type { PostStats } from "../domain/social";
import * as zernio from "./zernio";

// ─────────────────────────────────────────────────────────────
// PUBLICATION RÉELLE (BRIEF § 21) — une interface, une mise en œuvre : Zernio (7 sept. 2026).
//   La publication simulée (compte social interne, domain/social.ts) reste le défaut tant qu'aucun
//   compte n'est connecté pour l'influenceur et le réseau.
// Champs vérifiés sur la spec OpenAPI Zernio 1.0.4 (docs/RECHERCHE-PUBLICATION.md § 5) :
//   POST /posts {content, mediaItems[{type,url,thumbnail?,instagramThumbnail?}], platforms[{platform, accountId,
//   customContent?, platformSpecificData}], publishNow, tags, metadata, tiktokSettings}
//   Labels IA : Instagram `isAiGenerated`, TikTok `videoMadeWithAi`, YouTube `containsSyntheticMedia`.
//   Facebook n'expose pas de champ de label IA (NF) : la mention reste dans la légende.
// ─────────────────────────────────────────────────────────────

export interface PublishInput {
  network: string;
  caption: string;
  mediaUrls: string[];
  isVideo: boolean;
  coverUrl?: string | null;
  title?: string | null;
  hashtags?: string[];
  /** Identifiant du compte connecté chez le fournisseur. */
  accountId: string;
  /** Toujours vrai pour un influenceur synthétique (AI Act art. 50, règles TikTok/Meta). */
  aiLabel: boolean;
  /** Divulgation commerciale TikTok : own brand (« Your Brand ») ou partenariat rémunéré. */
  commercial: "none" | "brand_organic" | "brand_content";
  /** UUID d'idempotence (identifiant du contenu Viralya). */
  requestId: string;
  metadata: Record<string, string>;
}

export interface PublishResult {
  postId: string | null;
  state: "published" | "publishing" | "failed";
  url: string | null;
  platformPostId?: string | null;
  error?: string | null;
}

export interface Publisher {
  readonly name: "zernio";
  publish(input: PublishInput): Promise<PublishResult>;
  status(postId: string, network: string): Promise<PublishResult>;
  stats(postId: string, network: string): Promise<Partial<PostStats> | null>;
}

const firstLine = (s: string) => (s.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();

function mapPost(post: zernio.ZernioPost | null, platform: string): PublishResult {
  if (!post) return { postId: null, state: "failed", url: null, error: "publication introuvable chez le fournisseur" };
  const entry = (post.platforms ?? []).find((p) => p.platform === platform) ?? post.platforms?.[0];
  const st = String(entry?.status ?? post.status ?? "");
  if (st === "published" || (post.status === "published" && st !== "failed")) {
    return { postId: post._id, state: "published", url: entry?.platformPostUrl ?? null, platformPostId: entry?.platformPostId ?? null };
  }
  if (st === "failed" || post.status === "failed") {
    return { postId: post._id, state: "failed", url: null, error: entry?.errorMessage ?? "échec chez le fournisseur" };
  }
  return { postId: post._id, state: "publishing", url: null };
}

export class ZernioPublisher implements Publisher {
  readonly name = "zernio" as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    const platform = zernio.ZERNIO_PLATFORM[input.network];
    if (!platform) throw new Error(`réseau non supporté par Zernio : ${input.network}`);
    const media = input.mediaUrls.filter((u) => /^https:\/\//i.test(u));
    if (media.length !== input.mediaUrls.length) throw new Error("les médias doivent être des URL https publiques");
    const cover = input.coverUrl && /^https:\/\//i.test(input.coverUrl) ? input.coverUrl : null;
    const mediaItems = media.map((url) => ({
      type: input.isVideo ? "video" : "image",
      url,
      // Couverture : Reels Instagram et vidéos Facebook seulement (TikTok « colle » l'image dans la vidéo, on évite).
      ...(input.isVideo && cover && platform === "instagram" ? { instagramThumbnail: cover } : {}),
      ...(input.isVideo && cover && platform === "facebook" ? { thumbnail: cover } : {}),
    }));

    let content = input.caption.trim();
    if (platform === "twitter" && content.length > 280) content = `${content.slice(0, 277)}…`;
    if ((platform === "instagram" || platform === "tiktok") && content.length > 2200) content = `${content.slice(0, 2197)}…`;
    const title = (input.title ? input.title : firstLine(content) || "Vidéo").slice(0, 100);

    const body: Record<string, unknown> = {
      content,
      mediaItems,
      platforms: [{ platform, accountId: input.accountId, platformSpecificData: this.platformData(platform, input, title) }],
      publishNow: true,
      metadata: input.metadata,
    };
    if (platform === "youtube" && input.hashtags?.length) {
      // Mots-clés YouTube : ≤ 100 caractères chacun, ≤ 500 au total.
      const tags: string[] = [];
      let total = 0;
      for (const h of input.hashtags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean)) {
        if (h.length > 100 || total + h.length > 500) continue;
        tags.push(h); total += h.length;
      }
      if (tags.length) body.tags = tags;
    }
    if (platform === "tiktok") body.tiktokSettings = await this.tiktokSettings(input, content);

    const post = await zernio.createPost(body, input.requestId);
    const r = mapPost(post, platform);
    logger.info("zernio_post", { network: input.network, id: post._id, status: post.status, state: r.state });
    return r;
  }

  private platformData(platform: string, input: PublishInput, title: string): Record<string, unknown> {
    switch (platform) {
      case "instagram":
        return { isAiGenerated: input.aiLabel, shareToFeed: true };
      case "youtube":
        return { title, visibility: "public", madeForKids: false, containsSyntheticMedia: input.aiLabel, categoryId: "22" };
      case "facebook":
        // Reels : une vidéo verticale 9:16 de 3 à 60 s (nos rendus) ; sinon publication classique.
        return input.isVideo ? { contentType: "reel", title } : {};
      default:
        return {};
    }
  }

  /** TikTok exige les options du créateur (niveau de confidentialité, interactions) et les deux confirmations. */
  private async tiktokSettings(input: PublishInput, content: string): Promise<Record<string, unknown>> {
    const mediaType = input.isVideo ? "video" : "photo";
    let privacyLevel = "PUBLIC_TO_EVERYONE";
    let inter: Record<string, boolean> = {};
    try {
      const info = await zernio.tiktokCreatorInfo(input.accountId, mediaType);
      const levels = (info.privacyLevels ?? []).map((l) => l.value);
      if (levels.length && !levels.includes(privacyLevel)) privacyLevel = levels[0]!;
      inter = info.postingLimits?.interactionSettings ?? {};
      if (info.creator?.canPostMore === false) throw new Error("TikTok : limite quotidienne de publication atteinte pour ce compte");
    } catch (err) {
      if (err instanceof zernio.ZernioError) logger.warn("tiktok_creator_info_failed", { err: err.message.slice(0, 160) });
      else throw err;
    }
    const s: Record<string, unknown> = {
      privacyLevel,
      allowComment: inter.comment ?? true,
      allowDuet: inter.duet ?? true,
      allowStitch: inter.stitch ?? true,
      commercialContentType: input.commercial,
      // Le contenu a été prévisualisé et approuvé par un humain dans Viralya avant la publication.
      contentPreviewConfirmed: true,
      expressConsentGiven: true,
      videoMadeWithAi: input.aiLabel,
      mediaType,
    };
    if (!input.isVideo) {
      s.autoAddMusic = false;
      if (content.length > 90) s.description = content.slice(0, 4000);
    }
    return s;
  }

  async status(postId: string, network: string): Promise<PublishResult> {
    const platform = zernio.ZERNIO_PLATFORM[network] ?? network;
    return mapPost(await zernio.getPost(postId), platform);
  }

  async stats(postId: string): Promise<Partial<PostStats> | null> {
    const a = await zernio.postAnalytics(postId);
    if (!a) return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const views = num(a.views) || num(a.impressions) || num(a.reach);
    return {
      ...(views !== undefined ? { views } : {}),
      ...(num(a.likes) !== undefined ? { likes: num(a.likes) } : {}),
      ...(num(a.comments) !== undefined ? { comments: num(a.comments) } : {}),
      ...(num(a.shares) !== undefined ? { shares: num(a.shares) } : {}),
      ...(num(a.saves) !== undefined ? { saves: num(a.saves) } : {}),
    };
  }
}

/** Fournisseur réel si la clé est configurée, sinon null (publication simulée). */
export function realPublisher(): Publisher | null {
  return zernio.zernioConfigured() ? new ZernioPublisher() : null;
}
