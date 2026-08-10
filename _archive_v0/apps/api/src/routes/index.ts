import express, { type Express } from "express";
import { adminRouter } from "./admin";
import { avatarsRouter } from "./avatars";
import { contentRouter } from "./content";
import { healthRouter } from "./health";
import { leadsRouter } from "./leads";
import { pagesRouter } from "./pages";
import { productsRouter } from "./products";
import { stripeRouter } from "./stripe";

// Monte toutes les routes. L'ordre importe : le webhook Stripe a besoin du
// body brut, il est donc monté AVANT express.json().
export function registerRoutes(app: Express): void {
  app.use("/stripe", stripeRouter); // gère express.raw() en interne pour /webhook
  app.use(express.json({ limit: "2mb" }));

  app.use(healthRouter);
  app.use("/avatars", avatarsRouter);
  app.use("/content", contentRouter);
  app.use("/leads", leadsRouter);
  app.use("/products", productsRouter);
  app.use("/admin", adminRouter);
  app.use(pagesRouter); // pages funnel SSR (capture, offres, merci, légal)
}
