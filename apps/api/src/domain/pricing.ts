import { HttpError } from "../lib/httpError";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// TARIFS (14 sept. 2026, docs/TARIFICATION-CREDITS.md) — versionnés en base (`pricing_config`), la
// version 1 est embarquée ici en repli. Un client garde la version souscrite (`organizations.pricing_version`).
//   1 crédit = CREDIT_INFRA_USD de coût fournisseur ; les prix de vente sont en CHF.
//   Règle absolue : prix de vente d'un crédit ≥ coût d'infra × RATIO_MIN, vérifiée à chaque enregistrement.
// ─────────────────────────────────────────────────────────────

export interface PlanSetup { code: string; label: string; price_chf: number; required: boolean }
export interface PlanDef {
  code: string;
  name: string;
  price_chf: number;
  credits: number;
  /** Influenceurs actifs au maximum (null = sans limite). */
  avatars: number | null;
  /** Réseaux connectables par espace (null = tous). */
  platforms: number | null;
  auto_pilot: boolean;
  support: string;
  description: string;
  setup: PlanSetup | null;
}
export interface TopupDef { code: string; name: string; credits: number; price_chf: number }
export interface PricingConfig {
  version: number;
  credit_infra_usd: number;
  usd_to_chf: number;
  ratio_min: number;
  plans: PlanDef[];
  topups: TopupDef[];
  /** Ordre de consommation des crédits. */
  consume_order: ["monthly", "topup"];
}

export const DEFAULT_PRICING: PricingConfig = {
  version: 1,
  credit_infra_usd: 0.1,
  usd_to_chf: 0.81,
  ratio_min: 1.2,
  consume_order: ["monthly", "topup"],
  plans: [
    { code: "starter", name: "Starter", price_chf: 197, credits: 400, avatars: 1, platforms: 2, auto_pilot: false, support: "self-service", description: "1 influenceur · 2 réseaux · ≈ 3 pubs premium ou 16 explicatives par mois", setup: null },
    { code: "growth", name: "Growth", price_chf: 497, credits: 1200, avatars: 3, platforms: 4, auto_pilot: true, support: "e-mail 48 h", description: "3 influenceurs · 4 réseaux · pilote automatique · ≈ 10 pubs premium par mois", setup: { code: "setup_growth", label: "Onboarding Growth (configuration + lancement)", price_chf: 297, required: false } },
    { code: "brand", name: "Brand", price_chf: 797, credits: 2000, avatars: 5, platforms: null, auto_pilot: true, support: "prioritaire 24 h", description: "5 influenceurs · tous les réseaux · ≈ 16 pubs premium par mois", setup: { code: "setup_brand", label: "Setup Brand complet (marque + onboarding)", price_chf: 1497, required: true } },
    { code: "agency", name: "Agency", price_chf: 2197, credits: 6000, avatars: 10, platforms: null, auto_pilot: true, support: "SLA 4 h", description: "10 influenceurs · tous les réseaux · ≈ 50 pubs premium par mois", setup: { code: "setup_agency", label: "Setup Agency (5 marques + formation)", price_chf: 2997, required: true } },
    { code: "white_label", name: "Marque Blanche", price_chf: 3497, credits: 10000, avatars: 25, platforms: null, auto_pilot: true, support: "SLA 2 h", description: "25 influenceurs · tous les réseaux · ≈ 83 pubs premium par mois", setup: { code: "setup_white_label", label: "Setup Marque Blanche (formation + accompagnement)", price_chf: 4997, required: true } },
  ],
  topups: [
    { code: "micro", name: "Micro", credits: 50, price_chf: 49 },
    { code: "starter_plus", name: "Starter+", credits: 150, price_chf: 129 },
    { code: "boost", name: "Boost", credits: 400, price_chf: 299 },
    { code: "pro", name: "Pro", credits: 900, price_chf: 599 },
    { code: "studio", name: "Studio", credits: 2000, price_chf: 1199 },
  ],
};

let cache: { at: number; cfg: PricingConfig } | null = null;
let tableMissing = false;
const CACHE_MS = 60_000;

/** Tarifs actifs (dernière version en base ; repli sur la version embarquée). */
export async function activePricing(): Promise<PricingConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cfg;
  if (!tableMissing) {
    const { data, error } = await supabase.from("pricing_config").select("version, config").order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) {
      if (/does not exist|schema cache|relation/i.test(error.message)) { tableMissing = true; logger.warn("pricing_config_missing", { hint: "appliquer la migration 0022" }); }
      else logger.warn("pricing_config_read_failed", { err: error.message.slice(0, 120) });
    } else if (data?.config) {
      const cfg = { ...(data.config as PricingConfig), version: Number(data.version) };
      cache = { at: Date.now(), cfg };
      return cfg;
    }
  }
  cache = { at: Date.now(), cfg: DEFAULT_PRICING };
  return DEFAULT_PRICING;
}

/** Version précise (tarif souscrit par un client) ; repli sur la version active. */
export async function pricingVersion(version: number | null | undefined): Promise<PricingConfig> {
  const active = await activePricing();
  if (version == null || version === active.version || tableMissing) return active;
  const { data } = await supabase.from("pricing_config").select("version, config").eq("version", version).maybeSingle();
  return data?.config ? { ...(data.config as PricingConfig), version: Number(data.version) } : active;
}

export const planOf = (cfg: PricingConfig, code: string | null | undefined): PlanDef | null => cfg.plans.find((p) => p.code === code) ?? null;
export const topupOf = (cfg: PricingConfig, code: string | null | undefined): TopupDef | null => cfg.topups.find((t) => t.code === code) ?? null;

/** Crédits pour un coût fournisseur en dollars (arrondi au plus proche : sous 0,05 $ c'est offert). */
export function creditsFor(usd: number, cfg: PricingConfig = DEFAULT_PRICING): number {
  return Math.max(0, Math.round(Math.max(0, usd) / cfg.credit_infra_usd));
}
export const usdOfCredits = (credits: number, cfg: PricingConfig = DEFAULT_PRICING): number => Math.round(credits * cfg.credit_infra_usd * 100) / 100;

/** Plancher : prix de vente d'un crédit ≥ infra × ratio_min. Renvoie la liste des violations (vide = OK). */
export function pricingViolations(cfg: PricingConfig): string[] {
  const floor = cfg.credit_infra_usd * cfg.usd_to_chf * cfg.ratio_min;
  const out: string[] = [];
  for (const p of cfg.plans) if (p.credits > 0 && p.price_chf / p.credits < floor) out.push(`forfait ${p.name} : ${(p.price_chf / p.credits).toFixed(3)} CHF/crédit < plancher ${floor.toFixed(3)}`);
  for (const t of cfg.topups) if (t.credits > 0 && t.price_chf / t.credits < floor) out.push(`top-up ${t.name} : ${(t.price_chf / t.credits).toFixed(3)} CHF/crédit < plancher ${floor.toFixed(3)}`);
  return out;
}

function validate(raw: unknown): PricingConfig {
  const c = raw as Partial<PricingConfig>;
  const num = (v: unknown, name: string, min = 0) => { const n = Number(v); if (!Number.isFinite(n) || n < min) throw new HttpError(400, `Tarifs : ${name} invalide`); return n; };
  if (!Array.isArray(c.plans) || !c.plans.length) throw new HttpError(400, "Tarifs : plans manquants");
  if (!Array.isArray(c.topups)) throw new HttpError(400, "Tarifs : topups manquants");
  const plans: PlanDef[] = c.plans.map((p) => ({
    code: String(p.code ?? "").trim().toLowerCase(), name: String(p.name ?? p.code ?? ""), price_chf: num(p.price_chf, `prix ${p.code}`), credits: Math.round(num(p.credits, `crédits ${p.code}`)),
    avatars: p.avatars == null ? null : Math.round(num(p.avatars, `influenceurs ${p.code}`)), platforms: p.platforms == null ? null : Math.round(num(p.platforms, `réseaux ${p.code}`)),
    auto_pilot: Boolean(p.auto_pilot), support: String(p.support ?? ""), description: String(p.description ?? ""),
    setup: p.setup ? { code: String(p.setup.code ?? `setup_${p.code}`), label: String(p.setup.label ?? ""), price_chf: num(p.setup.price_chf, `setup ${p.code}`), required: Boolean(p.setup.required) } : null,
  }));
  if (plans.some((p) => !/^[a-z_]{2,30}$/.test(p.code))) throw new HttpError(400, "Tarifs : code de forfait invalide");
  const topups: TopupDef[] = c.topups.map((t) => ({ code: String(t.code ?? "").trim().toLowerCase(), name: String(t.name ?? t.code ?? ""), credits: Math.round(num(t.credits, `crédits top-up ${t.code}`)), price_chf: num(t.price_chf, `prix top-up ${t.code}`) }));
  const cfg: PricingConfig = {
    version: 0, credit_infra_usd: num(c.credit_infra_usd ?? DEFAULT_PRICING.credit_infra_usd, "credit_infra_usd", 0.001), usd_to_chf: num(c.usd_to_chf ?? DEFAULT_PRICING.usd_to_chf, "usd_to_chf", 0.01),
    ratio_min: num(c.ratio_min ?? DEFAULT_PRICING.ratio_min, "ratio_min", 1), consume_order: ["monthly", "topup"], plans, topups,
  };
  const bad = pricingViolations(cfg);
  if (bad.length) throw new HttpError(400, `Plancher ×${cfg.ratio_min} non respecté — ${bad.join(" ; ")}`);
  return cfg;
}

/** Nouvelle version des tarifs (admin) : validée, plancher vérifié, jamais d'écrasement (historique conservé). */
export async function savePricing(raw: unknown, note: string | null): Promise<PricingConfig> {
  const cfg = validate(raw);
  const { data: last } = await supabase.from("pricing_config").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
  const version = Number(last?.version ?? 0) + 1;
  const { error } = await supabase.from("pricing_config").insert({ version, config: { ...cfg, version }, note });
  if (error) throw new HttpError(503, /does not exist|schema cache/i.test(error.message) ? "La migration 0022 (crédits) n'est pas appliquée dans Supabase." : `Tarifs : ${error.message.slice(0, 120)}`);
  cache = null;
  logger.info("pricing_saved", { version, plans: cfg.plans.length, topups: cfg.topups.length });
  return { ...cfg, version };
}
