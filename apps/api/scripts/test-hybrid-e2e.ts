/**
 * Test RÉEL de bout en bout de la vidéo hybride v2 (réalisateur IA → voix → plans → montage).
 * Coûte de l'argent (≈ 2-3 $ pour 20 s). Nécessite un worker actif (API avec RUN_WORKER_INLINE=true).
 *   pnpm --filter @viralya/api exec tsx scripts/test-hybrid-e2e.ts <avatar_id> [durée_s] [brief]
 */
import { readFile } from "node:fs/promises";
import { buildContextBrief } from "../src/context/contextBuilder";
import { breakIntoScenes, writeStory, type VlogScene } from "../src/domain/director";
import { createLocation, listLocations } from "../src/domain/locations";
import { getMemoryBrief } from "../src/memory/memory";
import { estimateHybridCost, readHybridSettings, type ShotState } from "../src/pipeline/hybrid";
import { DEFAULT_SEEDANCE_MODEL, DEFAULT_SEEDANCE_RESOLUTION } from "../src/providers/piapi";
import { DEFAULT_TALK_PROVIDER } from "../src/providers/talkingAvatar";
import { enqueue } from "../src/queue/queue";
import { supabase } from "../src/supabase";

const [avatarId, durArg, ...briefParts] = process.argv.slice(2);
if (!avatarId) throw new Error("usage: test-hybrid-e2e.ts <avatar_id> [durée_s] [brief]");
const durationSec = Number(durArg) || 20;
const brief = briefParts.join(" ") || undefined;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const { data: avatar } = await supabase.from("avatars").select("id, name, niche, city, timezone, system_prompt").eq("id", avatarId).single();
if (!avatar) throw new Error("avatar introuvable");
const [contextBrief, memoryBrief, locations] = await Promise.all([
  buildContextBrief({ city: avatar.city ?? "", niche: avatar.niche ?? "", timezone: avatar.timezone ?? "Europe/Paris" }),
  getMemoryBrief(avatarId),
  listLocations(avatarId, "all").catch(() => []),
]);
const base = {
  name: avatar.name, niche: avatar.niche, city: avatar.city, system_prompt: avatar.system_prompt, contextBrief, memoryBrief,
  locations: locations.map((l) => ({ key: l.key, name: l.name, description: l.description })),
};
log(`${avatar.name} — ${locations.length} lieu(x) : ${locations.map((l) => l.key).join(", ")}`);

// 1) Histoire puis découpage hybride (ou réutilisation d'une production existante : REUSE_CONTENT=<content_id>).
let story: { title: string; story: string; caption: string; hashtags: string[] };
let scenes: VlogScene[];
if (process.env.REUSE_CONTENT) {
  const { data: prev } = await supabase.from("content_items").select("payload").eq("id", process.env.REUSE_CONTENT).single();
  const prod = (prev?.payload as { production?: { title: string; story: string; caption: string; hashtags: string[]; scenes: VlogScene[] } } | null)?.production;
  if (!prod?.scenes?.length) throw new Error("REUSE_CONTENT : production introuvable");
  story = { title: prod.title, story: prod.story, caption: prod.caption, hashtags: prod.hashtags };
  scenes = prod.scenes;
  log(`Production réutilisée depuis ${process.env.REUSE_CONTENT} : ${story.title}`);
} else {
  // STORY_FILE=<json {title, story, caption, hashtags}> : histoire déjà validée → découpage seulement.
  if (process.env.STORY_FILE) {
    story = JSON.parse(await readFile(process.env.STORY_FILE, "utf8"));
    log(`Histoire validée reprise : ${story.title}`);
  } else {
    story = await writeStory({ ...base, presetKey: "walk", brief }, () => {});
    log(`Histoire : ${story.title}\n${story.story}`);
  }
  // SINGLE_TAKE=1 : une seule prise Seedance 2.5 de 30 s (texte d'une traite).
  scenes = await breakIntoScenes({ ...base, story: story.story, durationSec, format: "hybrid", singleTake: process.env.SINGLE_TAKE === "1" });
}
for (const sc of scenes) {
  log(`  [${sc.mode}] ${sc.duration_sec}s @${sc.location_key ?? sc.new_location?.key ?? "?"} « ${sc.texte} »${sc.inserts?.length ? ` inserts=${JSON.stringify(sc.inserts.map((i) => [i.anchor, i.framing]))}` : ""}`);
}

// DRY_RUN=1 : on s'arrête ici (histoire + découpage seulement, ≈ 0,02 $ de LLM, aucune vidéo).
if (process.env.DRY_RUN) {
  log(`Texte lu d'affilée :\n${scenes.map((s) => s.texte).join(" ")}`);
  process.exit(0);
}

// Nouveaux décors éventuels (comme la route /vlog/produce) — coûte une image chacun.
const known = new Set(locations.map((l) => l.key));
const created = new Map<string, string>();
for (const sc of scenes) {
  const nl = sc.new_location;
  if (!nl) continue;
  if (created.has(nl.key)) { sc.location_key = created.get(nl.key); continue; }
  if (known.has(nl.key)) { sc.location_key = nl.key; continue; }
  log(`  décor inédit demandé : ${nl.key} → génération de son image…`);
  const row = await createLocation(avatarId, nl, true, "oneoff");
  created.set(nl.key, row.key);
  known.add(row.key);
  sc.location_key = row.key;
}
for (const sc of scenes) {
  if (sc.location_key && !known.has(sc.location_key) && created.has(sc.location_key)) sc.location_key = created.get(sc.location_key);
  if (sc.location_key && !known.has(sc.location_key)) {
    // Clé sans suffixe d'une production précédente → décor déjà créé « <clé>-xxxxx ».
    const match = [...known].find((k) => k.startsWith(`${sc.location_key}-`));
    if (match) { sc.location_key = match; continue; }
    log(`  ⚠️ scène « ${sc.titre} » : décor ${sc.location_key} inconnu`);
  }
}
if (process.env.REUSE_CONTENT) for (const sc of scenes) log(`  [${sc.mode}] @${sc.location_key} « ${sc.texte.slice(0, 60)} »`);

// RES=1080p pour la qualité maximale (plans parlés en mode "pro" = 1080p, b-roll en 1080p).
const res = process.env.RES === "1080p" ? "1080p" : process.env.RES === "480p" ? "480p" : DEFAULT_SEEDANCE_RESOLUTION;
const talkMode = res === "1080p" ? "pro" : "std";
const settings = readHybridSettings({ resolution: res, talk_mode: talkMode });
const estimate = estimateHybridCost(scenes, settings, { music: true });
log(`Estimation : ${estimate.total} $ (${estimate.shots.join(" + ")}) — moteur parlant ${DEFAULT_TALK_PROVIDER} ${talkMode}, b-roll ${settings.seedance.taskType} ${res}`);

// 2) Contenu + premier job (même payload que la route /vlog/produce).
const title = `Test v2 — ${story.title}`;
const { data: item, error } = await supabase
  .from("content_items")
  .insert({
    avatar_id: avatarId, type: "video", network: "tiktok", ratio_class: "value", status: "generating", title,
    payload: {
      theme: title, production: { ...story, scenes }, format: "hybrid", video_model: DEFAULT_SEEDANCE_MODEL, resolution: res,
      talk_provider: DEFAULT_TALK_PROVIDER, talk_mode: talkMode, tts_model: "eleven_v3", subtitles: process.env.SUBTITLES === "1", music: true,
      caption: story.caption, hashtags: story.hashtags, script: scenes.map((s) => s.texte).join(" "),
    },
  })
  .select("id")
  .single();
if (error || !item) throw new Error(`insert: ${error?.message}`);
await enqueue("generate_voice", { avatar_id: avatarId, content_item_id: item.id }, { contentItemId: item.id, avatarId, label: title });
log(`Contenu ${item.id} lancé.`);

// 3) Suivi.
const t0 = Date.now();
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 15_000));
  const { data: row } = await supabase.from("content_items").select("status, error, assets").eq("id", item.id).single();
  const assets = (row?.assets ?? {}) as Record<string, unknown>;
  const shots = (assets.shots as ShotState[] | undefined) ?? [];
  const line = `${row?.status} — ${shots.map((s) => `${s.idx}:${s.role[0]}:${s.phase}`).join(" ")}${assets.assembling ? " (montage)" : ""}`;
  if (line !== last) { log(`${Math.round((Date.now() - t0) / 1000)} s ${line}`); last = line; }
  if (["needs_review", "failed", "canceled"].includes(String(row?.status)) || Date.now() - t0 > 40 * 60_000) {
    const logs = (assets.log as Array<{ msg: string }> | undefined) ?? [];
    log(`FINAL : ${row?.status} en ${Math.round((Date.now() - t0) / 1000)} s — erreur : ${row?.error ?? "aucune"}`);
    for (const s of shots) log(`  plan ${s.idx} ${s.role} ${s.phase} ${s.provider ?? ""} ${s.audio_seconds ?? ""}s visage=${s.qc?.face_score?.toFixed(2) ?? "-"} coût=${s.cost_usd ?? "-"}${s.inserts?.length ? ` inserts=${JSON.stringify(s.inserts.map((i) => [i.anchor, i.at, i.len, i.error]))}` : ""}${s.error ? ` ERR=${s.error}` : ""}`);
    log(`  vidéo : ${assets.video_url} v${assets.video_version} ${assets.video_seconds}s sous-titres=${assets.subtitled} musique=${assets.music_mixed} inserts=${assets.inserts_count} coût estimé=${assets.estimated_cost_usd} musique=${assets.music_cost_usd}`);
    for (const l of logs.slice(-14)) log(`    ${l.msg.slice(0, 140)}`);
    break;
  }
}
process.exit(0);
