// ─────────────────────────────────────────────────────────────
// Énumérations centrales du domaine VIRALYA.
// Sources de vérité partagées entre l'API, le worker et le front.
// ─────────────────────────────────────────────────────────────

/** Réseaux de diffusion supportés. */
export const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook", "email"] as const;
export type Network = (typeof NETWORKS)[number];

/** Types de contenu produits par le pipeline (M2). */
export const CONTENT_TYPES = ["hook", "carousel", "story", "video", "tweet", "email"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Cycle de vie d'un content_item. */
export const CONTENT_STATUS = [
  "queued",
  "generating",
  "ready",
  "needs_review",
  "scheduled",
  "published",
  "failed",
] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

/** Classe de contenu pour la règle 70/20/10 (M3). */
export const RATIO_CLASS = ["value", "proof", "sale"] as const;
export type RatioClass = (typeof RATIO_CLASS)[number];

/** Cibles du ratio 70/20/10 (part du volume total). */
export const RATIO_TARGET: Record<RatioClass, number> = {
  value: 0.7,
  proof: 0.2,
  sale: 0.1,
};

/** Types de jobs de la queue maison (remplace n8n). Ordre = pipeline de contenu. */
export const JOB_TYPES = [
  "plan_day",
  "generate_text",
  "generate_voice",
  "generate_video",
  "poll_video",
  "generate_image",
  "assemble",
  "schedule",
  "publish",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Statut d'un job dans la queue. */
export const JOB_STATUS = ["pending", "running", "done", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

/** Statut RGPD d'un lead (double opt-in). */
export const LEAD_STATUS = ["pending_optin", "confirmed", "unsubscribed"] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/** Statut d'une commande Stripe (M5). */
export const ORDER_STATUS = ["pending", "paid", "refunded", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/** Modèle tarifaire d'un produit maison. */
export const PRICING_MODEL = ["one_shot", "subscription", "per_lead", "commission"] as const;
export type PricingModel = (typeof PRICING_MODEL)[number];

/** Type d'entrée de mémoire narrative (écosystème vivant). */
export const MEMORY_KIND = ["fact", "storyline", "life_event", "content_ref"] as const;
export type MemoryKind = (typeof MEMORY_KIND)[number];
