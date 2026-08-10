import { z } from "zod";
import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  JOB_STATUS,
  JOB_TYPES,
  MEMORY_KIND,
  NETWORKS,
  RATIO_CLASS,
  VIDEO_PROVIDERS,
} from "./enums.js";

const zEnum = <T extends readonly [string, ...string[]]>(v: T) => z.enum(v);
const uuid = z.string().uuid();
const ts = z.string();

// ── A — Avatar (fiche personnage) ────────────────────────────
export const AvatarInputSchema = z.object({
  name: z.string().min(2),
  niche: z.string().min(2),
  sex_age: z.string().default(""),
  nationality: z.string().default(""),
  city: z.string().default(""),
  timezone: z.string().default("Europe/Paris"),
  personality: z.array(z.string()).max(5).default([]),
  tone_of_voice: z.string().default(""),
  values: z.array(z.string()).default([]),
  clothing_style: z.string().default(""),
  backstory: z.string().default(""),
  business_positioning: z.string().default(""),
  target_audience: z.string().default(""),
  products: z.array(z.string()).default([]),
  priority_networks: z.array(zEnum(NETWORKS)).default(["instagram", "tiktok"]),
  is_ai_disclosed: z.boolean().default(true),
  status: z.enum(["draft", "active", "paused"]).default("draft"),
  // Identité média
  video_provider: zEnum(VIDEO_PROVIDERS).default("heygen"),
  video_avatar_id: z.string().nullable().default(null), // HeyGen avatar_id / Argil avatar id
  voice_id: z.string().nullable().default(null), // voice du moteur vidéo
  ref_image_url: z.string().url().nullable().default(null),
  // Voix ElevenLabs choisie à la création (identité / preview)
  eleven_voice_id: z.string().nullable().default(null),
  eleven_voice_name: z.string().nullable().default(null),
});
export type AvatarInput = z.infer<typeof AvatarInputSchema>;

export const AvatarSchema = AvatarInputSchema.extend({
  id: uuid,
  system_prompt: z.string(),
  created_at: ts,
  updated_at: ts,
});
export type Avatar = z.infer<typeof AvatarSchema>;

// ── A — Mémoire narrative ────────────────────────────────────
export const AvatarMemoryInputSchema = z.object({
  kind: zEnum(MEMORY_KIND),
  summary: z.string().min(2),
  status: z.enum(["active", "open", "resolved"]).default("active"),
  importance: z.number().int().min(1).max(5).default(3),
});
export type AvatarMemoryInput = z.infer<typeof AvatarMemoryInputSchema>;

export const AvatarMemorySchema = AvatarMemoryInputSchema.extend({
  id: uuid,
  avatar_id: uuid,
  occurred_on: z.string(),
  created_at: ts,
});
export type AvatarMemory = z.infer<typeof AvatarMemorySchema>;

// ── B — Contenu ──────────────────────────────────────────────
export const VideoSceneSchema = z.object({
  text: z.string(),
  role: z.enum(["hook", "value", "cta"]).default("value"),
  background: z.string().optional(),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const ContentItemSchema = z.object({
  id: uuid,
  avatar_id: uuid,
  type: zEnum(CONTENT_TYPES),
  network: zEnum(NETWORKS),
  ratio_class: zEnum(RATIO_CLASS),
  status: zEnum(CONTENT_STATUS),
  payload: z.record(z.unknown()),
  assets: z.record(z.unknown()),
  scheduled_at: ts.nullable(),
  published_at: ts.nullable(),
  error: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

// ── B — Job (queue maison) ───────────────────────────────────
export const JobSchema = z.object({
  id: uuid,
  type: zEnum(JOB_TYPES),
  status: zEnum(JOB_STATUS),
  payload: z.record(z.unknown()),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  run_after: ts,
  content_item_id: uuid.nullable(),
  error: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
});
export type Job = z.infer<typeof JobSchema>;
