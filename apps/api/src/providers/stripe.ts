import Stripe from "stripe";
import { config } from "../config";

// Stripe (abonnements) — client paresseux : la plateforme fonctionne sans clé (facturation désactivée,
// budgets manuels), et Stripe s'active dès que STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont posés.
let client: Stripe | null = null;

export const stripeConfigured = (): boolean => !!config.STRIPE_SECRET_KEY;

export function stripe(): Stripe {
  if (!config.STRIPE_SECRET_KEY) throw new Error("Stripe non configuré (STRIPE_SECRET_KEY manquante).");
  client ??= new Stripe(config.STRIPE_SECRET_KEY);
  return client;
}
