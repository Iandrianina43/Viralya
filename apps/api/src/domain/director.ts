import { extractJson } from "../lib/storage";
import { generateText, streamText } from "../providers/llm";
import { VLOG_PRESETS } from "../providers/higgsfield";

// ─────────────────────────────────────────────────────────────
// Le RÉALISATEUR IA : Claude écrit l'histoire d'un vlog complet et le
// découpe en scènes (il décide du nombre selon l'histoire, 3 à 6).
// Sortie streaming : l'histoire s'écrit en direct, puis le JSON des scènes.
// ─────────────────────────────────────────────────────────────

export interface VlogScene {
  titre: string; // ex. "Réveil face au miroir"
  mode: "talk" | "voiceover"; // talk = elle parle face caméra (lip-sync) ; voiceover = ambiance + voix off
  texte: string; // ce qu'elle dit (FR) — réplique (talk) ou narration (voiceover)
  soul_prompt: string; // EN — action + cadrage pour l'image (le décor vient du lieu)
  motion_prompt: string; // EN — mouvement caméra/sujet pour l'animation (DoP)
  location_key?: string; // lieu de l'univers où se tourne la scène
  // Lieu inédit. scope = "permanent" (il fait partie de sa vie : sa salle de bain)
  // ou "oneoff" (lieu de passage d'une seule vidéo : les toilettes d'un McDo).
  new_location?: { key: string; name: string; description: string; scope?: "permanent" | "oneoff" };
}

export interface VlogProduction {
  title: string;
  story: string; // l'histoire lisible (FR), streamée en direct
  caption: string;
  hashtags: string[];
  scenes: VlogScene[];
}

const DELIM = "§§§SCENES§§§";

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

/** Nettoie/valide les scènes renvoyées par le LLM. */
export function normalizeScenes(raw: VlogScene[]): VlogScene[] {
  return (raw ?? [])
    .filter((s) => s && typeof s.texte === "string" && typeof s.soul_prompt === "string")
    .slice(0, 6)
    .map((s) => ({
      titre: String(s.titre ?? "Scène"),
      mode: s.mode === "talk" ? ("talk" as const) : ("voiceover" as const),
      texte: String(s.texte).trim(),
      soul_prompt: String(s.soul_prompt).trim(),
      motion_prompt: String(s.motion_prompt ?? "natural subtle movement, cinematic handheld camera").trim(),
      ...(s.location_key ? { location_key: slug(s.location_key) } : {}),
      ...(s.new_location?.key && s.new_location.description
        ? {
            new_location: {
              key: slug(s.new_location.key),
              name: String(s.new_location.name ?? s.new_location.key),
              description: String(s.new_location.description),
              scope: s.new_location.scope === "oneoff" ? ("oneoff" as const) : ("permanent" as const),
            },
          }
        : {}),
    }));
}

const SYSTEM = `Tu es le RÉALISATEUR d'un vlog court (TikTok/Reels, vertical 9:16) pour un influenceur IA.
Ta mission : écrire une mini-histoire vécue AUJOURD'HUI par le personnage, puis la découper en scènes tournables.

RÈGLES DES SCÈNES :
- Tu DÉCIDES du nombre de scènes selon l'histoire (3 à 6). Chaque scène = un plan de ~5-10 secondes.
- Alterne les modes : "talk" (elle parle face caméra, réplique courte et naturelle) et "voiceover" (plan d'ambiance, elle ne parle pas à la caméra, narration voix off).
- La 1re scène doit accrocher en 2 secondes. La dernière conclut (punchline/invitation douce, pas de vente).
- "texte" : FRANÇAIS parlé naturel (comme une vraie personne, contractions, spontané). 1-2 phrases max par scène.
- "location_key" : chaque scène se tourne dans UN lieu de l'UNIVERS fourni (utilise sa key). PRIVILÉGIE les lieux existants (c'est sa vraie vie, ses vrais endroits). Si l'histoire exige un lieu inédit, mets "new_location": {"key":"<slug-en>","name":"<nom FR>","description":"<canonical EN description figée, 40-70 mots : murs, meubles, couleurs, lumière>"} — il rejoindra son univers.
- "soul_prompt" : ANGLAIS. L'ACTION et le CADRAGE seulement (medium shot / wide full-body shot…, sa tenue, son geste, la lumière du moment). NE re-décris PAS le décor : il est fourni par le lieu. JAMAIS de gros plan visage serré.
- "motion_prompt" : ANGLAIS. Le mouvement du sujet + de la caméra (handheld, push-in, tracking…), style cinématique naturel.
- Cohérence : même tenue et même moment de la journée sur toutes les scènes (c'est un seul vlog).

FORMAT DE SORTIE STRICT (streaming) :
1) D'ABORD écris l'HISTOIRE en français (3-5 phrases vivantes, comme si le personnage racontait sa journée). Pas de JSON ici.
2) PUIS, sur une nouvelle ligne, écris EXACTEMENT ${DELIM}
3) PUIS le JSON :
{"title": "<titre court du vlog>", "caption": "<caption du post, FR, avec 1-2 emojis>", "hashtags": ["#...", ...], "scenes": [{"titre": "...", "mode": "talk"|"voiceover", "texte": "...", "location_key": "<key>", "new_location": {...} | null, "soul_prompt": "...", "motion_prompt": "..."}]}
N'écris RIEN après le JSON.`;

// ─────────────────────────────────────────────────────────────
// MODE ASSISTANT (étape par étape) : on sépare l'écriture de l'histoire
// (validée/affinée par l'utilisateur) du découpage en scènes.
// ─────────────────────────────────────────────────────────────

const STORY_DELIM = "§§§META§§§";

const STORY_SYSTEM = `Tu es le RÉALISATEUR d'un vlog court (TikTok/Reels) pour un influenceur IA.
Écris UNE mini-histoire vécue AUJOURD'HUI par le personnage : un moment de vie authentique, incarné, avec un petit fil narratif (une envie, un imprévu, une découverte).

RÈGLES :
- 3 à 5 phrases, en français, à la 3e personne, vivantes et concrètes (on doit VOIR les images).
- Ancre-la dans son vrai contexte (météo, heure, saison) et dans ses lieux habituels.
- Reste cohérent avec sa personnalité et sa mémoire. Pas de vente.
- Si l'utilisateur demande des modifications, RÉÉCRIS l'histoire en tenant compte de sa demande (garde ce qui marchait).

FORMAT DE SORTIE STRICT (streaming) :
1) D'ABORD l'HISTOIRE en texte simple. Pas de JSON ici.
2) PUIS sur une nouvelle ligne EXACTEMENT ${STORY_DELIM}
3) PUIS le JSON : {"title": "<titre court du vlog>", "caption": "<caption du post, FR, 1-2 emojis>", "hashtags": ["#..."]}
N'écris RIEN après le JSON.`;

export interface StoryInput {
  name: string;
  niche: string | null;
  city: string | null;
  system_prompt: string | null;
  presetKey?: string;
  brief?: string; // brief libre de l'utilisateur
  contextBrief: string;
  memoryBrief: string;
  locations: Array<{ key: string; name: string; description: string }>;
  previousStory?: string; // histoire précédente à retravailler
  instruction?: string; // ce que l'utilisateur veut changer
}

export interface StoryResult { title: string; story: string; caption: string; hashtags: string[] }

function characterBlock(i: StoryInput): string {
  return [
    `PERSONNAGE : ${i.name}${i.niche ? ` — ${i.niche}` : ""}${i.city ? ` — vit à ${i.city}` : ""}.`,
    i.system_prompt ? `SA PERSONNALITÉ :\n${i.system_prompt.slice(0, 1200)}` : "",
    i.contextBrief ? `CONTEXTE RÉEL DU JOUR :\n${i.contextBrief}` : "",
    i.memoryBrief ? `SA MÉMOIRE :\n${i.memoryBrief}` : "",
    i.locations.length ? `SES LIEUX :\n${i.locations.map((l) => `- ${l.key} · ${l.name}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Étape 1 : écrit (ou réécrit) l'histoire, en streaming. */
export async function writeStory(input: StoryInput, onToken: (t: string) => void): Promise<StoryResult> {
  const preset = input.presetKey ? VLOG_PRESETS[input.presetKey] : undefined;
  const user = [
    characterBlock(input),
    input.brief ? `DEMANDE DE L'UTILISATEUR : ${input.brief}` : preset ? `TYPE DE VLOG : ${preset.label} — ambiance : ${preset.scene}` : "",
    input.previousStory ? `HISTOIRE PRÉCÉDENTE :\n${input.previousStory}` : "",
    input.instruction ? `MODIFICATIONS DEMANDÉES : ${input.instruction}` : "",
    `Écris l'histoire.`,
  ].filter(Boolean).join("\n\n");

  let full = "";
  let emitted = 0;
  let delimFound = false;
  await streamText(STORY_SYSTEM, user, (tok) => {
    full += tok;
    if (delimFound) return;
    const idx = full.indexOf(STORY_DELIM);
    if (idx !== -1) {
      if (idx > emitted) onToken(full.slice(emitted, idx));
      emitted = idx;
      delimFound = true;
    } else {
      const safe = full.length - STORY_DELIM.length;
      if (safe > emitted) { onToken(full.slice(emitted, safe)); emitted = safe; }
    }
  }, 1200);

  const story = (delimFound ? full.slice(0, full.indexOf(STORY_DELIM)) : full).trim();
  const meta = extractJson<{ title?: string; caption?: string; hashtags?: string[] }>(
    delimFound ? full.slice(full.indexOf(STORY_DELIM) + STORY_DELIM.length) : "",
  );
  return {
    title: meta?.title ?? "Vlog du jour",
    story,
    caption: meta?.caption ?? "",
    hashtags: Array.isArray(meta?.hashtags) ? meta!.hashtags! : [],
  };
}

const SCENES_SYSTEM = `Tu es le RÉALISATEUR. On te donne une HISTOIRE validée : découpe-la en scènes tournables (vertical 9:16).

RÈGLES :
- Respecte la DURÉE CIBLE : chaque scène dure ~6 secondes. Produis donc le nombre de scènes correspondant (arrondis au plus proche, min 2, max 6).
- Alterne "talk" (elle parle face caméra, réplique courte) et "voiceover" (plan d'ambiance, narration off).
- 1re scène = accroche en 2 secondes. Dernière = conclusion.
- "texte" : FRANÇAIS parlé naturel, 1-2 phrases max par scène.
- "location_key" : le lieu de l'UNIVERS où se tourne la scène. Si un lieu inédit est nécessaire, ajoute "new_location": {"key","name","description","scope"} (description canonique EN figée, 40-70 mots).
- "scope" du nouveau lieu : "permanent" si le lieu fait partie de sa VIE et reviendra (sa salle de bain, son salon, sa salle de sport habituelle) ; "oneoff" si c'est un lieu de PASSAGE vu une seule fois (les toilettes d'un fast-food, une chambre d'hôtel en voyage, un resto testé une fois).
- "soul_prompt" : ANGLAIS, l'ACTION + le CADRAGE seulement (medium shot / wide full-body shot…, tenue, geste, lumière). NE re-décris PAS le décor. Jamais de gros plan visage serré.
- "motion_prompt" : ANGLAIS, mouvement du sujet + caméra, cinématique.
- Cohérence : même tenue, même moment de la journée sur toutes les scènes.
- Si l'utilisateur demande des modifications sur un découpage précédent, applique-les.

Réponds UNIQUEMENT en JSON :
{"scenes":[{"titre","mode":"talk"|"voiceover","texte","location_key","new_location":null,"soul_prompt","motion_prompt"}]}`;

/** Étape 2 : découpe l'histoire validée en scènes, pour une durée cible. */
export async function breakIntoScenes(
  input: StoryInput & { story: string; durationSec: number; previousScenes?: VlogScene[] },
): Promise<VlogScene[]> {
  const user = [
    characterBlock(input),
    input.locations.length ? `DESCRIPTIONS DES LIEUX :\n${input.locations.map((l) => `- ${l.key} : ${l.description}`).join("\n")}` : "",
    `HISTOIRE VALIDÉE :\n${input.story}`,
    `DURÉE CIBLE : ${input.durationSec} secondes (~${Math.max(2, Math.min(6, Math.round(input.durationSec / 6)))} scènes).`,
    input.previousScenes?.length ? `DÉCOUPAGE PRÉCÉDENT :\n${JSON.stringify(input.previousScenes)}` : "",
    input.instruction ? `MODIFICATIONS DEMANDÉES : ${input.instruction}` : "",
    `Découpe en scènes.`,
  ].filter(Boolean).join("\n\n");

  const raw = await generateText(SCENES_SYSTEM, user, 2500);
  const parsed = extractJson<{ scenes?: VlogScene[] }>(raw);
  const scenes = normalizeScenes(parsed?.scenes ?? []);
  if (scenes.length === 0) throw new Error("Découpage impossible — réessaie ou reformule l'histoire.");
  return scenes;
}

export interface DirectorInput {
  name: string;
  niche: string | null;
  city: string | null;
  system_prompt: string | null;
  presetKey: string;
  contextBrief: string; // météo / heure / saison
  memoryBrief: string; // mémoire narrative
  locations: Array<{ key: string; name: string; description: string }>; // univers de lieux
}

export async function directVlog(input: DirectorInput, onToken: (t: string) => void): Promise<VlogProduction> {
  const preset = VLOG_PRESETS[input.presetKey];
  const user = [
    `PERSONNAGE : ${input.name}${input.niche ? ` — ${input.niche}` : ""}${input.city ? ` — vit à ${input.city}` : ""}.`,
    input.system_prompt ? `SA PERSONNALITÉ :\n${input.system_prompt.slice(0, 1200)}` : "",
    input.contextBrief ? `CONTEXTE RÉEL DU JOUR (utilise-le : météo, heure, saison) :\n${input.contextBrief}` : "",
    input.memoryBrief ? `SA MÉMOIRE (reste cohérent avec sa vie) :\n${input.memoryBrief}` : "",
    input.locations.length
      ? `SON UNIVERS DE LIEUX (tourne dans ces endroits, c'est chez elle) :\n${input.locations.map((l) => `- key "${l.key}" · ${l.name} : ${l.description}`).join("\n")}`
      : `SON UNIVERS DE LIEUX : vide pour l'instant — crée les lieux nécessaires via "new_location".`,
    `TYPE DE VLOG DEMANDÉ : ${preset?.label ?? input.presetKey} — ambiance de départ : ${preset?.scene ?? "moment de vie authentique"}.`,
    `Écris l'histoire puis les scènes.`,
  ].filter(Boolean).join("\n\n");

  let full = "";
  let emitted = 0;
  let delimFound = false;

  await streamText(SYSTEM, user, (tok) => {
    full += tok;
    if (delimFound) return;
    const idx = full.indexOf(DELIM);
    if (idx !== -1) {
      if (idx > emitted) onToken(full.slice(emitted, idx));
      emitted = idx;
      delimFound = true;
    } else {
      const safe = full.length - DELIM.length;
      if (safe > emitted) {
        onToken(full.slice(emitted, safe));
        emitted = safe;
      }
    }
  }, 2500);

  const story = (delimFound ? full.slice(0, full.indexOf(DELIM)) : full).trim();
  if (!delimFound && full.length > emitted) onToken(full.slice(emitted));

  const dataStr = delimFound ? full.slice(full.indexOf(DELIM) + DELIM.length) : full;
  const parsed = extractJson<{ title?: string; caption?: string; hashtags?: string[]; scenes?: VlogScene[] }>(dataStr);
  const scenes = normalizeScenes(parsed?.scenes ?? []);
  if (scenes.length === 0) throw new Error("Le réalisateur n'a pas produit de scènes exploitables.");

  return {
    title: parsed?.title ?? "Vlog du jour",
    story,
    caption: parsed?.caption ?? "",
    hashtags: Array.isArray(parsed?.hashtags) ? parsed!.hashtags! : [],
    scenes,
  };
}
