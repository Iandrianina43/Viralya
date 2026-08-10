import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { config } from "./config";
import { logger } from "./logger";
import { registerRoutes } from "./routes";

export function createServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: [config.WEB_BASE_URL], credentials: true }));

  registerRoutes(app);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    logger.error("unhandled_error", { status, err: String(err?.message ?? err) });
    res.status(status).json({ error: err?.message ?? "internal_error" });
  };
  app.use(errorHandler);
  return app;
}
