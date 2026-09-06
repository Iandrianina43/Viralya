import { logger } from "../logger";
import { runJob } from "../pipeline";
import { claimJobs, completeJob, failJob, heartbeat, markCanceled, reapStaleJobs, type JobRow } from "./queue";
import { schedulerTick } from "./scheduler";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 2_000;
const BATCH = 5;
const HEARTBEAT_MS = 20_000;
const REAP_EVERY_MS = 60_000;
const STALE_AFTER_S = 300;
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

const TICK_MS = 60_000;

async function loop(): Promise<void> {
  let lastReap = 0;
  let lastTick = 0;
  while (running) {
    try {
      // Tâches périodiques : battement de cœur (supervision) et pilote automatique du calendrier.
      if (Date.now() - lastTick > TICK_MS) {
        lastTick = Date.now();
        await schedulerTick(WORKER_ID).catch((err) => logger.warn("scheduler_tick_failed", { err: String((err as Error)?.message ?? err) }));
      }
      // Reprise des jobs orphelins (worker précédent mort en plein rendu).
      if (Date.now() - lastReap > REAP_EVERY_MS) {
        lastReap = Date.now();
        const n = await reapStaleJobs(STALE_AFTER_S).catch((err) => {
          logger.warn("reap_failed", { err: String((err as Error)?.message ?? err) });
          return 0;
        });
        if (n > 0) logger.warn("jobs_reaped", { count: n });
      }

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
  if (job.cancel_requested) {
    await markCanceled(job.id);
    logger.info("job_canceled", { id: job.id, type: job.type });
    return;
  }
  const t0 = Date.now();
  const beat = setInterval(() => void heartbeat(job.id).catch(() => {}), HEARTBEAT_MS);
  try {
    await heartbeat(job.id);
    await runJob(job);
    await completeJob(job.id);
    logger.info("job_done", { id: job.id, type: job.type, ms: Date.now() - t0 });
  } catch (err) {
    const retry = await failJob(job, err);
    logger.warn("job_failed", { id: job.id, type: job.type, attempts: job.attempts, retry, err: String((err as Error)?.message ?? err) });
  } finally {
    clearInterval(beat);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
