import { musicPromptFor, type VlogScene } from "../../domain/director";
import { uploadBytes } from "../../lib/storage";
import { logger } from "../../logger";
import { DEFAULT_TTS_MODEL, generateMusic, ttsWithTimestamps, type TtsModel } from "../../providers/elevenlabs";
import { clampDuration } from "../../providers/piapi";
import { jobLog, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { shotsFromScenes, type ShotState } from "../hybrid";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// VOIX D'ABORD — chaque réplique/narration est dite par ElevenLabs (v3) avec
// horodatage des mots (sous-titres). La durée réelle de l'audio fixe la durée
// des plans : le lip-sync suit l'audio, jamais l'inverse.
// payload.only_shots = [idx…] → régénération ciblée (les autres plans sont gardés).
// ─────────────────────────────────────────────────────────────

export async function generateVoiceJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") return;

  const production = item.payload.production as { scenes?: VlogScene[] } | undefined;
  const scenes = production?.scenes ?? [];
  if (!scenes.length) throw new Error("generate_voice: production.scenes manquantes");

  const { data: avatar } = await supabase.from("avatars").select("id, name, eleven_voice_id").eq("id", item.avatar_id).single();
  if (!avatar?.eleven_voice_id) throw new Error("L'influenceur n'a pas de voix ElevenLabs — choisis-en une dans sa fiche.");

  const only = Array.isArray(job.payload.only_shots) ? (job.payload.only_shots as number[]) : null;
  const existing = Array.isArray(item.assets.shots) ? (item.assets.shots as ShotState[]) : [];
  const shots = existing.length ? existing : shotsFromScenes(scenes);
  const ttsModel: TtsModel = item.payload.tts_model === "eleven_multilingual_v2" ? "eleven_multilingual_v2" : DEFAULT_TTS_MODEL;

  const log: Array<{ t: string; msg: string }> = Array.isArray(item.assets.log) ? (item.assets.log as never[]) : [];
  const say = (msg: string) => log.push({ t: new Date().toISOString(), msg });

  const targets = shots.filter((s) => (only ? only.includes(s.idx) : s.phase === "voice") && s.texte.trim());
  if (!existing.length) say(`🎬 Production hybride : ${shots.length} plan(s) — ${shots.filter((s) => s.role === "talk").length} parlé(s), ${shots.filter((s) => s.role === "broll").length} b-roll`);

  let i = 0;
  for (const shot of targets) {
    i++;
    await jobLog(job, `Voix ${i}/${targets.length} : « ${shot.titre} »`, Math.round((i / Math.max(1, targets.length)) * 80));
    const tts = await ttsWithTimestamps(avatar.eleven_voice_id, shot.texte, ttsModel);
    const url = await uploadBytes(`${item.avatar_id}/${id}/voice-${shot.idx}-v${shot.version ?? 1}.mp3`, tts.mp3, "audio/mpeg");
    shot.audio_url = url;
    shot.audio_seconds = tts.seconds;
    shot.words = tts.words;
    shot.tts_model = tts.model;
    // talk : le plan dure ce que dure la voix ; broll : 4-15 s Seedance, prolongé au montage si la narration dépasse.
    shot.duration = shot.role === "talk" ? Math.max(2, Math.ceil(tts.seconds + 0.3)) : clampDuration(Math.max(shot.duration, Math.ceil(tts.seconds + 0.5)));
    shot.phase = "waiting";
    say(`🎙️ ${shot.titre} : voix générée (${tts.seconds.toFixed(1)} s, ${tts.model})`);
    logger.info("hybrid_voice_done", { itemId: id, idx: shot.idx, seconds: tts.seconds, model: tts.model });
  }
  // Un plan sans texte n'a pas de voix : il est prêt tel quel.
  for (const s of shots) if (s.phase === "voice" && !s.texte.trim()) s.phase = "waiting";

  // Musique de fond (Eleven Music, ≈ 0,15 $/min) — une fois par vidéo, jamais bloquante.
  const extra: Record<string, unknown> = {};
  if (!only && item.payload.music !== false && !item.assets.music_url) {
    try {
      const total = shots.reduce((a, s) => a + (s.role === "talk" ? s.audio_seconds ?? s.duration : Math.max(s.duration, s.audio_seconds ?? 0)), 0);
      const story = String((production as { story?: string } | undefined)?.story ?? item.payload.script ?? "");
      const prompt = typeof item.payload.music_prompt === "string" && item.payload.music_prompt.trim() ? item.payload.music_prompt.trim() : await musicPromptFor(story, scenes);
      await jobLog(job, "Musique de fond (Eleven Music)", 90);
      const m = await generateMusic(prompt, Math.min(120, Math.ceil(total + 3)));
      const url = await uploadBytes(`${item.avatar_id}/${id}/music-v1.mp3`, m.mp3, "audio/mpeg");
      Object.assign(extra, { music_url: url, music_prompt: prompt, music_seconds: m.seconds, music_cost_usd: m.costUsd });
      say(`🎵 Musique de fond générée (${m.seconds} s, ${m.costUsd.toFixed(3)} $)`);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      say(`⚠️ Musique de fond indisponible (${msg.slice(0, 80)}) — vidéo sans musique`);
      logger.warn("hybrid_music_failed", { itemId: id, err: msg.slice(0, 200) });
    }
  }

  await mergeAssets(id, { shots, log, format: "hybrid", ...extra });
  await advance(job);
}
