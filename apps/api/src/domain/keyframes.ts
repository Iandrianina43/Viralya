import { faceScores, qcVerdict, saveQcReport } from "../lib/qc";
import { logger } from "../logger";
import { estimateImageCost, piapiImageToStorage, type ImageAspect, type ImageQuality } from "../providers/piapiImage";
import { supabase } from "../supabase";
import { avatarImageModel, identityBlock, identityRefs, pronouns, resolveOutfit, type AvatarIdentity } from "./characterBible";

// ─────────────────────────────────────────────────────────────
// KEYFRAMES — l'influenceur DANS un décor de son univers, avec une tenue de sa
// garde-robe, dans un cadrage fixe. Générés une fois, scorés contre le portrait,
// validés, puis RÉUTILISÉS comme référence : photos dans ce décor (phase 1) et
// première image des vidéos (phase 2). Un trio (décor, tenue, cadrage) validé
// n'est jamais regénéré sans `force` — zéro génération inutile.
// ─────────────────────────────────────────────────────────────

type P = ReturnType<typeof pronouns>;
export interface FramingDef { label: string; aspect: ImageAspect; quality?: ImageQuality; scene: (p: P) => string }

// Les cadrages 9:16 servent de PREMIÈRE IMAGE des vidéos (OmniHuman garde le format et la
// définition de l'image) : générés en 2K pour sortir en 1080×1920 sans agrandissement.
// Test du 4 sept. : un keyframe 3:4 en 1K (864×1152) → clip 960×1280 → agrandi ×1,5 et
// recadré au montage = image molle, jugée « qualité pas top » par l'utilisateur.
export const KEYFRAME_FRAMINGS = {
  medium: { label: "Plan taille", aspect: "3:4", scene: (p) => `medium shot from the waist up, ${p.subj} faces the camera with a relaxed natural expression` },
  close: { label: "Gros plan", aspect: "3:4", scene: (p) => `close-up from the shoulders up, ${p.subj} looks at the camera with a relaxed natural expression` },
  full: { label: "Plein pied", aspect: "9:16", quality: "2K", scene: (p) => `full-body shot from head to toe, ${p.subj} stands naturally in the place, facing the camera` },
  selfie: { label: "Selfie", aspect: "9:16", quality: "2K", scene: (p) => `selfie taken at arm's length with a phone, ${p.subj} smiles slightly at the camera, the place clearly visible behind ${p.poss} shoulder` },
  talk: { label: "Face caméra (vidéo)", aspect: "9:16", quality: "2K", scene: (p) => `vertical medium shot from the hips up, ${p.subj} faces the camera at eye level with both hands visible and relaxed, about to speak, the place clearly visible behind and around ${p.poss} shoulders` },
} satisfies Record<string, FramingDef>;
export type KeyframeFraming = keyof typeof KEYFRAME_FRAMINGS;
export const DEFAULT_FRAMING: KeyframeFraming = "medium";
export function isFraming(v: unknown): v is KeyframeFraming {
  return typeof v === "string" && v in KEYFRAME_FRAMINGS;
}

export interface AvatarKeyframe {
  id: string;
  avatar_id: string;
  location_id: string | null;
  outfit_id: string | null;
  framing: string | null;
  url: string;
  prompt: string | null;
  model: string | null;
  face_score: number | null;
  validated: boolean;
  created_at: string;
  location_name: string | null;
  location_key: string | null;
  outfit_name: string | null;
}

const KEYFRAME_SELECT = "*, avatar_locations(name, key), avatar_wardrobe(name)";

function flatten(row: Record<string, any>): AvatarKeyframe {
  const { avatar_locations, avatar_wardrobe, ...kf } = row;
  return {
    ...(kf as Omit<AvatarKeyframe, "location_name" | "location_key" | "outfit_name">),
    location_name: avatar_locations?.name ?? null,
    location_key: avatar_locations?.key ?? null,
    outfit_name: avatar_wardrobe?.name ?? null,
  };
}

export async function listKeyframes(avatarId: string): Promise<AvatarKeyframe[]> {
  const { data, error } = await supabase.from("avatar_keyframes").select(KEYFRAME_SELECT).eq("avatar_id", avatarId).order("created_at", { ascending: false });
  if (error) throw new Error(`keyframes list: ${error.message}`);
  return (data ?? []).map(flatten);
}

export async function setKeyframeValidated(avatarId: string, id: string, validated: boolean): Promise<AvatarKeyframe | null> {
  const { data, error } = await supabase.from("avatar_keyframes").update({ validated }).eq("id", id).eq("avatar_id", avatarId).select(KEYFRAME_SELECT).maybeSingle();
  if (error) throw new Error(`keyframe update: ${error.message}`);
  return data ? flatten(data as Record<string, any>) : null;
}

export async function deleteKeyframe(avatarId: string, id: string): Promise<void> {
  const { error } = await supabase.from("avatar_keyframes").delete().eq("id", id).eq("avatar_id", avatarId);
  if (error) throw new Error(`keyframe delete: ${error.message}`);
}

export interface KeyframeQuery {
  locationId: string;
  /** Tenue résolue (id) ; null = sans tenue de garde-robe. */
  outfitId: string | null;
  /** Cadrage exact ; absent = n'importe lequel (le mieux validé/scoré d'abord). */
  framing?: KeyframeFraming | null;
}

/** Cherche un keyframe réutilisable : validé d'abord, puis meilleur score de visage. */
export async function findKeyframe(avatarId: string, q: KeyframeQuery, opts: { validatedOnly?: boolean } = {}): Promise<AvatarKeyframe | null> {
  let sel = supabase.from("avatar_keyframes").select(KEYFRAME_SELECT).eq("avatar_id", avatarId).eq("location_id", q.locationId);
  sel = q.outfitId ? sel.eq("outfit_id", q.outfitId) : sel.is("outfit_id", null);
  if (q.framing) sel = sel.eq("framing", q.framing);
  if (opts.validatedOnly) sel = sel.eq("validated", true);
  const { data, error } = await sel.order("validated", { ascending: false }).order("face_score", { ascending: false, nullsFirst: false }).limit(1);
  if (error) throw new Error(`keyframe find: ${error.message}`);
  return data?.length ? flatten(data[0] as Record<string, any>) : null;
}

export interface EnsureKeyframeInput {
  locationId: string;
  outfitId?: string | null;
  framing?: KeyframeFraming | null;
  model?: string;
  /** Regénère même si un keyframe validé existe déjà pour ce trio. */
  force?: boolean;
}

/**
 * Renvoie le keyframe du trio (décor, tenue, cadrage) : celui du cache s'il est
 * validé (ou reconnu ≥ seuil), sinon le génère, le score et l'archive.
 */
export async function ensureKeyframe(
  avatar: AvatarIdentity,
  input: EnsureKeyframeInput,
): Promise<{ keyframe: AvatarKeyframe; cached: boolean; cost: number }> {
  if (!avatar.ref_image_url) throw new Error("L'influenceur n'a pas de portrait — génère-le d'abord.");
  const framing: KeyframeFraming = input.framing ?? DEFAULT_FRAMING;
  const outfit = await resolveOutfit(avatar.id, input.outfitId);
  const query: KeyframeQuery = { locationId: input.locationId, outfitId: outfit?.id ?? null, framing };

  if (!input.force) {
    const existing = await findKeyframe(avatar.id, query);
    if (existing && (existing.validated || qcVerdict(existing.face_score) === "pass")) {
      return { keyframe: existing, cached: true, cost: 0 };
    }
  }

  const { data: loc } = await supabase
    .from("avatar_locations")
    .select("id, key, name, description, ref_image_url")
    .eq("id", input.locationId)
    .eq("avatar_id", avatar.id)
    .maybeSingle();
  if (!loc) throw new Error("Décor introuvable dans l'univers de cet influenceur.");

  const p = pronouns(avatar);
  const model = avatarImageModel(avatar, input.model);
  const def: FramingDef = KEYFRAME_FRAMINGS[framing];

  // Références, dans l'ordre annoncé au modèle : identité, tenue, décor (dernier).
  const refs = await identityRefs(avatar, 5);
  const identityCount = refs.length;
  let outfitIdx = 0;
  if (outfit?.ref_url) { refs.push(outfit.ref_url); outfitIdx = refs.length; }
  let locationIdx = 0;
  if (loc.ref_image_url) { refs.push(String(loc.ref_image_url)); locationIdx = refs.length; }

  const prompt = [
    `Reference image 1 is the face and identity of ${avatar.name}.`,
    identityCount === 2 ? "Reference image 2 shows the same person (character sheet)." : identityCount > 2 ? `Reference images 2-${identityCount} show the same person (character sheet, other views).` : "",
    outfitIdx ? `Reference image ${outfitIdx} shows ${p.poss} outfit.` : "",
    locationIdx ? `Reference image ${locationIdx} is the EXACT location: reuse its walls, furniture, colors, light and layout.` : "",
    `Create a NEW photo of the SAME person with an identical face: ${def.scene(p)}, in this location.`,
    !locationIdx ? `Location: ${String(loc.description ?? loc.name)}.` : "",
    outfit ? `${p.Subj} is wearing ${outfit.description_en} — do NOT copy the clothes from the identity references.` : "",
    `Keep the face, features, hairstyle and skin exactly like the references. ${identityBlock(avatar)}.`,
    // Réalisme « photo de téléphone » (guides 2026) : une seule source de lumière, peau non retouchée,
    // grain léger, cadrage un peu imparfait — et AUCUN mot du type « 8K / flawless / photorealistic »
    // qui pousse les modèles vers le rendu lisse et idéalisé.
    `Candid still frame from a real handheld smartphone video: natural unretouched skin with visible pores and slight asymmetry, a few flyaway hairs, no beauty filter, no retouching, one coherent natural light source with real shadows, mild sensor grain, eye-level phone camera, framing slightly off-center. She is relaxed and caught mid-moment, not posing.`,
  ].filter(Boolean).join(" ");

  const { imageUrl, cost, ms } = await piapiImageToStorage(
    { prompt, refs, model, aspect: def.aspect, ...(def.quality ? { quality: def.quality } : {}) },
    `${avatar.id}/keyframes/${String(loc.key)}-${framing}-${Date.now()}`,
  );
  const [qc] = await faceScores(avatar.ref_image_url, [imageUrl]);
  const verdict = qc?.verdict ?? qcVerdict(null);

  const { data: row, error } = await supabase
    .from("avatar_keyframes")
    .insert({
      avatar_id: avatar.id,
      location_id: loc.id,
      outfit_id: outfit?.id ?? null,
      framing,
      url: imageUrl,
      prompt,
      model,
      face_score: qc?.score ?? null,
      // Validé automatiquement si le visage est reconnu (≥ 0,55) ; l'humain peut retirer.
      validated: verdict === "pass",
    })
    .select(KEYFRAME_SELECT)
    .single();
  if (error || !row) throw new Error(`keyframe insert: ${error?.message ?? ""}`);
  const keyframe = flatten(row as Record<string, any>);

  await saveQcReport({
    targetType: "keyframe",
    targetId: keyframe.id,
    avatarId: avatar.id,
    checks: { face_score: qc?.score ?? null, faces: qc?.faces ?? 0, model, framing, location: loc.key },
    score: qc?.score ?? null,
    passed: verdict === "pass",
  });
  const finalCost = cost || estimateImageCost(model, refs.length, "1K");
  logger.info("keyframe_generated", { avatarId: avatar.id, location: loc.key, framing, outfit: outfit?.id ?? null, score: qc?.score ?? null, verdict, ms, cost: finalCost });
  return { keyframe, cached: false, cost: finalCost };
}
