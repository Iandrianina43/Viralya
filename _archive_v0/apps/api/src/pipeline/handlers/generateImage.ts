import { generateImage } from "../../providers/image";
import type { JobRow } from "../../queue/queue";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

export async function generateImageJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const theme = String(item.payload.theme ?? "");
  const caption = String(item.payload.caption ?? "");
  const prompt =
    `Visuel ${item.type} premium pour un post business "${theme}". ` +
    `Style moderne, épuré, cohérent avec un influenceur entrepreneuriat. ${caption}`.slice(0, 900);

  const existing = Array.isArray(item.assets.image_urls) ? (item.assets.image_urls as string[]) : [];
  const { imageUrl } = await generateImage(prompt, `${item.avatar_id}/${item.id}/image-${existing.length}`);
  await mergeAssets(id, { image_urls: [...existing, imageUrl] });
  await advance(job);
}
