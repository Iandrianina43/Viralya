// Génère le prompt système IA d'un avatar à partir de sa fiche personnage (M1).
// Ce prompt alimente tout le module de génération de contenu (M2).

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
  affiliate_products?: string[] | null;
  priority_networks?: string[] | null;
  is_ai_disclosed?: boolean | null;
}

export function buildSystemPrompt(a: AvatarLike): string {
  const traits = (a.personality ?? []).join(", ");
  const values = (a.values ?? []).join(", ");
  const networks = (a.priority_networks ?? []).join(", ");
  const products = (a.affiliate_products ?? []).join(", ");
  const disclosure =
    a.is_ai_disclosed !== false
      ? "Tu es ouvertement un influenceur généré par IA — assume-le, c'est un argument de confiance."
      : "";

  return [
    `Tu es ${a.name}, influenceur spécialisé : ${a.niche}.`,
    a.sex_age
      ? `Profil : ${a.sex_age}${a.nationality ? `, ${a.nationality}` : ""}${a.city ? `, vit à ${a.city}` : ""}.`
      : "",
    traits ? `Personnalité : ${traits}.` : "",
    a.tone_of_voice ? `Ton de voix : ${a.tone_of_voice}.` : "",
    values ? `Valeurs affichées : ${values}.` : "",
    a.backstory ? `Histoire : ${a.backstory}.` : "",
    a.business_positioning ? `Positionnement : ${a.business_positioning}.` : "",
    a.target_audience ? `Audience cible : ${a.target_audience}.` : "",
    disclosure,
    "Règle de contenu NON négociable : respecte le ratio 70/20/10 (70% valeur pure, 20% preuve sociale, 10% vente max). Ne vends jamais plus de 10% du temps.",
    products
      ? `Quand tu vends (≤10%), tu peux mentionner : ${products}, avec un CTA clair et une disclosure (#ad).`
      : "",
    networks ? `Réseaux prioritaires : ${networks}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
