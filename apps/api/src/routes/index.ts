import express, { type Express } from "express";
import { authRequired } from "../auth/auth";
import { orgRequired } from "../auth/org";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { avatarDraftsRouter } from "./avatarDrafts";
import { avatarsRouter } from "./avatars";
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
  app.use("/api/admin", adminRouter);
}
