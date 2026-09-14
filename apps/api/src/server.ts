import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { config } from "./config";
import { signedJsonMiddleware } from "./lib/storage";
import { logger } from "./logger";
import { registerRoutes } from "./routes";

const here = dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // derrière Caddy : IP réelle pour le rate-limit
  // Identifiant de requête + journal d'accès (audit P2, 14 sept. 2026) : x-request-id repris s'il est fourni (proxy,
  // tests), sinon généré ; renvoyé dans la réponse ; une ligne par appel /api (méthode, chemin, statut, durée,
  // utilisateur, organisation) pour relier une plainte à ce qui s'est passé côté serveur.
  app.use((req, res, next) => {
    const given = String(req.headers["x-request-id"] ?? "");
    const id = /^[A-Za-z0-9._-]{8,64}$/.test(given) ? given : randomUUID();
    req.id = id;
    res.setHeader("x-request-id", id);
    if (!req.path.startsWith("/api/") || req.path === "/api/health") { next(); return; }
    const t0 = Date.now();
    res.on("finish", () => {
      logger.info("http_request", { id, method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode, ms: Date.now() - t0, user: req.user?.id ?? null, org: req.org?.id ?? null });
    });
    next();
  });
  app.use(cors({ origin: [config.WEB_BASE_URL], credentials: true }));

  // Bucket privé : toute réponse JSON part avec des URLs de stockage SIGNÉES (lib/storage.ts).
  app.use(signedJsonMiddleware());

  registerRoutes(app);

  // Production : le build du front est servi par la même app (un seul port,
  // donc même origine → pas de CORS et un seul service à exposer).
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    logger.info("serving_web_build", { webDist });
    app.use(express.static(webDist));
    // Routage SPA : toute route hors /api renvoie index.html (React gère /avatars, /content…).
    app.get(/^(?!\/(api|health)\b).*/, (_req, res) => {
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    // 4xx = refus attendu (404 hors organisation, 400 validation…) : simple avertissement.
    if (status >= 500) logger.error("unhandled_error", { id: req.id, status, path: req.originalUrl.split("?")[0], err: String(err?.message ?? err) });
    else logger.warn("request_rejected", { id: req.id, status, path: req.originalUrl.split("?")[0], err: String(err?.message ?? err) });
    // 5xx : jamais le détail interne (schéma, fournisseur) au client — il est journalisé ci-dessus.
    res.status(status).json({ error: status >= 500 ? "Erreur interne : réessaie dans un instant, l'incident est journalisé." : err?.message ?? "erreur" });
  };
  app.use(errorHandler);
  return app;
}
