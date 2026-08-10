import express, { type Express } from "express";
import { authRequired } from "../auth/auth";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { avatarDraftsRouter } from "./avatarDrafts";
import { avatarsRouter } from "./avatars";
import { contentRouter } from "./content";
import { healthRouter } from "./health";

// Toute l'API vit sous /api : en production le front est servi sur le même
// domaine et utilise les mêmes chemins (/avatars, /content…) pour ses pages.
// Public : /health et /api/auth (login/signup). Tout le reste exige une session.
export function registerRoutes(app: Express): void {
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter); // /health à la racine (supervision)
  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/avatars", authRequired, avatarsRouter);
  app.use("/api/avatar-drafts", authRequired, avatarDraftsRouter);
  app.use("/api/content", authRequired, contentRouter);
  app.use("/api/admin", adminRouter); // adminAuth : session OU x-admin-key (scripts internes)
}
