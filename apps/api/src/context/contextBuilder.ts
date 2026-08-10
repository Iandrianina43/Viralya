import { getCalendar, localHour } from "./calendar";
import { getRoutine } from "./routine";
import { getTrends } from "./trends";
import { getWeather } from "./weather";

// Assemble le "brief de contexte du jour" injecté dans la génération.
export interface AvatarContextInput {
  city: string;
  niche: string;
  timezone: string;
}

export async function buildContextBrief(a: AvatarContextInput): Promise<string> {
  const tz = a.timezone || "Europe/Paris";
  const now = new Date();
  const cal = getCalendar(now, tz);
  const routine = getRoutine(localHour(now, tz));
  const [weather, trends] = await Promise.all([getWeather(a.city, tz), getTrends(a.niche)]);

  return [
    `- Nous sommes ${cal.weekday} (${cal.season}).`,
    weather ? `- Météo à ${a.city} : ${weather.tempC}°C, ${weather.description}.` : "",
    cal.events.length ? `- Contexte de période : ${cal.events.join(" ; ")}.` : "",
    `- Moment de publication : ${routine.moment} → ${routine.tone}.`,
    trends.length ? `- Sujets d'actualité (${a.niche}) : ${trends.join(" | ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
