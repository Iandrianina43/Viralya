import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

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
  SUPABASE_STORAGE_BUCKET: z.string().default("avatar-assets").transform((v) => v.trim() || "avatar-assets"),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  IMAGE_PROVIDER: z.enum(["openai", "stub"]).default("openai"),

  // Voix ElevenLabs (écoute + choix à la création)
  ELEVENLABS_API_KEY: z.string().optional(),

  VIDEO_PROVIDER: z.enum(["heygen", "argil", "higgsfield", "stub"]).default("heygen"),
  HEYGEN_API_KEY: z.string().optional(),
  ARGIL_API_KEY: z.string().optional(),
  HIGGSFIELD_API_KEY: z.string().optional(),
  HIGGSFIELD_API_SECRET: z.string().optional(),

  NEWS_API_KEY: z.string().optional(),

  RUN_WORKER_INLINE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Configuration invalide (.env) :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;
