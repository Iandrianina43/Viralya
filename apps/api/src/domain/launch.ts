import { randomUUID } from "node:crypto";
import { BANNER_SPECS, composeBanner, HOOK_MAX_CHARS, type BannerSpec } from "../lib/banner";
import { HttpError, notFound } from "../lib/httpError";
import { downloadMedia, extractJson, storagePathOf, uploadBytes } from "../lib/storage";
import { removePaths } from "../lib/storageCleanup";
import { logger } from "../logger";
import { generateText } from "../providers/llm";
import { estimateImageCost, piapiImageToStorage, type PiapiImageModel } from "../providers/piapiImage";
import { supabase } from "../supabase";
import { avatarImageModel, identityBlock, identityRefs, pronouns, type AvatarIdentity } from "./characterBible";
import { listConnections } from "./connections";

// ─────────────────────────────────────────────────────────────
// KIT DE LANCEMENT (14 sept. 2026) — demande de Jérôme : quand la fiche d'un influenceur est prête, tout
// ce qu'il faut pour créer ses comptes à la main, en copier-coller.
//   1. Identité de compte (LLM) : réseaux recommandés pour la niche, noms de compte valables PARTOUT
//      (lettres et chiffres, 5-15 caractères : X refuse le point, Facebook le tiret bas), e-mail, nom
//      affiché, bio par réseau aux limites du réseau, accroches de bannière, mots-clés.
//   2. Bannières : fond généré (avec l'influenceur via ses références validées, ou son univers seul),
//      accroche composée par nous dans la zone sûre (lib/banner.ts). Instagram et TikTok n'en ont pas.
//   3. Checklist des étapes MANUELLES (e-mail, téléphone, compte, photo, bio, bannière, lien, label IA,
//      connexion Zernio) et notes de ce qui a servi.
//   Ce qui n'est PAS fait, volontairement : vérifier la disponibilité d'un nom (scraping, contraire aux
//   CGU) et automatiser la validation par téléphone (les réseaux bloquent les numéros virtuels ;
//   contourner = bannissement). Les boutons « vérifier » ouvrent la page du réseau.
// ─────────────────────────────────────────────────────────────

export const LAUNCH_NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"] as const;
export type LaunchNetwork = (typeof LAUNCH_NETWORKS)[number];

export interface NetworkRule {
  label: string;
  handleMax: number;
  handleHint: string;
  bioMax: number;
  bioLabel: string;
  profileUrl: string; // gabarit, {h} = nom de compte
  picture: string;
  aiLabel: string | null;
  banner: BannerSpec | null;
}

// Limites vérifiées le 14 sept. 2026 (documentation et guides 2026).
export const NETWORK_RULES: Record<LaunchNetwork, NetworkRule> = {
  instagram: { label: "Instagram", handleMax: 30, handleHint: "lettres, chiffres, point, tiret bas", bioMax: 150, bioLabel: "Bio", profileUrl: "https://www.instagram.com/{h}/", picture: "320×320 (rond)", aiLabel: "Profil : « Créé avec l'IA » (obligatoire depuis le 31 août 2026)", banner: null },
  tiktok: { label: "TikTok", handleMax: 24, handleHint: "lettres, chiffres, point, tiret bas (pas de point final)", bioMax: 80, bioLabel: "Bio", profileUrl: "https://www.tiktok.com/@{h}", picture: "200×200 (rond)", aiLabel: "Contenu : « Créé par IA » sur chaque vidéo", banner: null },
  youtube: { label: "YouTube", handleMax: 30, handleHint: "lettres, chiffres, point, tiret, tiret bas (3-30)", bioMax: 1000, bioLabel: "Description de la chaîne", profileUrl: "https://www.youtube.com/@{h}", picture: "800×800 (rond)", aiLabel: "Vidéo : « Contenu modifié ou synthétique »", banner: BANNER_SPECS.youtube },
  x: { label: "X", handleMax: 15, handleHint: "lettres, chiffres, tiret bas (4-15)", bioMax: 160, bioLabel: "Bio", profileUrl: "https://x.com/{h}", picture: "400×400 (rond)", aiLabel: null, banner: BANNER_SPECS.x },
  facebook: { label: "Facebook", handleMax: 50, handleHint: "lettres, chiffres, point (5 minimum)", bioMax: 255, bioLabel: "À propos", profileUrl: "https://www.facebook.com/{h}", picture: "170×170 (bureau)", aiLabel: null, banner: BANNER_SPECS.facebook },
};

/** Nom valable sur les cinq réseaux à la fois : lettres et chiffres seulement, 5 à 15 caractères. */
export const UNIVERSAL_HANDLE = /^[a-z0-9]{5,15}$/;

export const CHECKLIST_STEPS = [
  { key: "email", label: "Adresse e-mail créée" },
  { key: "phone", label: "Numéro de téléphone validé" },
  { key: "account", label: "Compte créé avec le nom retenu" },
  { key: "picture", label: "Photo de profil posée (portrait)" },
  { key: "bio", label: "Bio collée" },
  { key: "banner", label: "Bannière posée", networks: ["youtube", "facebook", "x"] },
  { key: "link", label: "Lien posé" },
  { key: "ai_label", label: "Label IA activé", networks: ["instagram", "tiktok", "youtube"] },
  { key: "connected", label: "Compte connecté à Viralya (Zernio)", auto: true },
] as const;

export interface LaunchIdentity {
  networks: Array<{ network: LaunchNetwork; priority: "principal" | "secondaire" | "plus_tard"; why: string }>;
  handles: Array<{ handle: string; why: string }>;
  display_name: string;
  email_local_parts: string[];
  bios: Partial<Record<LaunchNetwork, string>>;
  hooks: string[];
  keywords: string[];
  hashtags: string[];
  link_suggestion: string;
  profile_picture_hint: string;
  banner_scene_en: string;
  generated_at?: string;
  /** Bios modifiées à la main : une régénération ne les écrase pas. */
  edited_bios?: Partial<Record<LaunchNetwork, boolean>>;
  chosen_handle?: string | null;
}

export interface LaunchBanner { id: string; network: "youtube" | "facebook" | "x"; url: string; hook: string | null; with_avatar: boolean; cost_usd: number; created_at: string }

export interface LaunchKit {
  avatar_id: string;
  identity: Partial<LaunchIdentity>;
  checklist: Record<string, Record<string, boolean>>;
  notes: Record<string, string>;
  banners: LaunchBanner[];
  connected: LaunchNetwork[];
  rules: Record<LaunchNetwork, NetworkRule>;
  steps: typeof CHECKLIST_STEPS;
  hook_max_chars: number;
}

const MIGRATION_HINT = "La migration 0021 (kit de lancement) n'est pas appliquée dans Supabase.";
function guardMigration(err: { message?: string; code?: string } | null | undefined): void {
  if (!err) return;
  if (err.code === "42703" || err.code === "42P01" || err.code === "PGRST204" || /does not exist|schema cache/i.test(String(err.message ?? ""))) throw new HttpError(503, MIGRATION_HINT);
}

type KitRow = { avatar_id: string; identity: Partial<LaunchIdentity>; checklist: Record<string, Record<string, boolean>>; notes: Record<string, string>; banners: LaunchBanner[] };

async function readRow(avatarId: string): Promise<KitRow> {
  const { data, error } = await supabase.from("launch_kits").select("avatar_id, identity, checklist, notes, banners").eq("avatar_id", avatarId).maybeSingle();
  guardMigration(error);
  return (data as KitRow | null) ?? { avatar_id: avatarId, identity: {}, checklist: {}, notes: {}, banners: [] };
}

async function writeRow(avatarId: string, patch: Partial<Omit<KitRow, "avatar_id">>): Promise<KitRow> {
  const { data, error } = await supabase.from("launch_kits").upsert({ avatar_id: avatarId, ...patch }, { onConflict: "avatar_id" }).select("avatar_id, identity, checklist, notes, banners").single();
  guardMigration(error);
  if (error || !data) throw new Error(`launch_kits upsert: ${error?.message ?? ""}`);
  return data as KitRow;
}

export async function getKit(orgId: string, avatarId: string): Promise<LaunchKit> {
  const row = await readRow(avatarId);
  const conns = await listConnections(orgId, avatarId).catch(() => []);
  const connected = new Set<LaunchNetwork>();
  for (const c of conns) if (c.status === "active") for (const n of c.networks ?? []) if ((LAUNCH_NETWORKS as readonly string[]).includes(n)) connected.add(n as LaunchNetwork);
  // La connexion Zernio coche l'étape toute seule.
  const checklist = { ...row.checklist };
  for (const n of connected) checklist[n] = { ...(checklist[n] ?? {}), connected: true };
  return { avatar_id: avatarId, identity: row.identity ?? {}, checklist, notes: row.notes ?? {}, banners: row.banners ?? [], connected: [...connected], rules: NETWORK_RULES, steps: CHECKLIST_STEPS, hook_max_chars: HOOK_MAX_CHARS };
}

// ── 1. Identité de compte ─────────────────────────────────────

export const LAUNCH_AVATAR_SELECT = "id, name, sex_age, nationality, city, niche, ref_image_url, character_sheet_url, portrait_spec, image_model, personality, tone_of_voice, values, backstory, business_positioning, target_audience, products, priority_networks, system_prompt";

type LaunchAvatar = AvatarIdentity & {
  personality: string[] | null; tone_of_voice: string | null; values: string[] | null; backstory: string | null;
  business_positioning: string | null; target_audience: string | null; products: string[] | null; priority_networks: string[] | null; system_prompt: string | null;
};

export const IDENTITY_SYSTEM = `Tu es directeur de marque pour des influenceurs virtuels. À partir de la fiche d'un influenceur, tu prépares son identité de compte pour les réseaux sociaux. Réponds UNIQUEMENT par un objet JSON, sans commentaire.

Règles :
- "networks" : les 5 réseaux (instagram, tiktok, youtube, x, facebook), chacun avec "priority" = "principal" | "secondaire" | "plus_tard" et "why" (1 phrase, FR) : où vit l'audience de CETTE niche, quel format y marche.
- "handles" : 6 noms de compte, IDENTIQUES sur tous les réseaux → lettres minuscules et chiffres SEULEMENT (ni point, ni tiret bas, ni accent), 5 à 15 caractères, mémorisables, cohérents avec le prénom et la niche ; "why" en 1 phrase.
- "display_name" : nom affiché (≤ 30 caractères).
- "email_local_parts" : 3 parties locales d'adresse e-mail (avant le @), lettres minuscules, chiffres, points.
- "bios" : une bio par réseau, TOUJOURS EN FRANÇAIS, dans la voix du personnage, LIMITES STRICTES (compte les caractères, vise 20 % sous la limite) : instagram ≤ 150 caractères, tiktok ≤ 80, x ≤ 160, facebook ≤ 220, youtube ≤ 900 (description de chaîne : qui, quoi, rythme de publication). Pas de « bienvenue », pas de hashtag dans les bios courtes, 0 à 2 emojis. Mention IA courte quand c'est pertinent (« créatrice virtuelle »).
- "hooks" : 5 accroches de bannière, ≤ 36 caractères, 2 à 6 mots, sans point final, une promesse concrète pour l'audience (pas le nom du personnage).
- "keywords" : 8 mots-clés de recherche ; "hashtags" : 10 hashtags sans #.
- "link_suggestion" : ce que le lien en bio devrait pointer (1 phrase).
- "profile_picture_hint" : quel portrait choisir (1 phrase).
- "banner_scene_en" : EN ANGLAIS, 1 phrase : le décor d'une bannière 16:9 qui raconte son univers (lieu, lumière, objets de la niche), sans personne, sans texte.

FORME EXACTE de la réponse (mêmes clés, mêmes types) :
{"networks":[{"network":"instagram","priority":"principal","why":"…"},{"network":"tiktok","priority":"…","why":"…"},{"network":"youtube","priority":"…","why":"…"},{"network":"x","priority":"…","why":"…"},{"network":"facebook","priority":"…","why":"…"}],
"handles":[{"handle":"…","why":"…"},…],
"display_name":"…","email_local_parts":["…","…","…"],
"bios":{"instagram":"…","tiktok":"…","youtube":"…","x":"…","facebook":"…"},
"hooks":["…"],"keywords":["…"],"hashtags":["…"],"link_suggestion":"…","profile_picture_hint":"…","banner_scene_en":"…"}`;

export function avatarBrief(a: LaunchAvatar): string {
  const l = (x: unknown) => (Array.isArray(x) && x.length ? x.join(", ") : "—");
  return [
    `Prénom : ${a.name}`,
    `Sexe / âge : ${a.sex_age || "—"} · Nationalité : ${a.nationality || "—"} · Ville : ${a.city || "—"}`,
    `Niche : ${a.niche || "—"}`,
    `Personnalité : ${l(a.personality)} · Ton : ${a.tone_of_voice || "—"} · Valeurs : ${l(a.values)}`,
    `Positionnement : ${a.business_positioning || "—"}`,
    `Audience visée : ${a.target_audience || "—"}`,
    `Produits / offres : ${l(a.products)}`,
    `Réseaux déjà envisagés : ${l(a.priority_networks)}`,
    `Histoire : ${(a.backstory || "").slice(0, 900) || "—"}`,
    `Voix du personnage : ${(a.system_prompt || "").slice(0, 700) || "—"}`,
  ].join("\n");
}

/** Coupe à `max` caractères en finissant sur une phrase, sinon sur un mot. */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf(".\n"));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1).trim();
  const space = head.lastIndexOf(" ");
  return (space > max * 0.6 ? head.slice(0, space) : head).replace(/[,;:\s]+$/, "").trim();
}
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strip = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function fallbackHandles(a: LaunchAvatar): string[] {
  const base = strip(a.name).replace(/[^a-z0-9]/g, "").slice(0, 10) || "viralya";
  const niche = strip(a.niche ?? "").replace(/[^a-z0-9]/g, "").slice(0, 6);
  const city = strip(a.city ?? "").replace(/[^a-z0-9]/g, "").slice(0, 6);
  return [base, `${base}${niche}`, `${base}${city}`, `${base}off`, `${base}2026`].map((h) => h.slice(0, 15)).filter((h) => UNIVERSAL_HANDLE.test(h));
}

export function sanitizeIdentity(raw: Record<string, unknown>, a: LaunchAvatar): LaunchIdentity {
  const nets: Array<Record<string, unknown>> = Array.isArray(raw.networks)
    ? (raw.networks as Array<Record<string, unknown>>)
    : raw.networks && typeof raw.networks === "object"
      ? Object.entries(raw.networks as Record<string, unknown>).map(([network, v]) => (typeof v === "string" ? { network, priority: v } : { network, ...(v as Record<string, unknown>) }))
      : [];
  const networks: LaunchIdentity["networks"] = [];
  for (const n of nets) {
    const network = String(n?.network ?? "").toLowerCase() as LaunchNetwork;
    const priority = String(n?.priority ?? "") as LaunchIdentity["networks"][number]["priority"];
    if (!(LAUNCH_NETWORKS as readonly string[]).includes(network) || networks.some((x) => x.network === network)) continue;
    networks.push({ network, priority: ["principal", "secondaire", "plus_tard"].includes(priority) ? priority : "plus_tard", why: clean(n?.why, 220) });
  }
  for (const network of LAUNCH_NETWORKS) if (!networks.some((x) => x.network === network)) networks.push({ network, priority: "plus_tard", why: "" });

  const handles: LaunchIdentity["handles"] = [];
  const seen = new Set<string>();
  const rawHandles: Array<Record<string, unknown> | string> = Array.isArray(raw.handles)
    ? (raw.handles as Array<Record<string, unknown> | string>)
    : raw.handles && typeof raw.handles === "object"
      ? (() => { const o = raw.handles as Record<string, unknown>; const list = Array.isArray(o.names) ? o.names : Array.isArray(o.list) ? o.list : Object.keys(o); return (list as unknown[]).map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>))); })()
      : [];
  for (const h of rawHandles) {
    const src = typeof h === "string" ? h : String(h?.handle ?? "");
    const handle = strip(src).replace(/^@/, "").replace(/[^a-z0-9]/g, "").slice(0, 15);
    if (!UNIVERSAL_HANDLE.test(handle) || seen.has(handle)) continue;
    seen.add(handle);
    handles.push({ handle, why: typeof h === "string" ? "" : clean(h?.why, 200) });
    if (handles.length >= 6) break;
  }
  for (const h of fallbackHandles(a)) if (handles.length < 5 && !seen.has(h)) { seen.add(h); handles.push({ handle: h, why: "Variante de repli (prénom + niche / ville)." }); }

  const bios: LaunchIdentity["bios"] = {};
  const rawBios = (raw.bios && typeof raw.bios === "object" ? raw.bios : {}) as Record<string, unknown>;
  for (const network of LAUNCH_NETWORKS) {
    const b = typeof rawBios[network] === "string" ? (rawBios[network] as string).trim() : "";
    if (b) bios[network] = cutAt(b, NETWORK_RULES[network].bioMax);
  }

  const emails = (Array.isArray(raw.email_local_parts) ? raw.email_local_parts : []).map((e) => strip(String(e)).replace(/[^a-z0-9.]/g, "").replace(/^\.+|\.+$/g, "")).filter((e) => e.length >= 3 && e.length <= 30).slice(0, 3);
  if (!emails.length && handles[0]) emails.push(handles[0].handle);

  const hooks = (Array.isArray(raw.hooks) ? raw.hooks : []).map((h) => clean(h, HOOK_MAX_CHARS).replace(/[.!]+$/, "")).filter((h) => h.length >= 4).slice(0, 6);

  return {
    networks,
    handles,
    display_name: clean(raw.display_name, 30) || a.name,
    email_local_parts: emails,
    bios,
    hooks,
    keywords: (Array.isArray(raw.keywords) ? raw.keywords : []).map((k) => clean(k, 40)).filter(Boolean).slice(0, 10),
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags : []).map((k) => clean(k, 40).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 12),
    link_suggestion: clean(raw.link_suggestion, 200),
    profile_picture_hint: clean(raw.profile_picture_hint, 200),
    banner_scene_en: clean(raw.banner_scene_en, 300),
    generated_at: new Date().toISOString(),
  };
}

/** Génère l'identité de compte (≈ 0,03 $ de LLM) et la sauvegarde ; les bios déjà éditées à la main ne sont pas écrasées. */
export async function generateIdentity(avatar: LaunchAvatar): Promise<LaunchIdentity> {
  const raw = await generateText(IDENTITY_SYSTEM, avatarBrief(avatar), 3500, { effort: "low" });
  const parsed = extractJson<Record<string, unknown>>(raw);
  if (!parsed) throw new HttpError(502, "Le modèle n'a pas renvoyé une identité lisible. Réessaie.");
  const identity = sanitizeIdentity(parsed, avatar);
  const prev = await readRow(avatar.id);
  const keptBios = { ...identity.bios };
  for (const network of LAUNCH_NETWORKS) if (prev.identity?.bios?.[network] && prev.identity?.edited_bios?.[network]) keptBios[network] = prev.identity.bios[network];
  await writeRow(avatar.id, { identity: { ...prev.identity, ...identity, bios: keptBios } as Partial<LaunchIdentity> });
  logger.info("launch_identity_generated", { avatarId: avatar.id, handles: identity.handles.length, hooks: identity.hooks.length });
  return { ...identity, bios: keptBios };
}

// ── Édition (bios, choix, notes, checklist) ───────────────────

export interface KitPatch {
  bios?: Partial<Record<LaunchNetwork, string>>;
  chosen_handle?: string | null;
  notes?: Record<string, unknown>;
  checklist?: Record<string, Record<string, unknown>>;
}

export async function patchKit(avatarId: string, patch: KitPatch): Promise<void> {
  const row = await readRow(avatarId);
  const identity = { ...(row.identity ?? {}) } as Partial<LaunchIdentity> & { edited_bios?: Partial<Record<LaunchNetwork, boolean>>; chosen_handle?: string | null };
  if (patch.bios) {
    identity.bios = { ...(identity.bios ?? {}) };
    identity.edited_bios = { ...(identity.edited_bios ?? {}) };
    for (const network of LAUNCH_NETWORKS) {
      const b = patch.bios[network];
      if (typeof b !== "string") continue;
      identity.bios[network] = b.slice(0, NETWORK_RULES[network].bioMax);
      identity.edited_bios[network] = true;
    }
  }
  if (patch.chosen_handle !== undefined) identity.chosen_handle = patch.chosen_handle ? strip(String(patch.chosen_handle)).replace(/^@/, "").replace(/[^a-z0-9._-]/g, "").slice(0, 30) : null;
  const notes = { ...(row.notes ?? {}) };
  for (const [k, v] of Object.entries(patch.notes ?? {})) if (/^[a-z_]{1,30}$/.test(k)) notes[k] = clean(v, 200);
  const checklist = { ...(row.checklist ?? {}) };
  for (const [network, steps] of Object.entries(patch.checklist ?? {})) {
    if (!(LAUNCH_NETWORKS as readonly string[]).includes(network) || !steps || typeof steps !== "object") continue;
    checklist[network] = { ...(checklist[network] ?? {}) };
    for (const [step, v] of Object.entries(steps)) if (CHECKLIST_STEPS.some((s) => s.key === step)) checklist[network]![step] = Boolean(v);
  }
  await writeRow(avatarId, { identity, notes, checklist });
}

// ── 2. Bannières ──────────────────────────────────────────────

export type BannerNetwork = keyof typeof BANNER_SPECS;
export const isBannerNetwork = (v: unknown): v is BannerNetwork => typeof v === "string" && v in BANNER_SPECS;

export function bannerEstimate(avatar: Pick<AvatarIdentity, "image_model">, withAvatar: boolean): { model: PiapiImageModel; cost: number } {
  const model = avatarImageModel(avatar);
  // 2K : une bannière YouTube fait 2560 px de large, le 1K serait flou une fois agrandi.
  return { model, cost: estimateImageCost(model, withAvatar ? 4 : 0, "2K") };
}

function bannerPrompt(avatar: LaunchAvatar, spec: BannerSpec, scene: string, withAvatar: boolean, refCount: number): string {
  const subjectSide = spec.textSide === "left" ? "right" : "left";
  const decor = scene || `a place that tells the world of ${avatar.niche ?? "a content creator"}${avatar.city ? ` in ${avatar.city}` : ""}, soft natural light`;
  if (!withAvatar) return `Wide 16:9 banner photograph, cinematic and clean: ${decor}. No people, no text, no letters, no logos, no watermark. The composition tolerates cropping: nothing important in the top and bottom quarters of the frame, the ${spec.textSide} half stays calm and uncluttered (space for a title).`;
  const p = pronouns(avatar);
  return [
    identityBlock(avatar),
    refCount ? `The ${refCount} reference images show this exact person: keep the same face, hair and skin, no change of identity.` : "",
    `Wide 16:9 banner photograph. ${p.subj} stands in the ${subjectSide} third of the frame, medium shot from the waist up, face at the exact vertical center of the frame, looking at the camera with a natural confident smile, outfit true to ${p.poss} style. Background: ${decor}, softly blurred. The ${spec.textSide} half of the frame is calm and uncluttered (space for a title). Nothing important in the top and bottom quarters. No text, no letters, no logos, no watermark.`,
  ].filter(Boolean).join("\n");
}

/** Génère le fond, compose l'accroche, range le fichier et l'ajoute au kit. */
export async function generateBanner(avatar: LaunchAvatar, opts: { network: BannerNetwork; withAvatar: boolean; hook: string | null }): Promise<LaunchBanner> {
  const spec = BANNER_SPECS[opts.network];
  const hook = opts.hook ? opts.hook.replace(/\s+/g, " ").trim().slice(0, HOOK_MAX_CHARS) : null;
  const row = await readRow(avatar.id);
  const refs = opts.withAvatar ? await identityRefs(avatar, 4) : [];
  if (opts.withAvatar && !refs.length) throw new HttpError(409, "Aucun portrait validé pour cet influenceur : génère d'abord ses références dans la Bible, ou choisis « univers seul ».");
  const { model } = bannerEstimate(avatar, opts.withAvatar);
  const scene = String(row.identity?.banner_scene_en ?? "");
  const gen = await piapiImageToStorage({ prompt: bannerPrompt(avatar, spec, scene, opts.withAvatar, refs.length), refs, model, aspect: "16:9", quality: "2K" }, `${avatar.id}/launch/bg-${opts.network}-${Date.now()}`);
  const { bytes } = await downloadMedia(gen.imageUrl);
  const composed = await composeBanner(bytes, spec, hook);
  const url = await uploadBytes(`${avatar.id}/launch/banner-${opts.network}-${Date.now()}.jpg`, composed, "image/jpeg");
  const banner: LaunchBanner = { id: randomUUID(), network: opts.network, url, hook, with_avatar: opts.withAvatar, cost_usd: Math.round(gen.cost * 1000) / 1000, created_at: new Date().toISOString() };
  const fresh = await readRow(avatar.id);
  await writeRow(avatar.id, { banners: [banner, ...(fresh.banners ?? [])].slice(0, 30) });
  // Le fond brut ne sert plus : on garde la bannière composée seulement.
  const bgPath = storagePathOf(gen.imageUrl);
  if (bgPath) await removePaths([bgPath]).catch(() => 0);
  logger.info("launch_banner_generated", { avatarId: avatar.id, network: opts.network, withAvatar: opts.withAvatar, cost: gen.cost, ms: gen.ms });
  return banner;
}

export async function deleteBanner(avatarId: string, bannerId: string): Promise<void> {
  const row = await readRow(avatarId);
  const b = (row.banners ?? []).find((x) => x.id === bannerId);
  if (!b) throw notFound("Bannière");
  await writeRow(avatarId, { banners: row.banners.filter((x) => x.id !== bannerId) });
  const path = storagePathOf(b.url);
  if (path) await removePaths([path]).catch(() => 0);
}
