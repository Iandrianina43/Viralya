import { logger } from "../logger";
import { piapiCancel } from "../providers/piapi";

// ─────────────────────────────────────────────────────────────
// ANNULATION CÔTÉ FOURNISSEUR (14 sept. 2026, audit P1). PiAPI : `DELETE /api/v1/task/{id}` n'annule
// qu'une tâche encore EN ATTENTE ; une tâche déjà en cours de rendu va au bout et reste facturée
// (doc PiAPI « Cancel task », vérifiée le 14 sept. : « once a task has entered the processing state,
// it can no longer be canceled »). On tente donc l'annulation de chaque tâche en vol et on rend compte.
// ─────────────────────────────────────────────────────────────

export interface ProviderCancelReport { total: number; canceled: number; refused: number; not_found: number }

/** Identifiants des tâches PiAPI encore en vol dans les actifs d'un contenu (plans hybrides et segments). */
export function inflightTaskIds(assets: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>();
  const shots = Array.isArray(assets?.shots) ? (assets!.shots as Array<{ task_id?: string; phase?: string }>) : [];
  for (const s of shots) if (s.task_id && s.phase === "video") ids.add(String(s.task_id));
  const segments = Array.isArray(assets?.segments) ? (assets!.segments as Array<{ task_id?: string; phase?: string }>) : [];
  for (const s of segments) if (s.task_id && s.phase !== "done" && s.phase !== "failed") ids.add(String(s.task_id));
  return [...ids];
}

/** Tente d'annuler chez PiAPI toutes les tâches en vol d'un contenu. Jamais bloquant. */
export async function cancelProviderTasks(item: { id: string; assets: Record<string, unknown> | null | undefined }): Promise<ProviderCancelReport> {
  const report: ProviderCancelReport = { total: 0, canceled: 0, refused: 0, not_found: 0 };
  for (const taskId of inflightTaskIds(item.assets)) {
    report.total++;
    try {
      const r = await piapiCancel(taskId);
      if (r === "canceled") report.canceled++;
      else if (r === "not_found") report.not_found++;
      else report.refused++;
    } catch (err) {
      report.refused++;
      logger.warn("provider_cancel_failed", { itemId: item.id, taskId, err: String((err as Error)?.message ?? err).slice(0, 120) });
    }
  }
  if (report.total) logger.info("provider_cancel", { itemId: item.id, ...report });
  return report;
}
