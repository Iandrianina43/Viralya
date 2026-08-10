import type { ContentType, Network, RatioClass } from "@viralya/shared";
import { buildContextBrief } from "../../context/contextBuilder";
import { extractJson } from "../../lib/storage";
import { getMemoryBrief, recordContentMemory } from "../../memory/memory";
import { generateText } from "../../providers/llm";
import type { JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergePayload, patchContentItem, requireContentItemId } from "../pipelines";

interface LlmScene {
  text?: string;
  role?: string;
  background?: string;
}

interface LlmContent {
  script?: string;
  scenes?: LlmScene[];
  caption?: string;
  hashtags?: string[];
  cta?: string;
  slides?: string[];
  memory_note?: string; // ce que l'avatar retient de ce post (journal)
}

const SCENE_ROLES = new Set(["hook", "value", "cta"]);

export async function generateTextJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  const { data: avatar } = await supabase
    .from("avatars")
    .select("system_prompt, name, niche, city, timezone")
    .eq("id", item.avatar_id)
    .single();
  const system = avatar?.system_prompt || "Tu es un influenceur business généré par IA.";
  const theme = String(item.payload.theme ?? "Astuce du jour");

  // Écosystème vivant : contexte du jour (météo, date, routine, tendances) + mémoire narrative.
  const [contextBrief, memoryBrief] = await Promise.all([
    buildContextBrief({
      city: avatar?.city ?? "",
      niche: avatar?.niche ?? "",
      timezone: avatar?.timezone ?? "Europe/Paris",
    }),
    getMemoryBrief(item.avatar_id),
  ]);

  const user = buildUserPrompt(
    item.type,
    item.network as Network,
    item.ratio_class,
    theme,
    contextBrief,
    memoryBrief,
  );
  const raw = await generateText(system, user);
  const parsed = extractJson<LlmContent>(raw) ?? {};

  // Multi-scènes (vidéo uniquement) : normalise les scènes du LLM, reconstruit le script complet.
  const scenes = (item.type === "video" && Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .filter((s) => typeof s.text === "string" && s.text.trim().length > 0)
    .slice(0, 6)
    .map((s) => ({
      text: s.text!.trim(),
      role: SCENE_ROLES.has(s.role ?? "") ? (s.role as "hook" | "value" | "cta") : "value",
      ...(s.background ? { background: s.background } : {}),
    }));
  const script =
    scenes.length > 0 ? scenes.map((s) => s.text).join(" ") : (parsed.script ?? raw);

  await mergePayload(id, {
    script,
    ...(scenes.length > 0 ? { scenes } : {}),
    caption: parsed.caption ?? "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    cta: parsed.cta ?? "",
    ...(parsed.slides ? { slides: parsed.slides } : {}),
  });

  // Journal : l'avatar consigne ce qu'il vient de dire (continuité future).
  const memoryNote = parsed.memory_note?.trim() || parsed.caption?.trim() || "";
  if (memoryNote) await recordContentMemory(item.avatar_id, memoryNote);

  await patchContentItem(id, { status: "generating" });
  await advance(job);
}

function buildUserPrompt(
  type: ContentType,
  network: Network,
  ratioClass: RatioClass,
  theme: string,
  contextBrief: string,
  memoryBrief: string,
): string {
  const base = [
    contextBrief ? `CONTEXTE DU JOUR (intègre-le naturellement, sans le réciter) :\n${contextBrief}` : "",
    memoryBrief ? `TA MÉMOIRE (tu es une personne cohérente dans le temps) :\n${memoryBrief}` : "",
    `Thème du jour : "${theme}".`,
    `Format : ${type} pour ${network}.`,
    ratioClass === "sale"
      ? `Objectif : contenu de VENTE soft (≤10% du volume). Inclure un CTA produit clair ET une disclosure (#ad).`
      : ratioClass === "proof"
        ? `Objectif : preuve sociale (résultat client, coulisses, témoignage). Aucune vente directe.`
        : `Objectif : valeur pure (conseil, erreur à éviter, insight). Zéro vente.`,
    `Écris comme une vraie personne qui vit sa vie : réagis au contexte si pertinent, fais avancer tes histoires en cours, ne te répète pas.`,
    `Ajoute un champ "memory_note" : UNE phrase courte résumant ce que tu retiens de ce post (pour ta continuité future).`,
  ].filter(Boolean);

  const shape =
    type === "carousel"
      ? `Réponds UNIQUEMENT en JSON : {"caption": string, "hashtags": string[], "cta": string, "slides": string[] (5 à 7 slides courtes), "memory_note": string}.`
      : type === "video"
        ? [
            `La vidéo est découpée en SCÈNES (3 à 5) pour un montage rythmé type TikTok.`,
            `Scène 1 = HOOK percutant (< 3 secondes de parole, interpelle direct).`,
            `Scènes du milieu = le contenu (une idée par scène, phrases courtes).`,
            `Dernière scène = CTA ou punchline de clôture.`,
            `Total parlé : 20-45 secondes.`,
            `Pour "background" choisis une couleur hex sombre et premium différente par scène (ex "#0f1b3d", "#1a1a2e", "#16213e") pour marquer les cuts.`,
            `Réponds UNIQUEMENT en JSON : {"scenes": [{"text": string, "role": "hook"|"value"|"cta", "background": string}], "caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`,
          ].join("\n")
        : `Réponds UNIQUEMENT en JSON : {"script": string (le texte du post), "caption": string, "hashtags": string[], "cta": string, "memory_note": string}.`;

  return [...base, shape].join("\n");
}
