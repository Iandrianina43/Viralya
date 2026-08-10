import { getCalendar, localHour } from "./calendar";
import { getRoutine } from "./routine";
import { getTrends } from "./trends";
import { getWeather } from "./weather";

// ─────────────────────────────────────────────────────────────
// Assemble le "brief de contexte du jour" injecté dans la génération.
// Rend le contenu daté et vivant (comme une vraie personne réactive).
// Tous les signaux sont non bloquants (dégradation gracieuse).
// ─────────────────────────────────────────────────────────────

export interface AvatarContextInput {
  city: string;
  niche: string;
  timezone: string;
}

export async function buildContextBrief(avatar: AvatarContextInput): Promise<string> {
  const tz = avatar.timezone || "Europe/Paris";
  const now = new Date();
  const cal = getCalendar(now, tz);
  const routine = getRoutine(localHour(now, tz));

  const [weather, trends] = await Promise.all([
    getWeather(avatar.city, tz),
    getTrends(avatar.niche),
  ]);

  const lines = [
    `- Nous sommes ${cal.weekday} (${cal.season}).`,
    weather ? `- Météo à ${avatar.city} : ${weather.tempC}°C, ${weather.description}.` : "",
    cal.events.length ? `- Contexte de période : ${cal.events.join(" ; ")}.` : "",
    `- Moment de publication : ${routine.moment} → ${routine.tone}.`,
    trends.length ? `- Sujets d'actualité (${avatar.niche}) : ${trends.join(" | ")}.` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
