/**
 * Test à sec des formats (6 sept. 2026) : scripts LLM (≈ 0,03 $) + prompts Seedance tels qu'ils partiront.
 * Aucune vidéo ni image générée.
 *   pnpm --filter @viralya/api exec tsx scripts/test-formats.ts <avatar_id> [explainer|ad_product|clone|all] ["sujet ou produit"]
 */
import { pronouns } from "../src/domain/characterBible";
import { buildClonePrompt, buildFacelessPrompt, personWords } from "../src/domain/director";
import { cloneProduction, writeExplainer, writeProductAd } from "../src/domain/formats";
import { estimateHybridCost, readHybridSettings } from "../src/pipeline/hybrid";
import { supabase } from "../src/supabase";

const [avatarId, which = "all", topicArg] = process.argv.slice(2);
if (!avatarId) throw new Error("usage: test-formats.ts <avatar_id> [explainer|ad_product|clone|all] [sujet]");
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, system_prompt, sex_age").eq("id", avatarId).single();
if (!avatar) throw new Error("avatar introuvable");
const person = personWords(pronouns(avatar));
const settings = readHybridSettings({ resolution: "720p" });
const words = (p: { scenes: Array<{ texte: string }> }) => p.scenes.reduce((a, s) => a + s.texte.split(/\s+/).filter(Boolean).length, 0);
log(`${avatar.name} (${avatar.sex_age ?? "?"}) → pronoms ${person.she}/${person.her}`);

if (which === "explainer" || which === "all") {
  const topic = topicArg && which === "explainer" ? topicArg : "pourquoi ton café filtre est amer, et les trois réglages qui changent tout";
  const p = await writeExplainer({ avatar, topic, durationSec: 30 });
  log(`EXPLICATIVE « ${p.title} » — ${p.scenes.length} scènes, ${words(p)} mots, estimation ${estimateHybridCost(p.scenes, settings, { kind: "explainer" }).total} $`);
  for (const sc of p.scenes) {
    log(`  [${sc.visual}] ${sc.duration_sec}s « ${sc.texte} »\n      image: ${sc.image_prompt}\n      action: ${sc.action} · camera: ${sc.camera} · ambiance: ${sc.audio_ambiance}`);
  }
  const clip = p.scenes.find((s) => s.visual === "clip") ?? p.scenes[0]!;
  log(`Prompt clip Seedance 2.5 :\n${buildFacelessPrompt({ kind: "explainer", scene: clip, hasFrame: true, hasVoiceRef: true, person })}`);
}

if (which === "ad_product" || which === "all") {
  const product = { name: topicArg && which === "ad_product" ? topicArg : "Gourde isotherme Terra 500 ml", description: "acier inoxydable brossé, bouchon bambou, garde le chaud douze heures", image_url: "https://example.com/gourde.jpg" };
  const p = await writeProductAd({ avatar, product, durationSec: 30, voiceOver: true, brief: "montrer qu'elle garde le café chaud toute la matinée" });
  const sc = p.scenes[0]!;
  log(`PUB PRODUIT « ${p.title} » — ${sc.duration_sec}s, ${sc.shots.length} plans, ${words(p)} mots de voix off, estimation ${estimateHybridCost(p.scenes, settings, { kind: "ad_product" }).total} $`);
  log(`  product_lock: ${sc.product_lock}`);
  for (const sh of sc.shots) log(`  plan ${sh.t.padEnd(7)} ${sh.desc}`);
  log(`  voix off : « ${sc.texte} »`);
  log(`Prompt pub Seedance 2.5 :\n${buildFacelessPrompt({ kind: "ad", scene: sc, productImages: 1, hasVoiceRef: !!sc.texte.trim(), productDescription: `${product.name}: ${product.description}`, person })}`);
}

if (which === "clone" || which === "all") {
  const p = cloneProduction({ texte: "Bon, j'ai testé la recette virale des pâtes au four, et franchement, c'est pas ce que je pensais.", seconds: 12.4 });
  log(`CLONE — ${p.scenes[0]!.duration_sec}s, estimation ${estimateHybridCost(p.scenes, settings, { kind: "clone", music: false }).total} $`);
  log(`Prompt clone Seedance 2.5 :\n${buildClonePrompt({ refs: { hasSheet: true, hasOutfitImage: false, hasVoiceRef: true }, texte: p.scenes[0]!.texte, person })}`);
}
process.exit(0);
