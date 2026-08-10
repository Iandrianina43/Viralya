import { RATIO_TARGET, type RatioClass } from "./enums.js";

// M3 — moteur de règle 70/20/10.

export function hasCta(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const signals = [
    "lien en bio", "link in bio", "lien en description", "achète", "achete", "commande",
    "réserve", "reserve", "inscris-toi", "inscription", "profite", "promo", "offre",
    "http://", "https://", "dm moi", "écris-moi", "ecris-moi", "-50%",
  ];
  return signals.some((s) => t.includes(s));
}

export function inferRatioClass(text: string): RatioClass {
  return hasCta(text) ? "sale" : "value";
}

export interface RatioCheck {
  ok: boolean;
  shares: Record<RatioClass, number>;
  violations: string[];
}

/** Valide un ensemble de classes contre 70/20/10 (sale ≤ 10% strict). */
export function checkRatio(classes: RatioClass[], tolerance = 0.1): RatioCheck {
  const counts: Record<RatioClass, number> = { value: 0, proof: 0, sale: 0 };
  for (const c of classes) counts[c] += 1;
  const total = classes.length || 1;
  const shares: Record<RatioClass, number> = {
    value: counts.value / total,
    proof: counts.proof / total,
    sale: counts.sale / total,
  };
  const violations: string[] = [];
  if (shares.sale > RATIO_TARGET.sale + 1e-9)
    violations.push(`Part vente ${(shares.sale * 100).toFixed(0)}% > 10%`);
  if (shares.value < RATIO_TARGET.value - tolerance)
    violations.push(`Part valeur ${(shares.value * 100).toFixed(0)}% trop basse`);
  return { ok: violations.length === 0, shares, violations };
}
