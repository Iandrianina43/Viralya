import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleHybrid, frameFromVideo, type HybridPart } from "../../lib/ffmpeg";
import { faceScores } from "../../lib/qc";
import { uploadBytes } from "../../lib/storage";
import { logger } from "../../logger";
import { transcribeWords } from "../../providers/elevenlabs";
import { piapiPoll } from "../../providers/piapi";
import { pollTalkingAvatar } from "../../providers/talkingAvatar";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { alignWordsToScript, dialogueScore, loadShotContext, planInserts, submitShot, totalShotCost, type ShotContext, type ShotState } from "../hybrid";
import { advance, loadContentItem, mergeAssets, requireContentItemId, type ContentItemRow } from "../pipelines";
import { isOutOfCredits, isRateLimited, MAX_SUBMIT_ATTEMPTS, OUT_OF_CREDITS_MSG } from "./generateShots";

// ─────────────────────────────────────────────────────────────
// SUIVI DES PLANS — tous en vol en même temps. Prêt → rapatriement + QC visage
// (plans parlés) ; échec → nouvelle soumission (3 essais) ; tout fini → montage
// ffmpeg (voix off mixée sur les b-roll, sous-titres) → assemble (revue humaine).
// ─────────────────────────────────────────────────────────────

const POLL_MS = 15_000;
const MAX_POLLS = 100; // ≈ 25 min (Kling Avatar / OmniHuman ≈ 5-6 min, Seedance 2-8 min)

async function persist(url: string, avatarId: string, itemId: string, name: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    return await uploadBytes(`${avatarId}/${itemId}/${name}`, await res.arrayBuffer(), "video/mp4");
  } catch (err) {
    logger.warn("shot_persist_fallback", { itemId, err: String((err as Error)?.message ?? err) });
    return url;
  }
}

/** Contrôle du visage sur une image du plan (jamais bloquant). */
async function qcShot(portraitUrl: string, clipUrl: string): Promise<ShotState["qc"]> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-shotqc-"));
  try {
    const frame = await frameFromVideo(clipUrl, 1);
    const path = join(dir, "frame.jpg");
    await writeFile(path, frame);
    const [r] = await faceScores(portraitUrl, [path]);
    return { face_score: r?.score ?? null, face_height: r?.faceHeight ?? null, verdict: r?.verdict ?? "unknown", ...(r?.note ? { note: r.note } : {}) };
  } catch (err) {
    logger.warn("shot_qc_failed", { err: String((err as Error)?.message ?? err) });
    return { face_score: null, verdict: "unknown" };
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function pollShotsJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") {
    logger.info("poll_shots_canceled", { itemId: id });
    return;
  }
  const shots = Array.isArray(item.assets.shots) ? (item.assets.shots as ShotState[]) : [];
  if (!shots.length) throw new Error("poll_shots: plans manquants");

  const log: Array<{ t: string; msg: string }> = Array.isArray(item.assets.log) ? (item.assets.log as never[]) : [];
  const say = (msg: string) => log.push({ t: new Date().toISOString(), msg });
  let ctx: ShotContext | null = null;
  let portraitUrl: string | null = null;

  // 1) Plans en vol.
  for (const shot of shots.filter((s) => s.phase === "video" && s.task_id)) {
    const r = String(shot.provider ?? "").startsWith("seedance") ? await piapiPoll(String(shot.task_id)) : await pollTalkingAvatar(String(shot.task_id));
    if (r.status === "processing") continue;

    if (r.status === "failed") {
      shot.submit_attempts = (shot.submit_attempts ?? 0) + 1;
      shot.task_id = undefined;
      if (/moderation/i.test(r.error ?? "")) shot.moderated = true;
      if (shot.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
        shot.phase = "failed";
        shot.error = (r.error ?? "rendu échoué").slice(0, 200);
        shot.cost_usd = 0; // tâche refusée : rien de livré, on ne la compte pas dans l'estimation
        say(`❌ ${shot.titre} : abandon (${String(shot.error).slice(0, 100)})`);
      } else {
        shot.phase = "waiting";
        shot.error = (r.error ?? "rendu échoué").slice(0, 200);
        say(`⚠️ ${shot.titre} : échec (${String(r.error ?? "?").slice(0, 80)}) — nouvel essai ${shot.submit_attempts}/${MAX_SUBMIT_ATTEMPTS - 1}`);
      }
      continue;
    }

    shot.clip_url = await persist(String(r.videoUrl), item.avatar_id, id, `shot${shot.idx}-v${shot.version ?? 1}.mp4`);
    if ("costUsd" in r && typeof r.costUsd === "number") shot.cost_usd = r.costUsd;
    shot.phase = "done";
    shot.error = undefined;
    // Voix synthétisée par Seedance : on transcrit le clip pour horodater les mots (sous-titres,
    // inserts) et vérifier ce qui a vraiment été dit. Sans transcription, pas de sous-titres
    // désynchronisés : on préfère aucun mot à des mots calés sur un autre audio.
    if (shot.native_voice && shot.texte.trim()) {
      try {
        const t = await transcribeWords(shot.clip_url);
        shot.words = t.words.length ? alignWordsToScript(t.words, shot.texte) : null;
        shot.transcript = t.text || null;
        shot.dialogue_score = dialogueScore(shot.texte, t.text);
        const pct = Math.round(shot.dialogue_score * 100);
        say(`🗣️ ${shot.titre} : texte reconnu à ${pct} % (${t.model})${pct < 70 ? ` — entendu : « ${t.text.slice(0, 90)} »` : ""}`);
      } catch (err) {
        shot.words = null;
        shot.transcript = null;
        shot.dialogue_score = null;
        say(`⚠️ ${shot.titre} : transcription indisponible (${String((err as Error)?.message ?? err).slice(0, 60)}) — plan sans sous-titres`);
        logger.warn("shot_transcribe_failed", { itemId: id, idx: shot.idx, err: String((err as Error)?.message ?? err).slice(0, 200) });
      }
    }
    if (shot.role === "talk") {
      if (!portraitUrl) {
        const { data: a } = await supabase.from("avatars").select("ref_image_url").eq("id", item.avatar_id).single();
        portraitUrl = (a?.ref_image_url as string) || null;
      }
      shot.qc = portraitUrl ? await qcShot(portraitUrl, shot.clip_url) : null;
      const sc = shot.qc?.face_score;
      say(`✅ ${shot.titre} : plan parlé prêt${sc != null ? ` — visage ${sc.toFixed(2)} (${shot.qc?.verdict})` : ""}`);
    } else {
      say(`✅ ${shot.titre} : b-roll prêt (${shot.duration}s)`);
    }
  }

  // 2) Plans à (re)soumettre.
  for (const shot of shots.filter((s) => s.phase === "waiting")) {
    try {
      ctx ??= await loadShotContext(item);
      await submitShot(ctx, shot, say);
      say(`🎥 ${shot.titre} : ${shot.role === "talk" ? `avatar parlant (${shot.provider})` : "b-roll Seedance"} relancé`);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (isRateLimited(err)) {
        // Limite de tâches simultanées PiAPI : pas un échec, on réessaie au prochain passage (15 s).
        shot.error = "file d'attente PiAPI (limite de tâches simultanées) — soumission différée";
        break;
      }
      if (isOutOfCredits(err)) {
        shot.phase = "failed";
        shot.error = OUT_OF_CREDITS_MSG;
        say(`💳 ${shot.titre} : ${OUT_OF_CREDITS_MSG}`);
        break;
      }
      shot.submit_attempts = (shot.submit_attempts ?? 0) + 1;
      shot.error = msg.slice(0, 200);
      if (shot.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
        shot.phase = "failed";
        say(`❌ ${shot.titre} : abandon (${msg.slice(0, 100)})`);
      }
    }
  }

  await mergeAssets(id, { shots, log, estimated_cost_usd: totalShotCost(shots) });

  // 3) Encore du travail en vol → on repasse plus tard.
  if (shots.some((s) => s.phase === "video" || s.phase === "waiting")) {
    const polls = Number(job.payload.poll_attempts ?? 0) + 1;
    if (polls > MAX_POLLS) throw new Error("poll_shots: délai dépassé (rendu trop long)");
    await enqueue("poll_shots", { ...job.payload, poll_attempts: polls }, { contentItemId: id, runAfterMs: POLL_MS, avatarId: job.avatar_id ?? item.avatar_id, label: job.label ?? item.title ?? null });
    return;
  }

  await finalize(job, item, shots, log, say);
}

async function finalize(job: JobRow, item: ContentItemRow, shots: ShotState[], log: Array<{ t: string; msg: string }>, say: (msg: string) => void): Promise<void> {
  const id = item.id;
  const done = shots.filter((s) => s.phase === "done" && s.clip_url).sort((a, b) => a.idx - b.idx);
  if (!done.length) {
    await mergeAssets(id, { shots, log });
    throw new Error("hybride : aucun plan abouti");
  }
  const { data: fresh } = await supabase.from("content_items").select("status").eq("id", id).single();
  if (fresh?.status === "failed" || fresh?.status === "canceled") return;

  const musicUrl = typeof item.assets.music_url === "string" ? item.assets.music_url : null;
  say(`🎞️ Montage de ${done.length} plan(s) : inserts, voix off, sous-titres karaoké${musicUrl ? ", musique" : ""}…`);
  await mergeAssets(id, { shots, log, assembling: true });

  const parts: HybridPart[] = done.map((s) => ({
    role: s.role,
    clipUrl: String(s.clip_url),
    voiceUrl: s.role === "broll" && !s.native_voice ? s.audio_url ?? null : null,
    voiceSeconds: s.audio_seconds ?? null,
    words: s.words ?? null,
    // Inserts photo placés sur les mots de la voix (jamais avant 2 s, 1,5-3 s, espacés).
    // Voix native (Seedance 2.5) : le clip dure `duration`, plus long que l'audio ElevenLabs
    // (bug du 4 sept. : 3 inserts sur 4 écartés « trop tard dans le plan » à cause de audio_seconds).
    inserts: s.role === "talk" && s.inserts?.length && s.words?.length
      ? planInserts(s.words, s.inserts, s.native_voice ? s.duration : s.audio_seconds ?? s.duration)
      : null,
  }));
  const labels = item.payload.labels && typeof item.payload.labels === "object" ? (item.payload.labels as { top?: string | null; bottom?: string | null }) : null;
  const { video, seconds, subtitled, music, inserts } = await assembleHybrid(parts, {
    subtitles: item.payload.subtitles !== false,
    musicUrl,
    filmLook: item.payload.film_look === true,
    labels,
  });
  const version = Number(item.assets.video_version ?? 0) + 1;
  const videoUrl = await uploadBytes(`${item.avatar_id}/${id}/video-v${version}.mp4`, video, "video/mp4");

  const failed = shots.filter((s) => s.phase === "failed").length;
  const bits = [inserts ? `${inserts} insert(s)` : "", subtitled ? "sous-titrée" : "", music ? "musique" : ""].filter(Boolean).join(", ");
  say(`🏁 Vidéo terminée : ${done.length} plan(s), ${seconds.toFixed(0)} s${bits ? ` — ${bits}` : ""}${failed ? ` — ${failed} plan(s) en échec écarté(s)` : ""}`);
  await mergeAssets(id, { shots, log, assembling: false, video_url: videoUrl, video_version: version, video_seconds: seconds, subtitled, music_mixed: music, inserts_count: inserts });
  logger.info("hybrid_video_done", { itemId: id, shots: done.length, seconds, subtitled, music, inserts, cost: totalShotCost(shots) });
  await advance(job);
}
