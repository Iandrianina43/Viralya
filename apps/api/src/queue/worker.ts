import { logger } from "../logger";
import { runJob } from "../pipeline";
import { claimJobs, completeJob, failJob, type JobRow } from "./queue";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 2_000;
const BATCH = 5;
let running = false;

export function startWorker(): void {
  if (running) return;
  running = true;
  logger.info("worker_start", { id: WORKER_ID });
  void loop();
}
export function stopWorker(): void {
  running = false;
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const jobs = await claimJobs(WORKER_ID, BATCH);
      if (jobs.length === 0) {
        await sleep(POLL_MS);
        continue;
      }
      await Promise.all(jobs.map(handleOne));
    } catch (err) {
      logger.error("worker_loop_error", { err: String((err as Error)?.message ?? err) });
      await sleep(POLL_MS);
    }
  }
}

async function handleOne(job: JobRow): Promise<void> {
  const t0 = Date.now();
  try {
    await runJob(job);
    await completeJob(job.id);
    logger.info("job_done", { id: job.id, type: job.type, ms: Date.now() - t0 });
  } catch (err) {
    const retry = await failJob(job, err);
    logger.warn("job_failed", { id: job.id, type: job.type, attempts: job.attempts, retry, err: String((err as Error)?.message ?? err) });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
