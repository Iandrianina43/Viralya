import type { VideoProviderName } from "@viralya/shared";
import { assembleVlog } from "../../lib/ffmpeg";
import { uploadBytes } from "../../lib/storage";
import { logger } from "../../logger";
import { ttsToStorage } from "../../providers/elevenlabs";
import { composeKeyframe, openAiImageConfigured } from "../../providers/image";
import { hfPoll, speakDuration, submitImageToVideo, submitSoulKeyframe, submitSpeak } from "../../providers/higgsfield";
import { getVideoProvider } from "../../providers/video";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId, type ContentItemRow } from "../pipelines";

const MAX_POLLS = 60; // rendu vidéo cinématique long (~x 15-20s)

// Rapatrie la vidéo dans le Storage (URL provider souvent temporaire).
async function persist(url: string, avatarId: string, itemId: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    return await uploadBytes(`${avatarId}/${itemId}/video.mp4`, await res.arrayBuffer(), "video/mp4");
  } catch (err) {
    logger.warn("video_persist_fallback", { itemId, err: String((err as Error)?.message ?? err) });
    return url;
  }
}

export async function pollVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  // Annulation demandée pendant la production → on arrête la chaîne ici.
  if (item.status === "failed") {
    logger.info("poll_video_canceled", { itemId: id });
    return;
  }

  const providerName = (item.assets.video_provider ?? "stub") as VideoProviderName;

  // MOTEUR VLOG : machine à états multi-scènes (soul → voix → speak/anim → montage).
  if (item.assets.vlog) {
    await pollVlog(job, item);
    return;
  }

  // Moteur cinématique Higgsfield : 2 phases (soul → video) suivies via hf_job_id.
  if (providerName === "higgsfield") {
    await pollHiggsfield(job, id, item.avatar_id, item.assets);
    return;
  }

  const externalId = String(item.assets.video_external_id ?? "");
  if (!externalId) throw new Error("poll_video: video_external_id manquant");

  const result = await getVideoProvider(providerName).poll(externalId);

  if (result.status === "ready") {
    const videoUrl = result.videoUrl ? await persist(result.videoUrl, item.avatar_id, id) : null;
    await mergeAssets(id, { video_url: videoUrl });
    await advance(job);
    return;
  }
  if (result.status === "failed") throw new Error(`poll_video: rendu échoué (${result.error ?? "inconnu"})`);

  const polls = Number(job.payload.poll_attempts ?? 0) + 1;
  if (polls > MAX_POLLS) throw new Error("poll_video: timeout (rendu trop long)");
  await enqueue("poll_video", { ...job.payload, poll_attempts: polls }, { contentItemId: id, runAfterMs: 20_000 });
}

// Suivi du moteur Higgsfield : phase "soul" (keyframe) → phase "video" (clip) → persist.
async function pollHiggsfield(job: JobRow, id: string, avatarId: string, assets: Record<string, any>): Promise<void> {
  const jobId = String(assets.hf_job_id ?? "");
  if (!jobId) throw new Error("poll_video: hf_job_id manquant");
  const phase = String(assets.hf_phase ?? "soul");
  const result = await hfPoll(jobId);

  if (result.status === "failed") throw new Error(`higgsfield ${phase} échoué (${result.error ?? "inconnu"})`);

  if (result.status === "ready") {
    if (phase === "soul") {
      const keyframe = result.imageUrl;
      if (!keyframe) throw new Error("higgsfield soul: image manquante");
      const motion = String(assets.motion_prompt ?? "natural subtle movement, cinematic camera, lifelike");
      const videoJobId = await submitImageToVideo(keyframe, motion);
      logger.info("higgsfield_i2v_submit", { itemId: id, videoJobId });
      await mergeAssets(id, { hf_phase: "video", hf_job_id: videoJobId, keyframe_url: keyframe, image_url: keyframe });
      await enqueue("poll_video", { ...job.payload, poll_attempts: 0 }, { contentItemId: id, runAfterMs: 15_000 });
      return;
    }
    // phase "video" : clip prêt.
    const videoUrl = result.videoUrl ? await persist(result.videoUrl, avatarId, id) : null;
    await mergeAssets(id, { video_url: videoUrl });
    await advance(job);
    return;
  }

  // en cours → re-poll
  const polls = Number(job.payload.poll_attempts ?? 0) + 1;
  if (polls > MAX_POLLS) throw new Error("poll_video: timeout Higgsfield (rendu trop long)");
  await enqueue("poll_video", { ...job.payload, poll_attempts: polls }, { contentItemId: id, runAfterMs: 15_000 });
}

// ─────────────────────────────────────────────────────────────
// MOTEUR VLOG — machine à états par scène :
//  soul (image) → [voix TTS] → video (Speak si talk / DoP si voiceover) → done
// Quand toutes les scènes sont done → montage ffmpeg → vidéo finale.
// ─────────────────────────────────────────────────────────────

interface VlogSceneState {
  idx: number;
  phase: "waiting" | "soul" | "soul_done" | "video" | "done" | "failed";
  hf_job_id?: string;
  status?: string;
  keyframe_url?: string;
  audio_url?: string;
  clip_url?: string;
  error?: string;
  submit_attempts?: number;
}

// Limite Higgsfield : 4 requêtes simultanées PAR COMPTE → on garde une marge.
const MAX_INFLIGHT = 3;
const isConcurrencyError = (err: unknown) => /concurrent/i.test(String((err as Error)?.message ?? err));

async function pollVlog(job: JobRow, item: ContentItemRow): Promise<void> {
  const id = item.id;
  const scenes = (item.assets.scenes ?? []) as VlogSceneState[];
  const log: Array<{ t: string; msg: string }> = Array.isArray(item.assets.log) ? (item.assets.log as never[]) : [];
  const production = (item.payload.production ?? {}) as { scenes?: Array<{ mode?: string; texte?: string; motion_prompt?: string; titre?: string; soul_prompt?: string; location_key?: string }> };
  const refImage = (item.assets.ref_image_url as string) ?? null;
  const refAngles = Array.isArray(item.assets.ref_angles) ? (item.assets.ref_angles as string[]) : [];
  // Portrait principal + angles supplémentaires = identité plus stable.
  const faceRefs = [refImage, ...refAngles].filter(Boolean) as string[];
  const videoModel = String(item.payload.video_model ?? "kling");
  const say = (msg: string) => log.push({ t: new Date().toISOString(), msg });
  const label = (sc: VlogSceneState) => production.scenes?.[sc.idx]?.titre ?? `Scène ${sc.idx + 1}`;

  const { data: avatar } = await supabase.from("avatars").select("eleven_voice_id").eq("id", item.avatar_id).single();
  const voiceId = avatar?.eleven_voice_id ?? null;

  // Univers de lieux (décors récurrents) — pour composer visage + lieu.
  const { data: locRows } = await supabase.from("avatar_locations").select("key, description, ref_image_url").eq("avatar_id", item.avatar_id);
  const locations = new Map((locRows ?? []).map((l) => [l.key as string, l as { key: string; description: string; ref_image_url: string | null }]));

  let changed = false;

  // 1) Sonde les générations en vol (soul / video).
  for (const sc of scenes) {
    if (sc.phase !== "soul" && sc.phase !== "video") continue;
    const def = production.scenes?.[sc.idx] ?? {};

    const result = await hfPoll(String(sc.hf_job_id));
    if (result.status === "processing") continue;

    if (result.status === "failed") {
      sc.phase = "failed";
      sc.error = result.error ?? "génération échouée";
      say(`❌ ${label(sc)} : échec (${sc.error})`);
      changed = true;
      continue;
    }

    if (sc.phase === "soul") {
      // Image prête → voix de la scène, puis attend un créneau pour la vidéo.
      sc.keyframe_url = result.imageUrl;
      say(`🖼️ ${label(sc)} : image prête`);
      const texte = String(def.texte ?? "").trim();
      if (voiceId && texte && !sc.audio_url) {
        try {
          sc.audio_url = await ttsToStorage(voiceId, texte, `${item.avatar_id}/${id}/scene${sc.idx}.wav`);
          say(`🎙️ ${label(sc)} : voix générée`);
        } catch (err) {
          say(`⚠️ ${label(sc)} : voix impossible (${String((err as Error)?.message ?? err).slice(0, 80)}) — plan muet`);
        }
      }
      sc.phase = sc.keyframe_url ? "soul_done" : "failed";
      if (!sc.keyframe_url) sc.error = "image manquante";
      changed = true;
    } else {
      // Clip prêt.
      sc.clip_url = result.videoUrl;
      sc.phase = sc.clip_url ? "done" : "failed";
      if (!sc.clip_url) sc.error = "clip manquant";
      say(sc.clip_url ? `✅ ${label(sc)} : clip prêt` : `❌ ${label(sc)} : clip manquant`);
      changed = true;
    }
  }

  // 2) Régulateur : soumet les étapes suivantes tant qu'il reste des créneaux.
  const trySubmit = async (sc: VlogSceneState, fn: () => Promise<string>, okMsg: string): Promise<boolean> => {
    try {
      sc.hf_job_id = await fn();
      sc.submit_attempts = 0;
      say(okMsg);
      changed = true;
      return true;
    } catch (err) {
      if (isConcurrencyError(err)) return false; // file pleine → on retentera au prochain passage
      sc.submit_attempts = (sc.submit_attempts ?? 0) + 1;
      if (sc.submit_attempts >= 6) {
        sc.phase = "failed";
        sc.error = String((err as Error)?.message ?? err).slice(0, 200);
        say(`❌ ${label(sc)} : abandon (${sc.error.slice(0, 80)})`);
      }
      changed = true;
      return false;
    }
  };

  let inflight = scenes.filter((s) => s.phase === "soul" || s.phase === "video").length;

  // PAUSE VALIDATION : si l'utilisateur doit approuver les images, on s'arrête
  // dès que tous les keyframes sont prêts (aucune animation n'est payée avant son OK).
  const needsApproval = item.payload.approve_images === true && item.assets.images_approved !== true;
  if (needsApproval) {
    const pendingImages = scenes.some((s) => s.phase === "waiting" || s.phase === "soul");
    if (!pendingImages) {
      if (!item.assets.awaiting_approval) {
        say(`⏸️ Images prêtes — en attente de ta validation avant l'animation`);
        await mergeAssets(id, { scenes, log, awaiting_approval: true });
      } else if (changed) {
        await mergeAssets(id, { scenes, log });
      }
      return; // on ne réenfile pas : la reprise se fait à la validation
    }
  }

  // Priorité aux scènes dont l'image est prête (animation / lip-sync)…
  for (const sc of scenes) {
    if (inflight >= MAX_INFLIGHT) break;
    if (needsApproval) break; // rien n'est animé tant que les images ne sont pas validées
    if (sc.phase !== "soul_done") continue;
    const def = production.scenes?.[sc.idx] ?? {};
    const texte = String(def.texte ?? "").trim();
    const motion = String(def.motion_prompt ?? "natural subtle movement, cinematic handheld camera");
    const ok = def.mode === "talk" && sc.audio_url
      ? await trySubmit(sc, () => submitSpeak(sc.keyframe_url!, sc.audio_url!, motion, speakDuration(texte)), `🗣️ ${label(sc)} : lip-sync en cours (elle parle)`)
      : await trySubmit(sc, () => submitImageToVideo(sc.keyframe_url!, motion, videoModel), `🎥 ${label(sc)} : animation en cours`);
    if (ok) { sc.phase = "video"; inflight++; }
  }

  // …puis on lance les images des scènes en attente.
  // Priorité au compositeur multi-références (GPT Image : visage + lieu → même perso, même décor),
  // sinon fallback Soul (référence visage seule). 1 seule composition OpenAI par passage (appel long).
  let composedThisPass = false;
  for (const sc of scenes) {
    if (sc.phase !== "waiting") continue;
    const def = production.scenes?.[sc.idx] ?? {};
    const loc = def.location_key ? locations.get(def.location_key) : undefined;

    if (!composedThisPass && openAiImageConfigured() && faceRefs.length > 0 && loc?.ref_image_url) {
      // Composition GPT Image : visage (image 1) + lieu (image 2) + action.
      composedThisPass = true;
      try {
        const n = faceRefs.length;
        const prompt = [
          n > 1
            ? `Photorealistic vertical 9:16 photo. The first ${n} images are the SAME woman from different angles — reproduce her face, hair and features exactly. The last image is the location: keep the SAME place (identical walls, furniture, layout, light).`
            : `Photorealistic vertical 9:16 photo. Compose: the SAME young woman as in image 1 (identical face, hair, features), inside the SAME place as in image 2 (identical walls, furniture, layout, light).`,
          `Scene: ${def.soul_prompt ?? "candid lifestyle moment"}.`,
          `Location details: ${loc.description}.`,
          `Full scene framing, NOT a tight face close-up. Candid, natural light, real camera, film look, high detail.`,
        ].join(" ");
        const { imageUrl } = await composeKeyframe(faceRefs, loc.ref_image_url, prompt, `${item.avatar_id}/${id}/key${sc.idx}-${Date.now()}`);
        sc.keyframe_url = imageUrl;
        sc.phase = "soul_done";
        say(`🖼️ ${label(sc)} : image composée (visage + lieu)`);
        // Voix de la scène dans la foulée.
        const texte = String(def.texte ?? "").trim();
        if (voiceId && texte && !sc.audio_url) {
          try {
            sc.audio_url = await ttsToStorage(voiceId, texte, `${item.avatar_id}/${id}/scene${sc.idx}.wav`);
            say(`🎙️ ${label(sc)} : voix générée`);
          } catch { say(`⚠️ ${label(sc)} : voix impossible — plan muet`); }
        }
        changed = true;
        continue;
      } catch (err) {
        say(`⚠️ ${label(sc)} : composition échouée (${String((err as Error)?.message ?? err).slice(0, 80)}) — bascule Soul`);
        changed = true;
        // on retombe sur Soul ci-dessous
      }
    }

    if (inflight >= MAX_INFLIGHT) continue;
    const locBrief = loc ? ` Location: ${loc.description}.` : "";
    const prompt = `Photorealistic vertical 9:16. ${def.soul_prompt ?? "candid lifestyle moment"}.${locBrief} The same young woman as the reference. Full scene framing, NOT a tight face close-up. Candid, natural light, real camera, film look, high detail.`;
    const ok = await trySubmit(sc, () => submitSoulKeyframe(prompt, refImage), `🎬 ${label(sc)} : image en génération (Soul)`);
    if (ok) { sc.phase = "soul"; inflight++; }
  }

  const done = scenes.filter((s) => s.phase === "done");
  const failed = scenes.filter((s) => s.phase === "failed");
  const pending = scenes.length - done.length - failed.length;

  if (pending === 0) {
    if (done.length === 0) {
      await mergeAssets(id, { scenes, log });
      throw new Error("vlog: toutes les scènes ont échoué");
    }
    // Dernier contrôle avant l'étape longue (l'utilisateur a pu annuler entre-temps).
    const { data: fresh } = await supabase.from("content_items").select("status").eq("id", id).single();
    if (fresh?.status === "failed") {
      logger.info("vlog_canceled_before_assembly", { itemId: id });
      return;
    }

    // Montage final (les scènes réussies, dans l'ordre).
    say(`🎞️ Montage de ${done.length} scène(s)…`);
    await mergeAssets(id, { scenes, log, assembling: true });
    const ordered = done.sort((a, b) => a.idx - b.idx);
    const buf = await assembleVlog(
      ordered.map((s) => ({
        clipUrl: String(s.clip_url),
        // Voix-off posée au montage seulement pour les scènes non parlées (talk = audio déjà dans le clip).
        audioUrl: production.scenes?.[s.idx]?.mode === "talk" ? null : (s.audio_url ?? null),
      })),
    );
    const videoUrl = await uploadBytes(`${item.avatar_id}/${id}/vlog.mp4`, buf, "video/mp4");
    say(`🏁 Vlog terminé (${done.length} scènes${failed.length ? `, ${failed.length} abandonnée(s)` : ""})`);
    await mergeAssets(id, { scenes, log, assembling: false, video_url: videoUrl, image_url: ordered[0]?.keyframe_url ?? null });
    await advance(job);
    return;
  }

  if (changed) await mergeAssets(id, { scenes, log });

  const polls = Number(job.payload.poll_attempts ?? 0) + 1;
  if (polls > MAX_POLLS * 2) throw new Error("vlog: timeout (rendu trop long)");
  await enqueue("poll_video", { ...job.payload, poll_attempts: polls }, { contentItemId: id, runAfterMs: 12_000 });
}
