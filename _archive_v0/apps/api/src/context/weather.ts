import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Météo temps réel via Open-Meteo (100% gratuit, AUCUNE clé API).
// Non bloquant : toute erreur → null (le contexte omet la météo).
// ─────────────────────────────────────────────────────────────

export interface WeatherInfo {
  tempC: number;
  description: string;
}

// Codes météo WMO → description FR.
const WMO: Record<number, string> = {
  0: "ciel dégagé",
  1: "plutôt ensoleillé",
  2: "partiellement nuageux",
  3: "couvert",
  45: "brouillard",
  48: "brouillard givrant",
  51: "bruine légère",
  53: "bruine",
  55: "bruine dense",
  61: "pluie faible",
  63: "pluie",
  65: "forte pluie",
  71: "neige faible",
  73: "neige",
  75: "forte neige",
  80: "averses",
  81: "averses",
  82: "fortes averses",
  95: "orage",
  96: "orage avec grêle",
  99: "orage violent",
};

const geoCache = new Map<string, { lat: number; lon: number } | null>();

async function geocode(city: string): Promise<{ lat: number; lon: number } | null> {
  const key = city.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr`;
  const res = await fetch(url);
  if (!res.ok) {
    geoCache.set(key, null);
    return null;
  }
  const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
  const first = data.results?.[0];
  const loc = first ? { lat: first.latitude, lon: first.longitude } : null;
  geoCache.set(key, loc);
  return loc;
}

export async function getWeather(city: string, timezone: string): Promise<WeatherInfo | null> {
  if (!city) return null;
  try {
    const loc = await geocode(city);
    if (!loc) return null;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,weather_code&timezone=${encodeURIComponent(timezone || "auto")}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = data.current?.temperature_2m;
    if (typeof temp !== "number") return null;
    return {
      tempC: Math.round(temp),
      description: WMO[data.current?.weather_code ?? -1] ?? "temps variable",
    };
  } catch (err) {
    logger.warn("weather_failed", { city, err: String((err as Error)?.message ?? err) });
    return null;
  }
}
