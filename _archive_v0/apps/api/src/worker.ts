// Point d'entrée du worker en process séparé : `pnpm worker`.
import "./config";
import { logger } from "./logger";
import { startWorker } from "./queue/worker";

startWorker();
logger.info("worker_standalone_started");

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
