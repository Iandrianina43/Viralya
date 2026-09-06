import { extractJson } from "../lib/storage";
import { generateText } from "../providers/llm";

// ─────────────────────────────────────────────────────────────
// PORTRAIT STRUCTURÉ : la fiche visuelle du personnage est un JSON de champs
// précis (pré-rempli par l'IA, ajustable par l'utilisateur) → prompt image.
// Puis CHARACTER SHEET : planche 8 vues (4 pied + 4 buste) générée avec le
// portrait comme référence d'identité — elle sert de référence Seedance.
// ─────────────────────────────────────────────────────────────

/** Fiche portrait structurée (tous les champs sont du texte libre EN). */
export interface PortraitSpec {
  aspect_ratio: string;
  age: string;
  ethnicity: string;
  shot_style: string;
  framing: string;
  skin_tone: string;
  hair_style: string;
  hair_color: string;
  eyes: string;
  brows: string;
  nose: string;
  lips: string;
  facial_hair: string;
  face_shape: string;
  expression: string;
  clothing: string;
  makeup: string;
  lighting: string;
  background: string;
  realism: string;
}

export const PORTRAIT_FIELDS: Array<keyof PortraitSpec> = [
  "aspect_ratio", "age", "ethnicity", "shot_style", "framing", "skin_tone",
  "hair_style", "hair_color", "eyes", "brows", "nose", "lips", "facial_hair",
  "face_shape", "expression", "clothing", "makeup", "lighting", "background", "realism",
];

const PORTRAIT_DEFAULTS: PortraitSpec = {
  aspect_ratio: "3:4",
  age: "",
  ethnicity: "",
  shot_style: "professional portrait photograph",
  framing: "head and shoulders, looking at the camera",
  skin_tone: "",
  hair_style: "",
  hair_color: "",
  eyes: "",
  brows: "natural brows",
  nose: "natural nose",
  lips: "natural lips",
  facial_hair: "none",
  face_shape: "",
  expression: "soft natural smile",
  clothing: "",
  makeup: "minimal natural makeup",
  lighting: "soft natural light, golden hour",
  background: "softly blurred modern environment",
  realism:
    "highly photorealistic, authentic photograph quality, natural skin imperfections, realistic facial asymmetry, no beauty filter, no artificial smoothing, no CGI appearance",
};

/** Nettoie une fiche reçue (LLM ou formulaire) : champs connus uniquement + défauts. */
export function normalizePortraitSpec(raw: object | null | undefined): PortraitSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const spec = { ...PORTRAIT_DEFAULTS };
  for (const key of PORTRAIT_FIELDS) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) spec[key] = v.trim();
  }
  return spec;
}

/** Fiche portrait → prompt image (une ligne par champ renseigné). */
export function buildPortraitPrompt(spec: PortraitSpec): string {
  const s = normalizePortraitSpec(spec);
  return [
    `${s.shot_style}, ${s.framing}.`,
    `Subject: ${[s.age, s.ethnicity].filter(Boolean).join(", ") || "a person"}.`,
    s.skin_tone ? `Skin: ${s.skin_tone}.` : "",
    [s.hair_style, s.hair_color].filter(Boolean).length ? `Hair: ${[s.hair_style, s.hair_color].filter(Boolean).join(", ")}.` : "",
    s.eyes ? `Eyes: ${s.eyes}.` : "",
    `Brows: ${s.brows}. Nose: ${s.nose}. Lips: ${s.lips}.`,
    s.face_shape ? `Face shape: ${s.face_shape}.` : "",
    s.facial_hair && s.facial_hair !== "none" ? `Facial hair: ${s.facial_hair}.` : "",
    `Expression: ${s.expression}.`,
    s.clothing ? `Clothing: ${s.clothing}.` : "",
    s.makeup ? `Makeup: ${s.makeup}.` : "",
    `Lighting: ${s.lighting}. Background: ${s.background}.`,
    `Single person, face fully visible and sharp. ${s.realism}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

const SPEC_SYSTEM = `Tu remplis la fiche portrait d'un influenceur IA (personnage photoréaliste).
On te donne sa description (nom, niche, ville, personnalité, style, éventuellement une consigne libre).
Réponds UNIQUEMENT avec un objet JSON contenant EXACTEMENT ces clés (valeurs en ANGLAIS, courtes et concrètes) :
${JSON.stringify(PORTRAIT_FIELDS)}
Règles :
- "aspect_ratio": "3:4" (portrait vertical).
- Invente des traits PRÉCIS et cohérents avec le personnage (âge exact, origine, couleur/texture des cheveux, forme du visage…). Pas de valeurs vagues.
- "clothing": tenue cohérente avec sa niche et sa ville.
- "realism": toujours exiger un rendu photo authentique (imperfections de peau, asymétrie naturelle, pas de filtre beauté, pas de rendu CGI).
- "facial_hair": "none" pour une femme.`;

/** Pré-remplit la fiche portrait depuis la description du personnage (LLM). */
export async function draftPortraitSpec(input: {
  name?: string;
  niche?: string | null;
  city?: string | null;
  sex_age?: string | null;
  nationality?: string | null;
  personality?: string[] | null;
  clothing_style?: string | null;
  brief?: string; // consigne libre de l'utilisateur
}): Promise<PortraitSpec> {
  const user = [
    `PERSONNAGE : ${input.name ?? "?"}${input.niche ? ` — ${input.niche}` : ""}${input.city ? ` — vit à ${input.city}` : ""}.`,
    input.sex_age ? `Sexe/âge : ${input.sex_age}.` : "",
    input.nationality ? `Origine : ${input.nationality}.` : "",
    input.personality?.length ? `Personnalité : ${input.personality.slice(0, 5).join(", ")}.` : "",
    input.clothing_style ? `Style vestimentaire : ${input.clothing_style}.` : "",
    input.brief ? `CONSIGNE DE L'UTILISATEUR (priorité) : ${input.brief}` : "",
    `Remplis la fiche.`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await generateText(SPEC_SYSTEM, user, 1200);
  const parsed = extractJson<Record<string, unknown>>(raw);
  if (!parsed) throw new Error("fiche portrait : réponse du modèle inexploitable");
  return normalizePortraitSpec(parsed);
}

// ── Character sheet (planche 8 vues, référence d'identité Seedance) ──

/**
 * Prompt de la planche multi-angles. L'identité vient de l'image de référence
 * (le portrait) passée à /images/edits ; la fiche apporte tenue et cohérence.
 */
export function buildCharacterSheetPrompt(spec: PortraitSpec | null): string {
  const s = spec ? normalizePortraitSpec(spec) : null;
  return [
    "Character reference sheet, 16:9, single character depicted eight times in a grid layout on a clean solid light grey background.",
    "Use the reference image as the definitive identity and face for ALL depictions: exact same face, hair, skin tone and features in every view.",
    "Upper row, four full-body standing views: front view (neutral standing, arms relaxed); three-quarter front view (turned slightly left, looking straight ahead); left side profile view (standing straight); back view (back to camera).",
    "Lower row, four close-up bust views: front close-up (neutral expression); three-quarter close-up (slight smile); left profile close-up; three-quarter rear close-up looking over the shoulder.",
    s?.clothing ? `Clothing in all views: ${s.clothing}.` : "Simple understated everyday outfit, identical in all views.",
    "Soft even studio lighting. No text, no annotations.",
    s?.realism ?? PORTRAIT_DEFAULTS.realism,
  ].join(" ");
}
