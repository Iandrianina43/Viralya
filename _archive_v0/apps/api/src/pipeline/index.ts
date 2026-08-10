import type { JobRow } from "../queue/queue";
import { assembleJob } from "./handlers/assemble";
import { generateImageJob } from "./handlers/generateImage";
import { generateTextJob } from "./handlers/generateText";
import { generateVideoJob } from "./handlers/generateVideo";
import { generateVoiceJob } from "./handlers/generateVoice";
import { planDay } from "./handlers/planDay";
import { pollVideoJob } from "./handlers/pollVideo";
import { publishJob } from "./handlers/publish";
import { scheduleJob } from "./handlers/schedule";

// Dispatch d'un job vers son handler. C'est le "routeur" de la queue maison.
export async function runJob(job: JobRow): Promise<void> {
  switch (job.type) {
    case "plan_day":
      return planDay(job);
    case "generate_text":
      return generateTextJob(job);
    case "generate_voice":
      return generateVoiceJob(job);
    case "generate_video":
      return generateVideoJob(job);
    case "poll_video":
      return pollVideoJob(job);
    case "generate_image":
      return generateImageJob(job);
    case "assemble":
      return assembleJob(job);
    case "schedule":
      return scheduleJob(job);
    case "publish":
      return publishJob(job);
    default:
      throw new Error(`type de job non supporté: ${job.type}`);
  }
}
