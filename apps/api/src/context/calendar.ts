// Contexte calendaire (jour, saison, moments) dans le fuseau de l'avatar.
export interface CalendarInfo {
  weekday: string;
  season: string;
  events: string[];
}

function parts(date: Date, tz: string) {
  const label = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(date);
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(date));
  const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(date));
  return { label, month, day };
}

function season(m: number): string {
  if (m >= 3 && m <= 5) return "printemps";
  if (m >= 6 && m <= 8) return "été";
  if (m >= 9 && m <= 11) return "automne";
  return "hiver";
}

function events(m: number, d: number): string[] {
  const e: string[] = [];
  if (m === 1) e.push("début d'année, bonnes résolutions");
  if (m === 9) e.push("rentrée, reprise, nouveaux objectifs");
  if (m === 11 && d >= 20) e.push("Black Friday, période promotionnelle");
  if (m === 12) e.push("fêtes de fin d'année, bilan annuel");
  if (m === 6 && d <= 7) e.push("mi-année, point d'étape");
  return e;
}

export function getCalendar(date: Date, tz: string): CalendarInfo {
  const { label, month, day } = parts(date, tz);
  return { weekday: label, season: season(month), events: events(month, day) };
}

export function localHour(date: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date));
}
