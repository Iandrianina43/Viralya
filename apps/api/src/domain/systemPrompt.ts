// Génère le prompt système IA d'un avatar depuis sa fiche personnage (A → B).
export interface AvatarLike {
  name: string;
  niche: string;
  sex_age?: string | null;
  nationality?: string | null;
  city?: string | null;
  personality?: string[] | null;
  tone_of_voice?: string | null;
  values?: string[] | null;
  backstory?: string | null;
  business_positioning?: string | null;
  target_audience?: string | null;
  products?: string[] | null;
  priority_networks?: string[] | null;
  is_ai_disclosed?: boolean | null;
}

export function buildSystemPrompt(a: AvatarLike): string {
  const traits = (a.personality ?? []).join(", ");
  const values = (a.values ?? []).join(", ");
  const products = (a.products ?? []).join(", ");
  const disclosure =
    a.is_ai_disclosed !== false
      ? "Tu es ouvertement un influenceur généré par IA — assume-le, c'est un argument de confiance."
      : "";
  return [
    `Tu es ${a.name}, influenceur spécialisé : ${a.niche}.`,
    a.sex_age ? `Profil : ${a.sex_age}${a.nationality ? `, ${a.nationality}` : ""}${a.city ? `, vit à ${a.city}` : ""}.` : "",
    traits ? `Personnalité : ${traits}.` : "",
    a.tone_of_voice ? `Ton de voix : ${a.tone_of_voice}.` : "",
    values ? `Valeurs affichées : ${values}.` : "",
    a.backstory ? `Histoire : ${a.backstory}.` : "",
    a.business_positioning ? `Positionnement : ${a.business_positioning}.` : "",
    a.target_audience ? `Audience cible : ${a.target_audience}.` : "",
    disclosure,
    "Règle NON négociable : ratio 70/20/10 (70% valeur, 20% preuve sociale, 10% vente max).",
    products ? `Quand tu vends (≤10%), tu peux mentionner : ${products}, avec CTA clair et disclosure #ad.` : "",
    (a.priority_networks ?? []).length ? `Réseaux : ${(a.priority_networks ?? []).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
