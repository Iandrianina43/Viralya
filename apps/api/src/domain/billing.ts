import type Stripe from "stripe";
import { config } from "../config";
import { HttpError } from "../lib/httpError";
import { logger } from "../logger";
import { stripe, stripeConfigured } from "../providers/stripe";
import { supabase } from "../supabase";
import { activePricing, creditsFor, planOf, pricingVersion, topupOf, usdOfCredits, type PlanDef, type PricingConfig, type TopupDef } from "./pricing";

// ─────────────────────────────────────────────────────────────
// FACTURATION EN CRÉDITS (14 sept. 2026, docs/TARIFICATION-CREDITS.md ; migration 0022)
//  - 1 crédit = 0,10 $ de coût fournisseur. Chaque lancement est estimé en dollars (comme avant),
//    converti en crédits, RÉSERVÉ atomiquement (fonction SQL `reserve_credits` : mensuel d'abord,
//    top-up ensuite), inscrit au registre `usage_ledger` ; le coût réel ajuste les crédits à la fin.
//  - Deux soldes : mensuels (forfait Stripe ou budget manuel admin ; remis à zéro à chaque période)
//    et achetés (top-up Stripe en paiement unique, persistants).
//  - Sans forfait : `DEFAULT_MONTHLY_BUDGET_USD` (converti en crédits ; vide = illimité, espaces
//    internes) ; `manual_monthly_credits` (admin) prime sur tout.
//  - Forfaits en CHF, setup facturé en ligne séparée sur la première facture, features par forfait
//    (influenceurs, réseaux, pilote automatique) contrôlées par `planLimits` / `requireAvatarSlot`…
// ─────────────────────────────────────────────────────────────

export type { PlanDef as Plan };

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

interface OrgBilling {
  id: string;
  name: string;
  monthly_budget_usd: number | null;
  manual_monthly_credits: number | null;
  plan_code: string | null;
  pricing_version: number | null;
  plan_setup_paid: boolean;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  billing_email: string | null;
}

interface Wallet { org_id: string; monthly_credits: number; monthly_granted: number; period_start: string | null; period_end: string | null; topup_credits: number }

export interface BillingStatus {
  stripe_configured: boolean;
  plan: PlanDef | null;
  subscription_status: string | null;
  current_period_end: string | null;
  /** Origine de l'allocation mensuelle : plan | manual | default | unlimited. */
  budget_source: "plan" | "manual" | "default" | "unlimited";
  credits: { monthly: number; monthly_granted: number; topup: number; total: number; period_end: string | null } | null;
  /** Dépense fournisseur du mois (dollars, coût réel quand connu) et son équivalent en crédits. */
  spent_usd: number;
  spent_credits: number;
  month: string;
  plans: PlanDef[];
  topups: TopupDef[];
  credit_usd: number;
  currency: "CHF";
  billing_email: string | null;
  has_customer: boolean;
  setup_paid: boolean;
  limits: PlanLimits;
}

export interface PlanLimits { avatars: number | null; platforms: number | null; auto_pilot: boolean; plan_name: string | null }

const round = (n: number) => Math.round(n * 1000) / 1000;
const monthStart = (): Date => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
const nextMonthStart = (): Date => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
};

const MIGRATION_HINT = "La migration 0022 (crédits) n'est pas appliquée dans Supabase.";
let creditsSchemaMissing = false;
const schemaMissing = (err: { message?: string; code?: string } | null | undefined): boolean =>
  !!err && (err.code === "42703" || err.code === "42P01" || err.code === "42883" || err.code === "PGRST202" || err.code === "PGRST204" || err.code === "PGRST205" || /does not exist|schema cache/i.test(String(err.message ?? "")));

async function orgRow(orgId: string): Promise<OrgBilling> {
  const full = "id, name, monthly_budget_usd, manual_monthly_credits, plan_code, pricing_version, plan_setup_paid, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end, billing_email";
  const { data, error } = await supabase.from("organizations").select(full).eq("id", orgId).single();
  if (error && /column|relation|does not exist/i.test(error.message)) {
    // Migration 0022 (ou 0017) absente : on relit les colonnes historiques, la facturation en crédits est inactive.
    if (!creditsSchemaMissing) { creditsSchemaMissing = true; logger.warn("billing_schema_missing", { err: error.message.slice(0, 120), hint: MIGRATION_HINT }); }
    const { data: legacy } = await supabase.from("organizations").select("id, name, monthly_budget_usd, plan_code, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end, billing_email").eq("id", orgId).single();
    if (!legacy) throw new HttpError(404, "Organisation introuvable");
    const l = legacy as Partial<OrgBilling> & { id: string; name: string };
    return { id: l.id, name: l.name, monthly_budget_usd: l.monthly_budget_usd ?? null, manual_monthly_credits: l.monthly_budget_usd != null ? Math.round(Number(l.monthly_budget_usd) * 10) : null, plan_code: l.plan_code ?? null, pricing_version: null, plan_setup_paid: false, subscription_status: l.subscription_status ?? null, stripe_customer_id: l.stripe_customer_id ?? null, stripe_subscription_id: l.stripe_subscription_id ?? null, current_period_end: l.current_period_end ?? null, billing_email: l.billing_email ?? null };
  }
  if (error || !data) throw new HttpError(404, "Organisation introuvable");
  return data as OrgBilling;
}

export async function orgIdOfAvatar(avatarId: string): Promise<string | null> {
  const { data } = await supabase.from("avatars").select("org_id").eq("id", avatarId).maybeSingle();
  return (data?.org_id as string | null) ?? null;
}

/** Dépenses fournisseur du mois (coût réel quand il est connu, sinon l'estimation), en dollars. */
export async function monthSpend(orgId: string): Promise<number> {
  const { data } = await supabase.from("usage_ledger").select("estimated_usd, actual_usd").eq("org_id", orgId).gte("created_at", monthStart().toISOString());
  return round((data ?? []).reduce((a, r) => a + Number(r.actual_usd ?? r.estimated_usd ?? 0), 0));
}

// ── Allocation mensuelle ──────────────────────────────────────

interface Grant { credits: number | null; source: BillingStatus["budget_source"]; plan: PlanDef | null }

/**
 * Allocation applicable : budget manuel (admin) > forfait actif > organisation qui a eu un forfait mais
 * plus actif → 0 > DEFAULT_MONTHLY_BUDGET_USD converti en crédits (vide = illimité, espaces internes).
 */
async function grantFor(org: OrgBilling): Promise<Grant> {
  const cfg = await pricingVersion(org.pricing_version);
  const plan = planOf(cfg, org.plan_code);
  if (org.manual_monthly_credits != null) return { credits: Math.max(0, Math.round(Number(org.manual_monthly_credits))), source: "manual", plan };
  if (plan && ACTIVE_STATUSES.has(org.subscription_status ?? "")) return { credits: plan.credits, source: "plan", plan };
  if (org.plan_code) return { credits: 0, source: "plan", plan };
  if (config.DEFAULT_MONTHLY_BUDGET_USD != null) return { credits: creditsFor(config.DEFAULT_MONTHLY_BUDGET_USD, cfg), source: "default", plan: null };
  return { credits: null, source: "unlimited", plan: null };
}

async function readWallet(orgId: string): Promise<Wallet | null> {
  const { data, error } = await supabase.from("credit_wallets").select("org_id, monthly_credits, monthly_granted, period_start, period_end, topup_credits").eq("org_id", orgId).maybeSingle();
  if (error) { if (schemaMissing(error)) { creditsSchemaMissing = true; return null; } throw new Error(`credit_wallets : ${error.message}`); }
  return (data as Wallet | null) ?? null;
}

/** Remise à zéro de la période (valeur absolue), idempotente par `ref` Stripe. */
async function grantPeriod(orgId: string, credits: number, periodStart: Date, periodEnd: Date, ref: string | null, note: string): Promise<void> {
  const { error } = await supabase.rpc("grant_credits", { p_org: orgId, p_credits: credits, p_period_start: periodStart.toISOString(), p_period_end: periodEnd.toISOString(), p_stripe_ref: ref, p_note: note });
  if (error) { if (schemaMissing(error)) { creditsSchemaMissing = true; return; } throw new Error(`grant_credits : ${error.message}`); }
  logger.info("credits_granted", { orgId, credits, periodEnd: periodEnd.toISOString(), note });
}

/**
 * Portefeuille à jour : créé à la première demande, remis à zéro quand la période est passée (lazy — pas
 * besoin de cron), réaligné si l'allocation a changé (changement de forfait ou de budget manuel).
 * null = sans limite (espace interne) ou schéma absent.
 */
async function ensureWallet(org: OrgBilling): Promise<{ wallet: Wallet; grant: Grant } | null> {
  const grant = await grantFor(org);
  if (grant.credits == null || creditsSchemaMissing) return null;
  let w = await readWallet(org.id);
  if (creditsSchemaMissing) return null;
  const now = Date.now();
  const expired = !w || !w.period_end || Date.parse(w.period_end) <= now;
  if (expired) {
    // Fin de période : celle de Stripe si elle est encore devant nous, sinon le début du mois prochain.
    const stripeEnd = grant.source === "plan" && org.current_period_end ? Date.parse(org.current_period_end) : NaN;
    const end = Number.isFinite(stripeEnd) && stripeEnd > now + 3600_000 ? new Date(stripeEnd) : nextMonthStart();
    await grantPeriod(org.id, grant.credits, new Date(), end, null, `période ${grant.source}`);
    w = await readWallet(org.id);
  } else if (w && w.monthly_granted !== grant.credits) {
    // Allocation changée en cours de période (upgrade, budget manuel) : on ajuste le reste du même écart.
    const delta = grant.credits - w.monthly_granted;
    await supabase.from("credit_wallets").update({ monthly_granted: grant.credits, monthly_credits: Math.max(0, w.monthly_credits + delta), updated_at: new Date().toISOString() }).eq("org_id", org.id);
    await supabase.from("credit_transactions").insert({ org_id: org.id, kind: "adjust", credits: delta, monthly_part: delta, topup_part: 0, note: `allocation ${w.monthly_granted} → ${grant.credits}` });
    w = await readWallet(org.id);
  }
  return w ? { wallet: w, grant } : null;
}

// ── Statut, limites ───────────────────────────────────────────

async function limitsOf(org: OrgBilling, grant: Grant, cfg: PricingConfig): Promise<PlanLimits> {
  if (grant.source === "unlimited" || grant.source === "manual") return { avatars: null, platforms: null, auto_pilot: true, plan_name: grant.plan?.name ?? null };
  const plan = grant.plan ?? (grant.source === "default" ? planOf(cfg, "starter") : null);
  if (!plan) return { avatars: 0, platforms: 0, auto_pilot: false, plan_name: null };
  return { avatars: plan.avatars, platforms: plan.platforms, auto_pilot: plan.auto_pilot, plan_name: plan.name };
}

export async function planLimits(orgId: string): Promise<PlanLimits> {
  const org = await orgRow(orgId);
  return limitsOf(org, await grantFor(org), await pricingVersion(org.pricing_version));
}

export async function getBilling(orgId: string): Promise<BillingStatus> {
  const org = await orgRow(orgId);
  const cfg = await pricingVersion(org.pricing_version);
  const active = await activePricing();
  const w = await ensureWallet(org);
  const grant = w?.grant ?? (await grantFor(org));
  const spent = await monthSpend(orgId);
  return {
    stripe_configured: stripeConfigured(),
    plan: grant.plan,
    subscription_status: org.subscription_status,
    current_period_end: org.current_period_end,
    budget_source: grant.source,
    credits: w ? { monthly: w.wallet.monthly_credits, monthly_granted: w.wallet.monthly_granted, topup: w.wallet.topup_credits, total: w.wallet.monthly_credits + w.wallet.topup_credits, period_end: w.wallet.period_end } : null,
    spent_usd: spent,
    spent_credits: creditsFor(spent, cfg),
    month: monthStart().toISOString().slice(0, 7),
    plans: active.plans,
    topups: active.topups,
    credit_usd: cfg.credit_infra_usd,
    currency: "CHF",
    billing_email: org.billing_email,
    has_customer: !!org.stripe_customer_id,
    setup_paid: !!org.plan_setup_paid,
    limits: await limitsOf(org, grant, cfg),
  };
}

function creditsError(credits: number, monthly: number, topup: number, source: BillingStatus["budget_source"]): HttpError {
  if (source === "plan" && monthly + topup === 0 && credits > 0) {
    return new HttpError(402, `Crédits épuisés ou aucun forfait actif : cette génération demande ${credits} crédit${credits > 1 ? "s" : ""}. Choisis un forfait ou achète des crédits dans Paramètres › Abonnement.`);
  }
  return new HttpError(402, `Crédits insuffisants : il reste ${monthly + topup} crédit${monthly + topup > 1 ? "s" : ""} (${monthly} du mois + ${topup} achetés), cette génération en demande ${credits}. Achète des crédits ou passe au forfait supérieur.`);
}

/** Pré-contrôle (HTTP 402) avant un travail coûteux ; la réservation atomique reste `recordUsage`. */
export async function assertBudget(orgId: string, estimateUsd: number): Promise<void> {
  const org = await orgRow(orgId);
  const w = await ensureWallet(org);
  if (!w) return;
  const cfg = await pricingVersion(org.pricing_version);
  const credits = creditsFor(estimateUsd, cfg);
  if (credits > w.wallet.monthly_credits + w.wallet.topup_credits) throw creditsError(credits, w.wallet.monthly_credits, w.wallet.topup_credits, w.grant.source);
}

/** Garde-fous par forfait (402 avec le forfait à prendre). */
export async function requireAvatarSlot(orgId: string): Promise<void> {
  const limits = await planLimits(orgId);
  if (limits.avatars == null) return;
  const { count } = await supabase.from("avatars").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  if ((count ?? 0) >= limits.avatars) throw new HttpError(402, limits.avatars === 0 ? "Aucun forfait actif : choisis un forfait pour créer un influenceur." : `Ton forfait ${limits.plan_name ?? ""} permet ${limits.avatars} influenceur${limits.avatars > 1 ? "s" : ""}. Passe au forfait supérieur pour en créer un autre.`);
}
export async function requirePlatformSlot(orgId: string, network: string): Promise<void> {
  const limits = await planLimits(orgId);
  if (limits.platforms == null) return;
  const { data } = await supabase.from("social_connections").select("networks").eq("org_id", orgId).eq("status", "active");
  const used = new Set<string>();
  for (const c of data ?? []) for (const n of (c.networks as string[] | null) ?? []) used.add(n);
  if (used.has(network)) return;
  if (used.size >= limits.platforms) throw new HttpError(402, `Ton forfait ${limits.plan_name ?? ""} permet ${limits.platforms} réseau${limits.platforms > 1 ? "x" : ""} connecté${limits.platforms > 1 ? "s" : ""}. Passe au forfait supérieur pour en ajouter.`);
}
export async function requireAutoPilot(orgId: string): Promise<void> {
  const limits = await planLimits(orgId);
  if (!limits.auto_pilot) throw new HttpError(402, "Le pilote automatique du calendrier est inclus à partir du forfait Growth.");
}

// ── Réservation, rattachement, libération, coût réel ──────────

export interface UsageInput { orgId: string; avatarId?: string | null; contentItemId?: string | null; kind: string; estimatedUsd: number }

/**
 * RÉSERVE les crédits et inscrit le lancement au registre. Refuse en 402 quand le solde ne suffit pas.
 * Renvoie l'identifiant de la ligne du registre (à rattacher au contenu avec `attachUsage`, à libérer
 * avec `releaseUsage` si rien n'est lancé). Sans la migration 0022 : registre seul, pas de plafond.
 */
export async function recordUsage(o: UsageInput): Promise<string | null> {
  const estimated = round(Math.max(0, o.estimatedUsd));
  const org = await orgRow(o.orgId);
  const cfg = await pricingVersion(org.pricing_version);
  const credits = creditsFor(estimated, cfg);
  const w = await ensureWallet(org);
  const { data: led, error: ledErr } = await supabase
    .from("usage_ledger")
    .insert({ org_id: o.orgId, avatar_id: o.avatarId ?? null, content_item_id: o.contentItemId ?? null, kind: o.kind, estimated_usd: estimated, ...(creditsSchemaMissing ? {} : { credits }) })
    .select("id")
    .single();
  if (ledErr) {
    logger.warn("usage_record_failed", { orgId: o.orgId, err: ledErr.message.slice(0, 160) }); // migration 0017 absente : facturation inactive
    return null;
  }
  const ledgerId = String(led.id);
  if (!w) return ledgerId; // sans limite (espace interne) ou schéma crédits absent
  if (credits === 0) return ledgerId;
  const { data, error } = await supabase.rpc("reserve_credits", { p_org: o.orgId, p_credits: credits, p_ledger: ledgerId, p_kind: o.kind });
  if (error) {
    if (schemaMissing(error)) { creditsSchemaMissing = true; logger.warn("reserve_credits_rpc_missing", { hint: MIGRATION_HINT }); return ledgerId; }
    await supabase.from("usage_ledger").delete().eq("id", ledgerId);
    throw new Error(`réservation des crédits impossible : ${error.message.slice(0, 160)}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; monthly_left: number; topup_left: number } | undefined;
  if (!row || row.allowed === false) {
    await supabase.from("usage_ledger").delete().eq("id", ledgerId);
    throw creditsError(credits, Number(row?.monthly_left ?? w.wallet.monthly_credits), Number(row?.topup_left ?? w.wallet.topup_credits), w.grant.source);
  }
  // Seuils d'alerte sur le mensuel (80 % et 100 %), jamais bloquants.
  try {
    const granted = w.wallet.monthly_granted;
    if (granted > 0) {
      const beforeUsed = granted - w.wallet.monthly_credits;
      const afterUsed = granted - Number(row.monthly_left);
      const crossed = [0.8, 1].find((t) => beforeUsed < granted * t && afterUsed >= granted * t);
      if (crossed) {
        const { notifyBudget } = await import("./notifications");
        await notifyBudget(o.orgId, afterUsed, granted, crossed === 1 ? 100 : 80);
      }
    }
  } catch (err) {
    logger.warn("budget_alert_failed", { orgId: o.orgId, err: String((err as Error)?.message ?? err) });
  }
  return ledgerId;
}

/** Rattache une réservation au contenu créé ensuite (le coût réel viendra par `settleUsage`). */
export async function attachUsage(ledgerId: string | null, contentItemId: string): Promise<void> {
  if (!ledgerId) return;
  const { error } = await supabase.from("usage_ledger").update({ content_item_id: contentItemId }).eq("id", ledgerId);
  if (error) logger.warn("usage_attach_failed", { ledgerId, contentItemId, err: error.message });
}

/** Solde net déjà porté sur ces lignes du registre (négatif = consommé). */
async function netCredits(orgId: string, ledgerIds: string[]): Promise<number> {
  if (!ledgerIds.length) return 0;
  const { data } = await supabase.from("credit_transactions").select("credits").eq("org_id", orgId).in("usage_ledger_id", ledgerIds);
  return (data ?? []).reduce((a, r) => a + Number(r.credits ?? 0), 0);
}

/** Aligne les crédits portés sur des lignes du registre sur `targetCredits` (rend ou prélève la différence). */
async function settleCredits(orgId: string, ledgerIds: string[], targetCredits: number, note: string): Promise<void> {
  if (creditsSchemaMissing || !ledgerIds.length) return;
  const net = await netCredits(orgId, ledgerIds);
  const delta = -targetCredits - net; // > 0 : à rendre ; < 0 : à prélever en plus
  if (delta === 0) return;
  const ledgerId = ledgerIds[0]!;
  if (delta > 0) {
    // On rend d'abord au mensuel (qui a été pris en premier), le reste au top-up ; `adjust_credits` plafonne.
    const { data: parts } = await supabase.from("credit_transactions").select("monthly_part, topup_part").eq("org_id", orgId).in("usage_ledger_id", ledgerIds);
    const takenMonthly = -(parts ?? []).reduce((a, r) => a + Math.min(0, Number(r.monthly_part ?? 0)), 0);
    const refundMonthly = Math.min(delta, takenMonthly);
    const { error } = await supabase.rpc("adjust_credits", { p_org: orgId, p_monthly: refundMonthly, p_topup: delta - refundMonthly, p_kind: "settle", p_ledger: ledgerId, p_stripe_ref: null, p_note: note });
    if (error && !schemaMissing(error)) logger.warn("credits_settle_failed", { orgId, err: error.message.slice(0, 120) });
  } else {
    // Coût réel au-dessus de l'estimation : on prélève le complément si le solde le permet, sinon on journalise.
    const { data, error } = await supabase.rpc("reserve_credits", { p_org: orgId, p_credits: -delta, p_ledger: ledgerId, p_kind: `settle_extra:${note}` });
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | undefined;
    if (error && !schemaMissing(error)) logger.warn("credits_settle_failed", { orgId, err: error.message.slice(0, 120) });
    else if (row && row.allowed === false) logger.warn("credits_settle_uncovered", { orgId, extra: -delta, note });
  }
}

/** Libère une réservation dont le lancement n'a pas eu lieu (rien n'a été dépensé). */
export async function releaseUsage(ledgerId: string | null): Promise<void> {
  if (!ledgerId) return;
  const { data, error } = await supabase.from("usage_ledger").update({ actual_usd: 0 }).eq("id", ledgerId).select("org_id").maybeSingle();
  if (error) { logger.warn("usage_release_failed", { ledgerId, err: error.message }); return; }
  if (data?.org_id) await settleCredits(String(data.org_id), [ledgerId], 0, "rien lancé");
}

/** Coût réel connu à la fin de la production (assemble) : remplace l'estimation et ajuste les crédits. */
export async function settleUsage(contentItemId: string, actualUsd: number): Promise<void> {
  const actual = round(Math.max(0, actualUsd));
  const { data, error } = await supabase.from("usage_ledger").update({ actual_usd: actual }).eq("content_item_id", contentItemId).select("id, org_id");
  if (error) { logger.warn("usage_settle_failed", { contentItemId, err: error.message }); return; }
  const rows = data ?? [];
  if (!rows.length) return;
  const orgId = String(rows[0]!.org_id);
  const org = await orgRow(orgId).catch(() => null);
  if (!org) return;
  const cfg = await pricingVersion(org.pricing_version);
  await settleCredits(orgId, rows.map((r) => String(r.id)), creditsFor(actual, cfg), `coût réel ${actual} $`);
}

/** Budget manuel en crédits (admin plateforme) ; null = revenir à la règle du forfait. */
export async function setOrgCredits(orgId: string, credits: number | null): Promise<void> {
  const { error } = await supabase.from("organizations").update({ manual_monthly_credits: credits, monthly_budget_usd: credits == null ? null : usdOfCredits(credits) }).eq("id", orgId);
  if (error) throw new Error(error.message);
}

/** Dernières lignes du registre (mois en cours). */
export async function listUsage(orgId: string, limit = 60): Promise<Array<{ id: string; kind: string; estimated_usd: number; actual_usd: number | null; credits: number | null; content_item_id: string | null; avatar_id: string | null; created_at: string }>> {
  const { data, error } = await supabase
    .from("usage_ledger")
    .select("id, kind, estimated_usd, actual_usd, credits, content_item_id, avatar_id, created_at")
    .eq("org_id", orgId)
    .gte("created_at", monthStart().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error && /credits/.test(error.message)) {
    const { data: legacy } = await supabase.from("usage_ledger").select("id, kind, estimated_usd, actual_usd, content_item_id, avatar_id, created_at").eq("org_id", orgId).gte("created_at", monthStart().toISOString()).order("created_at", { ascending: false }).limit(limit);
    return ((legacy ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, credits: null })) as never[];
  }
  return (data ?? []) as never[];
}

/** Mouvements de crédits récents. */
export async function listCreditTransactions(orgId: string, limit = 60): Promise<Array<{ id: string; kind: string; credits: number; monthly_part: number; topup_part: number; note: string | null; created_at: string }>> {
  const { data, error } = await supabase.from("credit_transactions").select("id, kind, credits, monthly_part, topup_part, note, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as never[];
}

// ── Stripe ────────────────────────────────────────────────────

/** Traduit une erreur Stripe en message lisible (400) au lieu d'une erreur interne opaque. */
async function stripeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { type?: string; message?: string; statusCode?: number };
    logger.warn("stripe_error", { type: e.type, err: String(e.message ?? err).slice(0, 200) });
    if (e.type === "StripeAuthenticationError" || /invalid api key/i.test(String(e.message))) {
      throw new HttpError(400, "Paiement indisponible : la clé Stripe configurée sur le serveur est refusée par Stripe (clé d'exemple ou incomplète). Remplace STRIPE_SECRET_KEY par la vraie clé secrète du tableau de bord Stripe.");
    }
    throw new HttpError(400, `Stripe : ${String(e.message ?? "erreur inconnue").slice(0, 200)}`);
  }
}

async function ensureCustomer(org: OrgBilling, email?: string | null): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;
  const customer = await stripeCall(() => stripe().customers.create({ name: org.name, ...(email ? { email } : {}), metadata: { org_id: org.id } }));
  await supabase.from("organizations").update({ stripe_customer_id: customer.id, ...(email ? { billing_email: email } : {}) }).eq("id", org.id);
  return customer.id;
}

const chf = (n: number) => Math.round(n * 100);

/**
 * Page de paiement Stripe pour un forfait (abonnement mensuel en CHF, promo autorisée). Le setup du
 * forfait, s'il est obligatoire ou demandé, part en ligne séparée sur la première facture. Renvoie l'URL.
 */
export async function createCheckout(orgId: string, planCode: string, opts: { email?: string | null; returnUrl: string; withSetup?: boolean }): Promise<string> {
  if (!stripeConfigured()) throw new HttpError(400, "Paiement indisponible : Stripe n'est pas configuré sur ce serveur.");
  const cfg = await activePricing();
  const plan = planOf(cfg, planCode);
  if (!plan) throw new HttpError(400, "Forfait inconnu.");
  const org = await orgRow(orgId);
  const customer = await ensureCustomer(org, opts.email);
  const withSetup = !!plan.setup && !org.plan_setup_paid && (plan.setup.required || !!opts.withSetup);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { quantity: 1, price_data: { currency: "chf", unit_amount: chf(plan.price_chf), recurring: { interval: "month" }, product_data: { name: `Viralya ${plan.name}`, description: `${plan.credits} crédits par mois · ${plan.description}` } } },
  ];
  if (withSetup && plan.setup) lineItems.push({ quantity: 1, price_data: { currency: "chf", unit_amount: chf(plan.setup.price_chf), product_data: { name: plan.setup.label, description: "Prestation unique, facturée une fois" } } });
  const session = await stripeCall(() => stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: lineItems,
    success_url: `${opts.returnUrl}?billing=success`,
    cancel_url: `${opts.returnUrl}?billing=cancel`,
    allow_promotion_codes: true,
    locale: "fr",
    client_reference_id: orgId,
    metadata: { org_id: orgId, plan_code: plan.code, pricing_version: String(cfg.version), setup: withSetup ? "1" : "0" },
    subscription_data: { metadata: { org_id: orgId, plan_code: plan.code, pricing_version: String(cfg.version) } },
  }));
  if (!session.url) throw new Error("Stripe : session sans URL");
  return session.url;
}

/** Achat de crédits (paiement unique en CHF) ; crédités par le webhook `checkout.session.completed`. */
export async function createTopupCheckout(orgId: string, topupCode: string, opts: { email?: string | null; returnUrl: string }): Promise<string> {
  if (!stripeConfigured()) throw new HttpError(400, "Paiement indisponible : Stripe n'est pas configuré sur ce serveur.");
  const cfg = await activePricing();
  const topup = topupOf(cfg, topupCode);
  if (!topup) throw new HttpError(400, "Pack de crédits inconnu.");
  const org = await orgRow(orgId);
  const customer = await ensureCustomer(org, opts.email);
  const session = await stripeCall(() => stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ quantity: 1, price_data: { currency: "chf", unit_amount: chf(topup.price_chf), product_data: { name: `Viralya · ${topup.credits} crédits (${topup.name})`, description: "Crédits achetés : sans date d'expiration, consommés après les crédits du mois" } } }],
    success_url: `${opts.returnUrl}?billing=topup`,
    cancel_url: `${opts.returnUrl}?billing=cancel`,
    allow_promotion_codes: true,
    locale: "fr",
    client_reference_id: orgId,
    invoice_creation: { enabled: true },
    metadata: { org_id: orgId, topup_code: topup.code, credits: String(topup.credits) },
  }));
  if (!session.url) throw new Error("Stripe : session sans URL");
  return session.url;
}

/** Portail client Stripe (changer de carte, annuler, factures). Renvoie l'URL. */
export async function createPortal(orgId: string, returnUrl: string): Promise<string> {
  if (!stripeConfigured()) throw new HttpError(400, "Stripe n'est pas configuré sur ce serveur.");
  const org = await orgRow(orgId);
  if (!org.stripe_customer_id) throw new HttpError(400, "Aucun abonnement à gérer pour cet espace.");
  const session = await stripeCall(() => stripe().billingPortal.sessions.create({ customer: org.stripe_customer_id!, return_url: returnUrl }));
  return session.url;
}

const asId = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null);

/** Fin de période : selon la version d'API, sur l'abonnement ou sur son premier item. */
function periodEnd(sub: Stripe.Subscription): string | null {
  const s = sub as unknown as { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } };
  const ts = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function orgByCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabase.from("organizations").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Traite un événement Stripe vérifié (idempotent grâce à billing_events + stripe_ref des mouvements). */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const { error: dup } = await supabase.from("billing_events").insert({ id: event.id, type: event.type });
  if (dup) {
    if (/duplicate|unique|23505/i.test(dup.message)) return;
    // Sans journal d'idempotence on ne traite pas : Stripe rejouera l'événement.
    throw new Error(`billing_events : ${dup.message}`);
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (!["paid", "no_payment_required"].includes(String(s.payment_status))) { logger.info("stripe_checkout_ignored", { session: s.id, status: s.payment_status }); return; }
      const orgId = s.metadata?.org_id ?? s.client_reference_id ?? (await orgByCustomer(asId(s.customer)));
      if (!orgId) { logger.warn("stripe_checkout_without_org", { session: s.id }); return; }
      if (s.mode === "payment" && s.metadata?.topup_code) {
        const cfg = await activePricing();
        const topup = topupOf(cfg, s.metadata.topup_code);
        const credits = topup?.credits ?? Number(s.metadata.credits ?? 0);
        if (!credits) { logger.warn("stripe_topup_unknown", { session: s.id, code: s.metadata.topup_code }); return; }
        const { error } = await supabase.rpc("adjust_credits", { p_org: orgId, p_monthly: 0, p_topup: credits, p_kind: "topup", p_ledger: null, p_stripe_ref: s.id, p_note: `top-up ${topup?.name ?? s.metadata.topup_code}` });
        if (error) throw new Error(`top-up non crédité : ${error.message}`);
        logger.info("stripe_topup", { orgId, credits, session: s.id });
        return;
      }
      if (s.mode !== "subscription") return;
      const cfg = await activePricing();
      const plan = planOf(cfg, s.metadata?.plan_code);
      if (!plan) { logger.warn("stripe_checkout_unknown_plan", { session: s.id }); return; }
      const version = Number(s.metadata?.pricing_version ?? cfg.version) || cfg.version;
      await supabase
        .from("organizations")
        .update({
          stripe_customer_id: asId(s.customer),
          stripe_subscription_id: asId(s.subscription),
          plan_code: plan.code,
          pricing_version: version,
          subscription_status: "active",
          billing_email: s.customer_details?.email ?? undefined,
          ...(s.metadata?.setup === "1" ? { plan_setup_paid: true } : {}),
          manual_monthly_credits: null,
          monthly_budget_usd: null,
        })
        .eq("id", orgId);
      // Allocation du premier mois tout de suite (la facture payée la confirmera avec la vraie fin de période).
      await grantPeriod(orgId, plan.credits, new Date(), nextMonthStart(), s.id, `souscription ${plan.name}`);
      logger.info("stripe_subscribed", { orgId, plan: plan.code, setup: s.metadata?.setup === "1" });
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.org_id ?? (await orgByCustomer(asId(sub.customer)));
      if (!orgId) return;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      await supabase
        .from("organizations")
        .update({
          subscription_status: status,
          stripe_subscription_id: sub.id,
          current_period_end: periodEnd(sub),
          ...(sub.metadata?.plan_code ? { plan_code: sub.metadata.plan_code } : {}),
        })
        .eq("id", orgId);
      logger.info("stripe_subscription", { orgId, status });
      return;
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const orgId = await orgByCustomer(asId(inv.customer));
      if (!orgId) return;
      await supabase.from("organizations").update({ subscription_status: event.type === "invoice.paid" ? "active" : "past_due" }).eq("id", orgId);
      if (event.type === "invoice.paid") {
        // Chaque facture d'abonnement payée ouvre une période : mensuel remis au quota du forfait.
        const org = await orgRow(orgId);
        const plan = planOf(await pricingVersion(org.pricing_version), org.plan_code);
        const line = (inv.lines?.data ?? []).find((l) => (l as unknown as { period?: { end?: number } }).period?.end) as unknown as { period?: { start?: number; end?: number } } | undefined;
        const end = line?.period?.end ? new Date(line.period.end * 1000) : nextMonthStart();
        const start = line?.period?.start ? new Date(line.period.start * 1000) : new Date();
        if (plan && end.getTime() > Date.now()) {
          await supabase.from("organizations").update({ current_period_end: end.toISOString() }).eq("id", orgId);
          await grantPeriod(orgId, plan.credits, start, end, inv.id ?? null, `facture ${inv.number ?? inv.id} · ${plan.name}`);
        }
      }
      return;
    }
    default:
      return;
  }
}
