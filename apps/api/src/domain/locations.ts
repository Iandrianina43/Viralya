import { extractJson } from "../lib/storage";
import { logger } from "../logger";
import { generateImage } from "../providers/image";
import { generateText } from "../providers/llm";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Univers de lieux persistants : les décors récurrents de la vie de l'avatar
// (sa chambre, son café…). Description canonique EN = l'ancre de cohérence.
// ─────────────────────────────────────────────────────────────

export type LocationScope = "permanent" | "oneoff";

export interface AvatarLocation {
  id: string;
  avatar_id: string;
  key: string;
  name: string;
  description: string;
  ref_image_url: string | null;
  scope: LocationScope;
}

/** Lieux de l'avatar. Par défaut, seulement son univers permanent. */
export async function listLocations(avatarId: string, scope: LocationScope | "all" = "permanent"): Promise<AvatarLocation[]> {
  let q = supabase.from("avatar_locations").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: true });
  if (scope !== "all") q = q.eq("scope", scope);
  const { data, error } = await q;
  if (error) throw new Error(`locations list: ${error.message}`);
  return (data ?? []) as AvatarLocation[];
}

// Prompt d'image de référence : le lieu SEUL (sans personnage) pour servir de décor réutilisable.
function refImagePrompt(description: string): string {
  return `Photorealistic vertical 9:16 interior/exterior photography, EMPTY scene with NO people. ${description}. Natural light, shot on a real camera, film look, high detail, realistic lived-in place.`;
}

export async function createLocation(
  avatarId: string,
  loc: { key: string; name: string; description: string },
  withImage = true,
  scope: LocationScope = "permanent",
): Promise<AvatarLocation> {
  // Un lieu de passage porte une clé unique : il ne remplace jamais un lieu de vie.
  const key = scope === "oneoff" ? `${loc.key}-${Date.now().toString(36).slice(-5)}` : loc.key;
  const { data, error } = await supabase
    .from("avatar_locations")
    .upsert({ avatar_id: avatarId, key, name: loc.name, description: loc.description, scope }, { onConflict: "avatar_id,key" })
    .select("*")
    .single();
  if (error || !data) throw new Error(`location create: ${error?.message ?? ""}`);
  let row = data as AvatarLocation;
  if (withImage && !row.ref_image_url) {
    try {
      const { imageUrl } = await generateImage(refImagePrompt(loc.description), `${avatarId}/locations/${loc.key}-${Date.now()}`, "1024x1536");
      const { data: updated } = await supabase.from("avatar_locations").update({ ref_image_url: imageUrl }).eq("id", row.id).select("*").single();
      if (updated) row = updated as AvatarLocation;
    } catch (err) {
      logger.warn("location_image_failed", { key: loc.key, err: String((err as Error)?.message ?? err) });
    }
  }
  return row;
}

export async function regenerateLocationImage(avatarId: string, locationId: string, refinement?: string): Promise<AvatarLocation> {
  const { data: loc } = await supabase.from("avatar_locations").select("*").eq("id", locationId).eq("avatar_id", avatarId).single();
  if (!loc) throw new Error("lieu introuvable");
  const prompt = refImagePrompt(refinement ? `${loc.description}. ${refinement}` : loc.description);
  const { imageUrl } = await generateImage(prompt, `${avatarId}/locations/${loc.key}-${Date.now()}`, "1024x1536");
  const { data: updated, error } = await supabase.from("avatar_locations").update({ ref_image_url: imageUrl }).eq("id", locationId).select("*").single();
  if (error || !updated) throw new Error(`location update: ${error?.message ?? ""}`);
  return updated as AvatarLocation;
}

// Ré-encode en JPEG les images de référence encore en PNG (allège la galerie
// sans rien régénérer → aucun coût IA).
export async function optimizeLocationImages(avatarId: string): Promise<{ optimized: number }> {
  const rows = await listLocations(avatarId, "all");
  const heavy = rows.filter((l) => l.ref_image_url?.toLowerCase().endsWith(".png"));
  const { storeAsJpeg } = await import("../providers/image");
  let optimized = 0;
  for (const loc of heavy) {
    try {
      const res = await fetch(loc.ref_image_url as string);
      if (!res.ok) continue;
      const url = await storeAsJpeg(Buffer.from(await res.arrayBuffer()), `${avatarId}/locations/${loc.key}-opt-${Date.now()}`);
      await supabase.from("avatar_locations").update({ ref_image_url: url }).eq("id", loc.id);
      optimized++;
    } catch (err) {
      logger.warn("location_optimize_failed", { key: loc.key, err: String((err as Error)?.message ?? err) });
    }
  }
  return { optimized };
}

// ── Génération d'univers (à la création de l'avatar ou à la demande) ──
const UNIVERSE_SYSTEM = `Tu es directeur artistique. Tu définis l'UNIVERS DE VIE d'un influenceur : ses 5-6 lieux récurrents (où il vit et tourne ses vlogs).
Pour CHAQUE lieu, écris une description CANONIQUE en ANGLAIS, ultra-précise et FIGÉE (murs, meubles, matériaux, couleurs, objets signature, lumière) — elle servira à régénérer LE MÊME lieu dans toutes les vidéos.
Inclus obligatoirement : sa chambre, sa salle de bain, sa cuisine/coin repas, un extérieur du quartier, son café/spot favori. Ajoute 1 lieu signature lié à sa niche.
Les lieux doivent être cohérents entre eux (même appartement, même quartier, même standing) et avec la ville/personnalité.
Réponds UNIQUEMENT en JSON :
{"locations":[{"key":"bedroom|bathroom|kitchen|street|cafe|<slug>","name":"<nom FR court>","description":"<canonical EN description, 40-70 mots>"}]}`;

export async function generateUniverse(avatar: {
  id: string;
  name: string;
  niche: string | null;
  city: string | null;
  system_prompt: string | null;
}): Promise<AvatarLocation[]> {
  const user = [
    `PERSONNAGE : ${avatar.name}${avatar.niche ? ` — ${avatar.niche}` : ""}${avatar.city ? ` — vit à ${avatar.city}` : ""}.`,
    avatar.system_prompt ? `PERSONNALITÉ :\n${avatar.system_prompt.slice(0, 800)}` : "",
    `Définis son univers de lieux.`,
  ].filter(Boolean).join("\n\n");

  const raw = await generateText(UNIVERSE_SYSTEM, user, 1600);
  const parsed = extractJson<{ locations?: Array<{ key?: string; name?: string; description?: string }> }>(raw);
  const defs = (parsed?.locations ?? [])
    .filter((l) => l.key && l.name && l.description)
    .slice(0, 7)
    .map((l) => ({
      key: String(l.key).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
      name: String(l.name),
      description: String(l.description),
    }));
  if (defs.length === 0) throw new Error("univers: aucune proposition exploitable");

  // Images de référence générées en parallèle.
  const rows = await Promise.all(defs.map((d) => createLocation(avatar.id, d, true)));
  logger.info("universe_generated", { avatarId: avatar.id, locations: rows.length });
  return rows;
}
