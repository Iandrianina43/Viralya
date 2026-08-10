import express, { type Express } from "express";
import { adminRouter } from "./admin";
import { avatarDraftsRouter } from "./avatarDrafts";
import { avatarsRouter } from "./avatars";
import { contentRouter } from "./content";
import { healthRouter } from "./health";

// Toute l'API vit sous /api : en production le front est servi sur le même
// domaine et utilise les mêmes chemins (/avatars, /content…) pour ses pages.
export function registerRoutes(app: Express): void {
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter); // /health à la racine (supervision)
  app.use("/api", healthRouter);
  app.use("/api/avatars", avatarsRouter);
  app.use("/api/avatar-drafts", avatarDraftsRouter);
  app.use("/api/content", contentRouter);
  app.use("/api/admin", adminRouter);
}
