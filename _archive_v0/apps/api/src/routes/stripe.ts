import express, { Router } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../logger";
import { supabase } from "../supabase";

export const stripeRouter = Router();

const stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null;

// M5 — création d'une session Checkout pour un produit (par slug).
async function createCheckoutSession(
  slug: string,
  email?: string,
): Promise<{ url: string | null; id: string } | { error: string; status: number }> {
  if (!stripe) return { error: "stripe non configuré", status: 503 };

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("landing_slug", slug)
    .single();
  if (error || !product) return { error: "produit introuvable", status: 404 };

  const isSub = product.pricing_model === "subscription";
  const session = await stripe.checkout.sessions.create({
    mode: isSub ? "subscription" : "payment",
    line_items: [
      product.stripe_price_id
        ? { price: product.stripe_price_id, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: String(product.currency).toLowerCase(),
              unit_amount: product.price_cents,
              product_data: { name: product.name },
              ...(isSub ? { recurring: { interval: "month" as const } } : {}),
            },
          },
    ],
    success_url: `${config.API_BASE_URL}/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.API_BASE_URL}/offre/${slug}`,
    customer_email: email || undefined,
    metadata: { product_id: product.id, avatar_id: product.avatar_id ?? "" },
  });

  await supabase.from("orders").insert({
    product_id: product.id,
    avatar_id: product.avatar_id,
    email: email ?? null,
    amount_cents: product.price_cents,
    currency: product.currency,
    status: "pending",
    stripe_session_id: session.id,
  });

  return { url: session.url, id: session.id };
}

// Endpoint JSON (console / intégrations).
stripeRouter.post(
  "/checkout",
  express.json(),
  asyncHandler(async (req, res) => {
    const result = await createCheckoutSession(
      String(req.body?.slug ?? ""),
      req.body?.email as string | undefined,
    );
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  }),
);

// Endpoint formulaire SSR (no-JS) — redirige directement vers Stripe.
stripeRouter.post(
  "/checkout-form",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const result = await createCheckoutSession(
      String(req.body?.slug ?? ""),
      String(req.body?.email ?? "").trim() || undefined,
    );
    if ("error" in result || !result.url) {
      const msg = "error" in result ? result.error : "session sans URL";
      res.status("error" in result ? result.status : 500).send(`Erreur paiement : ${msg}`);
      return;
    }
    res.redirect(303, result.url);
  }),
);

// Webhook Stripe — nécessite le body BRUT (monté avant express.json global).
stripeRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    if (!stripe || !config.STRIPE_WEBHOOK_SECRET) {
      res.status(503).end();
      return;
    }
    const sig = req.header("stripe-signature") ?? "";
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      res.status(400).json({ error: `signature invalide: ${String((err as Error).message)}` });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await supabase.from("orders").update({ status: "paid" }).eq("stripe_session_id", session.id);
      logger.info("order_paid", { session: session.id });
    }
    res.json({ received: true });
  }),
);
