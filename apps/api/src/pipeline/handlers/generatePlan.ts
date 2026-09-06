import { generatePlan } from "../../domain/calendar";
import { logger } from "../../logger";
import { jobLog, type JobRow } from "../../queue/queue";

// Calendrier du mois (phase 3) : un appel LLM, suivi dans le Task Center.
export async function generatePlanJob(job: JobRow): Promise<void> {
  const avatarId = String(job.payload.avatar_id ?? "");
  const month = String(job.payload.month ?? "");
  if (!avatarId || !month) throw new Error("generate_plan: avatar_id et month requis");
  const plan = await generatePlan(
    avatarId,
    {
      month,
      postsPerWeek: Number(job.payload.posts_per_week) || undefined,
      brief: typeof job.payload.brief === "string" ? job.payload.brief : undefined,
      arcs: Array.isArray(job.payload.arcs) ? (job.payload.arcs as string[]) : undefined,
    },
    (msg, pct) => jobLog(job, msg, pct),
  );
  await jobLog(job, `Calendrier ${month} : ${plan.entries?.length ?? 0} contenus, ${plan.strategy.arcs.length} arc(s)`, 100);
  logger.info("generate_plan_done", { avatarId, month, entries: plan.entries?.length ?? 0 });
}
