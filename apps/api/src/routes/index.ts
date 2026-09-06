import express, { type Express } from "express";
import { authRequired } from "../auth/auth";
import { orgRequired } from "../auth/org";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { avatarDraftsRouter } from "./avatarDrafts";
import { config } from "../config";
import { avatarsRouter } from "./avatars";
import { billingRouter, stripeWebhook } from "./billing";
import { calendarRouter } from "./calendar";
import { contentRouter } from "./content";
import { healthRouter } from "./health";
import { orgsRouter } from "./orgs";
import { socialRouter } from "./social";
import { studioRouter } from "./studio";
import { ugcRouter } from "./ugc";

// Toute l'API vit sous /api : en production le front est servi sur le même
// domaine et utilise les mêmes chemins (/avatars, /content…) pour ses pages.
// Public : /health et /api/auth (login/signup).
// Session + organisation active (en-tête x-org-id, sinon la première) :
// /api/avatars, /api/avatar-drafts, /api/content, /api/studio.
// /api/admin : rôle admin plateforme ou clé interne x-admin-key.
export function registerRoutes(app: Express): void {
  // En-têtes de sécurité (7 sept. 2026) — sans dépendance.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  });
  // Webhook Stripe : corps brut pour la vérification de signature, AVANT le parseur JSON.
  app.post("/api/billing/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter); // /health à la racine (supervision)
  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/orgs", authRequired, orgsRouter);
  app.use("/api/avatars", authRequired, orgRequired, avatarsRouter);
  app.use("/api/avatar-drafts", authRequired, orgRequired, avatarDraftsRouter);
  app.use("/api/content", authRequired, orgRequired, contentRouter);
  app.use("/api/studio", authRequired, orgRequired, studioRouter);
  // Phase 3 : calendrier éditorial, compte social (simulé/réel), campagnes UGC.
  app.use("/api/calendar", authRequired, orgRequired, calendarRouter);
  app.use("/api/social", authRequired, orgRequired, socialRouter);
  app.use("/api/ugc", authRequired, orgRequired, ugcRouter);
  // Facturation et budget de génération (Stripe, migration 0017).
  app.use("/api/billing", authRequired, orgRequired, billingRouter);
  app.use("/api/admin", adminRouter);
}
