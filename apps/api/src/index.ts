import { config } from "./config";
import { ensureBucket } from "./lib/storage";
import { logger } from "./logger";
import { startWorker } from "./queue/worker";
import { createServer } from "./server";

// Un rejet non géré ne doit jamais tuer l'API et les rendus en vol (audit du 7 sept.).
process.on("unhandledRejection", (err) => logger.error("unhandled_rejection", { err: String((err as Error)?.message ?? err) }));
process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", { err: String(err?.message ?? err), stack: String(err?.stack ?? "").slice(0, 600) });
});

const app = createServer();
const server = app.listen(config.API_PORT, () => {
  logger.info("api_listening", { port: config.API_PORT, env: config.NODE_ENV });
  ensureBucket().catch((err) => logger.error("bucket_failed", { err: String((err as Error)?.message ?? err) })); // crée le bucket si absent
  import("./auth/auth").then((m) => m.ensureBootstrapAdmin()).catch((err) => logger.warn("bootstrap_failed", { err: String((err as Error)?.message ?? err) }));
  if (config.RUN_WORKER_INLINE) {
    startWorker();
    logger.info("worker_started_inline");
  }
});

// Arrêt propre (systemctl restart, déploiement) : plus de nouveaux jobs, 15 s pour finir, puis sortie.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    logger.info("shutdown_begin", { signal: sig });
    import("./queue/worker").then((m) => m.stopWorker()).catch(() => {});
    server.close(() => logger.info("http_closed"));
    setTimeout(() => process.exit(0), 15_000).unref();
  });
}
