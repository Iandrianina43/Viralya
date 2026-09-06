/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────
// BANC D'ESSAI « AVATAR PARLANT » (phase 2) — la voix française vient
// d'ElevenLabs (v3), la vidéo est PILOTÉE PAR CET AUDIO (lip-sync) à partir
// d'un keyframe (l'influenceur dans son décor) :
//   - Kling AI Avatar (PiAPI, mode std)   ≈ 0,052 $/s
//   - OmniHuman 1.5   (PiAPI)             ≈ 0,13 $/s
// Constat d'origine : Seedance 2.0 synthétise lui-même la parole (les audios
// de référence ne guident que le rythme) → français médiocre.
//
//   pnpm --filter @viralya/api exec tsx scripts/bench-talking.ts <avatar_id> <keyframe_url> [models] [out_dir]
//   models = kling-avatar,omnihuman (défaut : les deux)
//   BENCH_TEXT="…" pour changer la phrase ; BENCH_TTS_MODEL=eleven_multilingual_v2 pour comparer.
// ─────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config";
import { uploadBytes } from "../src/lib/storage";
import { supabase } from "../src/supabase";

const PIAPI = "https://api.piapi.ai";
const avatarId = process.argv[2] ?? "";
const keyframeUrl = process.argv[3] ?? "";
const only = (process.argv[4] ?? "kling-avatar,omnihuman").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = process.argv[5] ?? `bench-talking-${Date.now()}`;
if (!avatarId || !keyframeUrl) throw new Error("usage: bench-talking.ts <avatar_id> <keyframe_url> [models] [out_dir]");
if (!config.PIAPI_API_KEY) throw new Error("PIAPI_API_KEY manquante");
if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY manquante");

// ≈ 10 s parlées. Tag d'émotion v3 entre crochets (ignoré par multilingual_v2).
const TEXT =
  process.env.BENCH_TEXT?.trim() ||
  "[cheerful] Coucou ! Aujourd'hui je vous emmène dans les ruelles de Santa Cruz, à Séville. Regardez ces murs jaunes et ces orangers, c'est magnifique. Franchement, vous allez adorer.";
const TTS_MODEL = process.env.BENCH_TTS_MODEL?.trim() || "eleven_v3";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function piapi(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${PIAPI}${path}`, {
    ...init,
    headers: { "x-api-key": config.PIAPI_API_KEY!, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error(`piapi ${path} ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok || body.code !== 200) throw new Error(`piapi ${path} ${res.status}: ${body.message ?? text.slice(0, 300)}`);
  return body.data;
}

async function tts(voiceId: string, text: string, modelId: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": config.ELEVENLABS_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      // v3 : stability ∈ {0, 0.5, 1} (Creative / Natural / Robust).
      voice_settings: modelId === "eleven_v3" ? { stability: 0.5, similarity_boost: 0.8 } : { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs ${modelId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

interface Attempt { label: string; body: Record<string, unknown> }

async function submitWithFallbacks(name: string, attempts: Attempt[]): Promise<{ taskId: string; used: string }> {
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const data = await piapi("/api/v1/task", { method: "POST", body: JSON.stringify(a.body) });
      if (!data?.task_id) throw new Error("pas de task_id");
      console.log(`  ${name}: soumis (${a.label}) → ${data.task_id}`);
      return { taskId: String(data.task_id), used: a.label };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      console.log(`  ${name}: ${a.label} refusé → ${msg}`);
      errors.push(`${a.label}: ${msg}`);
    }
  }
  throw new Error(`${name}: toutes les formes refusées\n${errors.join("\n")}`);
}

async function poll(name: string, taskId: string, maxMs = 20 * 60_000): Promise<any> {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < maxMs) {
    const data = await piapi(`/api/v1/task/${taskId}`);
    const status = String(data?.status ?? "").trim().toLowerCase();
    if (status !== last) { console.log(`  ${name}: ${status} (${Math.round((Date.now() - t0) / 1000)} s)`); last = status; }
    if (status === "completed" || status === "success") return data;
    if (status === "failed") throw new Error(`${name}: échec — ${JSON.stringify(data?.error ?? {}).slice(0, 400)}`);
    await sleep(10_000);
  }
  throw new Error(`${name}: délai dépassé`);
}

function findVideoUrl(output: any): string | null {
  if (!output) return null;
  for (const k of ["video", "video_url", "url"]) if (typeof output[k] === "string" && output[k]) return output[k];
  if (Array.isArray(output.video_urls) && output.video_urls[0]) return String(output.video_urls[0]);
  if (output.works?.[0]?.video?.resource_without_watermark) return String(output.works[0].video.resource_without_watermark);
  if (output.works?.[0]?.video?.resource) return String(output.works[0].video.resource);
  return null;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { data: avatar } = await supabase.from("avatars").select("name, eleven_voice_id").eq("id", avatarId).single();
  if (!avatar?.eleven_voice_id) throw new Error("avatar sans voix ElevenLabs");
  console.log(`== ${avatar.name} — voix ${avatar.eleven_voice_id} — TTS ${TTS_MODEL}`);
  console.log(`   texte : ${TEXT}`);

  // 1) Voix française (BENCH_AUDIO_URL=… pour réutiliser un audio déjà généré).
  let audioUrl = process.env.BENCH_AUDIO_URL?.trim() || "";
  if (audioUrl) {
    console.log(`== Audio réutilisé : ${audioUrl}`);
  } else {
    const t0 = Date.now();
    const mp3 = await tts(avatar.eleven_voice_id, TEXT, TTS_MODEL);
    audioUrl = await uploadBytes(`bench/talking/${avatarId}-${TTS_MODEL}-${Date.now()}.mp3`, mp3, "audio/mpeg");
    writeFileSync(join(outDir, `voice-${TTS_MODEL}.mp3`), mp3);
    console.log(`== Audio ${TTS_MODEL} : ${mp3.length} octets en ${Math.round((Date.now() - t0) / 1000)} s → ${audioUrl}`);
  }

  const prompt = "She speaks naturally to the camera like a travel vlogger, warm smile, subtle hand gestures, steady eye-level handheld camera, natural daylight in a narrow street of Seville.";

  // 2) Soumissions (plusieurs formes de requête : la doc PiAPI ne fige pas encore les champs).
  const subs: Record<string, Promise<{ taskId: string; used: string }>> = {};
  if (only.includes("kling-avatar")) {
    // Doc PiAPI (kling-avatar-api) : l'audio s'appelle `local_dubbing_url` (comme pour lip_sync).
    subs["kling-avatar"] = submitWithFallbacks("kling-avatar", [
      { label: "kling/avatar std (local_dubbing_url)", body: { model: "kling", task_type: "avatar", input: { image_url: keyframeUrl, local_dubbing_url: audioUrl, prompt, mode: "std" } } },
      { label: "kling/avatar std (sans prompt)", body: { model: "kling", task_type: "avatar", input: { image_url: keyframeUrl, local_dubbing_url: audioUrl, mode: "std" } } },
      { label: "kling/avatar std (audio_url)", body: { model: "kling", task_type: "avatar", input: { image_url: keyframeUrl, audio_url: audioUrl, prompt, mode: "std" } } },
    ]);
  }
  if (only.includes("omnihuman")) {
    subs["omnihuman"] = submitWithFallbacks("omnihuman", [
      { label: "omni-human/omni-human-1.5", body: { model: "omni-human", task_type: "omni-human-1.5", input: { image_url: keyframeUrl, audio_url: audioUrl, prompt } } },
      { label: "omnihuman/omni-human-1.5", body: { model: "omnihuman", task_type: "omni-human-1.5", input: { image_url: keyframeUrl, audio_url: audioUrl, prompt } } },
      { label: "omni-human/omnihuman-1.5", body: { model: "omni-human", task_type: "omnihuman-1.5", input: { image_url: keyframeUrl, audio_url: audioUrl, prompt } } },
    ]);
  }

  const results: Record<string, any> = { text: TEXT, tts_model: TTS_MODEL, audio_url: audioUrl, keyframe_url: keyframeUrl };
  await Promise.all(
    Object.entries(subs).map(async ([name, p]) => {
      const t1 = Date.now();
      try {
        const { taskId, used } = await p;
        const data = await poll(name, taskId);
        const videoUrl = findVideoUrl(data?.output);
        const meta = data?.meta ?? null;
        console.log(`== ${name}: prêt en ${Math.round((Date.now() - t1) / 1000)} s — ${videoUrl ?? "URL introuvable"}`);
        if (meta) console.log(`   meta : ${JSON.stringify(meta).slice(0, 300)}`);
        if (!videoUrl) console.log(`   output brut : ${JSON.stringify(data?.output).slice(0, 500)}`);
        if (videoUrl) {
          const buf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
          writeFileSync(join(outDir, `${name}.mp4`), buf);
          console.log(`   téléchargé : ${buf.length} octets → ${join(outDir, `${name}.mp4`)}`);
        }
        results[name] = { task_id: taskId, request: used, video_url: videoUrl, seconds: Math.round((Date.now() - t1) / 1000), meta, output: data?.output ?? null };
      } catch (err) {
        console.log(`== ${name}: ÉCHEC — ${String((err as Error)?.message ?? err)}`);
        results[name] = { error: String((err as Error)?.message ?? err) };
      }
    }),
  );
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(`== résultats : ${join(outDir, "results.json")}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
