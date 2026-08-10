import { config } from "../config";
import { logger } from "../logger";

// Tendances/actus de la niche — NewsAPI si clé, sinon [] (le seul signal à source externe).
export async function getTrends(niche: string): Promise<string[]> {
  if (!config.NEWS_API_KEY || !niche) return [];
  try {
    const q = encodeURIComponent(niche.split(/[/,]/)[0]?.trim() || niche);
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&language=fr&sortBy=publishedAt&pageSize=3`,
      { headers: { "X-Api-Key": config.NEWS_API_KEY } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { articles?: Array<{ title?: string }> };
    return (data.articles ?? []).map((a) => a.title).filter((t): t is string => !!t).slice(0, 3);
  } catch (err) {
    logger.warn("trends_failed", { err: String((err as Error)?.message ?? err) });
    return [];
  }
}
