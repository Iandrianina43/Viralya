import { logger } from "../logger";
import { supabase } from "../supabase";

/**
 * Journal d'audit (migration 0018) : membres, rôles, bannissements, budget, impersonation admin,
 * suppression d'espace. Jamais bloquant : sans table, on journalise seulement.
 */
export async function auditLog(action: string, o: { orgId?: string | null; userId?: string | null; details?: Record<string, unknown> } = {}): Promise<void> {
  logger.info(`audit_${action}`, { orgId: o.orgId ?? null, userId: o.userId ?? null, ...(o.details ?? {}) });
  const { error } = await supabase.from("audit_log").insert({ org_id: o.orgId ?? null, user_id: o.userId ?? null, action, details: o.details ?? {} });
  if (error && !/audit_log/.test(error.message)) logger.warn("audit_log_failed", { action, err: error.message.slice(0, 120) });
}
