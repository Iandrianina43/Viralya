/**
 * Lance RÉELLEMENT un format (explicative, pub produit) et suit le rendu. Coûte de l'argent.
 * Nécessite un worker actif (prod ou local) sur la même base.
 *   pnpm --filter @viralya/api exec tsx scripts/launch-format.ts <avatar_id> explainer|ad_product [480p|720p|1080p] ["sujet ou brief"]
 *   Pub produit : PRODUCT_NAME, PRODUCT_DESC, PRODUCT_IMAGE (URL publique) en variables d'environnement.
 */
import { writeExplainer, writeProductAd } from "../src/domain/formats";
import { launchProduction } from "../src/domain/production";
import type { ShotState } from "../src/pipeline/hybrid";
import { supabase } from "../src/supabase";

const [avatarId, kind = "explainer", resArg = "720p", ...briefParts] = process.argv.slice(2);
if (!avatarId) throw new Error("usage: launch-format.ts <avatar_id> explainer|ad_product [res] [brief]");
const resolution = ["480p", "720p", "1080p"].includes(resArg) ? resArg : "720p";
const brief = briefParts.join(" ");
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, system_prompt").eq("id", avatarId).single();
if (!avatar) throw new Error("avatar introuvable");

const extra: Record<string, unknown> = { kind, faceless: true, inserts: false };
let production;
if (kind === "explainer") {
  production = await writeExplainer({ avatar, topic: brief || "pourquoi ton café filtre est amer, et les trois réglages qui changent tout", durationSec: 30 });
} else if (kind === "ad_product") {
  const product = { name: process.env.PRODUCT_NAME ?? "", description: process.env.PRODUCT_DESC ?? "", image_url: process.env.PRODUCT_IMAGE ?? null };
  if (!product.name || !product.image_url) throw new Error("PRODUCT_NAME et PRODUCT_IMAGE requis");
  production = await writeProductAd({ avatar, product, brief, durationSec: 30, voiceOver: true });
  Object.assign(extra, { product, product_image_url: product.image_url, product_image_urls: [product.image_url] });
} else throw new Error("kind inconnu");

log(`« ${production.title} » — ${production.scenes.length} scène(s)`);
for (const sc of production.scenes) log(`  [${sc.visual ?? "-"}] ${sc.duration_sec}s « ${sc.texte.slice(0, 90)} »`);
const r = await launchProduction(avatarId, production, { resolution, music: true, singleTake: true, inserts: false, extraPayload: extra });
log(`Contenu ${r.itemId} lancé — estimation ${r.estimate} $ (${resolution})`);

const t0 = Date.now();
let last = "";
for (;;) {
  await new Promise((s) => setTimeout(s, 15_000));
  const { data: row } = await supabase.from("content_items").select("status, error, assets").eq("id", r.itemId).single();
  const assets = (row?.assets ?? {}) as Record<string, unknown>;
  const shots = (assets.shots as ShotState[] | undefined) ?? [];
  const line = `${row?.status} — ${shots.map((s) => `${s.idx}:${s.role[0]}:${s.phase}`).join(" ")}${assets.assembling ? " (montage)" : ""}`;
  if (line !== last) { log(`${Math.round((Date.now() - t0) / 1000)} s ${line}`); last = line; }
  if (["needs_review", "failed", "canceled"].includes(String(row?.status)) || Date.now() - t0 > 40 * 60_000) {
    const logs = (assets.log as Array<{ msg: string }> | undefined) ?? [];
    log(`FINAL : ${row?.status} en ${Math.round((Date.now() - t0) / 1000)} s — erreur : ${row?.error ?? "aucune"}`);
    for (const s of shots) log(`  plan ${s.idx} ${s.role} ${s.phase} ${s.duration}s coût=${s.cost_usd ?? "-"} ${s.clip_url ?? s.image_url ?? ""}${s.error ? ` ERR=${s.error}` : ""}`);
    log(`  vidéo : ${assets.video_url} (${assets.video_seconds}s) musique=${assets.music_mixed} coût estimé=${assets.estimated_cost_usd}`);
    for (const l of logs.slice(-12)) log(`    ${l.msg.slice(0, 160)}`);
    break;
  }
}
process.exit(0);
