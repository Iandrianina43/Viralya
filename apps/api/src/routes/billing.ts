import { Router, type RequestHandler } from "express";
import { config } from "../config";
import { createCheckout, createPortal, createTopupCheckout, getBilling, handleStripeEvent, listCreditTransactions, listUsage, setOrgCredits } from "../domain/billing";
import { activePricing, savePricing } from "../domain/pricing";
import { asyncHandler } from "../lib/asyncHandler";
import { badRequest, forbidden } from "../lib/httpError";
import { logger } from "../logger";
import { stripe, stripeConfigured } from "../providers/stripe";

// ─────────────────────────────────────────────────────────────
// FACTURATION — /api/billing (session + organisation) et le webhook Stripe (public, signé).
// ─────────────────────────────────────────────────────────────
export const billingRouter = Router();

const returnUrl = () => `${config.WEB_BASE_URL.replace(/\/$/, "")}/settings`;

billingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getBilling(req.org!.id));
  }),
);

billingRouter.get(
  "/usage",
  asyncHandler(async (req, res) => {
    res.json({ usage: await listUsage(req.org!.id), transactions: await listCreditTransactions(req.org!.id) });
  }),
);

// Seuls le propriétaire / admin de l'organisation (ou l'admin plateforme) engagent un paiement.
function requireBillingRole(req: Parameters<RequestHandler>[0]): void {
  if (req.user?.role === "admin") return;
  if (!["owner", "admin"].includes(req.org?.role ?? "")) throw forbidden("Réservé au propriétaire de l'espace.");
}

billingRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    requireBillingRole(req);
    const plan = String(req.body?.plan ?? "");
    if (!plan) throw badRequest("plan requis");
    res.json({ url: await createCheckout(req.org!.id, plan, { email: req.user?.email ?? null, returnUrl: returnUrl(), withSetup: req.body?.with_setup === true }) });
  }),
);

// Achat de crédits (paiement unique) : { topup: code }.
billingRouter.post(
  "/topup",
  asyncHandler(async (req, res) => {
    requireBillingRole(req);
    const topup = String(req.body?.topup ?? "");
    if (!topup) throw badRequest("topup requis");
    res.json({ url: await createTopupCheckout(req.org!.id, topup, { email: req.user?.email ?? null, returnUrl: returnUrl() }) });
  }),
);

// Tarifs : lecture pour tous, nouvelle version (historisée, plancher vérifié) pour l'admin plateforme.
billingRouter.get(
  "/pricing",
  asyncHandler(async (_req, res) => {
    res.json({ pricing: await activePricing() });
  }),
);
billingRouter.put(
  "/pricing",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== "admin") throw forbidden("Réservé à l'administrateur de la plateforme.");
    res.json({ pricing: await savePricing(req.body?.pricing ?? req.body, typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null) });
  }),
);

billingRouter.post(
  "/portal",
  asyncHandler(async (req, res) => {
    requireBillingRole(req);
    res.json({ url: await createPortal(req.org!.id, returnUrl()) });
  }),
);

// Budget manuel en crédits (admin plateforme) : { org_id?, monthly_credits: number | null } (monthly_budget_usd accepté, converti ×10).
billingRouter.put(
  "/budget",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== "admin") throw forbidden("Réservé à l'administrateur de la plateforme.");
    const orgId = String(req.body?.org_id ?? req.org!.id);
    const raw = req.body?.monthly_credits ?? (req.body?.monthly_budget_usd == null || req.body?.monthly_budget_usd === "" ? undefined : Number(req.body.monthly_budget_usd) * 10);
    const credits = raw === null || raw === "" || raw === undefined ? null : Math.round(Number(raw));
    if (credits != null && (!Number.isFinite(credits) || credits < 0)) throw badRequest("monthly_credits invalide");
    await setOrgCredits(orgId, credits);
    res.json({ ok: true, monthly_credits: credits });
  }),
);

/** Webhook Stripe : corps BRUT (monté avant express.json), signature vérifiée, 200 rapide. */
export const stripeWebhook: RequestHandler = async (req, res) => {
  if (!stripeConfigured() || !config.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Stripe non configuré" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string" || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "signature ou corps manquant" });
    return;
  }
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn("stripe_webhook_bad_signature", { err: String((err as Error)?.message ?? err).slice(0, 120) });
    res.status(400).json({ error: "signature invalide" });
    return;
  }
  // Réponse immédiate ; le traitement suit (idempotent, Stripe rejoue en cas d'échec réseau).
  res.json({ received: true });
  try {
    await handleStripeEvent(event);
  } catch (err) {
    logger.error("stripe_webhook_failed", { type: event.type, id: event.id, err: String((err as Error)?.message ?? err) });
  }
};
