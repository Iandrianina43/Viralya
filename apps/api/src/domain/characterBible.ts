import { extractJson } from "../lib/storage";
import { faceScores, saveQcReport } from "../lib/qc";
import { logger } from "../logger";
import { generateText } from "../providers/llm";
import { DEFAULT_IMAGE_MODEL, isPiapiImageModel, piapiImageToStorage, type ImageAspect, type PiapiImageModel } from "../providers/piapiImage";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// CHARACTER BIBLE — l'identité visuelle d'un influenceur n'est pas un prompt :
// c'est un pack de références validées (portrait + planche + vues + expressions),
// une garde-robe canonique et une description figée. Tout ce qui est généré
// est scoré contre le portrait (SFace) puis validé par l'humain.
// ─────────────────────────────────────────────────────────────

export interface AvatarIdentity {
  id: string;
  name: string;
  sex_age: string | null;
  nationality: string | null;
  city: string | null;
  niche: string | null;
  ref_image_url: string | null;
  character_sheet_url: string | null;
  portrait_spec: Record<string, string> | null;
  image_model: string | null;
}

export interface AvatarReference {
  id: string;
  avatar_id: string;
  kind: string;
  label: string | null;
  url: string;
  prompt: string | null;
  model: string | null;
  face_score: number | null;
  validated: boolean;
  is_primary: boolean;
  version: number;
  created_at: string;
}

export interface WardrobeItem {
  id: string;
  avatar_id: string;
  name: string;
  description_en: string;
  ref_url: string | null;
  is_default: boolean;
  created_at: string;
}

export const IDENTITY_SELECT = "id, name, sex_age, nationality, city, niche, ref_image_url, character_sheet_url, portrait_spec, image_model";

export function pronouns(avatar: Pick<AvatarIdentity, "sex_age">) {
  const female = /femme|woman|female/i.test(String(avatar.sex_age ?? ""));
  return { subj: female ? "she" : "he", poss: female ? "her" : "his", who: female ? "woman" : "man", Subj: female ? "She" : "He" };
}

/** Bloc d'identité figé (issu de la fiche portrait) — répété dans chaque prompt. */
export function identityBlock(avatar: AvatarIdentity): string {
  const s = avatar.portrait_spec ?? {};
  const p = pronouns(avatar);
  return [
    `${avatar.name}: ${s.ethnicity ?? avatar.nationality ?? ""} ${p.who}, ${s.age ?? ""} years old`,
    s.face_shape ? `${s.face_shape} face` : "",
    s.eyes ? `${s.eyes} eyes` : "",
    s.hair_style ? `${s.hair_style}, ${s.hair_color ?? ""} hair` : "",
    s.skin_tone ? `${s.skin_tone} skin` : "",
    s.facial_hair && s.facial_hair !== "none" ? s.facial_hair : "",
  ].filter(Boolean).join(", ").replace(/\s+,/g, ",");
}

export function avatarImageModel(avatar: Pick<AvatarIdentity, "image_model">, override?: string): PiapiImageModel {
  if (isPiapiImageModel(override)) return override;
  if (isPiapiImageModel(avatar.image_model)) return avatar.image_model;
  return DEFAULT_IMAGE_MODEL;
}

/** Références d'identité à passer en @image : portrait, planche, puis vues validées. */
export async function identityRefs(avatar: AvatarIdentity, max = 6): Promise<string[]> {
  const refs = [avatar.ref_image_url, avatar.character_sheet_url].filter(Boolean) as string[];
  const { data } = await supabase
    .from("avatar_references")
    .select("url, kind, face_score")
    .eq("avatar_id", avatar.id)
    .eq("validated", true)
    .order("face_score", { ascending: false })
    .limit(max);
  for (const r of data ?? []) if (refs.length < max && !refs.includes(r.url)) refs.push(String(r.url));
  return refs;
}

// ── Pack de références ───────────────────────────────────────
export interface ReferenceKindDef {
  kind: string;
  label: string;
  aspect: ImageAspect;
  scene: (p: ReturnType<typeof pronouns>) => string;
}

export const REFERENCE_KINDS: ReferenceKindDef[] = [
  { kind: "three_quarter", label: "Trois-quarts", aspect: "3:4", scene: () => "three-quarter view portrait, head and shoulders, neutral relaxed expression, soft even daylight, plain light grey studio background" },
  { kind: "profile", label: "Profil", aspect: "3:4", scene: () => "true side profile portrait, head and shoulders, neutral expression, soft even daylight, plain light grey studio background" },
  { kind: "half_body", label: "Plan taille", aspect: "3:4", scene: (p) => `half-body shot from the waist up, ${p.subj} faces the camera with arms relaxed, plain casual outfit, plain light grey studio background` },
  { kind: "full_body", label: "Plein pied", aspect: "9:16", scene: (p) => `full-body shot from head to toe, ${p.subj} stands naturally, plain casual outfit and sneakers, plain light grey studio background` },
  { kind: "expression", label: "Rire", aspect: "3:4", scene: (p) => `close-up portrait, ${p.subj} laughs naturally with eyes slightly closed, soft daylight, plain background` },
  { kind: "expression", label: "Sérieux", aspect: "3:4", scene: (p) => `close-up portrait, serious focused expression looking straight into the lens, soft daylight, plain background` },
];

export function referencePrompt(avatar: AvatarIdentity, def: ReferenceKindDef, refCount: number): string {
  const p = pronouns(avatar);
  return [
    `Reference image 1 is the face and identity of ${avatar.name}.`,
    refCount > 1 ? `The other reference images show the same person (character sheet, other views).` : "",
    `Create a NEW photo of the SAME person with an identical face: ${def.scene(p)}.`,
    `Keep the face, features, hairstyle and skin exactly like the references. ${identityBlock(avatar)}.`,
    `Photorealistic, natural unretouched skin texture, no beauty filter, studio reference photo.`,
  ].filter(Boolean).join(" ");
}

export async function listReferences(avatarId: string): Promise<AvatarReference[]> {
  const { data, error } = await supabase.from("avatar_references").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: true });
  if (error) throw new Error(`references list: ${error.message}`);
  return (data ?? []) as AvatarReference[];
}

/** Génère le pack (6 vues par défaut), score chaque image contre le portrait, archive. */
export async function generateReferencePack(
  avatar: AvatarIdentity,
  opts: { model?: string; kinds?: string[]; labels?: string[] } = {},
): Promise<AvatarReference[]> {
  if (!avatar.ref_image_url) throw new Error("L'influenceur n'a pas de portrait — génère-le d'abord.");
  const model = avatarImageModel(avatar, opts.model);
  const refs = [avatar.ref_image_url, ...(avatar.character_sheet_url ? [avatar.character_sheet_url] : [])];
  const defs = REFERENCE_KINDS.filter((d) => (!opts.kinds?.length || opts.kinds.includes(d.kind)) && (!opts.labels?.length || opts.labels.includes(d.label)));

  const generated = await Promise.all(
    defs.map(async (def) => {
      const prompt = referencePrompt(avatar, def, refs.length);
      try {
        const { imageUrl } = await piapiImageToStorage(
          { prompt, refs, model, aspect: def.aspect },
          `${avatar.id}/bible/${def.kind}-${def.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        );
        return { def, prompt, url: imageUrl };
      } catch (err) {
        logger.warn("reference_generation_failed", { avatarId: avatar.id, kind: def.kind, err: String((err as Error)?.message ?? err) });
        return null;
      }
    }),
  );
  const ok = generated.filter((g): g is NonNullable<typeof g> => !!g);
  if (!ok.length) throw new Error("aucune référence générée");

  const scores = await faceScores(avatar.ref_image_url, ok.map((g) => g.url));
  const rows = ok.map((g, i) => ({
    avatar_id: avatar.id,
    kind: g.def.kind,
    label: g.def.label,
    url: g.url,
    prompt: g.prompt,
    model,
    face_score: scores[i]?.score ?? null,
    validated: false,
    is_primary: false,
  }));
  const { data, error } = await supabase.from("avatar_references").insert(rows).select("*");
  if (error) throw new Error(`references insert: ${error.message}`);
  const inserted = (data ?? []) as AvatarReference[];
  await Promise.all(
    inserted.map((r, i) => saveQcReport({ targetType: "reference", targetId: r.id, avatarId: avatar.id, checks: { face_score: r.face_score, faces: scores[i]?.faces ?? 0, model }, score: r.face_score, passed: scores[i]?.verdict === "pass" })),
  );
  logger.info("reference_pack_generated", { avatarId: avatar.id, count: inserted.length, model });
  return inserted;
}

// ── Garde-robe ───────────────────────────────────────────────
const WARDROBE_SYSTEM = `Tu es styliste pour un influenceur virtuel. Tu définis sa GARDE-ROBE CANONIQUE : des tenues cohérentes avec sa personnalité, sa ville, sa niche et son âge, réutilisées telles quelles dans toutes ses photos et vidéos.
Pour CHAQUE tenue, écris une description en ANGLAIS, précise et figée (pièces, coupes, couleurs exactes, matières, chaussures, accessoires), 25-45 mots, sans mentionner le visage ni la coiffure.
Réponds UNIQUEMENT en JSON : {"outfits":[{"name":"<nom FR court>","description_en":"<description>","occasion":"<quotidien|sport|soirée|travail|voyage>"}]}`;

export async function listWardrobe(avatarId: string): Promise<WardrobeItem[]> {
  const { data, error } = await supabase.from("avatar_wardrobe").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: true });
  if (error) throw new Error(`wardrobe list: ${error.message}`);
  return (data ?? []) as WardrobeItem[];
}

export interface ResolvedOutfit { id: string; name: string; description_en: string; ref_url: string | null }

/** Tenue à porter : celle demandée (si elle appartient à l'avatar), sinon la tenue par défaut, sinon aucune. */
export async function resolveOutfit(avatarId: string, outfitId?: string | null): Promise<ResolvedOutfit | null> {
  const sel = "id, name, description_en, ref_url";
  if (outfitId) {
    const { data } = await supabase.from("avatar_wardrobe").select(sel).eq("id", outfitId).eq("avatar_id", avatarId).maybeSingle();
    if (data) return data as ResolvedOutfit;
  }
  const { data } = await supabase.from("avatar_wardrobe").select(sel).eq("avatar_id", avatarId).eq("is_default", true).limit(1).maybeSingle();
  return (data as ResolvedOutfit | null) ?? null;
}

export function outfitPrompt(avatar: AvatarIdentity, description: string, refCount: number): string {
  const p = pronouns(avatar);
  return [
    `Reference image 1 is the face and identity of ${avatar.name}.`,
    refCount > 1 ? "The other reference images show the same person." : "",
    `Create a NEW photo of the SAME person with an identical face: half-body shot from the waist up, ${p.subj} faces the camera, plain light grey studio background.`,
    `${p.Subj} is wearing ${description} — do NOT copy the clothes from the reference images.`,
    `Keep the face, features, hairstyle and skin exactly like the references. ${identityBlock(avatar)}.`,
    `Photorealistic, natural skin texture, no beauty filter, lookbook photo.`,
  ].filter(Boolean).join(" ");
}

/** Propose des tenues (LLM) puis génère une image de chacune portée par le personnage. */
export async function generateWardrobe(
  avatar: AvatarIdentity & { personality?: string[] | null; clothing_style?: string | null; system_prompt?: string | null },
  opts: { count?: number; model?: string; withImages?: boolean } = {},
): Promise<WardrobeItem[]> {
  const count = Math.max(2, Math.min(6, opts.count ?? 4));
  const user = [
    `PERSONNAGE : ${avatar.name}${avatar.sex_age ? ` — ${avatar.sex_age}` : ""}${avatar.niche ? ` — ${avatar.niche}` : ""}${avatar.city ? ` — vit à ${avatar.city}` : ""}.`,
    avatar.clothing_style ? `Style vestimentaire souhaité : ${avatar.clothing_style}.` : "",
    avatar.portrait_spec?.clothing ? `Tenue du portrait de référence (à ne pas répéter) : ${avatar.portrait_spec.clothing}.` : "",
    avatar.system_prompt ? `PERSONNALITÉ :\n${avatar.system_prompt.slice(0, 600)}` : "",
    `Définis ${count} tenues : au moins une quotidienne, une sport, une soirée/sortie.`,
  ].filter(Boolean).join("\n\n");
  const raw = await generateText(WARDROBE_SYSTEM, user, 1400);
  const parsed = extractJson<{ outfits?: Array<{ name?: string; description_en?: string; occasion?: string }> }>(raw);
  const defs = (parsed?.outfits ?? []).filter((o) => o.name && o.description_en).slice(0, count);
  if (!defs.length) throw new Error("garde-robe : aucune proposition exploitable");

  const existing = await listWardrobe(avatar.id);
  const model = avatarImageModel(avatar, opts.model);
  const refs = [avatar.ref_image_url, avatar.character_sheet_url].filter(Boolean) as string[];
  const withImages = opts.withImages !== false && refs.length > 0;

  const rows = await Promise.all(
    defs.map(async (o, i) => {
      let ref_url: string | null = null;
      if (withImages) {
        try {
          const r = await piapiImageToStorage(
            { prompt: outfitPrompt(avatar, String(o.description_en), refs.length), refs, model, aspect: "3:4" },
            `${avatar.id}/wardrobe/${String(o.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${Date.now()}`,
          );
          ref_url = r.imageUrl;
        } catch (err) {
          logger.warn("wardrobe_image_failed", { avatarId: avatar.id, name: o.name, err: String((err as Error)?.message ?? err) });
        }
      }
      return { avatar_id: avatar.id, name: `${o.name}${o.occasion ? ` (${o.occasion})` : ""}`.slice(0, 80), description_en: String(o.description_en), ref_url, is_default: existing.length === 0 && i === 0 };
    }),
  );
  const { data, error } = await supabase.from("avatar_wardrobe").insert(rows).select("*");
  if (error) throw new Error(`wardrobe insert: ${error.message}`);
  logger.info("wardrobe_generated", { avatarId: avatar.id, count: rows.length });
  return (data ?? []) as WardrobeItem[];
}
