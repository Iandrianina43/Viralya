/**
 * Remonte la vidéo finale d'un contenu hybride à partir des plans DÉJÀ rendus (aucun appel Seedance,
 * seulement ffmpeg en local) — nouvelle version video-vN.mp4, l'ancienne reste en ligne.
 *   pnpm --filter @viralya/api exec tsx scripts/reassemble.ts <content_id> [--no-inserts] [--no-music] [--subtitles]
 */
import { assembleHybrid, type HybridPart } from "../src/lib/ffmpeg";
import { uploadBytes } from "../src/lib/storage";
import { planInserts, type ShotState } from "../src/pipeline/hybrid";
import { mergeAssets } from "../src/pipeline/pipelines";
import { supabase } from "../src/supabase";

const [id, ...flags] = process.argv.slice(2);
if (!id) throw new Error("usage: reassemble.ts <content_id> [--no-inserts] [--no-music] [--subtitles]");
const noInserts = flags.includes("--no-inserts");
const noMusic = flags.includes("--no-music");
const subtitles = flags.includes("--subtitles");

const { data: item, error } = await supabase.from("content_items").select("id, avatar_id, title, assets, payload").eq("id", id).single();
if (error || !item) throw new Error(`contenu introuvable : ${error?.message}`);
const assets = (item.assets ?? {}) as Record<string, unknown>;
const payload = (item.payload ?? {}) as Record<string, unknown>;
const shots = ((assets.shots as ShotState[] | undefined) ?? []).filter((s) => s.phase === "done" && s.clip_url).sort((a, b) => a.idx - b.idx);
if (!shots.length) throw new Error("aucun plan rendu pour ce contenu");

const parts: HybridPart[] = shots.map((s) => ({
  role: s.role,
  clipUrl: String(s.clip_url),
  voiceUrl: s.role === "broll" && !s.native_voice ? s.audio_url ?? null : null,
  voiceSeconds: s.audio_seconds ?? null,
  words: s.words ?? null,
  inserts: !noInserts && s.role === "talk" && s.inserts?.length && s.words?.length ? planInserts(s.words, s.inserts, s.native_voice ? s.duration : s.audio_seconds ?? s.duration) : null,
}));
const musicUrl = !noMusic && typeof assets.music_url === "string" ? assets.music_url : null;
const labels = payload.labels && typeof payload.labels === "object" ? (payload.labels as { top?: string | null; bottom?: string | null }) : null;
console.log(`« ${item.title} » : montage de ${parts.length} plan(s) — inserts=${!noInserts} musique=${!!musicUrl} sous-titres=${subtitles}`);

const { video, seconds, subtitled, music, inserts } = await assembleHybrid(parts, { subtitles, musicUrl, filmLook: payload.film_look === true, labels });
const version = Number(assets.video_version ?? 0) + 1;
const url = await uploadBytes(`${item.avatar_id}/${id}/video-v${version}.mp4`, video, "video/mp4");
const log = Array.isArray(assets.log) ? (assets.log as Array<{ t: string; msg: string }>) : [];
log.push({ t: new Date().toISOString(), msg: `🎞️ Remontage v${version}${noInserts ? " sans inserts" : ""}${noMusic ? " sans musique" : ""} (${seconds.toFixed(0)} s)` });
await mergeAssets(id, { log, video_url: url, video_version: version, video_seconds: seconds, subtitled, music_mixed: music, inserts_count: inserts });
console.log(`v${version} ${seconds.toFixed(1)} s → ${url}`);
process.exit(0);
