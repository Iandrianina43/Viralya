import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { config } from "./config";
import { logger } from "./logger";
import { registerRoutes } from "./routes";

const here = dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: [config.WEB_BASE_URL], credentials: true }));

  registerRoutes(app);

  // Production : le build du front est servi par la même app (un seul port,
  // donc même origine → pas de CORS et un seul service à exposer).
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    logger.info("serving_web_build", { webDist });
    app.use(express.static(webDist));
    // Routage SPA : toute route non-API renvoie index.html.
    app.get(/^(?!\/(avatars|avatar-drafts|content|admin|health)\b).*/, (_req, res) => {
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    logger.error("unhandled_error", { status, err: String(err?.message ?? err) });
    res.status(status).json({ error: err?.message ?? "internal_error" });
  };
  app.use(errorHandler);
  return app;
}
