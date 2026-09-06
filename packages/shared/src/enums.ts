// Énumérations centrales du domaine VIRALYA V1 (A + B + C).

export const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"] as const;
export type Network = (typeof NETWORKS)[number];

export const CONTENT_TYPES = ["video", "hook", "carousel", "story", "tweet", "photo"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUS = [
  "queued",
  "generating",
  "needs_review",
  "scheduled",
  "published",
  "failed",
  "canceled",
] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

/** États affichés dans le Task Center (regroupement des statuts internes). */
export const TASK_STATES = ["running", "upcoming", "review", "done", "failed"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Règle 70/20/10 (M3). */
export const RATIO_CLASS = ["value", "proof", "sale"] as const;
export type RatioClass = (typeof RATIO_CLASS)[number];
export const RATIO_TARGET: Record<RatioClass, number> = { value: 0.7, proof: 0.2, sale: 0.1 };

/** Types de jobs de la queue maison. */
export const JOB_TYPES = [
  "plan_day",
  "generate_text",
  "generate_video",
  "poll_video",
  // Vidéo v2 hybride : voix ElevenLabs → plans (avatar parlant / b-roll) → suivi + montage.
  "generate_voice",
  "generate_shots",
  "poll_shots",
  "generate_image",
  "generate_photo",
  "assemble",
  "schedule",
  "publish",
  // Phase 3 : calendrier mensuel (stratège LLM) et remontée des statistiques réelles.
  "generate_plan",
  "sync_stats",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Calendrier éditorial (phase 3). */
export const PLAN_ENTRY_TYPES = ["video", "photo", "carousel", "story", "ugc"] as const;
export type PlanEntryType = (typeof PLAN_ENTRY_TYPES)[number];
export const PLAN_ENTRY_STATUS = ["planned", "generating", "ready", "scheduled", "published", "skipped", "failed"] as const;
export type PlanEntryStatus = (typeof PLAN_ENTRY_STATUS)[number];

export const JOB_STATUS = ["pending", "running", "done", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

/** Mémoire narrative (écosystème vivant). */
export const MEMORY_KIND = ["fact", "storyline", "life_event", "content_ref"] as const;
export type MemoryKind = (typeof MEMORY_KIND)[number];

/** Moteur vidéo : Seedance 2.0 via PiAPI (stub pour les environnements sans clé). */
export const VIDEO_PROVIDERS = ["piapi", "stub"] as const;
export type VideoProviderName = (typeof VIDEO_PROVIDERS)[number];
