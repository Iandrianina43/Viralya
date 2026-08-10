import { config } from "../config";
import { logger } from "../logger";
import type { Network } from "@viralya/shared";

// ─────────────────────────────────────────────────────────────
// Provider de planification réseaux — Buffer/Publer (API officielles).
// Stub par défaut : renvoie juste un créneau (pas d'appel externe).
// Publication compliant : jamais d'API sociale non officielle.
// ─────────────────────────────────────────────────────────────

export interface ScheduleInput {
  network: Network;
  caption: string;
  mediaUrl?: string | null;
  scheduledAt: string; // ISO
}

export async function schedulePost(
  input: ScheduleInput,
): Promise<{ scheduledAt: string; externalRef: string | null }> {
  if (config.SCHEDULER_PROVIDER === "buffer" && config.BUFFER_ACCESS_TOKEN) {
    // TODO Phase 1+ : appel Buffer API (create update) — à brancher avec le profile_id.
    logger.info("scheduler_buffer_todo", { network: input.network });
  } else if (config.SCHEDULER_PROVIDER === "publer" && config.PUBLER_API_KEY) {
    logger.info("scheduler_publer_todo", { network: input.network });
  } else {
    logger.warn("scheduler_stub_used", { network: input.network });
  }
  // MVP : on enregistre le créneau ; l'envoi réel via Buffer/Publer se branche ici.
  return { scheduledAt: input.scheduledAt, externalRef: null };
}
