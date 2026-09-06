import { extractJson } from "../lib/storage";
import { logger } from "../logger";
import { generateText } from "../providers/llm";
import { seedanceCost } from "../providers/piapi";
import { supabase } from "../supabase";
import type { VlogScene } from "./director";
import { listLocations } from "./locations";
import { launchProduction } from "./production";

// ─────────────────────────────────────────────────────────────
// CAMPAGNES UGC (BRIEF § 12, 14) — « cette influenceuse doit présenter ce produit ».
// Structure d'une vidéo UGC performante : accroche → problème → produit → démonstration →
// bénéfices → preuve → appel à l'action. Une campagne = une MATRICE de variations
// (influenceurs × angles × accroches × durées × CTA) ; chaque variante a son script (LLM, ≈ 0,02 $)
// et se produit à la demande en prise unique Seedance 2.5 (le produit est une image de référence).
// Conformité : mention « collaboration commerciale » dans la légende, label IA activé.
// ─────────────────────────────────────────────────────────────

export interface UgcProduct { name: string; description: string; image_url?: string | null; url?: string | null; price?: string | null; key_benefits?: string[] }
export type UgcBeatKind = "hook" | "problem" | "product" | "demo" | "benefits" | "proof" | "cta";
export interface UgcBeat { beat: UgcBeatKind; seconds: number; line: string; action: string }
export interface UgcScript { beats: UgcBeat[]; caption: string; hashtags: string[]; hook_type?: string; on_screen_text?: string[] }

export interface UgcCampaignInput {
  name?: string;
  brand: string;
  product: UgcProduct;
  objective?: "awareness" | "consideration" | "conversion";
  target?: string;
  tone?: string;
  language?: string;
  avatar_ids: string[];
  angles: string[];
  hooks_per_angle?: number;
  durations?: number[];
  ctas?: string[];
}

export interface UgcVariant {
  id: string;
  campaign_id: string;
  avatar_id: string;
  label: string;
  angle: string;
  hook: string;
  duration_sec: number;
  cta: string | null;
  script: UgcScript;
  status: "scripted" | "generating" | "ready" | "failed" | "archived";
  content_item_id: string | null;
  est_cost_usd: number;
  created_at: string;
}

export interface UgcCampaign {
  id: string;
  org_id: string;
  name: string;
  brand: string;
  product: UgcProduct;
  objective: string;
  target: string | null;
  tone: string | null;
  language: string;
  matrix: { avatar_ids: string[]; angles: string[]; hooks_per_angle: number; durations: number[]; ctas: string[] };
  status: string;
  cost_usd: number;
  created_at: string;
  variants?: UgcVariant[];
}

/**
 * Répartition des secondes par temps fort (docs/RECHERCHE-UGC.md) : grille 20 s vérifiée (Spark UGC,
 * juin 2026 : accroche 0-3 s, produit visible avant 1,5 s), 30 s et 45 s extrapolées ; 45 s ajoute
 * un temps « objection / offre » avec un CTA intermédiaire (6 des 10 meilleures pubs, Billo 2026).
 */
export function beatBudget(duration: number): Record<UgcBeatKind, number> {
  if (duration <= 20) return { hook: 2.5, problem: 2.5, product: 3, demo: 4, benefits: 3, proof: 2, cta: 3 };
  if (duration <= 30) return { hook: 3, problem: 4, product: 3, demo: 6, benefits: 5, proof: 4, cta: 5 };
  return { hook: 3, problem: 5, product: 4, demo: 10, benefits: 6, proof: 7, cta: 10 };
}

/** Mécanismes d'accroche (taxonomie croisée Hustler / Zeely / Arcads 2026) — un différent par variante. */
export const HOOK_TYPES = ["pattern_interrupt", "pain_point", "question", "bold_claim", "results_first", "pov", "story", "myth_busting", "comment_reply", "friend_recommendation"] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** Appels à l'action qui convertissent (Billo, 6 mois de données) : offre concrète > urgence vague. */
export const CTA_PRESETS = ["Code promo avec une vraie date de fin", "Lien en bio", "Commente un mot-clé pour recevoir le lien"] as const;

const UGC_SYSTEM = `Tu écris des scripts de vidéos UGC (« contenu généré par un utilisateur ») pour un influenceur qui présente un produit face caméra, en FRANÇAIS parlé naturel.
Structure OBLIGATOIRE, dans cet ordre : hook (accroche, 1 phrase, sans le nom de la marque, une raison de rester), problem (le problème vécu, à la 1re personne), product (« du coup j'ai testé <produit> », le nom prononcé clairement), demo (ce qu'elle fait avec, concret, à l'image), benefits (2 bénéfices max, concrets, jamais inventés : UNIQUEMENT ce que dit la description), proof (un résultat vécu, un chiffre en toutes lettres, un avis), cta (appel à l'action naturel, jamais agressif).
Règles d'écriture : phrases complètes et courtes, contractions (« j'suis », « y a »), connecteurs oraux (« bon », « en fait », « du coup »), une pointe d'humour ; ≈ 2,3 mots par seconde → respecte STRICTEMENT le budget de mots de chaque temps fort ; chiffres en toutes lettres ; aucun sigle ; les mots étrangers/marques difficiles écrits phonétiquement pour un moteur vocal français.
INTERDITS : « incroyable », « révolutionnaire », « vous allez adorer », « n'hésitez pas », promesses médicales ou chiffrées absentes de la description, style télégraphique.
Chaque accroche demandée utilise un MÉCANISME différent parmi : pattern_interrupt (« Non, attends. »), pain_point (le problème vécu), question, bold_claim (affirmation forte mais vraie), results_first (le résultat d'abord : « J'en ai commandé un deuxième. C'est tout dire. »), pov (« POV : … »), story (« Il y a six mois… »), myth_busting (« Arrête de … Fais ça à la place. »), comment_reply (« Vous m'avez demandé … »), friend_recommendation. L'accroche fait 8 mots maximum et le produit (ou le résultat) est visible avant une seconde et demie.
"action" (EN, 8-15 mots) décrit ce qu'on VOIT à ce moment : elle tient le produit, montre l'étiquette, l'applique, regarde la caméra, etc. Le produit doit être à l'image dès « product », avec au moins un gros plan pendant « demo ».
"caption" (FR) : 1-2 phrases + mention obligatoire « Collaboration commerciale avec <marque> » ; "hashtags" : 4-6.

Réponds UNIQUEMENT en JSON :
{"variants":[{"angle":"<angle>","hook_index":1,"hook_type":"<mécanisme>","hook":"<phrase d'accroche>","beats":[{"beat":"hook","seconds":3,"line":"…","action":"…"},{"beat":"problem",…},{"beat":"product",…},{"beat":"demo",…},{"beat":"benefits",…},{"beat":"proof",…},{"beat":"cta",…}],"caption":"…","hashtags":["#…"]}]}`;

const BEATS: UgcBeatKind[] = ["hook", "problem", "product", "demo", "benefits", "proof", "cta"];

function normalizeScript(raw: Record<string, any>, duration: number, cta: string | null): UgcScript | null {
  const budget = beatBudget(duration);
  const beats: UgcBeat[] = [];
  for (const kind of BEATS) {
    const b = Array.isArray(raw.beats) ? raw.beats.find((x: any) => x?.beat === kind) : null;
    if (!b || typeof b.line !== "string" || !b.line.trim()) return null;
    beats.push({ beat: kind, seconds: Number(b.seconds) > 0 ? Math.round(Number(b.seconds)) : budget[kind], line: String(b.line).trim(), action: String(b.action ?? "").trim() });
  }
  if (cta && !/http|lien|bio|code|commente/i.test(beats[6]!.line)) beats[6]!.line = `${beats[6]!.line} ${cta}`.trim();
  return {
    beats,
    caption: String(raw.caption ?? "").slice(0, 400),
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.map(String).slice(0, 8) : [],
    ...(HOOK_TYPES.includes(raw.hook_type) ? { hook_type: String(raw.hook_type) } : {}),
  };
}

const short = (s: string) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 10) || "x";

export async function createCampaign(orgId: string, input: UgcCampaignInput, onProgress?: (msg: string) => void): Promise<UgcCampaign> {
  if (!input.brand?.trim() || !input.product?.name?.trim()) throw new Error("marque et produit requis");
  if (!input.avatar_ids?.length) throw new Error("au moins un influenceur");
  const angles = (input.angles ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 5);
  if (!angles.length) throw new Error("au moins un angle");
  const hooksPerAngle = Math.max(1, Math.min(4, Number(input.hooks_per_angle) || 2));
  const durations = (input.durations?.length ? input.durations : [30]).map((d) => Math.max(15, Math.min(45, Math.round(Number(d)) || 30))).slice(0, 3);
  const ctas = (input.ctas ?? []).map(String).filter(Boolean).slice(0, 3);
  const objective = input.objective ?? "awareness";

  const { data: camp, error } = await supabase
    .from("ugc_campaigns")
    .insert({
      org_id: orgId,
      name: input.name?.trim() || `${input.brand} — ${input.product.name}`,
      brand: input.brand.trim(),
      product: input.product,
      objective, target: input.target ?? null, tone: input.tone ?? null, language: input.language ?? "fr",
      matrix: { avatar_ids: input.avatar_ids, angles, hooks_per_angle: hooksPerAngle, durations, ctas },
      status: "draft",
    })
    .select("*")
    .single();
  if (error || !camp) throw new Error(`campaign insert: ${error?.message ?? ""}`);

  const { data: avatars } = await supabase.from("avatars").select("id, name, niche, city, system_prompt").in("id", input.avatar_ids);
  const rows: Array<Record<string, unknown>> = [];
  for (const avatar of avatars ?? []) {
    for (const duration of durations) {
      onProgress?.(`Scripts pour ${avatar.name} (${duration} s)`);
      const budget = beatBudget(duration);
      const user = [
        `INFLUENCEUR : ${avatar.name}${avatar.niche ? ` — ${avatar.niche}` : ""}${avatar.city ? ` — ${avatar.city}` : ""}.`,
        avatar.system_prompt ? `SA PERSONNALITÉ :\n${String(avatar.system_prompt).slice(0, 800)}` : "",
        `MARQUE : ${input.brand}. PRODUIT : ${input.product.name}. DESCRIPTION (seule source de vérité) : ${input.product.description}${input.product.price ? ` Prix : ${input.product.price}.` : ""}${input.product.key_benefits?.length ? ` Bénéfices clés : ${input.product.key_benefits.join(" ; ")}.` : ""}`,
        `OBJECTIF : ${objective}.${input.target ? ` CIBLE : ${input.target}.` : ""}${input.tone ? ` TON : ${input.tone}.` : ""}`,
        `DURÉE : ${duration} s. BUDGET PAR TEMPS FORT (secondes → mots max) : ${BEATS.map((b) => `${b} ${budget[b]} s → ${Math.round(budget[b] * 2.3)} mots`).join(" ; ")}.`,
        ctas.length ? `APPELS À L'ACTION POSSIBLES : ${ctas.join(" | ")} (utilise-en un par variante, en variant).` : "APPEL À L'ACTION : naturel (commentaire, lien en bio).",
        `ANGLES ET ACCROCHES : pour CHACUN des angles suivants, écris ${hooksPerAngle} variante(s) avec une accroche différente :\n${angles.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
        `Total attendu : ${angles.length * hooksPerAngle} variantes.`,
      ].filter(Boolean).join("\n\n");
      let parsed: { variants?: Array<Record<string, any>> } | null = null;
      try {
        parsed = extractJson(await generateText(UGC_SYSTEM, user, 12000, { effort: "low" }));
      } catch (err) {
        logger.warn("ugc_script_failed", { avatarId: avatar.id, duration, err: String((err as Error)?.message ?? err) });
      }
      const variants = parsed?.variants ?? [];
      let n = 0;
      for (const v of variants) {
        const angle = String(v.angle ?? angles[0]);
        const aIdx = Math.max(0, angles.findIndex((a) => a.toLowerCase() === angle.toLowerCase()));
        const hIdx = Number(v.hook_index) || (n % hooksPerAngle) + 1;
        const cta = ctas.length ? ctas[n % ctas.length]! : null;
        const script = normalizeScript(v, duration, cta);
        if (!script) continue;
        n++;
        // Convention de nommage (Bestever / Motion 2026) : chaque dimension lisible dans le nom.
        rows.push({
          campaign_id: camp.id, avatar_id: avatar.id,
          label: `${short(input.brand)}_${short(input.product.name)}_H${hIdx}-${script.hook_type ?? "hook"}_A${aIdx + 1}_AV-${short(String(avatar.name))}_${duration}s${cta ? `_C${(n - 1) % ctas.length + 1}` : ""}`,
          angle: angles[aIdx] ?? angle, hook: String(v.hook ?? script.beats[0]!.line).slice(0, 200), duration_sec: duration, cta,
          script, status: "scripted",
          est_cost_usd: Math.round((seedanceCost("seedance-2.5-less-restriction", "720p", duration + 1) + 0.15) * 1000) / 1000,
        });
      }
    }
  }
  if (!rows.length) {
    await supabase.from("ugc_campaigns").update({ status: "draft" }).eq("id", camp.id);
    throw new Error("Aucun script exploitable n'a été produit. Réessaie ou simplifie les angles.");
  }
  const { error: vErr } = await supabase.from("ugc_variants").insert(rows);
  if (vErr) throw new Error(`variants insert: ${vErr.message}`);
  await supabase.from("ugc_campaigns").update({ status: "scripted", updated_at: new Date().toISOString() }).eq("id", camp.id);
  logger.info("ugc_campaign_created", { id: camp.id, variants: rows.length });
  return (await getCampaign(orgId, camp.id))!;
}

export async function listCampaigns(orgId: string): Promise<UgcCampaign[]> {
  const { data, error } = await supabase.from("ugc_campaigns").select("*, ugc_variants(id, status, avatar_id, est_cost_usd)").eq("org_id", orgId).order("created_at", { ascending: false });
  if (error) throw new Error(`campaigns: ${error.message}`);
  return (data ?? []).map((c: any) => ({ ...c, variants: c.ugc_variants ?? [], ugc_variants: undefined })) as UgcCampaign[];
}

export async function getCampaign(orgId: string, id: string): Promise<UgcCampaign | null> {
  const { data, error } = await supabase.from("ugc_campaigns").select("*, ugc_variants(*)").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`campaign: ${error.message}`);
  if (!data) return null;
  const { ugc_variants, ...camp } = data as UgcCampaign & { ugc_variants: UgcVariant[] };
  return { ...camp, variants: [...(ugc_variants ?? [])].sort((a, b) => a.label.localeCompare(b.label)) };
}

export async function updateVariant(orgId: string, variantId: string, patch: { script?: UgcScript; hook?: string; cta?: string | null; status?: "archived" | "scripted" }): Promise<UgcVariant> {
  const { data: v } = await supabase.from("ugc_variants").select("id, campaign_id, ugc_campaigns!inner(org_id)").eq("id", variantId).maybeSingle();
  if (!v || (v as any).ugc_campaigns?.org_id !== orgId) throw new Error("variante introuvable");
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.script?.beats?.length) clean.script = patch.script;
  if (typeof patch.hook === "string") clean.hook = patch.hook.slice(0, 200);
  if (patch.cta !== undefined) clean.cta = patch.cta;
  if (patch.status) clean.status = patch.status;
  const { data, error } = await supabase.from("ugc_variants").update(clean).eq("id", variantId).select("*").single();
  if (error || !data) throw new Error(`variant update: ${error?.message ?? ""}`);
  return data as UgcVariant;
}

export async function deleteCampaign(orgId: string, id: string): Promise<void> {
  const { error } = await supabase.from("ugc_campaigns").delete().eq("org_id", orgId).eq("id", id);
  if (error) throw new Error(`campaign delete: ${error.message}`);
}

/** Script → scènes (prise unique ≤ 30 s ; au-delà, deux prises coupées avant « benefits »). */
export function scenesFromScript(variant: UgcVariant, product: UgcProduct, locationKey: string | null): VlogScene[] {
  const beats = variant.script.beats;
  const groups = variant.duration_sec <= 30 ? [beats] : [beats.filter((b) => ["hook", "problem", "product", "demo"].includes(b.beat)), beats.filter((b) => ["benefits", "proof", "cta"].includes(b.beat))];
  return groups.map((g, i) => {
    let t = 0;
    const shots = g.map((b) => { const s = `${t}-${t + b.seconds}s`; t += b.seconds; return { t: s, desc: b.action || `she talks to the camera (${b.beat})` }; });
    const texte = g.map((b) => b.line).join(" ");
    const productBeat = g.find((b) => b.beat === "product") ?? g[0]!;
    const anchor = productBeat.line.split(/\s+/).slice(0, 3).join(" ");
    return {
      titre: i === 0 ? `${variant.label} · accroche → démo` : `${variant.label} · bénéfices → CTA`,
      mode: "talk" as const,
      texte,
      duration_sec: Math.min(30, Math.max(4, t)),
      action: `UGC selfie video: she talks to her phone camera, holds and shows the product ${product.name} to the lens (label readable), demonstrates it exactly as described; ${g.map((b) => b.action).filter(Boolean).join("; ")}`,
      shots,
      scene_desc: "her real everyday setting, the product visible on the table or in her hand",
      camera: "vertical selfie, arm's length handheld phone, eye level, medium close-up, product brought close to the lens when shown",
      lighting: "natural daylight from a window, soft, authentic phone footage",
      audio_ambiance: "quiet room tone",
      constraints: "the product stays identical to the reference image (shape, color, label), no invented claims on screen, no text overlay",
      inserts: [{ anchor, framing: "illustration" as const, desc: `close-up product photo of ${product.name}: ${product.description.slice(0, 120)}` }],
      ...(locationKey ? { location_key: locationKey } : {}),
    };
  });
}

export async function produceVariant(orgId: string, variantId: string, opts: { resolution?: string; talkMode?: string; music?: boolean } = {}): Promise<{ itemId: string; estimate: number }> {
  const { data: v } = await supabase.from("ugc_variants").select("*, ugc_campaigns!inner(*)").eq("id", variantId).maybeSingle();
  if (!v || (v as any).ugc_campaigns?.org_id !== orgId) throw new Error("variante introuvable");
  const variant = v as UgcVariant & { ugc_campaigns: UgcCampaign };
  if (variant.status === "generating") throw new Error("déjà en production");
  const campaign = variant.ugc_campaigns;
  const product = campaign.product;
  const locations = await listLocations(variant.avatar_id, "permanent").catch(() => []);
  const locationKey = locations[0]?.key ?? null;
  const scenes = scenesFromScript(variant, product, locationKey);
  const caption = `${variant.script.caption}${/collaboration commerciale/i.test(variant.script.caption) ? "" : ` Collaboration commerciale avec ${campaign.brand}.`}`.trim();
  const r = await launchProduction(variant.avatar_id, {
    title: `UGC ${campaign.brand} — ${variant.label}`,
    story: `${variant.hook} — ${product.name} (${campaign.brand}). Angle : ${variant.angle}.`,
    caption,
    hashtags: variant.script.hashtags,
    scenes,
  }, {
    format: "hybrid", singleTake: true, resolution: opts.resolution, talkMode: opts.talkMode, music: opts.music ?? false, subtitles: false,
    network: "tiktok", ratioClass: "sale",
    extraPayload: {
      kind: "ugc", campaign_id: campaign.id, variant_id: variant.id, brand: campaign.brand, product, product_image_url: product.image_url ?? null,
      // Mentions légales incrustées dès la première image et pendant toute la vidéo (loi 2023-451 art. 5 ;
      // AI Act art. 50 + fiche ARPP août 2026) — voir docs/RECHERCHE-UGC.md.
      labels: { top: `Collaboration commerciale avec ${campaign.brand}`, bottom: "Images virtuelles · Contenu généré par IA" },
    },
    extraColumns: { ai_label: true },
  });
  await supabase.from("ugc_variants").update({ status: "generating", content_item_id: r.itemId, updated_at: new Date().toISOString() }).eq("id", variant.id);
  await supabase.from("ugc_campaigns").update({ status: "producing", updated_at: new Date().toISOString() }).eq("id", campaign.id);
  return { itemId: r.itemId, estimate: r.estimate };
}

/** Recale le statut d'une variante depuis le statut du contenu (appelé par le pipeline). */
export async function syncVariantFromContent(contentItemId: string, status: string): Promise<void> {
  const map: Record<string, string | undefined> = { needs_review: "ready", scheduled: "ready", published: "ready", failed: "failed", canceled: "scripted" };
  const next = map[status];
  if (!next) return;
  await supabase.from("ugc_variants").update({ status: next, updated_at: new Date().toISOString() }).eq("content_item_id", contentItemId);
}
