import { extractJson } from "../lib/storage";
import { logger } from "../logger";
import { getMemoryBrief } from "../memory/memory";
import { generateText } from "../providers/llm";
import { supabase } from "../supabase";
import { avatarBrief, LAUNCH_AVATAR_SELECT } from "./launch";
import { listLocations } from "./locations";

// ─────────────────────────────────────────────────────────────
// ANALYSE DU PROFIL (14 sept. 2026, demande de Jérôme) : à partir de la fiche d'identité, une IA dit ce que
// l'influenceur fait, ce qu'il vend, à qui, et en déduit piliers, réseaux, cadence, mix et arcs du mois.
// Résultat stocké sur `avatars.strategy_brief` (migration 0023) ; le stratège du calendrier le lit, et le
// bouton « Proposer le planning » en pré-remplit la génération. Un appel LLM ≈ 0,02-0,03 $ (offert en crédits).
// ─────────────────────────────────────────────────────────────

export interface StrategyBrief {
  does: string;
  sells: string;
  audience: string;
  promise: string;
  pillars: string[];
  networks: string[];
  cadence_per_week: number;
  mix: Record<string, number>;
  month_theme: string;
  arcs: Array<{ name: string; summary: string }>;
  tone: string;
  generated_at: string;
}

export const STRATEGY_ESTIMATE_USD = 0.03;

const SYSTEM = `Tu es un directeur de stratégie de contenu pour des influenceurs sur Instagram, TikTok, YouTube, X et Facebook.
On te donne la fiche d'identité d'un influenceur (généré par IA, ouvertement ou non). Tu analyses son profil comme un consultant :
ce qu'il FAIT concrètement, ce qu'il VEND (produit, service, partenariat, audience monétisable), à QUI il s'adresse, et la promesse
qui fait suivre le compte. Puis tu en déduis un plan : 3 à 5 piliers de contenu, les réseaux à prioriser (2 à 3), une cadence
réaliste par semaine, un mix de formats, un thème pour le mois à venir et 2 à 3 arcs narratifs (une histoire qui s'étale sur
plusieurs jours, avec un début et une fin).
Sois concret et spécifique à SA niche et à SES produits : pas de généralités. Français, phrases courtes.
Réponds UNIQUEMENT en JSON :
{"does":"…","sells":"…","audience":"…","promise":"…","pillars":["…"],"networks":["instagram","tiktok"],"cadence_per_week":5,
 "mix":{"video":0.4,"photo":0.35,"carousel":0.15,"story":0.1},"month_theme":"…","arcs":[{"name":"…","summary":"…"}],"tone":"…"}`;

const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"];
const cut = (v: unknown, n: number): string => String(v ?? "").trim().slice(0, n);

function sanitize(raw: unknown): Omit<StrategyBrief, "generated_at"> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v.map((x) => cut(x, len)).filter(Boolean).slice(0, n) : []);
  const mixRaw = (o.mix && typeof o.mix === "object" ? o.mix : {}) as Record<string, unknown>;
  const mix: Record<string, number> = {};
  for (const k of ["video", "photo", "carousel", "story"]) {
    const v = Number(mixRaw[k]);
    if (Number.isFinite(v) && v >= 0) mix[k] = Math.round(v * 100) / 100;
  }
  const arcs = Array.isArray(o.arcs)
    ? (o.arcs as unknown[]).map((a) => (a && typeof a === "object" ? { name: cut((a as Record<string, unknown>).name, 80), summary: cut((a as Record<string, unknown>).summary, 300) } : null)).filter((a): a is { name: string; summary: string } => !!a && !!a.name).slice(0, 4)
    : [];
  const cadence = Math.round(Number(o.cadence_per_week));
  return {
    does: cut(o.does, 400),
    sells: cut(o.sells, 400),
    audience: cut(o.audience, 400),
    promise: cut(o.promise, 300),
    pillars: list(o.pillars, 6, 80),
    networks: list(o.networks, 3, 20).map((n) => n.toLowerCase()).filter((n) => NETWORKS.includes(n)),
    cadence_per_week: Number.isFinite(cadence) ? Math.max(2, Math.min(14, cadence)) : 5,
    mix: Object.keys(mix).length ? mix : { video: 0.4, photo: 0.35, carousel: 0.15, story: 0.1 },
    month_theme: cut(o.month_theme, 300),
    arcs,
    tone: cut(o.tone, 200),
  };
}

export async function getStrategyBrief(avatarId: string): Promise<StrategyBrief | null> {
  const { data, error } = await supabase.from("avatars").select("strategy_brief").eq("id", avatarId).maybeSingle();
  if (error) {
    if (/strategy_brief/.test(error.message)) throw new Error("Applique la migration 0023_strategy_brief.sql pour activer l'analyse du profil.");
    throw new Error(error.message);
  }
  return (data?.strategy_brief as StrategyBrief | null) ?? null;
}

export async function analyzeProfile(avatarId: string): Promise<StrategyBrief> {
  const { data: avatar, error } = await supabase.from("avatars").select(LAUNCH_AVATAR_SELECT).eq("id", avatarId).single();
  if (error || !avatar) throw new Error("influenceur introuvable");
  const [locations, memory] = await Promise.all([listLocations(avatarId, "permanent").catch(() => []), getMemoryBrief(avatarId).catch(() => "")]);
  const user = [
    avatarBrief(avatar as Parameters<typeof avatarBrief>[0]),
    locations.length ? `Lieux de vie : ${locations.map((l) => l.name).join(", ")}` : "",
    memory ? `Mémoire (histoires en cours) :\n${memory.slice(0, 800)}` : "",
    "Analyse ce profil puis propose le plan.",
  ].filter(Boolean).join("\n\n");
  const raw = await generateText(SYSTEM, user, 1800, { effort: "low" });
  const parsed = extractJson(raw) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("analyse illisible (réponse du modèle sans JSON)");
  const brief: StrategyBrief = { ...sanitize(parsed), generated_at: new Date().toISOString() };
  if (!brief.does && !brief.sells) throw new Error("analyse vide : complète la fiche (niche, positionnement, produits) et réessaie");
  const { error: upErr } = await supabase.from("avatars").update({ strategy_brief: brief }).eq("id", avatarId);
  if (upErr) {
    if (/strategy_brief/.test(upErr.message)) throw new Error("Applique la migration 0023_strategy_brief.sql pour activer l'analyse du profil.");
    throw new Error(upErr.message);
  }
  logger.info("strategy_brief_generated", { avatarId, pillars: brief.pillars.length, arcs: brief.arcs.length });
  return brief;
}

/** Résumé injecté au stratège du calendrier. */
export function strategyBriefText(b: StrategyBrief | null | undefined): string {
  if (!b) return "";
  return [
    `Ce qu'il fait : ${b.does}`,
    `Ce qu'il vend : ${b.sells}`,
    `À qui : ${b.audience}`,
    b.promise ? `Promesse : ${b.promise}` : "",
    b.pillars.length ? `Piliers : ${b.pillars.join(" · ")}` : "",
    b.networks.length ? `Réseaux prioritaires : ${b.networks.join(", ")}` : "",
    b.month_theme ? `Thème proposé : ${b.month_theme}` : "",
    b.tone ? `Ton : ${b.tone}` : "",
  ].filter(Boolean).join("\n");
}
