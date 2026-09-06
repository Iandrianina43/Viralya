import { syncEntryFromContent } from "../../domain/calendar";
import { syncVariantFromContent } from "../../domain/ugc";
import { snapshotVersion } from "../../lib/versions";
import { logger } from "../../logger";
import type { JobRow } from "../../queue/queue";
import { loadContentItem, patchContentItem, requireContentItemId } from "../pipelines";

// Assemble + conformité, puis met en revue humaine (needs_review). Pas d'auto-publication.
export async function assembleJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  const payload = { ...item.payload };

  if (item.ratio_class === "sale") {
    const caption = String(payload.caption ?? "");
    if (!/#ad|#partenariat|sponsoris/i.test(caption)) payload.caption = `${caption} #ad`.trim();
    if (!payload.cta) payload.cta = "Lien en bio.";
  }

  await patchContentItem(id, { payload, status: "needs_review", error: null });

  // Chaque génération aboutie devient une version (retour arrière possible).
  try {
    await snapshotVersion(id, "Génération terminée");
  } catch (err) {
    logger.warn("version_snapshot_failed", { itemId: id, err: String((err as Error)?.message ?? err) });
  }
  // Calendrier et campagnes UGC suivent le statut du contenu (jamais bloquant).
  await Promise.all([
    syncEntryFromContent(id, "needs_review").catch(() => {}),
    syncVariantFromContent(id, "needs_review").catch(() => {}),
  ]);
}
