import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Tendances / actus de la niche.
// C'est le SEUL signal de contexte qui nécessite une source externe.
// Impl. NewsAPI.org si NEWS_API_KEY présent, sinon [] (stub).
// Swappable (GNews, Brave Search, Google Trends…) sans toucher au pipeline.
// ─────────────────────────────────────────────────────────────

export async function getTrends(nicheKeywords: string): Promise<string[]> {
  if (!config.NEWS_API_KEY || !nicheKeywords) return [];
  try {
    const q = encodeURIComponent(nicheKeywords.split(/[\/,]/)[0]?.trim() || nicheKeywords);
    const url = `https://newsapi.org/v2/everything?q=${q}&language=fr&sortBy=publishedAt&pageSize=3`;
    const res = await fetch(url, { headers: { "X-Api-Key": config.NEWS_API_KEY } });
    if (!res.ok) return [];
    const data = (await res.json()) as { articles?: Array<{ title?: string }> };
    return (data.articles ?? [])
      .map((a) => a.title)
      .filter((t): t is string => typeof t === "string")
      .slice(0, 3);
  } catch (err) {
    logger.warn("trends_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}
