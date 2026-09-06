import type { ContentType, Network, RatioClass } from "@viralya/shared";
import { buildContextBrief } from "../../context/contextBuilder";
import { extractJson } from "../../lib/storage";
import { getMemoryBrief, recordContentMemory } from "../../memory/memory";
import { generateText } from "../../providers/llm";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergePayload, patchContentItem, requireContentItemId } from "../pipelines";

interface LlmScene { text?: string; role?: string; background?: string }
interface LlmContent {
  script?: string;
  scenes?: LlmScene[];
  caption?: string;
  hashtags?: string[];
  cta?: string;
  memory_note?: string;
}
const SCENE_ROLES = new Set(["hook", "value", "cta"]);

export async function generateTextJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const { data: avatar } = await supabase
    .from("avatars")
    .select("system_prompt, niche, city, timezone")
    .eq("id", item.avatar_id)
    .single();
  const system = avatar?.system_prompt || "Tu es un influenceur business généré par IA.";
  const theme = String(item.payload.theme ?? "Astuce du jour");

  const [contextBrief, memoryBrief] = await Promise.all([
    buildContextBrief({ city: avatar?.city ?? "", niche: avatar?.niche ?? "", timezone: avatar?.timezone ?? "Europe/Paris" }),
    getMemoryBrief(item.avatar_id),
  ]);

  // Les réponses longues (vidéo multi-scènes) dépassaient 900 tokens → JSON tronqué, légende perdue.
  const raw = await generateText(system, buildUserPrompt(item.type, item.network as Network, item.ratio_class, theme, contextBrief, memoryBrief), item.type === "video" ? 2000 : 1200);
  const parsed = extractJson<LlmContent>(raw) ?? {};

  const scenes = (item.type === "video" && Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .filter((s) => typeof s.text === "string" && s.text!.trim().length > 0)
    .slice(0, 6)
    .map((s) => ({
      text: s.text!.trim(),
      role: SCENE_ROLES.has(s.role ?? "") ? (s.role as "hook" | "value" | "cta") : "value",
      ...(s.background ? { background: s.background } : {}),
    }));
  const script = scenes.length > 0 ? scenes.map((s) => s.text).join(" ") : (parsed.script ?? raw);

  await mergePayload(id, {
    script,
    ...(scenes.length > 0 ? { scenes } : {}),
    caption: parsed.caption ?? "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    cta: parsed.cta ?? "",
  });

  const note = parsed.memory_note?.trim() || parsed.caption?.trim() || "";
  if (note) await recordContentMemory(item.avatar_id, note);

  await patchContentItem(id, { status: "generating" });
  await advance(job);
}

function buildUserPrompt(type: ContentType, network: Network, rc: RatioClass, theme: string, context: string, memory: string): string {
  const base = [
    context ? `CONTEXTE DU JOUR (intègre-le naturellement) :\n${context}` : "",
    memory ? `TA MÉMOIRE (tu es cohérent dans le temps) :\n${memory}` : "",
    `Thème : "${theme}". Format : ${type} pour ${network}.`,
    rc === "sale"
      ? `Objectif : VENTE soft (≤10%). CTA produit clair + disclosure #ad.`
      : rc === "proof"
        ? `Objectif : preuve sociale (résultat, coulisses). Aucune vente.`
        : `Objectif : valeur pure (conseil, erreur, insight). Zéro vente.`,
    `Écris comme une vraie personne qui vit sa vie ; fais avancer tes histoires en cours ; ne te répète pas.`,
    `Ajoute "memory_note" : UNE phrase de ce que tu retiens de ce post (continuité future).`,
  ];
  const shape =
    type === "photo"
      ? [
          `C'est une PHOTO de toi : "${theme}". Écris la légende comme si tu la postais toi-même : 2 à 4 phrases en français, naturelles, ancrées dans le moment, qui se terminent par une question à ta communauté. Pas de script.`,
          `Hashtags : 3 maximum, pertinents (les hashtags en masse font perdre des vues).`,
          `Réponds UNIQUEMENT en JSON : {"caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`,
        ].join("\n")
      : type === "carousel"
      ? `Réponds UNIQUEMENT en JSON : {"caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`
      : type === "video"
        ? [
            `Découpe la vidéo en 3-5 SCÈNES (montage rythmé TikTok). Scène 1 = HOOK (<3s). Dernière = CTA/punchline. Total 20-45s.`,
            `"background" = couleur hex sombre premium différente par scène ("#0f1b3d","#1a1a2e","#16213e").`,
            `Réponds UNIQUEMENT en JSON : {"scenes":[{"text":string,"role":"hook"|"value"|"cta","background":string}], "caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`,
          ].join("\n")
        : `Réponds UNIQUEMENT en JSON : {"script": string, "caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`;
  return [...base.filter(Boolean), shape].join("\n");
}
