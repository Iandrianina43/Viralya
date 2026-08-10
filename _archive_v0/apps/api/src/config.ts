import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

// Charge le .env racine du monorepo (puis un .env local éventuel).
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../../../.env") });
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_BASE_URL: z.string().default("http://localhost:5173"),
  ADMIN_API_KEY: z.string().min(1).default("dev-admin-key"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("avatar-assets"),

  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("anthropic"),
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  ELEVENLABS_API_KEY: z.string().optional(),

  VIDEO_PROVIDER: z.enum(["heygen", "stub"]).default("heygen"),
  HEYGEN_API_KEY: z.string().optional(),

  IMAGE_PROVIDER: z.enum(["openai", "stub"]).default("stub"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  BREVO_API_KEY: z.string().optional(),
  BREVO_WELCOME_LIST_ID: z.coerce.number().default(1),
  BREVO_SENDER_EMAIL: z.string().default("no-reply@viralya.example"),
  BREVO_SENDER_NAME: z.string().default("VIRALYA"),

  // Funnel / conformité
  CONTACT_EMAIL: z.string().default("contact@viralya.example"),
  META_PIXEL_ID: z.string().optional(),
  GTAG_ID: z.string().optional(),

  // Écosystème vivant — tendances/actus (météo = Open-Meteo, sans clé)
  NEWS_API_KEY: z.string().optional(),

  SCHEDULER_PROVIDER: z.enum(["buffer", "publer", "stub"]).default("stub"),
  BUFFER_ACCESS_TOKEN: z.string().optional(),
  PUBLER_API_KEY: z.string().optional(),

  // Le worker peut tourner dans le même process que l'API (dev) ou séparément.
  RUN_WORKER_INLINE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Configuration invalide (.env) :");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
