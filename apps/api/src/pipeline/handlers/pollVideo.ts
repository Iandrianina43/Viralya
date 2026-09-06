import type { VlogScene } from "../../domain/director";
import { buildSegmentPrompt } from "../../domain/director";
import { concatClips } from "../../lib/ffmpeg";
import { uploadBytes } from "../../lib/storage";
import { logger } from "../../logger";
import { piapiPoll, submitSeedanceSegment } from "../../providers/piapi";
import { enqueue, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, requireContentItemId, type ContentItemRow } from "../pipelines";
import { readSeedanceSettings, loadAvatarRefs, type SegmentState } from "./generateVideo";

// ─────────────────────────────────────────────────────────────
// SUIVI DU TOURNAGE SEEDANCE — chaîne SÉQUENTIELLE :
//   segment N en rendu → prêt → soumission du segment N+1 avec
//   @video1 = LE SEGMENT N EN ENTIER ("Extend the video @video1") →
//   … → tous prêts → concat ffmpeg → vidéo finale.
// Un seul segment en vol à la fois (l'extension exige le clip précédent).
// ─────────────────────────────────────────────────────────────

const POLL_MS = 15_000;
const MAX_POLLS_PER_SEGMENT = 60; // ~15 min par segment (les rendus Seedance prennent 2-8 min)
const MAX_SUBMIT_ATTEMPTS = 4;

// Rapatrie la vidéo dans le Storage (URL provider souvent éphémère).
async function persist(url: string, avatarId: string, itemId: string, name: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    return await uploadBytes(`${avatarId}/${itemId}/${name}`, await res.arrayBuffer(), "video/mp4");
  } catch (err) {
    logger.warn("video_persist_fallback", { itemId, err: String((err as Error)?.message ?? err) });
    return url;
  }
}

export async function pollVideoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);

  // Annulation demandée pendant la production → on arrête la chaîne ici.
  if (item.status === "failed" || item.status === "canceled") {
    logger.info("poll_video_canceled", { itemId: id });
    return;
  }

  const segments = (item.assets.segments ?? []) as SegmentState[];
  if (!segments.length) throw new Error("poll_video: segments manquants (generate_video n'a pas abouti)");

  const log: Array<{ t: string; msg: string }> = Array.isArray(item.assets.log) ? (item.assets.log as never[]) : [];
  const say = (msg: string) => log.push({ t: new Date().toISOString(), msg });

  const inflight = segments.find((s) => s.phase === "video");

  if (inflight) {
    await pollInflight(job, item, segments, inflight, log, say);
    return;
  }

  // Aucun segment en vol : soit un waiting à soumettre (reprise après erreur), soit fini.
  const nextWaiting = segments.find((s) => s.phase === "waiting");
  if (nextWaiting) {
    await submitNext(job, item, segments, nextWaiting, log, say);
    return;
  }
  await finalizeIfDone(job, item, segments, log, say);
}

async function pollInflight(
  job: JobRow,
  item: ContentItemRow,
  segments: SegmentState[],
  seg: SegmentState,
  log: Array<{ t: string; msg: string }>,
  say: (msg: string) => void,
): Promise<void> {
  const id = item.id;
  const result = await piapiPoll(String(seg.task_id));

  if (result.status === "processing") {
    const polls = Number(job.payload.poll_attempts ?? 0) + 1;
    if (polls > MAX_POLLS_PER_SEGMENT) throw new Error(`poll_video: timeout du segment ${seg.idx + 1} (rendu trop long)`);
    await enqueue("poll_video", { ...job.payload, poll_attempts: polls }, { contentItemId: id, runAfterMs: POLL_MS });
    return;
  }

  if (result.status === "failed") {
    // Rejet de modération ou erreur de rendu : on retente la soumission du même segment.
    seg.submit_attempts = (seg.submit_attempts ?? 0) + 1;
    if (seg.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
      seg.phase = "failed";
      seg.error = result.error ?? "rendu échoué";
      say(`❌ ${seg.titre} : abandon (${String(seg.error).slice(0, 100)})`);
      await mergeAssets(id, { segments, log });
      throw new Error(`seedance: segment ${seg.idx + 1} échoué (${seg.error})`);
    }
    seg.phase = "waiting";
    seg.task_id = undefined;
    say(`⚠️ ${seg.titre} : échec (${String(result.error ?? "?").slice(0, 80)}) — nouvel essai ${seg.submit_attempts}/${MAX_SUBMIT_ATTEMPTS - 1}`);
    await mergeAssets(id, { segments, log });
    await enqueue("poll_video", { ...job.payload, poll_attempts: 0 }, { contentItemId: id, runAfterMs: 10_000 });
    return;
  }

  // Segment prêt → on le rapatrie et on enchaîne.
  seg.clip_url = await persist(String(result.videoUrl), item.avatar_id, id, `segment${seg.idx}.mp4`);
  seg.phase = "done";
  say(`✅ ${seg.titre} : segment prêt (${seg.duration}s)`);
  await mergeAssets(id, { segments, log, image_url: item.assets.image_url ?? null });

  const next = segments.find((s) => s.phase === "waiting");
  if (next) {
    await submitNext(job, item, segments, next, log, say);
    return;
  }
  await finalizeIfDone(job, item, segments, log, say);
}

async function submitNext(
  job: JobRow,
  item: ContentItemRow,
  segments: SegmentState[],
  seg: SegmentState,
  log: Array<{ t: string; msg: string }>,
  say: (msg: string) => void,
): Promise<void> {
  const id = item.id;
  const refs = await loadAvatarRefs(item.avatar_id);
  const settings = readSeedanceSettings({ ...item.payload, ...(item.assets.seedance ?? {}) });
  const production = (item.payload.production ?? {}) as { scenes?: VlogScene[] };
  const scene = production.scenes?.[seg.idx] ?? fallbackScene(seg);

  // Décor de la scène : description canonique + image de référence (→ @image).
  let locationDescription: string | null = null;
  let locationImage: string | null = null;
  if (scene.location_key) {
    const { data: loc } = await supabase
      .from("avatar_locations")
      .select("description, ref_image_url")
      .eq("avatar_id", item.avatar_id)
      .eq("key", scene.location_key)
      .maybeSingle();
    locationDescription = loc?.description ?? null;
    locationImage = (loc?.ref_image_url as string) || null;
  }

  // Extension : LE SEGMENT PRÉCÉDENT EN ENTIER → @video1 ("Extend the video @video1").
  const prev = seg.idx > 0 ? segments[seg.idx - 1] : undefined;
  const prevClipUrl = prev?.clip_url ? String(prev.clip_url) : undefined;

  const prompt = buildSegmentPrompt({
    scene,
    isFirst: !prevClipUrl,
    refs: { hasSheet: refs.hasSheet, hasLocationImage: !!locationImage, voiceRefs: refs.audioUrls.length },
    locationDescription,
    city: refs.city,
  });

  try {
    const taskId = await submitSeedanceSegment({
      prompt,
      imageUrls: [...refs.imageUrls, ...(locationImage ? [locationImage] : [])],
      videoUrls: prevClipUrl ? [prevClipUrl] : undefined,
      audioUrls: refs.audioUrls,
      duration: seg.duration,
      resolution: settings.resolution,
      taskType: settings.taskType,
    });
    seg.phase = "video";
    seg.task_id = taskId;
    seg.prompt = prompt;
    say(`🎥 ${seg.titre} : ${prevClipUrl ? "extension du segment précédent en cours" : "tournage en cours"}`);
    await mergeAssets(id, { segments, log });
    await enqueue("poll_video", { ...job.payload, poll_attempts: 0 }, { contentItemId: id, runAfterMs: POLL_MS });
  } catch (err) {
    seg.submit_attempts = (seg.submit_attempts ?? 0) + 1;
    const msg = String((err as Error)?.message ?? err);
    if (seg.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
      seg.phase = "failed";
      seg.error = msg.slice(0, 200);
      say(`❌ ${seg.titre} : abandon (${msg.slice(0, 100)})`);
      await mergeAssets(id, { segments, log });
      throw new Error(`seedance: soumission du segment ${seg.idx + 1} impossible (${msg.slice(0, 150)})`);
    }
    say(`⚠️ ${seg.titre} : soumission échouée (${msg.slice(0, 80)}) — nouvel essai`);
    await mergeAssets(id, { segments, log });
    await enqueue("poll_video", { ...job.payload, poll_attempts: 0 }, { contentItemId: id, runAfterMs: 20_000 });
  }
}

async function finalizeIfDone(
  job: JobRow,
  item: ContentItemRow,
  segments: SegmentState[],
  log: Array<{ t: string; msg: string }>,
  say: (msg: string) => void,
): Promise<void> {
  const id = item.id;
  const done = segments.filter((s) => s.phase === "done").sort((a, b) => a.idx - b.idx);
  if (done.length === 0) {
    await mergeAssets(id, { segments, log });
    throw new Error("seedance: aucun segment abouti");
  }

  // Dernier contrôle avant l'étape longue (l'utilisateur a pu annuler entre-temps).
  const { data: fresh } = await supabase.from("content_items").select("status").eq("id", id).single();
  if (fresh?.status === "failed" || fresh?.status === "canceled") {
    logger.info("seedance_canceled_before_assembly", { itemId: id });
    return;
  }

  let videoUrl: string;
  if (done.length === 1) {
    videoUrl = String(done[0]!.clip_url);
  } else {
    say(`🎞️ Assemblage de ${done.length} segments…`);
    await mergeAssets(id, { segments, log, assembling: true });
    const buf = await concatClips(done.map((s) => String(s.clip_url)));
    videoUrl = await uploadBytes(`${item.avatar_id}/${id}/vlog.mp4`, buf, "video/mp4");
  }

  say(`🏁 Vidéo terminée (${done.length} segment(s))`);
  await mergeAssets(id, { segments, log, assembling: false, video_url: videoUrl });
  await advance(job);
}

function fallbackScene(seg: SegmentState): VlogScene {
  return {
    titre: seg.titre,
    mode: "voiceover",
    texte: "",
    duration_sec: seg.duration,
    action: "candid lifestyle moment, natural gestures",
    shots: [],
    scene_desc: "",
    camera: "medium-wide shot, natural handheld camera movement",
    lighting: "natural light, photorealistic cinematic vlog style",
    audio_ambiance: "natural ambient sound of the location",
    constraints: "",
  };
}
