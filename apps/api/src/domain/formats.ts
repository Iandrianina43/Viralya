import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSourceVideo } from "../lib/ffmpeg";
import { extractJson, uploadBytes } from "../lib/storage";
import { logger } from "../logger";
import { transcribeWords } from "../providers/elevenlabs";
import { generateText } from "../providers/llm";
import { ensureEnglishDirection, normalizeScenes, type VlogProduction, type VlogScene } from "./director";

// ─────────────────────────────────────────────────────────────
// FORMATS (6 sept. 2026, docs/RECHERCHE-FORMATS.md) : pub produit sans visage, pub avec
// l'influenceur (brief pour la prise unique), vidéo explicative sans visage (clips + images
// animées), clone de vidéo (source + sa voix). Tout produit une VlogProduction que
// launchProduction sait lancer ; les prompts Seedance sont dans director.ts.
// ─────────────────────────────────────────────────────────────

export interface FormatAvatar { id: string; name: string; niche: string | null; city: string | null; system_prompt: string | null }
export interface FormatProduct { name: string; description: string; image_url?: string | null; image_urls?: string[] }

export const FORMAT_KINDS = ["vlog", "ad_product", "ad_creator", "explainer", "clone"] as const;
export type FormatKind = (typeof FORMAT_KINDS)[number];
export const isFormatKind = (v: unknown): v is FormatKind => FORMAT_KINDS.includes(v as FormatKind);

/** Produit tel qu'envoyé par l'assistant (nom obligatoire, photos = URLs publiques). */
export function parseProduct(raw: unknown): FormatProduct {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = String(r.name ?? "").trim();
  if (!name) throw new Error("Le nom du produit est requis.");
  const urls = Array.isArray(r.image_urls) ? (r.image_urls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)) : [];
  const image_url = typeof r.image_url === "string" && /^https?:\/\//.test(r.image_url) ? r.image_url : urls[0] ?? null;
  return { name, description: String(r.description ?? "").trim().slice(0, 600), image_url, image_urls: [...new Set([...(image_url ? [image_url] : []), ...urls])].slice(0, 3) };
}

const who = (a: FormatAvatar) => `${a.name}${a.niche ? ` — ${a.niche}` : ""}${a.city ? ` — ${a.city}` : ""}${a.system_prompt ? `\nSA PERSONNALITÉ (pour le ton de sa voix off) :\n${a.system_prompt.slice(0, 800)}` : ""}`;

const RETRY_HINT = "IMPORTANT : ta réponse précédente n'était pas exploitable. Réponds UNIQUEMENT avec l'objet JSON, sans texte avant ni après, sans balises de code, champs courts.";

async function askJson<T>(system: string, user: string, maxTokens: number): Promise<T> {
  // Le modèle renvoie parfois du texte autour du JSON ou une sortie tronquée : un second essai plus strict.
  for (const retry of [false, true]) {
    const raw = await generateText(system, retry ? `${user}\n\n${RETRY_HINT}` : user, maxTokens, { effort: "low" });
    const parsed = extractJson<T>(raw);
    if (parsed) return parsed;
    logger.warn("format_json_failed", { retry, preview: String(raw ?? "").slice(0, 300) });
  }
  throw new Error("Le réalisateur n'a pas renvoyé un script exploitable — réessaie ou précise le brief.");
}

function finishProduction(parsed: Partial<VlogProduction>, fallbackTitle: string): Promise<VlogProduction> {
  const scenes = normalizeScenes((parsed.scenes ?? []) as VlogScene[]);
  if (!scenes.length) throw new Error("Aucune scène exploitable dans le script.");
  return ensureEnglishDirection(scenes).then((sc) => ({
    title: String(parsed.title ?? fallbackTitle).slice(0, 120),
    story: String(parsed.story ?? ""),
    caption: String(parsed.caption ?? ""),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 8) : [],
    scenes: sc,
  }));
}

// ── VIDÉO EXPLICATIVE SANS VISAGE ─────────────────────────────
// Recherche du 6 sept. : accroche 0-3 s, contexte, 2-3 points, chute, UN CTA ; un visuel littéral
// par idée ; mélange de clips (mouvement) et d'images animées (économie).
const EXPLAINER_SYSTEM = `Tu es le réalisateur d'une vidéo EXPLICATIVE verticale SANS VISAGE pour TikTok/Reels : la voix off de l'influenceur explique une chose utile ; l'image montre des objets, des lieux, des mains, des écrans — JAMAIS un visage reconnaissable.
STRUCTURE : accroche 0-3 s (une erreur, un résultat ou une affirmation forte — jamais « aujourd'hui je vous explique »), contexte 3-8 s, 2 ou 3 points concrets 8-22 s, chute 22-27 s, UN seul appel à l'action léger à la fin (« enregistre », « dis-moi en commentaire »).
TEXTE ("texte", FR) : français parlé à la 1re personne, phrases complètes et courtes, ≈ 2,2 mots par seconde de vidéo — respecte le BUDGET DE MOTS donné, jamais plus. Chiffres en toutes lettres, aucun sigle, symbole ni emoji. Pas de remplissage, pas de formule de guide touristique.
VISUELS : 4 à 6 scènes, une idée par scène, un visuel LITTÉRAL qui montre la chose dont on parle. "visual":"clip" pour 1 ou 2 moments qui ont besoin de mouvement (l'accroche, une démonstration), "still" pour le reste (image fixe animée, dix fois moins chère). "image_prompt" (EN, 25-45 mots) décrit précisément l'image : sujet, matière, cadrage, lumière ; sans personne reconnaissable, sans texte.
DIRECTION EN ANGLAIS, jamais en français : "action" (ce qui bouge dans le clip, 12-25 mots), "camera" (UN seul mouvement : slow push-in, handheld pan, top-down…), "lighting" (une source), "audio_ambiance" (2-3 sons nommés, JAMAIS de musique), "constraints" (continuité, ex. same mug throughout). "shots" : [].
"duration_sec" : clip 4 à 8 s, still 3 à 7 s — la somme fait la durée demandée.
Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"title":"<titre FR, 6 mots max>","story":"<résumé FR en 2 phrases>","caption":"<légende FR, 1-2 phrases>","hashtags":["…"],"scenes":[{"titre":"<FR>","mode":"voiceover","visual":"clip"|"still","texte":"<FR>","duration_sec":<n>,"image_prompt":"<EN>","action":"<EN>","shots":[],"scene_desc":"","camera":"<EN>","lighting":"<EN>","audio_ambiance":"<EN>","constraints":"<EN>"}]}`;

export async function writeExplainer(input: { avatar: FormatAvatar; topic: string; durationSec: number; instruction?: string }): Promise<VlogProduction> {
  const words = Math.round(input.durationSec * 2.2);
  const user = [
    `INFLUENCEUR (sa voix off, son ton) : ${who(input.avatar)}`,
    `SUJET : ${input.topic}`,
    `DURÉE : ${input.durationSec} secondes — BUDGET DE MOTS : ${Math.max(20, words - 8)} à ${words} mots pour tous les "texte" réunis.`,
    input.instruction ? `MODIFICATIONS DEMANDÉES : ${input.instruction}` : "",
    "Écris le script.",
  ].filter(Boolean).join("\n\n");
  const parsed = await askJson<Partial<VlogProduction>>(EXPLAINER_SYSTEM, user, 6000);
  const production = await finishProduction(parsed, "Vidéo explicative");
  // Au plus 2 clips Seedance (les plus chers) : les suivants deviennent des images animées.
  let clips = 0;
  production.scenes = production.scenes.map((s) => {
    const visual = s.visual === "clip" && clips < 2 ? (clips++, "clip" as const) : ("still" as const);
    return { ...s, mode: "voiceover" as const, visual, inserts: undefined };
  });
  return production;
}

// ── PUB PRODUIT SANS VISAGE ───────────────────────────────────
// Recherche du 6 sept. (Oakgen, imastudio) : product lock en tête, accroche / preuve d'UN bénéfice /
// résultat / image finale propre, prix et texte ajoutés au montage, négatifs précis.
const AD_PRODUCT_SYSTEM = `Tu es le réalisateur d'une PUBLICITÉ produit verticale, SANS personne à l'écran (le produit est la star), rendue en UNE prise Seedance 2.5 avec des coupes internes.
STRUCTURE : 4 plans horodatés — ACCROCHE 0-5 s (un contraste, un geste ou un comportement surprenant du produit), PREUVE 5-20 s d'UN SEUL bénéfice montré par l'action (jamais une liste de fonctions), RÉSULTAT 20-27 s (la transformation, le produit en usage), IMAGE FINALE 27-30 s (produit de face, étiquette dégagée, fond simple, espace vide en haut pour le texte ajouté au montage, caméra fixe). Adapte les bornes si la durée demandée n'est pas 30 s.
PRODUCT LOCK ("product_lock", EN, 20-30 mots) : fige forme, matière, couleurs, position de l'étiquette et proportions — ce qui ne doit JAMAIS changer.
VOIX OFF ("texte", FR) : si demandée, 40 à 55 mots max pour 30 s, ton conversationnel (pas de slogan, pas de promesse santé), une phrase par plan, le dernier plan SANS parole ; chiffres en toutes lettres, jamais de prix ni de pourcentage (ajoutés au montage). Si non demandée : "texte": "".
DIRECTION EN ANGLAIS, jamais en français : "shots" = 4 objets {"t":"0-5s","desc":"<EN 15-25 mots : taille de plan + UN mouvement de caméra + l'action lisible du produit>"} ; "scene_desc" (EN : le décor et la lumière motivée), "camera" (EN : style général, ex. slow controlled moves, macro details), "lighting" (EN : une source), "audio_ambiance" (EN : 2-3 sons d'objets ou d'ambiance, JAMAIS de musique), "constraints" (EN : négatifs propres au produit — no duplicate bottle, no label mutation, no floating product…), "action" (EN : résumé en 15-25 mots).
Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"title":"<FR>","story":"<FR : l'idée de la pub en 2 phrases>","caption":"<FR>","hashtags":["…"],"scenes":[{"titre":"<FR>","mode":"voiceover","visual":"clip","texte":"<FR ou vide>","duration_sec":<n>,"product_lock":"<EN>","action":"<EN>","shots":[{"t":"0-5s","desc":"<EN>"},{"t":"5-20s","desc":"<EN>"},{"t":"20-27s","desc":"<EN>"},{"t":"27-30s","desc":"<EN>"}],"scene_desc":"<EN>","camera":"<EN>","lighting":"<EN>","audio_ambiance":"<EN>","constraints":"<EN>"}]}`;

export async function writeProductAd(input: { avatar: FormatAvatar; product: FormatProduct; brief?: string; durationSec: number; voiceOver: boolean; instruction?: string }): Promise<VlogProduction> {
  const user = [
    `PRODUIT : ${input.product.name}${input.product.description ? ` — ${input.product.description}` : ""}${input.product.image_url ? " (photo fournie : elle sert de référence exacte)" : ""}`,
    `INFLUENCEUR dont la voix off sera utilisée : ${who(input.avatar)}`,
    input.brief ? `BRIEF : ${input.brief}` : "",
    `DURÉE : ${input.durationSec} secondes. VOIX OFF : ${input.voiceOver ? "oui, avec sa voix" : "non (ambiance et sons seulement)"}.`,
    input.instruction ? `MODIFICATIONS DEMANDÉES : ${input.instruction}` : "",
    "Écris la pub.",
  ].filter(Boolean).join("\n\n");
  const parsed = await askJson<Partial<VlogProduction>>(AD_PRODUCT_SYSTEM, user, 5000);
  const production = await finishProduction(parsed, `Pub ${input.product.name}`);
  const first = production.scenes[0]!;
  // Une seule prise : la scène couvre toute la durée ; sans voix off, aucun texte à synthétiser.
  production.scenes = [{ ...first, mode: "voiceover", visual: "clip", duration_sec: Math.max(10, Math.min(30, input.durationSec)), texte: input.voiceOver ? first.texte : "", inserts: undefined }];
  return production;
}

/** Pub AVEC l'influenceur : brief injecté dans la prise unique existante (writeStory + breakIntoScenes). */
export function adCreatorBrief(product: FormatProduct, brief?: string): string {
  return [
    `PUBLICITÉ pour le produit « ${product.name} »${product.description ? ` (${product.description})` : ""}.`,
    "Elle tient le produit et le montre à la caméra. Structure : une accroche en une phrase (un problème vécu ou un contraste), UN bénéfice montré concrètement, une preuve vécue (ce que ça change pour elle, un détail précis), un appel à l'action naturel à la fin (code, lien en bio, commentaire). Ton de conversation entre amies, aucune promesse santé, aucun prix chiffré.",
    brief ? `Consignes : ${brief}` : "",
  ].filter(Boolean).join(" ");
}

// ── CLONE DE VIDÉO ────────────────────────────────────────────
// Source : fichier déposé ou lien (yt-dlp) → normalisée en mp4 9:16, coupée à 30 s (limite Seedance 2.5).
export interface CloneSource { url: string; seconds: number; trimmed: boolean; original: number }

export async function storeCloneSource(avatarId: string, bytes: Buffer, contentType: string): Promise<CloneSource> {
  const stamp = Date.now();
  const ext = /quicktime|\/mov/i.test(contentType) ? "mov" : /webm/i.test(contentType) ? "webm" : "mp4";
  const rawUrl = await uploadBytes(`${avatarId}/sources/${stamp}-raw.${ext}`, bytes, contentType || "video/mp4");
  const prepared = await prepareSourceVideo(rawUrl, 30);
  const url = await uploadBytes(`${avatarId}/sources/${stamp}-source.mp4`, prepared.video, "video/mp4");
  logger.info("clone_source_stored", { avatarId, seconds: prepared.seconds, trimmed: prepared.trimmed, bytes: bytes.length });
  return { url, seconds: prepared.seconds, trimmed: prepared.trimmed, original: prepared.original };
}

/** Téléchargement d'un lien (TikTok, Instagram, YouTube…) via yt-dlp s'il est installé sur le serveur. */
export async function downloadCloneLink(avatarId: string, link: string): Promise<CloneSource> {
  if (!/^https?:\/\/\S+$/i.test(link)) throw new Error("Lien invalide.");
  const dir = await mkdtemp(join(tmpdir(), "viralya-dl-"));
  try {
    const out = join(dir, "dl.mp4");
    await new Promise<void>((resolve, reject) => {
      execFile(
        "yt-dlp",
        ["-f", "mp4/bestvideo*+bestaudio/best", "--merge-output-format", "mp4", "--no-playlist", "--max-filesize", "200m", "-o", out, link],
        { timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (!err) { resolve(); return; }
          const msg = String(err.message ?? err);
          reject(new Error(/ENOENT/.test(msg)
            ? "Téléchargement par lien indisponible sur ce serveur (yt-dlp non installé) — dépose le fichier vidéo à la place."
            : `Téléchargement impossible : ${String(stderr).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 240) || msg.slice(0, 240)}`));
        },
      );
    });
    return await storeCloneSource(avatarId, await readFile(out), "video/mp4");
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Transcription de la source (ElevenLabs Scribe) : le texte qu'elle redira avec sa voix. */
export async function transcribeCloneSource(url: string, language?: string): Promise<{ text: string; seconds: number; model: string }> {
  const t = await transcribeWords(url, language && /^[a-z]{3}$/.test(language) ? language : "fra");
  const last = t.words[t.words.length - 1];
  return { text: t.text, seconds: last ? Math.round(last.e * 10) / 10 : 0, model: t.model };
}

/** Production d'un clone : UNE scène parlée de la durée de la source ; le prompt vient de buildClonePrompt. */
export function cloneProduction(opts: { title?: string; texte: string; seconds: number }): VlogProduction {
  const seconds = Math.max(4, Math.min(30, Math.ceil(opts.seconds || 10)));
  const scene: VlogScene = {
    titre: "Clone",
    mode: "talk",
    texte: opts.texte.trim(),
    duration_sec: seconds,
    action: "reproduce the source video shot for shot",
    shots: [],
    scene_desc: "",
    camera: "as in the source video",
    lighting: "as in the source video",
    audio_ambiance: "ambience of the source video",
    constraints: "",
  };
  return { title: opts.title?.trim() || "Clone vidéo", story: `Même vidéo que la source (${seconds} s), avec l'influenceur à la place de la personne et sa voix sur le même texte.`, caption: "", hashtags: [], scenes: [scene] };
}
