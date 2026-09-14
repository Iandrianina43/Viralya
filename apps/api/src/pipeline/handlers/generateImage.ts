import { generateImage } from "../../providers/image";
import type { JobRow } from "../../queue/queue";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

export async function generateImageJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") return;
  const theme = String(item.payload.theme ?? "");
  const caption = String(item.payload.caption ?? "");
  const prompt =
    `Visuel ${item.type} premium pour un post business "${theme}". ` +
    `Style moderne, épuré, cohérent avec un influenceur entrepreneuriat. ${caption}`.slice(0, 900);

  const existing = Array.isArray(item.assets.image_urls) ? (item.assets.image_urls as string[]) : [];
  const { imageUrl, costUsd } = await generateImage(prompt, `${item.avatar_id}/${item.id}/image-${existing.length}`);
  // Coût réel (audit P2, 14 sept. 2026) : ce que le fournisseur facture s'accumule dans les assets ; `assemble`
  // le passe au registre des dépenses (settleUsage) à la place de l'estimation fixe du calendrier. Sans prix
  // connu (OpenAI), on garde l'estimation d'une image (0,05 $, ordre de grandeur des modèles 1K).
  const spent = Number(item.assets.estimated_cost_usd ?? 0) + (costUsd ?? 0.05);
  await mergeAssets(id, { image_urls: [...existing, imageUrl], estimated_cost_usd: Math.round(spent * 1000) / 1000, ...(costUsd == null ? { cost_estimated: true } : {}) });
  await advance(job);
}
