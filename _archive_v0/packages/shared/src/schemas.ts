import { z } from "zod";
import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  JOB_STATUS,
  JOB_TYPES,
  LEAD_STATUS,
  MEMORY_KIND,
  NETWORKS,
  ORDER_STATUS,
  PRICING_MODEL,
  RATIO_CLASS,
} from "./enums.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const zEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);
const uuid = z.string().uuid();
const timestamp = z.string(); // ISO-8601 renvoyé par Postgres/Supabase

// ─────────────────────────────────────────────────────────────
// M1 — Avatar (fiche personnage, cf. cahier des charges §3.3)
// ─────────────────────────────────────────────────────────────
export const AvatarInputSchema = z.object({
  name: z.string().min(2), // "Lucas Martin"
  niche: z.string().min(2), // "Entrepreneuriat / Side business"
  sex_age: z.string().min(2), // "Homme, 32 ans"
  nationality: z.string().default(""), // "Français expatrié à Dubaï"
  personality: z.array(z.string()).max(5).default([]), // 5 traits
  tone_of_voice: z.string().default(""),
  values: z.array(z.string()).default([]),
  clothing_style: z.string().default(""),
  backstory: z.string().default(""),
  business_positioning: z.string().default(""),
  target_audience: z.string().default(""),
  affiliate_products: z.array(z.string()).default([]),
  priority_networks: z.array(zEnum(NETWORKS)).default(["instagram", "tiktok", "email"]),
  // Lieu de vie (contexte météo/fuseau de l'écosystème vivant)
  city: z.string().default(""),
  country: z.string().default(""),
  timezone: z.string().default("Europe/Paris"),
  // Est-ce que l'avatar est ouvertement déclaré comme IA (conformité, imposé J1).
  is_ai_disclosed: z.boolean().default(true),
  status: z.enum(["draft", "active", "paused"]).default("draft"),
  // Références moteurs média (renseignées après clonage) :
  voice_id: z.string().nullable().default(null), // ElevenLabs
  heygen_avatar_id: z.string().nullable().default(null), // HeyGen
  ref_image_url: z.string().url().nullable().default(null),
});
export type AvatarInput = z.infer<typeof AvatarInputSchema>;

export const AvatarSchema = AvatarInputSchema.extend({
  id: uuid,
  system_prompt: z.string(), // généré depuis la fiche
  created_at: timestamp,
  updated_at: timestamp,
});
export type Avatar = z.infer<typeof AvatarSchema>;

// ─────────────────────────────────────────────────────────────
// M5 — Produit maison (catalogue)
// ─────────────────────────────────────────────────────────────
export const ProductInputSchema = z.object({
  avatar_id: uuid.nullable().default(null),
  name: z.string().min(2), // "Loomy CRM"
  description: z.string().default(""),
  price_cents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("EUR"),
  pricing_model: zEnum(PRICING_MODEL),
  stripe_price_id: z.string().nullable().default(null),
  landing_slug: z.string().nullable().default(null),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

export const ProductSchema = ProductInputSchema.extend({
  id: uuid,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Product = z.infer<typeof ProductSchema>;

// ─────────────────────────────────────────────────────────────
// M2/M3 — Content item
// ─────────────────────────────────────────────────────────────
/** Une scène de vidéo talking-head (multi-scènes HeyGen). */
export const VideoSceneSchema = z.object({
  text: z.string(), // texte parlé de la scène
  role: z.enum(["hook", "value", "cta"]).default("value"),
  // Fond de la scène : couleur hex ("#0f1b3d") ou URL d'image. Optionnel.
  background: z.string().optional(),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const ContentPayloadSchema = z.object({
  theme: z.string().optional(),
  script: z.string().optional(), // texte complet (concat des scènes pour la vidéo)
  scenes: z.array(VideoSceneSchema).optional(), // découpage multi-scènes (vidéo)
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  slides: z.array(z.string()).optional(), // carrousel
});
export type ContentPayload = z.infer<typeof ContentPayloadSchema>;

export const ContentAssetsSchema = z.object({
  audio_url: z.string().url().nullable().optional(), // mono-scène (fallback)
  audio_urls: z.array(z.string().url()).optional(), // un audio par scène
  video_url: z.string().url().nullable().optional(),
  image_urls: z.array(z.string().url()).optional(),
  // id externe pendant la génération vidéo async (HeyGen)
  video_external_id: z.string().nullable().optional(),
});
export type ContentAssets = z.infer<typeof ContentAssetsSchema>;

export const ContentItemSchema = z.object({
  id: uuid,
  avatar_id: uuid,
  type: zEnum(CONTENT_TYPES),
  network: zEnum(NETWORKS),
  ratio_class: zEnum(RATIO_CLASS),
  status: zEnum(CONTENT_STATUS),
  payload: ContentPayloadSchema,
  assets: ContentAssetsSchema,
  scheduled_at: timestamp.nullable(),
  published_at: timestamp.nullable(),
  error: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

// ─────────────────────────────────────────────────────────────
// M2 orchestration — Job (queue maison, remplace n8n)
// ─────────────────────────────────────────────────────────────
export const JobSchema = z.object({
  id: uuid,
  type: zEnum(JOB_TYPES),
  status: zEnum(JOB_STATUS),
  payload: z.record(z.unknown()),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  run_after: timestamp,
  locked_at: timestamp.nullable(),
  locked_by: z.string().nullable(),
  error: z.string().nullable(),
  content_item_id: uuid.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Job = z.infer<typeof JobSchema>;

// ─────────────────────────────────────────────────────────────
// M7 — Lead (capture funnel, double opt-in RGPD)
// ─────────────────────────────────────────────────────────────
export const LeadInputSchema = z.object({
  email: z.string().email(),
  avatar_id: uuid,
  source: z.string().default("landing"),
  utm: z.record(z.string()).default({}),
  // consentement explicite obligatoire (RGPD)
  consent: z.literal(true),
});
export type LeadInput = z.infer<typeof LeadInputSchema>;

export const LeadSchema = z.object({
  id: uuid,
  email: z.string().email(),
  avatar_id: uuid,
  source: z.string(),
  utm: z.record(z.string()),
  status: zEnum(LEAD_STATUS),
  optin_token: z.string().nullable(),
  confirmed_at: timestamp.nullable(),
  created_at: timestamp,
});
export type Lead = z.infer<typeof LeadSchema>;

// ─────────────────────────────────────────────────────────────
// M5 — Order (Stripe)
// ─────────────────────────────────────────────────────────────
export const OrderSchema = z.object({
  id: uuid,
  product_id: uuid,
  avatar_id: uuid.nullable(),
  email: z.string().email().nullable(),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: zEnum(ORDER_STATUS),
  stripe_session_id: z.string().nullable(),
  created_at: timestamp,
});
export type Order = z.infer<typeof OrderSchema>;

// ─────────────────────────────────────────────────────────────
// M8 — Analytics quotidien agrégé
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Écosystème vivant — mémoire narrative
// ─────────────────────────────────────────────────────────────
export const AvatarMemoryInputSchema = z.object({
  avatar_id: uuid,
  kind: zEnum(MEMORY_KIND),
  summary: z.string().min(2),
  details: z.record(z.unknown()).default({}),
  status: z.enum(["active", "open", "resolved"]).default("active"),
  importance: z.number().int().min(1).max(5).default(3),
});
export type AvatarMemoryInput = z.infer<typeof AvatarMemoryInputSchema>;

export const AvatarMemorySchema = AvatarMemoryInputSchema.extend({
  id: uuid,
  occurred_on: z.string(),
  created_at: timestamp,
});
export type AvatarMemory = z.infer<typeof AvatarMemorySchema>;

export const AnalyticsDailySchema = z.object({
  avatar_id: uuid,
  day: z.string(), // YYYY-MM-DD
  views: z.number().int().nonnegative(),
  engagement_rate: z.number(),
  leads: z.number().int().nonnegative(),
  revenue_cents: z.number().int().nonnegative(),
  content_published: z.number().int().nonnegative(),
});
export type AnalyticsDaily = z.infer<typeof AnalyticsDailySchema>;
