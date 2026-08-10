import { config } from "./config";
import { ensureBucket } from "./lib/storage";
import { logger } from "./logger";
import { startWorker } from "./queue/worker";
import { createServer } from "./server";

const app = createServer();
app.listen(config.API_PORT, () => {
  logger.info("api_listening", { port: config.API_PORT, env: config.NODE_ENV });
  void ensureBucket(); // crée le bucket public si absent
  void import("./auth/auth").then((m) => m.ensureBootstrapAdmin()); // compte admin .env si absent
  if (config.RUN_WORKER_INLINE) {
    startWorker();
    logger.info("worker_started_inline");
  }
});
