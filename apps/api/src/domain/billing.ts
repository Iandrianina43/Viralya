import type Stripe from "stripe";
import { config } from "../config";
import { HttpError } from "../lib/httpError";
import { logger } from "../logger";
import { stripe, stripeConfigured } from "../providers/stripe";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// FACTURATION ET BUDGET (7 sept. 2026, docs/PLAN-PLATEFORME.md)
//  - Un forfait Stripe par organisation (Checkout en mode abonnement, portail client, webhooks).
//  - Le forfait donne un BUDGET mensuel de génération en dollars : ce que la plateforme dépense
//    en IA (Seedance, images, voix, musique) pour le client. Chaque lancement est estimé, vérifié
//    contre le budget (HTTP 402 si dépassement) et inscrit au registre ; le coût réel remplace
//    l'estimation à la fin de la production.
//  - Sans Stripe : budget manuel par organisation (admin) ou DEFAULT_MONTHLY_BUDGET_USD.
// ─────────────────────────────────────────────────────────────

export interface Plan { code: string; name: string; price_eur: number; budget_usd: number; avatars: number; description: string }

// Tarifs INDICATIFS à valider (marge ≈ prix − budget × 0,92 €/$ − frais Stripe). Une vidéo 30 s en
// 720p coûte ≈ 11 $, une photo ≈ 0,1 $, une explicative ≈ 5 $.
export const PLANS: Plan[] = [
  { code: "starter", name: "Starter", price_eur: 79, budget_usd: 40, avatars: 1, description: "1 influenceur · ≈ 3 vidéos ou 40 photos par mois" },
  { code: "pro", name: "Pro", price_eur: 249, budget_usd: 150, avatars: 3, description: "3 influenceurs · ≈ 13 vidéos par mois · pilote automatique" },
  { code: "studio", name: "Studio", price_eur: 599, budget_usd: 400, avatars: 10, description: "10 influenceurs · ≈ 36 vidéos par mois · support prioritaire" },
];
export const planByCode = (code: string | null | undefined): Plan | null => PLANS.find((p) => p.code === code) ?? null;

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

interface OrgBilling {
  id: string;
  name: string;
  monthly_budget_usd: number | null;
  plan_code: string | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  billing_email: string | null;
}

export interface BillingStatus {
  stripe_configured: boolean;
  plan: Plan | null;
  subscription_status: string | null;
  current_period_end: string | null;
  /** Budget mensuel de génération en dollars ; null = illimité. */
  budget_usd: number | null;
  spent_usd: number;
  remaining_usd: number | null;
  month: string;
  plans: Plan[];
  billing_email: string | null;
  has_customer: boolean;
  /** Origine du budget : plan | manual | default | unlimited. */
  budget_source: "plan" | "manual" | "default" | "unlimited";
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const monthStart = (): Date => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

async function orgRow(orgId: string): Promise<OrgBilling> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, monthly_budget_usd, plan_code, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end, billing_email")
    .eq("id", orgId)
    .single();
  if (error && /column|relation|does not exist/i.test(error.message)) {
    // Migration 0017 non appliquée : la facturation est inactive, on ne bloque aucune production.
    logger.warn("billing_schema_missing", { err: error.message.slice(0, 120) });
    const { data: basic } = await supabase.from("organizations").select("id, name").eq("id", orgId).single();
    if (!basic) throw new HttpError(404, "Organisation introuvable");
    return { id: String(basic.id), name: String(basic.name), monthly_budget_usd: null, plan_code: null, subscription_status: null, stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null, billing_email: null };
  }
  if (error || !data) throw new HttpError(404, "Organisation introuvable");
  return data as OrgBilling;
}

export async function orgIdOfAvatar(avatarId: string): Promise<string | null> {
  const { data } = await supabase.from("avatars").select("org_id").eq("id", avatarId).maybeSingle();
  return (data?.org_id as string | null) ?? null;
}

/** Dépenses du mois en cours (coût réel quand il est connu, sinon l'estimation). */
export async function monthSpend(orgId: string): Promise<number> {
  const { data } = await supabase.from("usage_ledger").select("estimated_usd, actual_usd").eq("org_id", orgId).gte("created_at", monthStart().toISOString());
  return round((data ?? []).reduce((a, r) => a + Number(r.actual_usd ?? r.estimated_usd ?? 0), 0));
}

/**
 * Budget applicable : budget manuel (admin) > forfait actif > organisation qui a eu un forfait mais
 * plus actif → 0 > DEFAULT_MONTHLY_BUDGET_USD (vide = illimité, comportement historique).
 */
export function effectiveBudget(org: OrgBilling): { budget: number | null; source: BillingStatus["budget_source"] } {
  if (org.monthly_budget_usd != null) return { budget: Number(org.monthly_budget_usd), source: "manual" };
  const plan = planByCode(org.plan_code);
  if (plan && ACTIVE_STATUSES.has(org.subscription_status ?? "")) return { budget: plan.budget_usd, source: "plan" };
  if (org.plan_code) return { budget: 0, source: "plan" };
  if (config.DEFAULT_MONTHLY_BUDGET_USD != null) return { budget: config.DEFAULT_MONTHLY_BUDGET_USD, source: "default" };
  return { budget: null, source: "unlimited" };
}

export async function getBilling(orgId: string): Promise<BillingStatus> {
  const org = await orgRow(orgId);
  const { budget, source } = effectiveBudget(org);
  const spent = await monthSpend(orgId);
  return {
    stripe_configured: stripeConfigured(),
    plan: planByCode(org.plan_code),
    subscription_status: org.subscription_status,
    current_period_end: org.current_period_end,
    budget_usd: budget,
    spent_usd: spent,
    remaining_usd: budget == null ? null : Math.max(0, round(budget - spent)),
    month: monthStart().toISOString().slice(0, 7),
    plans: PLANS,
    billing_email: org.billing_email,
    has_customer: !!org.stripe_customer_id,
    budget_source: source,
  };
}

/** Refuse (HTTP 402) une génération qui ferait dépasser le budget mensuel. */
export async function assertBudget(orgId: string, estimateUsd: number): Promise<void> {
  const org = await orgRow(orgId);
  const { budget } = effectiveBudget(org);
  if (budget == null) return;
  const spent = await monthSpend(orgId);
  if (spent + estimateUsd > budget + 0.001) {
    throw new HttpError(
      402,
      budget === 0
        ? "Aucun forfait actif : choisis un forfait dans Paramètres › Abonnement pour lancer des générations."
        : `Budget mensuel atteint : ${spent.toFixed(2)} $ dépensés sur ${budget.toFixed(2)} $, cette génération coûterait ≈ ${estimateUsd.toFixed(2)} $. Passe au forfait supérieur ou attends le mois prochain.`,
    );
  }
}

/** Inscrit un lancement au registre, puis vérifie les seuils d'alerte (80 % et 100 %). */
export async function recordUsage(o: { orgId: string; avatarId?: string | null; contentItemId?: string | null; kind: string; estimatedUsd: number }): Promise<void> {
  const { error } = await supabase.from("usage_ledger").insert({
    org_id: o.orgId,
    avatar_id: o.avatarId ?? null,
    content_item_id: o.contentItemId ?? null,
    kind: o.kind,
    estimated_usd: round(Math.max(0, o.estimatedUsd)),
  });
  if (error) {
    logger.warn("usage_record_failed", { orgId: o.orgId, err: error.message });
    return;
  }
  try {
    const org = await orgRow(o.orgId);
    const { budget } = effectiveBudget(org);
    if (budget == null || budget <= 0) return;
    const spent = await monthSpend(o.orgId);
    const before = spent - o.estimatedUsd;
    const crossed = [0.8, 1].find((t) => before < budget * t && spent >= budget * t);
    if (crossed) {
      const { notifyBudget } = await import("./notifications");
      await notifyBudget(o.orgId, spent, budget, crossed === 1 ? 100 : 80);
    }
  } catch (err) {
    logger.warn("budget_alert_failed", { orgId: o.orgId, err: String((err as Error)?.message ?? err) });
  }
}

/** Coût réel connu à la fin de la production (assemble) : remplace l'estimation. */
export async function settleUsage(contentItemId: string, actualUsd: number): Promise<void> {
  const { error } = await supabase.from("usage_ledger").update({ actual_usd: round(Math.max(0, actualUsd)) }).eq("content_item_id", contentItemId);
  if (error) logger.warn("usage_settle_failed", { contentItemId, err: error.message });
}

/** Budget manuel (admin plateforme) ; null = revenir à la règle du forfait. */
export async function setOrgBudget(orgId: string, budget: number | null): Promise<void> {
  const { error } = await supabase.from("organizations").update({ monthly_budget_usd: budget }).eq("id", orgId);
  if (error) throw new Error(error.message);
}

/** Dernières lignes du registre (mois en cours). */
export async function listUsage(orgId: string, limit = 60): Promise<Array<{ id: string; kind: string; estimated_usd: number; actual_usd: number | null; content_item_id: string | null; avatar_id: string | null; created_at: string }>> {
  const { data } = await supabase
    .from("usage_ledger")
    .select("id, kind, estimated_usd, actual_usd, content_item_id, avatar_id, created_at")
    .eq("org_id", orgId)
    .gte("created_at", monthStart().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as never[];
}

// ── Stripe ────────────────────────────────────────────────────

async function ensureCustomer(org: OrgBilling, email?: string | null): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;
  const customer = await stripe().customers.create({ name: org.name, ...(email ? { email } : {}), metadata: { org_id: org.id } });
  await supabase.from("organizations").update({ stripe_customer_id: customer.id, ...(email ? { billing_email: email } : {}) }).eq("id", org.id);
  return customer.id;
}

/** Page de paiement Stripe (abonnement mensuel, prix défini ici, promo autorisée). Renvoie l'URL. */
export async function createCheckout(orgId: string, planCode: string, opts: { email?: string | null; returnUrl: string }): Promise<string> {
  if (!stripeConfigured()) throw new HttpError(400, "Paiement indisponible : Stripe n'est pas configuré sur ce serveur.");
  const plan = planByCode(planCode);
  if (!plan) throw new HttpError(400, "Forfait inconnu.");
  const org = await orgRow(orgId);
  const customer = await ensureCustomer(org, opts.email);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: plan.price_eur * 100,
          recurring: { interval: "month" },
          product_data: { name: `Viralya ${plan.name}`, description: plan.description },
        },
      },
    ],
    success_url: `${opts.returnUrl}?billing=success`,
    cancel_url: `${opts.returnUrl}?billing=cancel`,
    allow_promotion_codes: true,
    locale: "fr",
    client_reference_id: orgId,
    metadata: { org_id: orgId, plan_code: plan.code },
    subscription_data: { metadata: { org_id: orgId, plan_code: plan.code } },
  });
  if (!session.url) throw new Error("Stripe : session sans URL");
  return session.url;
}

/** Portail client Stripe (changer de carte, annuler, factures). Renvoie l'URL. */
export async function createPortal(orgId: string, returnUrl: string): Promise<string> {
  if (!stripeConfigured()) throw new HttpError(400, "Stripe n'est pas configuré sur ce serveur.");
  const org = await orgRow(orgId);
  if (!org.stripe_customer_id) throw new HttpError(400, "Aucun abonnement à gérer pour cet espace.");
  const session = await stripe().billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: returnUrl });
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

/** Traite un événement Stripe vérifié (idempotent grâce à billing_events). */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const { error: dup } = await supabase.from("billing_events").insert({ id: event.id, type: event.type });
  if (dup) {
    if (/duplicate|unique|23505/i.test(dup.message)) return;
    logger.warn("billing_event_log_failed", { err: dup.message });
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const orgId = s.metadata?.org_id ?? s.client_reference_id ?? (await orgByCustomer(asId(s.customer)));
      if (!orgId) { logger.warn("stripe_checkout_without_org", { session: s.id }); return; }
      await supabase
        .from("organizations")
        .update({
          stripe_customer_id: asId(s.customer),
          stripe_subscription_id: asId(s.subscription),
          plan_code: s.metadata?.plan_code ?? undefined,
          subscription_status: "active",
          billing_email: s.customer_details?.email ?? undefined,
        })
        .eq("id", orgId);
      logger.info("stripe_subscribed", { orgId, plan: s.metadata?.plan_code });
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
      return;
    }
    default:
      return;
  }
}
