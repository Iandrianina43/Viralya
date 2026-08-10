import type { JobRow } from "../../queue/queue";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// Assemble le package final et applique la conformité, puis met le contenu
// en revue humaine (needs_review). Pas d'auto-publication (compliance-safe).
export async function assembleJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const payload = { ...item.payload };

  // Conformité : tout contenu de vente doit porter une disclosure + un CTA.
  if (item.ratio_class === "sale") {
    const caption = String(payload.caption ?? "");
    if (!/#ad|#partenariat|sponsoris/i.test(caption)) {
      payload.caption = `${caption} #ad`.trim();
    }
    if (!payload.cta) payload.cta = "Lien en bio.";
  }

  await patchContentItem(id, { payload, status: "needs_review", error: null });
}
