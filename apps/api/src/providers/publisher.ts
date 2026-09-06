import { config } from "../config";
import { logger } from "../logger";
import type { PostStats } from "../domain/social";

// ─────────────────────────────────────────────────────────────
// PUBLICATION (BRIEF § 21) — une interface, deux mises en œuvre :
//   - simulée (par défaut) : le compte social interne (domain/social.ts) ;
//   - Ayrshare : agrégateur multi-réseaux (Instagram, TikTok, Facebook, LinkedIn, YouTube)
//     avec un « profil » par influenceur (profileKey) — évite une validation d'app par réseau.
// Champs Ayrshare utilisés : POST /api/post {post, platforms[], mediaUrls[], profileKey?, scheduleDate?}
// → {status, id, postIds:[{platform, id, postUrl}]} ; POST /api/analytics/post {id, platforms[]}.
// Les noms de champs d'options par réseau (label IA TikTok…) ne sont PAS envoyés tant qu'ils ne
// sont pas vérifiés sur la doc Ayrshare (voir docs/RECHERCHE-PUBLICATION.md).
// ─────────────────────────────────────────────────────────────

export interface PublishInput {
  network: string;
  caption: string;
  mediaUrls: string[];
  isVideo: boolean;
  scheduleAt?: string | null;
  profileKey?: string | null;
  aiLabel: boolean;
}

export interface PublishResult { externalId: string | null; url: string | null; raw?: unknown }

export interface Publisher {
  readonly name: "simulated" | "ayrshare";
  publish(input: PublishInput): Promise<PublishResult>;
  stats(externalId: string, network: string): Promise<Partial<PostStats> | null>;
}

const AYRSHARE_BASE = "https://api.ayrshare.com/api";
const AYRSHARE_PLATFORM: Record<string, string> = { instagram: "instagram", tiktok: "tiktok", facebook: "facebook", youtube: "youtube", x: "twitter", linkedin: "linkedin" };

export class AyrsharePublisher implements Publisher {
  readonly name = "ayrshare" as const;
  constructor(private readonly apiKey: string) {}

  private async call(path: string, body: Record<string, unknown>, profileKey?: string | null): Promise<any> {
    const res = await fetch(`${AYRSHARE_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...(profileKey ? { "Profile-Key": profileKey } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ayrshare ${path} ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const platform = AYRSHARE_PLATFORM[input.network];
    if (!platform) throw new Error(`réseau non supporté par Ayrshare : ${input.network}`);
    const body: Record<string, unknown> = {
      post: input.caption,
      platforms: [platform],
      mediaUrls: input.mediaUrls,
      ...(input.isVideo ? { isVideo: true } : {}),
      ...(input.scheduleAt ? { scheduleDate: input.scheduleAt } : {}),
      // Labels « contenu généré par IA » (docs Ayrshare, relevés par des sources tierces en 2026 —
      // docs/RECHERCHE-PUBLICATION.md) : TikTok `is_aigc`, Instagram `is_ai_generated`. Toujours vrai
      // pour un influenceur synthétique (AI Act art. 50, politique TikTok/Meta).
      ...(input.aiLabel && platform === "tiktok" ? { tikTokOptions: { isAIGenerated: true } } : {}),
      ...(input.aiLabel && platform === "instagram" ? { instagramOptions: { isAIGenerated: true } } : {}),
    };
    const data = await this.call("/post", body, input.profileKey);
    const first = Array.isArray(data?.postIds) ? data.postIds[0] : null;
    logger.info("ayrshare_post", { network: input.network, id: data?.id, status: data?.status });
    return { externalId: (data?.id as string) ?? null, url: (first?.postUrl as string) ?? null, raw: data };
  }

  async stats(externalId: string, network: string): Promise<Partial<PostStats> | null> {
    const platform = AYRSHARE_PLATFORM[network];
    if (!platform) return null;
    const data = await this.call("/analytics/post", { id: externalId, platforms: [platform] });
    const a = data?.[platform]?.analytics ?? data?.[platform] ?? null;
    if (!a || typeof a !== "object") return null;
    const pick = (...keys: string[]) => { for (const k of keys) if (typeof a[k] === "number") return a[k] as number; return undefined; };
    return {
      views: pick("playCount", "videoViews", "views", "impressions", "viewCount"),
      likes: pick("likeCount", "likes", "diggCount"),
      comments: pick("commentsCount", "commentCount", "comments"),
      shares: pick("shareCount", "shares"),
      saves: pick("savedCount", "saved", "saves"),
    };
  }
}

/** Fournisseur réel si la clé est configurée, sinon null (publication simulée). */
export function realPublisher(): Publisher | null {
  return config.AYRSHARE_API_KEY ? new AyrsharePublisher(config.AYRSHARE_API_KEY) : null;
}
