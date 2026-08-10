// Énumérations centrales du domaine VIRALYA V1 (A + B + C).

export const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"] as const;
export type Network = (typeof NETWORKS)[number];

export const CONTENT_TYPES = ["video", "hook", "carousel", "story", "tweet"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUS = [
  "queued",
  "generating",
  "needs_review",
  "scheduled",
  "published",
  "failed",
] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

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
  "generate_image",
  "assemble",
  "schedule",
  "publish",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUS = ["pending", "running", "done", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

/** Mémoire narrative (écosystème vivant). */
export const MEMORY_KIND = ["fact", "storyline", "life_event", "content_ref"] as const;
export type MemoryKind = (typeof MEMORY_KIND)[number];

/** Moteurs vidéo supportés (swappables) : talking-head (heygen/argil) + cinématique (higgsfield). */
export const VIDEO_PROVIDERS = ["heygen", "argil", "higgsfield", "stub"] as const;
export type VideoProviderName = (typeof VIDEO_PROVIDERS)[number];
