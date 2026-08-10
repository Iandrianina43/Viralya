// ─────────────────────────────────────────────────────────────
// Contexte calendaire : jour, saison, moments commerciaux/culturels.
// Calculé dans le fuseau de l'avatar (Intl, pas de dépendance).
// ─────────────────────────────────────────────────────────────

export interface CalendarInfo {
  weekday: string; // "mardi 15 juillet"
  season: string;
  events: string[];
}

function parts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const label = fmt.format(date);
  const month = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "numeric" }).format(date),
  );
  const day = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).format(date),
  );
  return { label, month, day };
}

function season(month: number): string {
  if (month >= 3 && month <= 5) return "printemps";
  if (month >= 6 && month <= 8) return "été";
  if (month >= 9 && month <= 11) return "automne";
  return "hiver";
}

// Fenêtres commerciales/culturelles approximatives (hémisphère nord).
function events(month: number, day: number): string[] {
  const e: string[] = [];
  if (month === 1) e.push("début d'année, bonnes résolutions, nouveaux départs");
  if (month === 9) e.push("rentrée, reprise, nouveaux objectifs");
  if (month === 11 && day >= 20) e.push("Black Friday, période promotionnelle");
  if (month === 12) e.push("fêtes de fin d'année, bilan annuel");
  if (month === 6 && day <= 7) e.push("mi-année, point d'étape sur les objectifs");
  return e;
}

export function getCalendar(date: Date, timezone: string): CalendarInfo {
  const { label, month, day } = parts(date, timezone);
  return { weekday: label, season: season(month), events: events(month, day) };
}

// Heure locale (0-23) dans le fuseau donné.
export function localHour(date: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
}
