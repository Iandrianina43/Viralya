import { buildContextBrief } from "../context/contextBuilder";
import { extractJson } from "../lib/storage";
import { logger } from "../logger";
import { getMemoryBrief } from "../memory/memory";
import { generateText } from "../providers/llm";
import { enqueue } from "../queue/queue";
import { supabase } from "../supabase";
import { listWardrobe } from "./characterBible";
import { breakIntoScenes, writeStory } from "./director";
import { listLocations } from "./locations";
import { launchProduction } from "./production";

// ─────────────────────────────────────────────────────────────
// CALENDRIER ÉDITORIAL (BRIEF § 10-12) — « Générer le calendrier du mois prochain ».
// Un stratège (LLM) construit piliers × séries × arcs narratifs, puis un planning jour par
// jour où la même personne vit vraiment sa vie (voyage, routine, imprévus). Chaque entrée
// devient un contenu réel à la demande (photo, carrousel, story, vidéo en prise unique).
// Une génération = un appel LLM (≈ 0,05 $), aucune image ni vidéo.
// ─────────────────────────────────────────────────────────────

export type PlanEntryType = "video" | "photo" | "carousel" | "story" | "ugc";
export type PlanEntryStatus = "planned" | "generating" | "ready" | "scheduled" | "published" | "skipped" | "failed";

export interface PlanArc { name: string; start: string; end: string; summary: string }
export interface PlanSeries { name: string; description: string; cadence: string }
export interface PlanStrategy {
  pillars: string[];
  series: PlanSeries[];
  arcs: PlanArc[];
  objectives: string;
  mix: Record<string, number>;
  voice?: string;
}

export interface PlanEntry {
  id: string;
  plan_id: string;
  avatar_id: string;
  day: string;
  slot: "matin" | "midi" | "soir";
  type: PlanEntryType;
  format: string | null;
  network: string;
  ratio_class: "value" | "proof" | "sale";
  pillar: string | null;
  series: string | null;
  arc: string | null;
  title: string;
  brief: string;
  location_key: string | null;
  status: PlanEntryStatus;
  content_item_id: string | null;
  position: number;
  created_at: string;
}

export interface ContentPlan {
  id: string;
  avatar_id: string;
  month: string;
  status: "draft" | "active" | "archived";
  brief: string | null;
  strategy: PlanStrategy;
  cost_usd: number;
  created_at: string;
  entries?: PlanEntry[];
}

export interface GeneratePlanInput {
  /** "YYYY-MM" */
  month: string;
  postsPerWeek?: number;
  brief?: string;
  /** Fils narratifs imposés par l'utilisateur (« Voyage à Séville du 10 au 14 », « lancement de sa marque… »). */
  arcs?: string[];
}

const monthStart = (month: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error("mois attendu au format YYYY-MM");
  return `${m[1]}-${m[2]}-01`;
};
const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};

const TYPES: PlanEntryType[] = ["video", "photo", "carousel", "story", "ugc"];
const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"];
const RATIOS = ["value", "proof", "sale"];
const SLOTS = ["matin", "midi", "soir"];

const STRATEGIST_SYSTEM = `Tu es le STRATÈGE ÉDITORIAL d'un influenceur IA sur Instagram et TikTok.
Tu construis le calendrier d'UN mois : une stratégie (piliers, séries récurrentes, arcs narratifs) puis un planning jour par jour.

PRINCIPES (issus de l'étude Metricool 2026 : Reels ≈ 4× d'interactions, carrousels ≈ 9× de sauvegardes, images seules −46 %) :
- Le compte doit donner l'impression qu'UNE MÊME PERSONNE VIT VRAIMENT SA VIE : les entrées se suivent (matin → soir, veille → lendemain), les arcs s'étalent sur plusieurs jours avec un début, un milieu, une fin (départ, arrivée, découverte, imprévu, retour).
- Mix des formats sur le mois : ≈ 40 % vidéos (prise unique de 20-30 s où elle parle à la caméra), ≈ 35 % photos (selfie, portrait, lifestyle, café, resto, voyage, spontané), ≈ 15 % carrousels (conseils, avant/après, coulisses), ≈ 10 % stories.
- Règle 70 / 20 / 10 : 70 % valeur (vie, conseils, émotion), 20 % preuve (résultats, coulisses, avis), 10 % vente maximum.
- Utilise les LIEUX de son univers (clé exacte). Un lieu inédit n'est possible que dans un arc de voyage : mets alors "location_key": null et décris le lieu dans "brief".
- Chaque "brief" (FR, 2-3 phrases) décrit CE QU'ELLE VIT ou MONTRE, avec un détail concret et un ressort (une envie, un imprévu, une découverte). Pas de texte parlé ici : le réalisateur l'écrira. Jamais de « c'est magnifique », jamais de formule de guide touristique.
- Ne répète pas les thèmes du mois précédent. Varie les créneaux (matin / midi / soir).
- Respecte la cadence demandée (contenus par semaine). Pas plus de 2 contenus le même jour.

Réponds UNIQUEMENT en JSON :
{"strategy":{"pillars":["…"],"series":[{"name":"…","description":"…","cadence":"hebdo"}],"arcs":[{"name":"…","start":"YYYY-MM-DD","end":"YYYY-MM-DD","summary":"…"}],"objectives":"…","mix":{"video":0.4,"photo":0.35,"carousel":0.15,"story":0.1},"voice":"<ton du compte en 1 phrase>"},
 "entries":[{"day":"YYYY-MM-DD","slot":"matin|midi|soir","type":"video|photo|carousel|story","network":"instagram|tiktok","ratio_class":"value|proof|sale","pillar":"…","series":"…|null","arc":"…|null","title":"<titre court>","brief":"…","location_key":"<clé exacte|null>"}]}`;

async function avatarContext(avatarId: string) {
  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, name, niche, city, timezone, system_prompt, products, priority_networks")
    .eq("id", avatarId)
    .single();
  if (!avatar) throw new Error("avatar introuvable");
  const [contextBrief, memoryBrief, locations, wardrobe] = await Promise.all([
    buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }).catch(() => ""),
    getMemoryBrief(avatarId).catch(() => ""),
    listLocations(avatarId, "all").catch(() => []),
    listWardrobe(avatarId).catch(() => []),
  ]);
  return { avatar, contextBrief, memoryBrief, locations, wardrobe };
}

/** Génère (ou régénère) le plan du mois : stratégie + entrées. Remplace le brouillon existant du même mois. */
export async function generatePlan(avatarId: string, input: GeneratePlanInput, onProgress?: (msg: string, pct: number) => Promise<void> | void): Promise<ContentPlan> {
  const month = monthStart(input.month);
  const nDays = daysInMonth(input.month);
  const perWeek = Math.max(2, Math.min(14, Number(input.postsPerWeek) || 5));
  const target = Math.round((perWeek * nDays) / 7);
  const ctx = await avatarContext(avatarId);
  await onProgress?.("Lecture de l'univers et de la mémoire", 10);

  // Mois précédent : ne pas se répéter.
  const prevMonth = new Date(`${month}T00:00:00Z`);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const { data: prevPlan } = await supabase
    .from("content_plans")
    .select("id, plan_entries(title, arc, pillar)")
    .eq("avatar_id", avatarId)
    .eq("month", prevMonth.toISOString().slice(0, 10))
    .maybeSingle();
  const prevTitles = ((prevPlan as { plan_entries?: Array<{ title: string; arc: string | null }> } | null)?.plan_entries ?? [])
    .map((e) => `${e.title}${e.arc ? ` (${e.arc})` : ""}`)
    .slice(0, 40);

  const user = [
    `PERSONNAGE : ${ctx.avatar.name}${ctx.avatar.niche ? ` — ${ctx.avatar.niche}` : ""}${ctx.avatar.city ? ` — vit à ${ctx.avatar.city}` : ""}.`,
    ctx.avatar.system_prompt ? `SA PERSONNALITÉ :\n${String(ctx.avatar.system_prompt).slice(0, 1500)}` : "",
    Array.isArray(ctx.avatar.products) && ctx.avatar.products.length ? `SES PRODUITS / PARTENARIATS : ${ctx.avatar.products.join(", ")}` : "",
    Array.isArray(ctx.avatar.priority_networks) && ctx.avatar.priority_networks.length ? `RÉSEAUX PRIORITAIRES : ${ctx.avatar.priority_networks.join(", ")}` : "",
    ctx.contextBrief ? `CONTEXTE RÉEL ACTUEL (météo, saison) :\n${ctx.contextBrief}` : "",
    ctx.memoryBrief ? `SA MÉMOIRE (histoires en cours, faits) :\n${ctx.memoryBrief}` : "",
    ctx.locations.length
      ? `SON UNIVERS DE LIEUX (clé · nom · portée) :\n${ctx.locations.map((l) => `- ${l.key} · ${l.name} · ${l.scope === "oneoff" ? "voyage" : "quotidien"} : ${String(l.description).slice(0, 120)}`).join("\n")}`
      : "SON UNIVERS DE LIEUX : vide (décris les lieux dans les briefs).",
    ctx.wardrobe.length ? `SA GARDE-ROBE : ${ctx.wardrobe.map((w) => w.name).join(", ")}` : "",
    prevTitles.length ? `MOIS PRÉCÉDENT (ne pas répéter) : ${prevTitles.join(" ; ")}` : "",
    `MOIS À PLANIFIER : ${input.month} (${nDays} jours). CADENCE : ${perWeek} contenus par semaine → ≈ ${target} entrées au total.`,
    input.arcs?.length ? `ARCS IMPOSÉS PAR L'UTILISATEUR :\n${input.arcs.map((a) => `- ${a}`).join("\n")}` : "",
    input.brief ? `CONSIGNES DE L'UTILISATEUR : ${input.brief}` : "",
    "Construis la stratégie puis le planning.",
  ].filter(Boolean).join("\n\n");

  await onProgress?.("Le stratège écrit le mois", 30);
  const raw = await generateText(STRATEGIST_SYSTEM, user, 16000, { effort: "low" });
  const parsed = extractJson<{ strategy?: Partial<PlanStrategy>; entries?: Array<Record<string, unknown>> }>(raw);
  if (!parsed?.entries?.length) {
    logger.warn("plan_parse_failed", { avatarId, preview: String(raw ?? "").slice(0, 300) });
    throw new Error("Le stratège n'a pas produit de planning exploitable. Réessaie.");
  }
  const knownKeys = new Set(ctx.locations.map((l) => l.key));
  const entries = parsed.entries
    .map((e, i) => {
      const day = String(e.day ?? "");
      if (!day.startsWith(input.month)) return null;
      const type = TYPES.includes(e.type as PlanEntryType) ? (e.type as PlanEntryType) : "photo";
      const loc = typeof e.location_key === "string" && knownKeys.has(e.location_key) ? e.location_key : null;
      return {
        day,
        slot: SLOTS.includes(String(e.slot)) ? String(e.slot) : "midi",
        type,
        format: type === "video" ? "single_take" : null,
        network: NETWORKS.includes(String(e.network)) ? String(e.network) : "instagram",
        ratio_class: RATIOS.includes(String(e.ratio_class)) ? String(e.ratio_class) : "value",
        pillar: e.pillar ? String(e.pillar) : null,
        series: e.series ? String(e.series) : null,
        arc: e.arc ? String(e.arc) : null,
        title: String(e.title ?? "Contenu").slice(0, 120),
        brief: String(e.brief ?? "").slice(0, 1000),
        location_key: loc,
        position: i,
      };
    })
    .filter((e): e is NonNullable<typeof e> => !!e && e.brief.length > 10)
    .sort((a, b) => (a.day === b.day ? SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) : a.day.localeCompare(b.day)));
  if (!entries.length) throw new Error("Aucune entrée valide dans le planning généré.");

  const strategy: PlanStrategy = {
    pillars: Array.isArray(parsed.strategy?.pillars) ? parsed.strategy!.pillars!.map(String).slice(0, 8) : [],
    series: Array.isArray(parsed.strategy?.series) ? (parsed.strategy!.series as PlanSeries[]).slice(0, 8) : [],
    arcs: Array.isArray(parsed.strategy?.arcs) ? (parsed.strategy!.arcs as PlanArc[]).slice(0, 8) : [],
    objectives: String(parsed.strategy?.objectives ?? ""),
    mix: (parsed.strategy?.mix as Record<string, number>) ?? {},
    ...(parsed.strategy?.voice ? { voice: String(parsed.strategy.voice) } : {}),
  };

  await onProgress?.("Enregistrement du calendrier", 80);
  // Remplace le plan du mois (les entrées déjà produites gardent leur contenu via content_items.plan_entry_id = null).
  const { data: existing } = await supabase.from("content_plans").select("id").eq("avatar_id", avatarId).eq("month", month).maybeSingle();
  let planId = existing?.id as string | undefined;
  if (planId) {
    await supabase.from("plan_entries").delete().eq("plan_id", planId).in("status", ["planned", "skipped", "failed"]);
    await supabase.from("content_plans").update({ strategy, brief: input.brief ?? null, status: "draft", updated_at: new Date().toISOString() }).eq("id", planId);
  } else {
    const { data: plan, error } = await supabase
      .from("content_plans")
      .insert({ avatar_id: avatarId, month, brief: input.brief ?? null, strategy })
      .select("id")
      .single();
    if (error || !plan) throw new Error(`plan insert: ${error?.message ?? ""}`);
    planId = plan.id as string;
  }
  const { error: entErr } = await supabase.from("plan_entries").insert(entries.map((e) => ({ ...e, plan_id: planId, avatar_id: avatarId })));
  if (entErr) throw new Error(`entries insert: ${entErr.message}`);
  logger.info("plan_generated", { avatarId, month, entries: entries.length, arcs: strategy.arcs.length });
  const plan = await getPlan(avatarId, input.month);
  if (!plan) throw new Error("plan introuvable après création");
  return plan;
}

export async function listPlans(avatarId: string): Promise<ContentPlan[]> {
  const { data, error } = await supabase.from("content_plans").select("*").eq("avatar_id", avatarId).order("month", { ascending: false });
  if (error) throw new Error(`plans: ${error.message}`);
  return (data ?? []) as ContentPlan[];
}

export async function getPlan(avatarId: string, month: string): Promise<ContentPlan | null> {
  const { data, error } = await supabase
    .from("content_plans")
    .select("*, plan_entries(*)")
    .eq("avatar_id", avatarId)
    .eq("month", monthStart(month))
    .maybeSingle();
  if (error) throw new Error(`plan: ${error.message}`);
  if (!data) return null;
  const { plan_entries, ...plan } = data as ContentPlan & { plan_entries: PlanEntry[] };
  const entries = [...(plan_entries ?? [])].sort((a, b) => (a.day === b.day ? SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) : a.day.localeCompare(b.day)));
  return { ...plan, entries };
}

export async function getEntry(entryId: string): Promise<PlanEntry | null> {
  const { data } = await supabase.from("plan_entries").select("*").eq("id", entryId).maybeSingle();
  return (data as PlanEntry | null) ?? null;
}

export async function updateEntry(entryId: string, patch: Partial<Pick<PlanEntry, "day" | "slot" | "type" | "network" | "ratio_class" | "title" | "brief" | "location_key" | "status" | "pillar" | "series" | "arc">>): Promise<PlanEntry> {
  const clean: Record<string, unknown> = {};
  if (patch.day) clean.day = patch.day;
  if (patch.slot && SLOTS.includes(patch.slot)) clean.slot = patch.slot;
  if (patch.type && TYPES.includes(patch.type)) clean.type = patch.type;
  if (patch.network && NETWORKS.includes(patch.network)) clean.network = patch.network;
  if (patch.ratio_class && RATIOS.includes(patch.ratio_class)) clean.ratio_class = patch.ratio_class;
  if (typeof patch.title === "string") clean.title = patch.title.slice(0, 120);
  if (typeof patch.brief === "string") clean.brief = patch.brief.slice(0, 1000);
  if (patch.location_key !== undefined) clean.location_key = patch.location_key;
  if (patch.status && ["planned", "skipped"].includes(patch.status)) clean.status = patch.status;
  for (const k of ["pillar", "series", "arc"] as const) if (patch[k] !== undefined) clean[k] = patch[k];
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("plan_entries").update(clean).eq("id", entryId).select("*").single();
  if (error || !data) throw new Error(`entry update: ${error?.message ?? ""}`);
  return data as PlanEntry;
}

export async function addEntry(planId: string, avatarId: string, input: Partial<PlanEntry> & { day: string; title: string; brief: string }): Promise<PlanEntry> {
  const type = TYPES.includes(input.type as PlanEntryType) ? (input.type as PlanEntryType) : "photo";
  const { data, error } = await supabase
    .from("plan_entries")
    .insert({
      plan_id: planId, avatar_id: avatarId, day: input.day, slot: SLOTS.includes(String(input.slot)) ? input.slot : "midi",
      type, format: type === "video" ? "single_take" : null,
      network: NETWORKS.includes(String(input.network)) ? input.network : "instagram",
      ratio_class: RATIOS.includes(String(input.ratio_class)) ? input.ratio_class : "value",
      pillar: input.pillar ?? null, series: input.series ?? null, arc: input.arc ?? null,
      title: String(input.title).slice(0, 120), brief: String(input.brief).slice(0, 1000), location_key: input.location_key ?? null, position: 99,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`entry insert: ${error?.message ?? ""}`);
  return data as PlanEntry;
}

export async function deleteEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from("plan_entries").delete().eq("id", entryId);
  if (error) throw new Error(`entry delete: ${error.message}`);
}

export interface ProduceEntryOptions { resolution?: string; talkMode?: string; music?: boolean; subtitles?: boolean }

/**
 * Transforme une entrée du calendrier en contenu réel :
 *  - vidéo : le réalisateur écrit l'histoire depuis le brief puis UNE prise de 20-30 s (Seedance 2.5) ;
 *  - photo / carrousel / story : pipeline existant (texte → image multi-référence + QC).
 */
export async function produceEntry(entryId: string, opts: ProduceEntryOptions = {}, onLog?: (msg: string) => void): Promise<{ itemId: string; estimate: number }> {
  const entry = await getEntry(entryId);
  if (!entry) throw new Error("entrée introuvable");
  if (entry.status === "generating") throw new Error("cette entrée est déjà en production");
  if (entry.content_item_id && ["ready", "scheduled", "published"].includes(entry.status)) throw new Error("cette entrée a déjà un contenu");

  const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, timezone, system_prompt").eq("id", entry.avatar_id).single();
  if (!avatar) throw new Error("avatar introuvable");

  if (entry.type === "video" || entry.type === "ugc") {
    const [contextBrief, memoryBrief, locations] = await Promise.all([
      buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }).catch(() => ""),
      getMemoryBrief(entry.avatar_id).catch(() => ""),
      listLocations(entry.avatar_id, "all").catch(() => []),
    ]);
    const base = {
      name: avatar.name, niche: avatar.niche, city: avatar.city, system_prompt: avatar.system_prompt, contextBrief, memoryBrief,
      locations: locations.map((l) => ({ key: l.key, name: l.name, description: l.description })),
    };
    const arc = entry.arc ? ` (fil narratif : ${entry.arc})` : "";
    const where = entry.location_key ? ` Lieu : ${entry.location_key}.` : "";
    onLog?.("Le réalisateur écrit l'histoire");
    const story = await writeStory({ ...base, presetKey: "vlog", brief: `${entry.title}${arc}. ${entry.brief}${where}` }, () => {});
    onLog?.("Découpage en une prise");
    const scenes = await breakIntoScenes({ ...base, story: story.story, durationSec: 30, format: "hybrid", singleTake: true });
    if (entry.location_key && scenes[0] && !scenes[0].location_key) scenes[0].location_key = entry.location_key;
    const r = await launchProduction(entry.avatar_id, { ...story, scenes }, {
      format: "hybrid", resolution: opts.resolution, talkMode: opts.talkMode, music: opts.music, subtitles: opts.subtitles,
      network: entry.network, ratioClass: entry.ratio_class,
      extraPayload: { plan_entry_id: entry.id, pillar: entry.pillar, arc: entry.arc },
      extraColumns: { plan_entry_id: entry.id },
    });
    await supabase.from("plan_entries").update({ status: "generating", content_item_id: r.itemId, updated_at: new Date().toISOString() }).eq("id", entry.id);
    return { itemId: r.itemId, estimate: r.estimate };
  }

  // Photo / carrousel / story : pipelines existants (generate_text → image).
  const type = entry.type === "photo" ? "photo" : entry.type === "carousel" ? "carousel" : "story";
  const { data: item, error } = await supabase
    .from("content_items")
    .insert({
      avatar_id: entry.avatar_id, type, network: entry.network, ratio_class: entry.ratio_class, status: "queued", title: entry.title,
      payload: { theme: entry.title, scene: entry.brief, brief: entry.brief, location_key: entry.location_key, plan_entry_id: entry.id, pillar: entry.pillar, arc: entry.arc },
      plan_entry_id: entry.id,
    })
    .select("id")
    .single();
  if (error || !item) throw new Error(`content insert: ${error?.message ?? ""}`);
  try {
    await enqueue("generate_text", { avatar_id: entry.avatar_id, content_item_id: item.id }, { contentItemId: item.id, avatarId: entry.avatar_id, label: entry.title });
  } catch (err) {
    await supabase.from("content_items").update({ status: "failed", error: String((err as Error)?.message ?? err).slice(0, 300) }).eq("id", item.id);
    throw err;
  }
  await supabase.from("plan_entries").update({ status: "generating", content_item_id: item.id, updated_at: new Date().toISOString() }).eq("id", entry.id);
  return { itemId: item.id, estimate: type === "photo" ? 0.08 : 0.3 };
}

/** Recale le statut d'une entrée depuis le statut du contenu (appelé par le pipeline). */
export async function syncEntryFromContent(contentItemId: string, status: string): Promise<void> {
  const map: Record<string, PlanEntryStatus | undefined> = {
    needs_review: "ready", scheduled: "scheduled", published: "published", failed: "failed", canceled: "planned",
  };
  const next = map[status];
  if (!next) return;
  await supabase.from("plan_entries").update({ status: next, updated_at: new Date().toISOString() }).eq("content_item_id", contentItemId);
}
