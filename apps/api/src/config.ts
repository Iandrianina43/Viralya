import { setDefaultResultOrder } from "node:dns";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

// Windows/Node : fetch (undici) tente l'IPv6 en premier et échoue ("fetch failed")
// vers certaines API (api.piapi.ai) alors que curl passe → on force l'IPv4 d'abord.
setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../../../.env") });
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_BASE_URL: z.string().default("http://localhost:5173"),
  ADMIN_API_KEY: z.string().min(1).default("dev-admin-key"), // refusé en production (voir ci-dessous)
  MAX_ORGS_PER_USER: z.coerce.number().int().min(1).default(3),
  // Mentions de l'éditeur affichées dans les CGU / confidentialité (raison sociale, adresse, contact).
  LEGAL_EDITOR: z.string().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().optional(),

  // Comptes utilisateurs
  ALLOW_SIGNUP: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ADMIN_EMAIL: z.string().optional(), // bootstrap : crée ce compte admin au démarrage s'il n'existe pas
  ADMIN_PASSWORD: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("avatar-assets").transform((v) => v.trim() || "avatar-assets"),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Images : PiAPI (Seedream 5 Pro / Nano Banana 2, banc du 3 sept. 2026) par défaut ; OpenAI en option.
  IMAGE_PROVIDER: z.enum(["piapi", "openai", "stub"]).default("piapi"),
  IMAGE_MODEL: z.string().default("seedream-5-pro"),
  // Contrôle qualité des visages (tools/qc/face_score.py — Python + OpenCV).
  PYTHON_BIN: z.string().default("python"),

  // Voix ElevenLabs (écoute + choix à la création)
  ELEVENLABS_API_KEY: z.string().optional(),

  // Moteur vidéo principal : Seedance 2.0 via PiAPI.
  PIAPI_API_KEY: z.string().optional(),

  NEWS_API_KEY: z.string().optional(),

  // Publication réelle (phase 4) : clé Ayrshare (compte Business, un profil par influenceur).
  // Sans clé, la publication est simulée (compte social interne).
  AYRSHARE_API_KEY: z.string().optional(),
  // --- Facturation Stripe (abonnements) et budget mensuel de génération (7 sept. 2026) ---
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Budget des organisations sans forfait ni budget manuel : vide = illimité (mono-client), 0 = forfait obligatoire.
  DEFAULT_MONTHLY_BUDGET_USD: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0).optional()),
  // --- E-mails transactionnels (Resend) ---
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Viralya <no-reply@viralya.app>"),

  RUN_WORKER_INLINE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  // Génération quotidienne automatique (pg_cron → plan_day). Désactivée par défaut :
  // l'ancien plan V1 (1 vidéo + 2 accroches + 1 carrousel « astuce business ») coûte
  // ≈ 1,40 $ par influenceur et par jour ; le calendrier de la phase 3 le remplacera.
  DAILY_PLAN_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Configuration invalide (.env) :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;

// Garde-fous de production (audit du 7 sept. 2026).
if (config.NODE_ENV === "production") {
  const fatal: string[] = [];
  if (config.ADMIN_API_KEY === "dev-admin-key" || config.ADMIN_API_KEY.length < 24) fatal.push("ADMIN_API_KEY doit être une clé unique de 24 caractères minimum");
  if (config.LLM_PROVIDER === "anthropic" ? !config.ANTHROPIC_API_KEY : !config.OPENAI_API_KEY) fatal.push("clé du fournisseur de texte manquante");
  if (config.IMAGE_PROVIDER === "piapi" && !config.PIAPI_API_KEY) fatal.push("PIAPI_API_KEY manquante");
  if (fatal.length) {
    console.error("❌ Configuration de production refusée :", fatal.join(" ; "));
    process.exit(1);
  }
  if (/localhost|127\.0\.0\.1/.test(config.WEB_BASE_URL)) console.warn("⚠️ WEB_BASE_URL pointe vers localhost : liens des e-mails et retour Stripe incorrects.");
  if (config.DEFAULT_MONTHLY_BUDGET_USD == null) console.warn("⚠️ DEFAULT_MONTHLY_BUDGET_USD vide : les espaces sans forfait n'ont aucun plafond de dépenses IA.");
}
