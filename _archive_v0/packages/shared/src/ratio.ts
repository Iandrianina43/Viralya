import { RATIO_TARGET, type RatioClass } from "./enums.js";

// ─────────────────────────────────────────────────────────────
// M3 — Moteur de règle 70/20/10.
// Contrôle que le plan de contenu respecte le ratio value/proof/sale
// et que la part "sale" ne dépasse jamais 10 % (garde-fou non négociable).
// ─────────────────────────────────────────────────────────────

export interface RatioCheck {
  ok: boolean;
  counts: Record<RatioClass, number>;
  shares: Record<RatioClass, number>;
  violations: string[];
}

/** Détecte un CTA / lien de vente dans un texte (heuristique simple). */
export function hasCta(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const signals = [
    "lien en bio",
    "link in bio",
    "lien en description",
    "achète",
    "achete",
    "commande",
    "réserve",
    "reserve",
    "inscris-toi",
    "inscription",
    "profite",
    "-50%",
    "promo",
    "offre",
    "http://",
    "https://",
    "dm moi",
    "écris-moi",
    "ecris-moi",
  ];
  return signals.some((s) => t.includes(s));
}

/** Classe par défaut d'un contenu selon la présence d'un CTA. */
export function inferRatioClass(text: string): RatioClass {
  return hasCta(text) ? "sale" : "value";
}

/**
 * Valide un ensemble de content_items (par leur ratio_class) contre 70/20/10.
 * Tolérance de ±10 points sur value/proof ; "sale" strictement ≤ 10 %.
 */
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
  // Garde-fou dur : jamais plus de 10 % de vente.
  if (shares.sale > RATIO_TARGET.sale + 1e-9) {
    violations.push(
      `Part "sale" ${(shares.sale * 100).toFixed(0)}% > 10% (max non négociable)`,
    );
  }
  if (shares.value < RATIO_TARGET.value - tolerance) {
    violations.push(
      `Part "value" ${(shares.value * 100).toFixed(0)}% < ${((RATIO_TARGET.value - tolerance) * 100).toFixed(0)}%`,
    );
  }

  return { ok: violations.length === 0, counts, shares, violations };
}
