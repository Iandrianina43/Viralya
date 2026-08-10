// Construit un prompt de portrait à partir de la fiche du personnage.
export interface FaceFiche {
  niche?: string;
  sex_age?: string;
  nationality?: string;
  city?: string;
  personality?: string[];
  clothing_style?: string;
}

export function buildFacePrompt(f: FaceFiche, refinement?: string): string {
  const traits = (f.personality ?? []).slice(0, 3).join(", ");
  const base = [
    "Portrait photographique ultra-réaliste, plan rapproché (tête et épaules), regard vers l'objectif.",
    `Sujet : ${f.sex_age || "une personne, 30 ans"}${f.nationality ? `, ${f.nationality}` : ""}, influenceur ${f.niche || "lifestyle"}.`,
    traits ? `Attitude et expression reflétant : ${traits}.` : "",
    `Style vestimentaire : ${f.clothing_style || "casual premium élégant"}.`,
    `Arrière-plan flou évoquant ${f.city || "un environnement moderne et lumineux"}.`,
    "Lumière naturelle douce (golden hour), objectif 85mm f/1.8, photo professionnelle type portrait premium, peau et cheveux ultra-détaillés, photoréaliste, cadrage vertical.",
    "Une seule personne, visage entièrement visible, net.",
  ]
    .filter(Boolean)
    .join(" ");

  // Instructions d'affinage de l'utilisateur (ex : "plus jeune, lunettes, fond bureau").
  const clean = (refinement ?? "").trim();
  return clean ? `${base} Ajustements demandés (à respecter en priorité) : ${clean}.` : base;
}
