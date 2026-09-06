import type { JobRow } from "../queue/queue";
import { assembleJob } from "./handlers/assemble";
import { generateImageJob } from "./handlers/generateImage";
import { generatePhotoJob } from "./handlers/generatePhoto";
import { generatePlanJob } from "./handlers/generatePlan";
import { syncStatsJob } from "./handlers/syncStats";
import { generateShotsJob } from "./handlers/generateShots";
import { generateTextJob } from "./handlers/generateText";
import { generateVideoJob } from "./handlers/generateVideo";
import { generateVoiceJob } from "./handlers/generateVoice";
import { planDay } from "./handlers/planDay";
import { pollShotsJob } from "./handlers/pollShots";
import { pollVideoJob } from "./handlers/pollVideo";
import { publishJob } from "./handlers/publish";
import { scheduleJob } from "./handlers/schedule";

// Routeur de la queue maison : dispatch d'un job vers son handler.
export async function runJob(job: JobRow): Promise<void> {
  switch (job.type) {
    case "plan_day": return planDay(job);
    case "generate_text": return generateTextJob(job);
    case "generate_video": return generateVideoJob(job);
    case "poll_video": return pollVideoJob(job);
    case "generate_voice": return generateVoiceJob(job);
    case "generate_shots": return generateShotsJob(job);
    case "poll_shots": return pollShotsJob(job);
    case "generate_image": return generateImageJob(job);
    case "generate_photo": return generatePhotoJob(job);
    case "assemble": return assembleJob(job);
    case "schedule": return scheduleJob(job);
    case "publish": return publishJob(job);
    case "generate_plan": return generatePlanJob(job);
    case "sync_stats": return syncStatsJob(job);
    default: throw new Error(`type de job non supporté: ${job.type}`);
  }
}
