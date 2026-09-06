import { extractJson } from "../lib/storage";
import { logger } from "../logger";
import { generateText, streamText } from "../providers/llm";
import { SEGMENT_MAX_SECONDS, SEGMENT_MIN_SECONDS } from "../providers/piapi";

// ─────────────────────────────────────────────────────────────
// Le RÉALISATEUR IA : Claude écrit l'histoire d'un vlog complet et le
// découpe en SEGMENTS Seedance 2.0 (4-15 s chacun, il décide du nombre).
// Le vlog est un PLAN-SÉQUENCE continu : chaque segment prolonge le
// précédent (extension vidéo), l'audio (voix + ambiance) est généré
// nativement par Seedance au timbre des échantillons de l'avatar.
// Sortie streaming : l'histoire s'écrit en direct, puis le JSON des scènes.
// ─────────────────────────────────────────────────────────────

/** Un plan de la shot list, avec sa timeline DANS le segment (ex. t: "0-5s"). */
export interface SceneShot { t: string; desc: string }

/**
 * Insert PHOTO (format hybride) : plan de coupe de 1,5-3 s incrusté PENDANT qu'elle
 * parle, ancré sur des mots exacts du texte (l'horodatage vient de la voix ElevenLabs).
 * framing = keyframe du décor dans ce cadrage (cache, ≈ 0,07 $ une fois) ; "location" = le décor seul.
 */
export type InsertFraming = "illustration" | "location" | "close" | "full" | "selfie";
export interface SceneInsert { anchor: string; framing: InsertFraming; desc?: string }
export const INSERT_FRAMINGS: InsertFraming[] = ["illustration", "location", "close", "full", "selfie"];

export type VlogFormat = "hybrid" | "seedance";

export interface VlogScene {
  titre: string; // ex. "Réveil face au miroir"
  mode: "talk" | "voiceover"; // talk = elle parle face caméra ; voiceover = narration off sur plan d'ambiance
  texte: string; // ce qu'elle dit (FR) — réplique (talk) ou narration (voiceover)
  duration_sec: number; // durée du segment (4-15 s)
  // ── Direction cinématographique : les éléments du prompt Seedance (EN).
  // Le Sujet (références @image) et le suffixe Qualité sont standardisés côté code.
  action: string; // 2. Action — ce qu'elle fait, verbes concrets
  shots: SceneShot[]; // shot list du segment (2-4 plans avec timeline) — rendu dynamique
  scene_desc: string; // 3. Scène — détails d'environnement au-delà du lieu canonique
  camera: string; // 4. Caméra — mouvement + angle
  lighting: string; // 5. Éclairage & style visuel
  audio_ambiance: string; // 6. Audio — sons d'ambiance (le dialogue vient de "texte")
  constraints: string; // 8. Contraintes — décidées par le réalisateur selon le contexte
  inserts?: SceneInsert[]; // hybride, scènes "talk" : 0-2 inserts photo pendant la parole
  location_key?: string; // lieu de l'univers où se tourne la scène
  // Lieu inédit. scope = "permanent" (il fait partie de sa vie : sa salle de bain)
  // ou "oneoff" (lieu de passage d'une seule vidéo : les toilettes d'un McDo).
  new_location?: { key: string; name: string; description: string; scope?: "permanent" | "oneoff" };
}

// Presets de vlog (ambiances de départ pour le réalisateur).
export const VLOG_PRESETS: Record<string, { label: string; scene: string }> = {
  grwm: { label: "Get Ready With Me", scene: "getting ready in the morning, bathroom routine, cozy and bright" },
  coffee: { label: "Prends un café avec moi", scene: "coffee break at a cozy café terrace, warm light, relaxed urban vibe" },
  walk: { label: "Balade dans la rue", scene: "walking through a charming city street, casual outfit, natural daylight" },
  vlog: { label: "Mini-vlog du jour", scene: "candid lifestyle moment, natural light, authentic influencer vibe" },
};

export interface VlogProduction {
  title: string;
  story: string; // l'histoire lisible (FR), streamée en direct
  caption: string;
  hashtags: string[];
  scenes: VlogScene[];
}

const DELIM = "§§§SCENES§§§";

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Texte replié pour comparer des mots (minuscules, sans accents ni ponctuation). */
export const foldText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const fold = foldText;

/** Inserts d'une scène parlée : ancre = mots exacts présents dans le texte, sinon écartés. */
function normalizeInserts(raw: unknown, texte: string): SceneInsert[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const t = fold(texte);
  const out: SceneInsert[] = [];
  for (const i of raw as Array<Partial<SceneInsert>>) {
    const anchor = str(i?.anchor);
    if (!anchor || !t.includes(fold(anchor))) continue;
    const desc = str(i?.desc);
    // Sans cadrage valide : une description → illustration de ce dont elle parle, sinon le décor.
    const framing: InsertFraming = INSERT_FRAMINGS.includes(i?.framing as InsertFraming) ? (i!.framing as InsertFraming) : desc ? "illustration" : "location";
    if (framing === "illustration" && !desc) continue;
    out.push({ anchor, framing, ...(desc ? { desc } : {}) });
    if (out.length >= 2) break;
  }
  return out.length ? out : undefined;
}

/** Nettoie/valide les scènes renvoyées par le LLM. */
export function normalizeScenes(raw: VlogScene[]): VlogScene[] {
  return (raw ?? [])
    .filter((s) => s && typeof s.texte === "string")
    .slice(0, 8)
    .map((s) => {
      const legacy = `${str((s as any).video_prompt)} ${str((s as any).soul_prompt)} ${str((s as any).motion_prompt)}`.trim();
      const mode = s.mode === "talk" ? ("talk" as const) : ("voiceover" as const);
      const inserts = mode === "talk" ? normalizeInserts((s as any).inserts, String(s.texte)) : undefined;
      return {
        titre: String(s.titre ?? "Scène"),
        mode,
        texte: String(s.texte).trim(),
        ...(inserts ? { inserts } : {}),
        duration_sec: Math.min(SEGMENT_MAX_SECONDS, Math.max(SEGMENT_MIN_SECONDS, Math.round(Number(s.duration_sec) || 12))),
        action: str(s.action, legacy || "candid lifestyle moment, natural gestures"),
        shots: Array.isArray(s.shots)
          ? s.shots
              .filter((sh) => sh && typeof (sh as SceneShot).desc === "string" && String((sh as SceneShot).desc).trim())
              .slice(0, 4)
              .map((sh) => ({ t: str((sh as SceneShot).t), desc: String((sh as SceneShot).desc).trim() }))
          : [],
        scene_desc: str(s.scene_desc),
        camera: str(s.camera, "handheld vlog camera, medium shot, natural movement"),
        lighting: str(s.lighting, "natural light, photorealistic cinematic style"),
        audio_ambiance: str(s.audio_ambiance, "natural ambient sound of the location"),
        constraints: str(s.constraints),
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
      };
    });
}

// ─────────────────────────────────────────────────────────────
// PROMPT DE SEGMENT SEEDANCE — structure en 8 éléments, toujours dans cet ordre :
//   1. Sujet  2. Action (+ timeline d'UNE prise continue)  3. Scène
//   4. Caméra  5. Éclairage & style  6. Audio  7. Qualité  8. Contraintes
// Références citées (indices DYNAMIQUES, ils doivent correspondre aux listes
// envoyées) : @image1 = portrait, @image2 = character sheet (si fournie),
// @imageN = photo du LIEU (si fournie), @audio1/@audio2 = timbre de voix,
// @video1 = LE SEGMENT PRÉCÉDENT EN ENTIER (extension).
// ─────────────────────────────────────────────────────────────

const QUALITY_SUFFIX = "4K, ultra HD, rich detail, cinematic textures, realistic skin texture, film grain";
// B-roll hybride : rendu « vidéo de téléphone » (guides réalisme 2026) — pas de vocabulaire
// « 4K / ultra HD / flawless » qui tire vers l'image lisse et idéalisée.
const BROLL_QUALITY = "candid handheld smartphone footage, natural unretouched skin with visible pores, no beauty filter, one coherent natural light source, mild sensor grain, slightly imperfect framing";
// Socle non négociable — le réalisateur ajoute ses contraintes contextuelles par scène.
// « prise unique sans coupe » : les timelines décrivent des évolutions de caméra, jamais des cuts.
const BASE_CONSTRAINTS =
  "no distortion, no morphing, exact face and outfit consistency with the reference images, single consistent person, one single uninterrupted take with NO cuts, no shot changes, no scene transitions";

// ── B-ROLL (vidéo v2 hybride) : plan d'illustration SANS parole ────────────
// La narration (voix off ElevenLabs) est mixée au montage ; Seedance ne doit
// produire ni dialogue ni mouvement de lèvres, seulement l'action et l'ambiance.
export interface BrollPromptRefs {
  hasSheet: boolean;
  hasLocationImage: boolean;
  /** Keyframe (elle dans ce décor, tenue de la scène) fourni juste après le lieu. */
  hasKeyframe: boolean;
  /** Photo de la tenue (garde-robe) fournie en dernier. */
  hasOutfitImage?: boolean;
}

export function buildBrollPrompt(opts: {
  scene: VlogScene;
  refs: BrollPromptRefs;
  locationDescription?: string | null;
  city?: string | null;
  /** Description figée de la tenue (garde-robe, EN) : la même sur tous les plans de la vidéo. */
  outfitDescription?: string | null;
}): string {
  const { scene, refs } = opts;
  let n = 1;
  const sheetRef = refs.hasSheet ? `@image${++n}` : null;
  const locationRef = refs.hasLocationImage ? `@image${++n}` : null;
  const keyframeRef = refs.hasKeyframe ? `@image${++n}` : null;
  const outfitRef = refs.hasOutfitImage ? `@image${++n}` : null;
  const parts: string[] = [];
  parts.push(
    sheetRef
      ? `Subject: the young woman from @image1 — her identity, face and features in every angle are locked by the character sheet ${sheetRef}.`
      : "Subject: the young woman from @image1 — keep her exact face, hair and features.",
  );
  // Tenue : la même sur toute la vidéo (continuité entre plans parlés et b-roll).
  const outfitBits = [
    keyframeRef ? `${keyframeRef} shows her in this exact location wearing her outfit for this video` : "",
    opts.outfitDescription ? `she wears exactly: ${opts.outfitDescription}` : "",
    outfitRef ? `${outfitRef} is the reference photo of that outfit` : "",
  ].filter(Boolean);
  if (outfitBits.length) parts.push(`Outfit and hair: ${outfitBits.join("; ")} — same clothes, same hairstyle, same accessories as in every other shot of this video, do NOT change the outfit.`);
  parts.push(`Action: ${scene.action}. She does NOT talk to the camera: mouth relaxed, no lip movement, no dialogue — this is a silent b-roll shot, the narration is added later.`);
  if (scene.shots.length) {
    parts.push(`Timeline of this single continuous take: ${scene.shots.map((sh) => `${sh.t ? `${sh.t}: ` : ""}${sh.desc}`).join("; ")}.`);
  }
  const sceneBits = [opts.locationDescription, scene.scene_desc].filter(Boolean).join(" — ") || scene.scene_desc || opts.city || "an authentic lifestyle setting";
  parts.push(locationRef ? `Scene: the EXACT location shown in ${locationRef} (same walls, furniture, colors and layout) — ${sceneBits}.` : `Scene: ${sceneBits}.`);
  parts.push(`Camera: ${scene.camera} — one continuous take, no cuts.`);
  parts.push(`Lighting and style: ${scene.lighting}. Vertical 9:16 influencer vlog footage.`);
  parts.push(`Audio: ${scene.audio_ambiance || "natural ambient sound of the location"} only, no speech, no music.`);
  parts.push(`Look: ${BROLL_QUALITY}.`);
  parts.push(`Constraints: ${[BASE_CONSTRAINTS, "no talking, no lip-sync, no subtitles, no text on screen", scene.constraints].filter(Boolean).join(", ")}.`);
  return parts.join(" ");
}

// ── SEEDANCE 2.5 (vidéo v2, voix native) : plan parlé ou plan de coupe narré ──
// Test du 4 sept. 2026 : 1080p net, mouvement naturel, voix synthétisée par Seedance au timbre
// de @audio1 (mp3 ElevenLabs de la réplique). Références dans CET ordre : @image1 portrait,
// puis planche, décor, keyframe (tenue de la vidéo), photo de la tenue ; @audio1 = la réplique.
export interface Seedance25PromptRefs {
  hasSheet: boolean;
  hasLocationImage: boolean;
  hasKeyframe: boolean;
  hasOutfitImage?: boolean;
  /** Photo du produit (campagnes UGC), fournie en dernier. */
  hasProductImage?: boolean;
  hasVoiceRef: boolean;
}

export function buildSeedance25Prompt(opts: {
  mode: "talk" | "voiceover";
  scene: VlogScene;
  refs: Seedance25PromptRefs;
  locationDescription?: string | null;
  city?: string | null;
  outfitDescription?: string | null;
  /** Produit UGC : nom + description (l'image est @imageN, dernière référence). */
  productDescription?: string | null;
  /**
   * "multi" (prise unique de 20-30 s) : le modèle COUPE entre 3-5 plans à l'intérieur du clip
   * (angles différents, même personne et tenue) — le rythme d'un vrai Reel sans risque de rupture
   * entre rendus séparés. "none" : plan continu sans coupe (plans courts du format monté).
   */
  cuts?: "multi" | "none";
}): string {
  const { scene, refs } = opts;
  const multi = opts.cuts === "multi";
  let n = 1;
  const sheetRef = refs.hasSheet ? `@image${++n}` : null;
  const locationRef = refs.hasLocationImage ? `@image${++n}` : null;
  const keyframeRef = refs.hasKeyframe ? `@image${++n}` : null;
  const outfitRef = refs.hasOutfitImage ? `@image${++n}` : null;
  const productRef = refs.hasProductImage ? `@image${++n}` : null;
  const texte = String(scene.texte ?? "").replace(/"/g, "'").trim();
  const parts: string[] = [];
  parts.push(
    sheetRef
      ? `Subject: the young woman from @image1 — her identity, face and features in every angle are locked by the character sheet ${sheetRef}.`
      : "Subject: the young woman from @image1 — keep her exact face, hair and features.",
  );
  if (productRef || opts.productDescription) {
    parts.push(`Product: ${productRef ? `${productRef} is the EXACT product she holds and shows to the camera (same shape, colors, label)` : "she holds and shows the product to the camera"}${opts.productDescription ? ` — ${opts.productDescription}` : ""}. The product stays identical throughout, no invented packaging.`);
  }
  const outfitBits = [
    keyframeRef ? `${keyframeRef} shows her in this exact location wearing her outfit for this video` : "",
    opts.outfitDescription ? `she wears exactly: ${opts.outfitDescription}` : "",
    outfitRef ? `${outfitRef} is the reference photo of that outfit` : "",
  ].filter(Boolean);
  if (outfitBits.length) parts.push(`Outfit and hair: ${outfitBits.join("; ")} — same clothes, same hairstyle, same accessories in every shot of this video.`);
  parts.push(
    opts.mode === "talk"
      ? `Action: she talks to the handheld phone camera like a vlogger talking to a friend — ${scene.action}. Lively expression, natural varied hand gestures, eye contact with the lens.`
      : `Action: ${scene.action}. She does NOT talk to the camera in this shot (mouth relaxed, no lip movement): a French voice-over narrates.`,
  );
  if (scene.shots.length) {
    parts.push(
      multi
        ? `Shot list — the video is EDITED with ${scene.shots.length} shots, cutting between angles on the beats of her speech (like a real short-form video): ${scene.shots.map((sh) => `${sh.t ? `${sh.t}: ` : ""}${sh.desc}`).join("; ")}. Every shot shows the same person, same outfit, same place and light; the speech continues seamlessly across cuts.`
        : `Timeline of this single continuous take: ${scene.shots.map((sh) => `${sh.t ? `${sh.t}: ` : ""}${sh.desc}`).join("; ")}.`,
    );
  }
  const sceneBits = [opts.locationDescription, scene.scene_desc].filter(Boolean).join(" — ") || scene.scene_desc || opts.city || "an authentic lifestyle setting";
  parts.push(locationRef ? `Scene: the EXACT location shown in ${locationRef} (same walls, colors and layout) — ${sceneBits}.` : `Scene: ${sceneBits}.`);
  parts.push(multi ? `Camera: ${scene.camera} — vertical 9:16, handheld phone, ${scene.shots.length || 3}-${Math.max(scene.shots.length || 3, 4)} distinct shots with clean cuts, medium shot for the talking parts and a close-up when she shows something.` : `Camera: ${scene.camera} — vertical 9:16, one continuous take, no cuts.`);
  parts.push(`Lighting and style: ${scene.lighting}. ${BROLL_QUALITY}.`);
  const voice = refs.hasVoiceRef ? " — her voice timbre matches the reference voice @audio1" : "";
  parts.push(
    opts.mode === "talk"
      ? `Audio: she speaks FRENCH naturally to the camera and says exactly: "${texte}"${voice}, accurate lip-sync; ${scene.audio_ambiance || "natural ambient sound of the location"} in the background, no music.`
      : `Audio: a French female voice-over narrates exactly: "${texte}"${voice}; ${scene.audio_ambiance || "natural ambient sound of the location"} in the background, no music.`,
  );
  const base = multi ? BASE_CONSTRAINTS.replace(", one single uninterrupted take with NO cuts, no shot changes, no scene transitions", ", cuts allowed only between the listed shots, no scene transitions or effects") : BASE_CONSTRAINTS;
  parts.push(`Constraints: ${[base, "no subtitles, no text on screen", scene.constraints].filter(Boolean).join(", ")}.`);
  return parts.join(" ");
}

/** Références réellement fournies au segment — pilote les @mentions du prompt. */
export interface SegmentPromptRefs {
  hasSheet: boolean;
  hasLocationImage: boolean;
  /** Nombre d'échantillons audio réellement fournis (0-2). */
  voiceRefs: number;
}

export function buildSegmentPrompt(opts: {
  scene: VlogScene;
  isFirst: boolean;
  refs: SegmentPromptRefs;
  locationDescription?: string | null;
  city?: string | null;
}): string {
  const { scene, refs } = opts;
  const voiceRef = refs.voiceRefs >= 2 ? "@audio1 and @audio2" : "@audio1";
  // Indices d'images dynamiques : portrait toujours @image1, puis planche, puis lieu.
  const sheetRef = refs.hasSheet ? "@image2" : null;
  const locationRef = refs.hasLocationImage ? `@image${refs.hasSheet ? 3 : 2}` : null;
  const parts: string[] = [];

  // Directive d'EXTENSION — avant tout le reste, formulée comme une continuation stricte.
  if (!opts.isFirst) {
    parts.push(
      "Extend the video @video1. This video is the DIRECT CONTINUATION of @video1: it starts exactly at the final frame of @video1 and carries the motion forward — same person, same outfit, same location, same light and ambience. Do not restart the scene, do not re-introduce anything, no cut between @video1 and this video.",
    );
  }

  // 1. Sujet — l'identité vient des références.
  parts.push(
    sheetRef
      ? `Subject: the young woman from @image1 — her identity, face and features in every angle are locked by the character sheet ${sheetRef}.`
      : "Subject: the young woman from @image1 — keep her exact face, hair and features.",
  );

  // 2. Action + timeline (temps forts d'UNE SEULE prise continue, pas des plans coupés).
  parts.push(`Action: ${opts.isFirst ? "" : "continuing directly from the end of @video1, "}${scene.action}.`);
  if (scene.shots.length) {
    parts.push(
      `Timeline of this single continuous take (the camera moves and reframes, it never cuts): ${scene.shots
        .map((sh) => `${sh.t ? `${sh.t}: ` : ""}${sh.desc}`)
        .join("; ")}.`,
    );
  }

  // 3. Scène — photo de référence du lieu + description canonique + détails du réalisateur.
  const sceneBits = [opts.locationDescription, scene.scene_desc].filter(Boolean).join(" — ")
    || scene.scene_desc || opts.city || "an authentic lifestyle setting";
  parts.push(
    locationRef
      ? `Scene: the EXACT location shown in ${locationRef} (same walls, furniture, colors and layout) — ${sceneBits}.`
      : `Scene: ${sceneBits}.`,
  );

  // 4. Caméra — toujours en prise unique.
  parts.push(`Camera: ${scene.camera} — one continuous handheld take, the camera travels and reframes but never cuts.`);

  // 5. Éclairage & style.
  parts.push(`Lighting and style: ${scene.lighting}. Photorealistic vertical 9:16 influencer vlog footage.`);

  // 6. Audio — dialogue FR (timbre des références) + ambiance.
  const texte = scene.texte.replace(/"/g, "'").trim();
  const audio: string[] = [];
  if (texte) {
    const ref = refs.voiceRefs > 0 ? ` — her voice matches the reference voice ${voiceRef}` : "";
    audio.push(
      scene.mode === "talk"
        ? `she speaks French naturally to the camera and says: "${texte}"${ref}, with accurate lip-sync`
        : `a French female voice-over narrates: "${texte}"${refs.voiceRefs > 0 ? ` — voice matching ${voiceRef}` : ""}; she does not talk to the camera`,
    );
  }
  audio.push(scene.audio_ambiance || "natural ambient sound of the location");
  parts.push(`Audio: ${audio.join("; ")}.`);

  // 7. Suffixe de qualité.
  parts.push(`Quality: ${QUALITY_SUFFIX}.`);

  // 8. Contraintes — socle + contraintes contextuelles du réalisateur + continuité.
  const constraints = [BASE_CONSTRAINTS, scene.constraints, !opts.isFirst ? "perfect continuity with @video1" : ""]
    .filter(Boolean)
    .join(", ");
  parts.push(`Constraints: ${constraints}.`);

  return parts.join(" ");
}

// Écriture du texte parlé — commun aux deux formats. Retour utilisateur du 4 sept. 2026 :
// « texte creux » (« c'est magnifique », « chaque porte raconte une histoire »…).
const SCRIPT_RULES = `ÉCRITURE DU TEXTE PARLÉ ("texte") — c'est ce qui fait qu'on y croit :
- LE SPECTATEUR N'A PAS LU L'HISTOIRE. Lus d'affilée, les "texte" de toutes les scènes doivent former UN monologue complet et compréhensible seul : 1) où elle est et ce qu'elle fait, 2) ce qui se passe ou ce qu'elle remarque, 3) la chute. Chaque phrase découle de la précédente. AUCUNE allusion à quelque chose qui n'a pas été dit à l'écran (pas de « ce grelot m'obsède » si on n'a pas encore vu ni expliqué le grelot).
- UNE seule histoire, UN seul moment, UN seul lieu ou trajet : pas de souvenir raconté depuis ailleurs, pas de digression vers un autre endroit ou une autre personne.
- FRANÇAIS parlé, à la 1re personne, comme elle parlerait VRAIMENT à une amie : phrases COMPLÈTES et simples, contractions (« j'suis », « y a », « c'est »), connecteurs oraux (« bon », « en fait », « du coup », « et là »), spontané, une pointe d'humour ou d'auto-dérision. Ce texte sera réellement PRONONCÉ par un moteur de synthèse.
- INTERDIT le style télégraphique ou « punchline » (« Séville, terrasse à tapas, je commande à l'aveugle. ») : personne ne parle comme ça. On écrit « Je suis à Séville, sur une terrasse à tapas, et je viens de commander sans rien comprendre à la carte. »
- La toute première phrase SITUE explicitement (où elle est, ce qu'elle fait) ; chaque phrase suivante s'enchaîne naturellement avec la précédente.
- Chaque scène fait AVANCER cette histoire avec un élément précis (un détail sensoriel, un chiffre en toutes lettres, un imprévu, un conseil concret). Jamais de remplissage, jamais de détail sans lien avec le fil.
- INTERDITS (ça sonne faux) : « c'est magnifique », « chaque X raconte une histoire », « vous allez adorer », « un vrai coup de cœur », « incroyable », « juste », « un petit moment de », « plongée dans », « n'hésitez pas », « franchement » en tête de phrase, les enfilades d'adjectifs, et toute formule de guide touristique ou de publicité.
- La dernière scène finit par une question ou une invitation naturelle (« vous connaissiez ? », « je vous montre la suite demain »), pas de vente.
- PRÊT-À-DIRE : chiffres en toutes lettres (« vingt-trois », jamais « 23 »), AUCUN sigle ni emoji, pas de symboles (%, €, # → « pour cent », « euros »…), et francise phonétiquement les mots étrangers ou marques difficiles (« Instagrame », « ouifi », « ticktock ») — le moteur bute sur tout ce qui ne s'écrit pas comme ça se prononce en français.`;

const SCENE_RULES = `RÈGLES DES SCÈNES (le vlog est UN SEUL PLAN-SÉQUENCE entre les segments : chaque scène PROLONGE la précédente à l'écran ; à l'INTÉRIEUR d'une scène, une shot list rend le segment dynamique) :
- Tu DÉCIDES du nombre de scènes selon l'histoire (2 à 5). Chaque scène = un segment de 8 à 15 secondes ("duration_sec", entier).
- CONTINUITÉ TOTALE entre les scènes : même tenue, même moment de la journée, le passage d'un lieu à l'autre se fait À L'ÉCRAN (elle se déplace, la caméra la suit). Pas de téléportation.
- Alterne les modes : "talk" (elle parle face caméra, réplique courte et naturelle) et "voiceover" (elle ne parle pas à la caméra, narration voix off).
- La 1re scène doit accrocher en 2 secondes. La dernière conclut (punchline/invitation douce, pas de vente).
- "texte" : 1-2 phrases courtes par scène, qui tiennent dans la durée du segment (~2,5 mots/seconde).
- "location_key" : chaque scène se tourne dans UN lieu de l'UNIVERS fourni (utilise sa key). PRIVILÉGIE les lieux existants. Si l'histoire exige un lieu inédit, mets "new_location": {"key":"<slug-en>","name":"<nom FR>","description":"<canonical EN description figée, 40-70 mots : murs, meubles, couleurs, lumière>"} — il rejoindra son univers.

${SCRIPT_RULES}

CHAQUE SCÈNE EMBARQUE SA DIRECTION CINÉMATOGRAPHIQUE — champs séparés, en ANGLAIS, AUCUN champ vide (si l'info manque, propose une valeur cohérente avec le reste) :
- "action" : ce qu'elle FAIT, verbes d'action concrets. NE re-décris pas le décor. Jamais de gros plan visage serré.
- "shots" : la TIMELINE du segment — 2 à 4 temps forts d'UNE SEULE PRISE CONTINUE couvrant duration_sec sans trou : [{"t":"0-5s","desc":"<ce qui évolue : geste, déplacement, recadrage caméra>"}, {"t":"5-12s","desc":"..."}]. INTERDIT : des plans coupés ou des changements de plan — la caméra se déplace et recadre, elle ne coupe JAMAIS. C'est le mouvement qui rend la vidéo dynamique, pas le montage.
- "scene_desc" : détails d'environnement AU-DELÀ du lieu canonique (accessoires, météo visible, passants, objets qu'elle manipule…).
- "camera" : mouvement + angle d'une prise unique (handheld tracking, slow push-in, pan, low angle, medium shot…).
- "lighting" : ambiance lumineuse + style visuel (golden hour, soft window light, neon…, cinematic realistic).
- "audio_ambiance" : les sons d'ambiance PRÉCIS attendus (birds, café chatter, traffic hum, water running…). Le dialogue vient de "texte", ne le répète pas ici.
- "constraints" : contraintes de cohérence ADAPTÉES au contexte de la scène (ex. keep the same ponytail, no on-screen text, background people stay blurred, the coffee cup stays in her hand…).

CONTINUITÉ ENTRE SCÈNES (extension vidéo) : chaque scène à partir de la 2e est générée comme la SUITE DIRECTE de la vidéo précédente. Son "action" et le 1er temps de sa timeline doivent donc DÉMARRER EXACTEMENT là où la scène précédente s'arrête (même geste en cours, même déplacement) — jamais une nouvelle ouverture ni une re-présentation. Si l'histoire change de lieu, le DÉPLACEMENT se fait À L'ÉCRAN dans la scène.`;

// ── Format HYBRIDE (vidéo v2) : Reel MONTÉ — plans parlés en lip-sync (voix ElevenLabs)
// + plans de coupe. Conventions 2026 (recherche du 4 sept.) : accroche visage dès la 1re
// seconde, changement visuel toutes les ≤ 3 s, b-roll de 1-3 s, message clé avant 3 s,
// durée moyenne réellement regardée d'un Reel ≈ 8,5 s.
const HYBRID_SCENE_RULES = `RÈGLES DES SCÈNES — FORMAT HYBRIDE (un Reel MONTÉ : le montage COUPE entre les scènes, ce n'est PAS un plan-séquence) :
- Deux modes : "talk" = elle parle face caméra (avatar animé en lip-sync sur sa voix) ; "voiceover" = plan de coupe sans elle qui parle, sa voix continue par-dessus. ALTERNE-les : jamais deux "talk" de suite si un "voiceover" peut s'intercaler.
- RYTHME : une scène "talk" = 3 à 7 secondes de parole (8 à 18 mots) ; une scène "voiceover" = 2 à 5 secondes (5 à 12 mots). 4 à 8 scènes au total. Un changement visuel toutes les 3 secondes maximum.
- La 1re scène est un "talk" : l'ACCROCHE, une phrase de 8 mots maximum qui donne une raison de rester ET situe déjà l'action (où / quoi), dite dès la première seconde (pas de « coucou », pas de présentation).
- Toutes les scènes se passent dans le MÊME lieu ou sur le même trajet, au même moment : les plans de coupe montrent ce dont elle parle, pas un autre endroit.
- "duration_sec" : voiceover = durée du plan de coupe (4 à 8) ; talk = durée estimée de la parole (~2,5 mots/seconde).
- "inserts" (scènes "talk" uniquement, 0 à 2 par scène) : plans de coupe PHOTO de 1,5 à 3 s incrustés PENDANT qu'elle parle. L'insert MONTRE CE DONT ELLE PARLE à cet instant (l'objet, le détail, l'endroit) — jamais un gros plan d'elle pendant qu'elle décrit autre chose : [{"anchor":"<2 à 4 mots EXACTS et consécutifs du texte, à l'endroit où l'image doit apparaître>","framing":"illustration"|"location"|"close"|"full"|"selfie","desc":"<EN, 10-20 mots : ce que montre l'image, précis et visuel>"}]. "illustration" = photo de la chose décrite (un pot de basilic entre deux volets bleus, une main sur un grelot…) — le cas normal ; "location" = le décor seul ; "close" / "full" / "selfie" = elle, UNIQUEMENT si elle parle d'elle-même, de sa tenue ou de son état. Jamais sur les 2 premiers mots de la scène.
- Même tenue et même coiffure sur toute la vidéo. Les lieux PEUVENT changer d'une scène à l'autre (c'est un montage), reste dans l'univers fourni.
- "location_key" : chaque scène se tourne dans UN lieu de l'UNIVERS fourni (utilise sa key). PRIVILÉGIE les lieux existants. Si l'histoire exige un lieu inédit, mets "new_location": {"key":"<slug-en>","name":"<nom FR>","description":"<canonical EN description figée, 40-70 mots : murs, meubles, couleurs, lumière>"} — il rejoindra son univers.

${SCRIPT_RULES}

CHAQUE SCÈNE EMBARQUE SA DIRECTION — champs séparés, en ANGLAIS, AUCUN champ vide :
- "action" : ce qu'elle FAIT (talk : gestes et attitude face caméra ; voiceover : l'action du plan de coupe, verbes concrets). NE re-décris pas le décor.
- "shots" : voiceover = 1 à 2 temps forts d'UNE prise continue ([{"t":"0-3s","desc":"..."}]) ; talk = [] .
- "scene_desc" : détails d'environnement AU-DELÀ du lieu canonique (accessoires, météo visible, passants, objets qu'elle manipule…).
- "camera" : talk = cadrage face caméra à hauteur d'yeux, buste ou taille (« medium shot from the waist up, hands visible », « selfie angle ») ; voiceover = mouvement + angle (handheld tracking, slow push-in, low angle…).
- "lighting" : ambiance lumineuse réaliste (one light source, natural daylight, window light…), pas de vocabulaire « cinematic 4K ».
- "audio_ambiance" : sons d'ambiance PRÉCIS du lieu. Le dialogue vient de "texte", ne le répète pas ici.
- "constraints" : contraintes de cohérence ADAPTÉES à la scène (same ponytail, no on-screen text, background people blurred…).`;

// ── PLAN-SÉQUENCE UNIQUE (Seedance 2.5, 30 s d'un coup) ──
// Retour utilisateur du 4 sept. (soir) sur la vidéo montée en 7 plans : tenue qui change entre les
// rendus séparés, histoire hachée, « scripts pas naturels ». Un seul rendu = une seule tenue, une
// seule voix, un récit d'une traite.
const SINGLE_TAKE_RULES = `RÈGLES — PLAN-SÉQUENCE UNIQUE (UNE seule vidéo de 30 secondes, sans montage, générée d'un coup) :
- Renvoie EXACTEMENT UNE scène : "mode":"talk", "duration_sec":30, "location_key" = le lieu unique de l'histoire.
- "texte" = TOUT ce qu'elle dit pendant les 30 secondes, d'une traite : 50 à 65 mots MAXIMUM (≈ 2,3 mots par seconde, au-delà la fin est coupée). Elle raconte à une amie ce qui vient de lui arriver, dans l'ordre : 1) une phrase simple qui situe (où elle est, ce qu'elle fait), 2) ce qui s'est passé, 3) la chute ou la question finale.
- "action" : ce qu'elle FAIT pendant qu'elle parle, en lien avec le récit (assise à la table, la carte en main, l'assiette arrive, elle goûte…).
- "shots" : le DÉCOUPAGE en 3 à 5 plans à l'intérieur de la vidéo ([{"t":"0-7s","desc":"..."}, …]) couvrant les 30 s : un changement d'angle par temps fort du récit (plan moyen face caméra, gros plan sur ce qu'elle montre ou sur son visage, plan plus large avec le décor, retour face caméra pour la chute). Chaque "desc" (EN) dit l'angle ET ce qui se passe. Elle parle à la caméra pendant toute la vidéo ; même personne, même tenue, même lieu d'un plan à l'autre.
- "inserts" : 0 à 2 illustrations (voir ci-dessus) ancrées sur des mots exacts du texte.
- "camera", "lighting", "audio_ambiance", "constraints" : comme d'habitude (EN).

${SCRIPT_RULES}`;

const sceneRulesFor = (format: VlogFormat, singleTake = false) => (singleTake ? SINGLE_TAKE_RULES : format === "hybrid" ? HYBRID_SCENE_RULES : SCENE_RULES);

const DEFAULT_MUSIC_PROMPT = "Warm upbeat acoustic pop instrumental for a lifestyle vlog, light hand percussion, soft guitar and gentle synth pads, 120 BPM, cheerful, instrumental, no vocals";
const MUSIC_SYSTEM = `Tu écris le prompt d'une musique de fond INSTRUMENTALE pour un Reel de 15 à 40 secondes.
Réponds UNIQUEMENT par UNE ligne en ANGLAIS (15 à 30 mots) : genre, 2-3 instruments, tempo en BPM entre 110 et 130, ambiance, et termine par "instrumental, no vocals". AUCUN nom d'artiste, de groupe ni de titre.`;

/** Prompt musical (EN) adapté à l'histoire ; repli sur un lit sonore générique si le modèle déraille. */
export async function musicPromptFor(story: string, scenes: VlogScene[]): Promise<string> {
  try {
    const raw = await generateText(MUSIC_SYSTEM, `HISTOIRE :\n${story.slice(0, 600)}\n\nAMBIANCES : ${scenes.map((s) => s.lighting).slice(0, 4).join(" / ")}`, 200);
    const line = String(raw ?? "").split("\n").map((x) => x.trim().replace(/^["'`]+|["'`]+$/g, "")).filter((x) => x.length > 10)[0] ?? "";
    return /vocal/i.test(line) ? line.slice(0, 300) : line ? `${line.slice(0, 280)}, instrumental, no vocals` : DEFAULT_MUSIC_PROMPT;
  } catch (err) {
    logger.warn("music_prompt_failed", { err: String((err as Error)?.message ?? err) });
    return DEFAULT_MUSIC_PROMPT;
  }
}

const SYSTEM = `Tu es le RÉALISATEUR d'un vlog court (TikTok/Reels, vertical 9:16) pour un influenceur IA.
Ta mission : écrire une mini-histoire vécue AUJOURD'HUI par le personnage, puis la découper en scènes tournables.

${SCENE_RULES}

FORMAT DE SORTIE STRICT (streaming) :
1) D'ABORD écris l'HISTOIRE en français (3-5 phrases vivantes, comme si le personnage racontait sa journée). Pas de JSON ici.
2) PUIS, sur une nouvelle ligne, écris EXACTEMENT ${DELIM}
3) PUIS le JSON :
{"title": "<titre court du vlog>", "caption": "<caption du post, FR, avec 1-2 emojis>", "hashtags": ["#...", ...], "scenes": [{"titre": "...", "mode": "talk"|"voiceover", "texte": "...", "duration_sec": 12, "location_key": "<key>", "new_location": {...} | null, "action": "...", "shots": [{"t": "0-5s", "desc": "..."}], "scene_desc": "...", "camera": "...", "lighting": "...", "audio_ambiance": "...", "constraints": "..."}]}
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
- UN moment, UN lieu (ou un trajet), UNE chose qui arrive : une histoire simple qu'un spectateur comprend sans rien savoir d'elle. Pas de souvenir raconté depuis un autre endroit, pas de digression.
- Le CONTEXTE RÉEL (météo, heure) décrit sa ville de résidence : utilise-le SEULEMENT si l'histoire s'y passe. Si la demande situe l'histoire ailleurs (voyage, autre ville), l'histoire se passe LÀ-BAS, de jour sauf indication contraire, et tu ignores l'heure et la météo de sa ville.
- Ancre-la dans ses lieux habituels quand l'histoire s'y passe.
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

const scenesSystemFor = (format: VlogFormat, singleTake = false) => `Tu es le RÉALISATEUR. On te donne une HISTOIRE validée : ${singleTake ? "écris-la en UNE prise continue tournable (vertical 9:16)" : "découpe-la en scènes tournables (vertical 9:16)"}.

${sceneRulesFor(format, singleTake)}
- "scope" du nouveau lieu : "permanent" si le lieu fait partie de sa VIE et reviendra (sa salle de bain, son salon, sa salle de sport habituelle) ; "oneoff" si c'est un lieu de PASSAGE vu une seule fois (les toilettes d'un fast-food, une chambre d'hôtel en voyage, un resto testé une fois).
- Respecte la DURÉE CIBLE totale : la somme des "duration_sec" doit s'en approcher.
- Si l'utilisateur demande des modifications sur un découpage précédent, applique-les.

Réponds UNIQUEMENT en JSON :
{"scenes":[{"titre","mode":"talk"|"voiceover","texte","duration_sec":12,"location_key","new_location":null,"action","shots":[{"t":"0-5s","desc":"..."}],"scene_desc","camera","lighting","audio_ambiance","constraints"${format === "hybrid" ? `,"inserts":[{"anchor":"...","framing":"close","desc":"..."}]` : ""}}]}`;

/** Étape 2 : découpe l'histoire validée en scènes, pour une durée cible. */
export async function breakIntoScenes(
  input: StoryInput & { story: string; durationSec: number; previousScenes?: VlogScene[]; format?: VlogFormat; singleTake?: boolean },
): Promise<VlogScene[]> {
  const format: VlogFormat = input.format ?? "hybrid";
  const singleTake = !!input.singleTake;
  const target = singleTake
    ? `DURÉE : une seule prise de ${Math.min(30, input.durationSec)} secondes, texte de 50 à 65 mots.`
    : format === "hybrid"
      ? `DURÉE CIBLE : ${input.durationSec} secondes au total (~${Math.max(4, Math.min(8, Math.round(input.durationSec / 4)))} scènes courtes de 2-7 s).`
      : `DURÉE CIBLE : ${input.durationSec} secondes au total (~${Math.max(1, Math.min(5, Math.round(input.durationSec / 12)))} scènes de 8-15 s).`;
  const user = [
    characterBlock(input),
    input.locations.length ? `DESCRIPTIONS DES LIEUX :\n${input.locations.map((l) => `- ${l.key} : ${l.description}`).join("\n")}` : "",
    `HISTOIRE VALIDÉE :\n${input.story}`,
    target,
    input.previousScenes?.length ? `DÉCOUPAGE PRÉCÉDENT :\n${JSON.stringify(input.previousScenes)}` : "",
    input.instruction ? `MODIFICATIONS DEMANDÉES : ${input.instruction}` : "",
    `Découpe en scènes.`,
  ].filter(Boolean).join("\n\n");

  // Le LLM renvoie parfois du texte autour du JSON, ou une sortie tronquée.
  // On tente une 2e fois avec une consigne plus stricte avant d'abandonner.
  const attempt = async (extra: string, maxTokens: number): Promise<VlogScene[]> => {
    const raw = await generateText(scenesSystemFor(format, singleTake), extra ? `${user}\n\n${extra}` : user, maxTokens);
    const parsed = extractJson<{ scenes?: VlogScene[] }>(raw);
    const scenes = normalizeScenes(parsed?.scenes ?? []);
    if (scenes.length === 0) {
      logger.warn("scenes_parse_failed", {
        rawLength: raw?.length ?? 0,
        hadJson: !!parsed,
        sceneCount: parsed?.scenes?.length ?? 0,
        preview: String(raw ?? "").slice(0, 400),
      });
    }
    return scenes;
  };

  // max_tokens couvre thinking + texte sur claude-sonnet-5 → marge large pour le
  // JSON des scènes (8 éléments de direction par segment).
  let scenes = await attempt("", 8000);
  if (scenes.length === 0) {
    scenes = await attempt(
      `IMPORTANT : ta réponse précédente n'était pas exploitable. Réponds UNIQUEMENT avec l'objet JSON, sans texte avant ni après, sans balises de code. Garde les prompts courts (max 30 mots).`,
      8000,
    );
  }
  if (scenes.length === 0) {
    throw new Error("Le découpage n'a pas abouti (réponse du modèle inexploitable). Réessaie, ou raccourcis l'histoire.");
  }
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
