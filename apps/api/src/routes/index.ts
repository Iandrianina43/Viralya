import express, { type Express } from "express";
import { adminRouter } from "./admin";
import { avatarDraftsRouter } from "./avatarDrafts";
import { avatarsRouter } from "./avatars";
import { contentRouter } from "./content";
import { healthRouter } from "./health";

export function registerRoutes(app: Express): void {
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter);
  app.use("/avatars", avatarsRouter);
  app.use("/avatar-drafts", avatarDraftsRouter);
  app.use("/content", contentRouter);
  app.use("/admin", adminRouter);
}
