import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { logger } from "../logger";

// Montage vidéo local (ffmpeg-static) : normalise chaque scène puis assemble le vlog.
// Format cible : 1080x1920 (9:16), 30 fps, H.264 + AAC — prêt pour TikTok/Reels.

const FF = ffmpegPath as unknown as string;

function ff(args: string[], timeoutMs = 300_000, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FF, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...(cwd ? { cwd } : {}) }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${String(stderr).split("\n").slice(-6).join(" ").slice(0, 500)}`));
      else resolve();
    });
  });
}

/** Durée (s) et présence d'une piste audio, lues dans la sortie de `ffmpeg -i` (pas de ffprobe dans ffmpeg-static). */
async function probe(file: string): Promise<{ seconds: number; hasAudio: boolean }> {
  return new Promise((resolve) => {
    execFile(FF, ["-hide_banner", "-i", file], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (_err, _out, stderr) => {
      const s = String(stderr);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
      const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
      resolve({ seconds, hasAudio: /Stream #\d+:\d+.*Audio:/.test(s) });
    });
  });
}

/** Une image JPEG extraite d'une vidéo (contrôle du visage d'un plan parlé). */
export async function frameFromVideo(url: string, atSec = 1): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-frame-"));
  try {
    const src = join(dir, "in.mp4");
    const dst = join(dir, "frame.jpg");
    await download(url, src);
    await ff(["-y", "-ss", String(atSec), "-i", src, "-frames:v", "1", "-q:v", "3", dst], 60_000);
    return await readFile(dst);
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}: ${url.slice(0, 120)}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Ré-encode une image en JPEG (≈10x plus léger qu'un PNG) avec largeur max optionnelle. */
export async function toJpeg(image: Buffer, maxWidth?: number, quality = 4): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-img-"));
  try {
    const src = join(dir, "in.bin");
    const dst = join(dir, "out.jpg");
    await writeFile(src, image);
    const vf = maxWidth ? ["-vf", `scale='min(${maxWidth},iw)':-2`] : [];
    await ff(["-y", "-i", src, ...vf, "-q:v", String(quality), dst], 60_000);
    return await readFile(dst);
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Agrandissement en Lanczos (plus net que le bicubique par défaut quand la source est en 720p / 3:4).
const V_NORM = "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,format=yuv420p";
const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"];

/**
 * Colle les segments Seedance (audio natif inclus) en un seul MP4 vertical 1080x1920.
 * Chaque segment est normalisé (même format/codecs) puis concat sans ré-encodage.
 */
export async function concatClips(clipUrls: string[]): Promise<Buffer> {
  if (clipUrls.length === 0) throw new Error("concat: aucun clip");
  const dir = await mkdtemp(join(tmpdir(), "viralya-vlog-"));
  try {
    const parts: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const clip = join(dir, `clip${i}.mp4`);
      const out = join(dir, `part${i}.mp4`);
      await download(clipUrls[i]!, clip);
      try {
        await ff(["-y", "-i", clip, "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "0:a", ...ENC, out]);
      } catch {
        // Clip muet → piste silencieuse (le concat exige 1 piste audio partout).
        await ff([
          "-y", "-i", clip, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "1:a", "-shortest", ...ENC, out,
        ]);
      }
      parts.push(out);
      logger.info("vlog_segment_normalized", { i });
    }

    const list = join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const final = join(dir, "final.mp4");
    await ff(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final]);
    return await readFile(final);
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Montage hybride (vidéo v2) ───────────────────────────────
// Plans parlés (avatar + voix ElevenLabs déjà dans le clip) et plans b-roll muets
// sur lesquels on mixe la voix off (ambiance Seedance conservée à −16 dB). Le clip
// b-roll est prolongé (dernière image figée) si la narration est plus longue.
// Conventions Reels 2026 (recherche du 4 sept.) appliquées ici :
//   - inserts photo (Ken Burns) incrustés PENDANT la parole pour un changement visuel ≤ 3 s ;
//   - sous-titres KARAOKÉ mot à mot (Poppins ExtraBold, surlignage jaune, zone sûre
//     TikTok/Reels : bas du texte à ~1220 px, marge droite pour la colonne d'icônes) ;
//   - musique de fond instrumentale ≈ −17 dB sous la voix, fondu de sortie ;
//   - léger grain temporel + contraste (anti « image trop propre », effet non mesuré).
// Chaque finition est optionnelle et jamais bloquante : sans police, sans musique, on livre quand même.

const here = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(here, "../../assets/fonts");
const CAPTION_FONT = "Poppins ExtraBold";
const CAPTION_FONT_FILE = "Poppins-ExtraBold.ttf";
// Grain « pellicule » : effet anti-IA non prouvé, et sur une source molle il se lit comme de la
// mauvaise qualité (retour utilisateur du 4 sept.) → désactivé par défaut (payload.film_look = true pour l'activer).
const FILM_LOOK = "noise=alls=7:allf=t,eq=contrast=1.03:saturation=0.97";
const MUSIC_GAIN = 0.14; // ≈ −17 dB : la voix reste devant
// Encodage final : CRF 21, plafond 12 Mbit/s (TikTok/Instagram ré-encodent autour de 5-10 Mbit/s).
const FINAL_ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"];

export interface HybridInsert { url: string; at: number; len: number }

export interface HybridPart {
  role: "talk" | "broll";
  clipUrl: string;
  /** Voix off à mixer (b-roll uniquement). */
  voiceUrl?: string | null;
  voiceSeconds?: number | null;
  /** Mots horodatés de la réplique (relatifs au début du plan) → sous-titres. */
  words?: Array<{ w: string; s: number; e: number }> | null;
  /** Inserts photo (plans parlés) : image + position/durée dans le plan. */
  inserts?: HybridInsert[] | null;
}

export interface SubtitleCue { start: number; end: number; text: string; words: Array<{ w: string; s: number; e: number }> }

/** Regroupe les mots en courtes lignes (≤ 4 mots / ≤ 26 caractères), décalées de `offset` ; temps absolus. */
export function cuesFromWords(rawWords: Array<{ w: string; s: number; e: number }>, offset: number, maxSeconds: number): SubtitleCue[] {
  // Typographie française : « Coucou ! » arrive comme deux jetons → la ponctuation rejoint le mot précédent.
  const words: Array<{ w: string; s: number; e: number }> = [];
  for (const w of rawWords) {
    const prev = words[words.length - 1];
    if (prev && /^[^\p{L}\p{N}]+$/u.test(w.w)) { prev.w += w.w; prev.e = Math.max(prev.e, w.e); continue; }
    words.push({ ...w });
  }
  const cues: SubtitleCue[] = [];
  let buf: typeof words = [];
  const flush = () => {
    if (!buf.length) return;
    const start = offset + buf[0]!.s;
    const end = Math.min(offset + maxSeconds, offset + buf[buf.length - 1]!.e + 0.15);
    if (end > start) cues.push({ start, end, text: buf.map((x) => x.w).join(" "), words: buf.map((x) => ({ w: x.w, s: offset + x.s, e: offset + x.e })) });
    buf = [];
  };
  for (const w of words) {
    if (w.s > maxSeconds) break;
    buf.push(w);
    const text = buf.map((x) => x.w).join(" ");
    if (buf.length >= 4 || text.length >= 26 || /[.!?…]$/.test(w.w)) flush();
  }
  flush();
  // Une ligne reste affichée jusqu'à la suivante quand le trou est court (pas de clignotement).
  for (let i = 0; i + 1 < cues.length; i++) {
    const gap = cues[i + 1]!.start - cues[i]!.end;
    if (gap > 0 && gap < 0.5) cues[i]!.end = cues[i + 1]!.start;
  }
  return cues;
}

const assTime = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

/** ASS karaoké : chaque mot passe du blanc (SecondaryColour) au jaune (PrimaryColour) quand il est dit. */
function buildAss(cues: SubtitleCue[]): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
  const line = (c: SubtitleCue) => {
    const lead = c.words.length && c.words[0]!.s > c.start + 0.01 ? `{\\k${Math.round((c.words[0]!.s - c.start) * 100)}}` : "";
    const syl = c.words.map((w, i) => {
      const next = i + 1 < c.words.length ? c.words[i + 1]!.s : c.end;
      return `{\\k${Math.max(1, Math.round((next - w.s) * 100))}}${esc(w.w)}`;
    });
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Kar,,0,0,0,,${lead}${syl.join(" ")}`;
  };
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "LayoutResX: 1080",
    "LayoutResY: 1920",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Jaune &H0000E5FF (BBGGRR), blanc au repos, contour noir 11 px, bas du texte à 1920-700 = 1220 px.
    `Style: Kar,${CAPTION_FONT},100,&H0000E5FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,11,0,2,100,190,700,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(line),
    "",
  ].join("\n");
}

/** Clip « Ken Burns » (zoom lent) de `len` s à partir d'une image, 1080x1920, muet. */
async function kenBurns(imageUrl: string, len: number, dst: string, dir: string, tag: string): Promise<void> {
  const img = join(dir, `${tag}.img`);
  await download(imageUrl, img);
  const frames = Math.max(30, Math.round(len * 30));
  const vf = `scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=z='min(1+0.0025*on,1.18)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p`;
  await ff(["-y", "-i", img, "-vf", vf, "-frames:v", String(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", dst], 120_000);
}

/** Incruste les inserts photo sur un plan parlé normalisé (l'audio du plan est conservé). */
async function overlayInserts(src: string, inserts: HybridInsert[], dir: string, i: number): Promise<string> {
  const clips: string[] = [];
  for (let k = 0; k < inserts.length; k++) {
    const p = join(dir, `ins${i}-${k}.mp4`);
    await kenBurns(inserts[k]!.url, inserts[k]!.len, p, dir, `ins${i}-${k}`);
    clips.push(p);
  }
  let chain = "";
  let cur = "0:v";
  inserts.forEach((ins, k) => {
    const at = ins.at.toFixed(2);
    const end = (ins.at + ins.len).toFixed(2);
    chain += `[${k + 1}:v]setpts=PTS+${at}/TB[i${k}];[${cur}][i${k}]overlay=eof_action=pass:enable='between(t,${at},${end})'[v${k}];`;
    cur = `v${k}`;
  });
  const out = join(dir, `part${i}-ins.mp4`);
  await ff(["-y", "-i", src, ...clips.flatMap((c) => ["-i", c]), "-filter_complex", chain.slice(0, -1), "-map", `[${cur}]`, "-map", "0:a", ...ENC, out]);
  return out;
}

export interface AssembleOptions {
  subtitles?: boolean;
  musicUrl?: string | null;
  filmLook?: boolean;
  /**
   * Mentions légales incrustées PENDANT TOUTE la vidéo (loi 2023-451 : « Collaboration commerciale »
   * lisible dès le début ; AI Act art. 50 / ARPP : « Images virtuelles », « Contenu généré par IA »).
   * `top` sous la zone d'interface (y ≈ 300 px), `bottom` au-dessus de la zone basse (y ≈ 1 180 px).
   */
  labels?: { top?: string | null; bottom?: string | null } | null;
}

/** Piste ASS des mentions légales : petite police, fond semi-opaque, toute la durée. */
function buildLabelsAss(labels: { top?: string | null; bottom?: string | null }, seconds: number): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
  const end = assTime(Math.max(0.5, seconds));
  const events: string[] = [];
  if (labels.top) events.push(`Dialogue: 1,0:00:00.00,${end},LabelTop,,0,0,0,,${esc(labels.top)}`);
  if (labels.bottom) events.push(`Dialogue: 1,0:00:00.00,${end},LabelBottom,,0,0,0,,${esc(labels.bottom)}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "LayoutResX: 1080", "LayoutResY: 1920", "ScaledBorderAndShadow: yes", "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // BorderStyle 3 = boîte opaque (BackColour), lisible sur tout fond ; alignement 8 = haut centre, 2 = bas centre.
    `Style: LabelTop,${CAPTION_FONT},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,-1,0,0,0,100,100,1,0,3,10,0,8,60,60,300,1`,
    `Style: LabelBottom,${CAPTION_FONT},34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,0,0,0,0,100,100,1,0,3,8,0,2,60,60,740,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events, "",
  ].join("\n");
}

export async function assembleHybrid(
  parts: HybridPart[],
  opts: AssembleOptions = {},
): Promise<{ video: Buffer; seconds: number; subtitled: boolean; music: boolean; inserts: number; cues: SubtitleCue[] }> {
  if (parts.length === 0) throw new Error("montage: aucun plan");
  const dir = await mkdtemp(join(tmpdir(), "viralya-hybrid-"));
  try {
    const normalized: string[] = [];
    const cues: SubtitleCue[] = [];
    let offset = 0;
    let insertsDone = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const clip = join(dir, `clip${i}.mp4`);
      let out = join(dir, `part${i}.mp4`);
      await download(p.clipUrl, clip);
      const info = await probe(clip);

      if (p.role === "broll" && p.voiceUrl) {
        const voice = join(dir, `voice${i}.mp3`);
        await download(p.voiceUrl, voice);
        const voiceSec = p.voiceSeconds ?? (await probe(voice)).seconds;
        const pad = Math.max(0, voiceSec + 0.4 - info.seconds);
        const vf = `[0:v]${V_NORM}${pad > 0.05 ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}` : ""}[v]`;
        const af = info.hasAudio
          ? `[0:a]volume=0.16[bg];[1:a][bg]amix=inputs=2:duration=longest:dropout_transition=0,volume=1.6[a]`
          : `[1:a]anull[a]`;
        await ff(["-y", "-i", clip, "-i", voice, "-filter_complex", `${vf};${af}`, "-map", "[v]", "-map", "[a]", ...ENC, out]);
      } else if (info.hasAudio) {
        await ff(["-y", "-i", clip, "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "0:a", ...ENC, out]);
      } else {
        await ff([
          "-y", "-i", clip, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "1:a", "-shortest", ...ENC, out,
        ]);
      }

      if (p.role === "talk" && p.inserts?.length) {
        try {
          out = await overlayInserts(out, p.inserts, dir, i);
          insertsDone += p.inserts.length;
        } catch (err) {
          logger.warn("hybrid_inserts_failed", { i, err: String((err as Error)?.message ?? err) });
        }
      }

      const done = await probe(out);
      if (p.words?.length) cues.push(...cuesFromWords(p.words, offset, done.seconds));
      offset += done.seconds;
      normalized.push(out);
      logger.info("hybrid_part_normalized", { i, role: p.role, seconds: done.seconds, inserts: p.inserts?.length ?? 0 });
    }

    const list = join(dir, "list.txt");
    await writeFile(list, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    await ff(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", join(dir, "joined.mp4")]);

    // Finition en une passe : grain + sous-titres karaoké + musique de fond.
    let music = false;
    if (opts.musicUrl) {
      try {
        await download(opts.musicUrl, join(dir, "music.mp3"));
        music = true;
      } catch (err) {
        logger.warn("hybrid_music_download_failed", { err: String((err as Error)?.message ?? err) });
      }
    }
    const wantSubs = opts.subtitles !== false && cues.length > 0;
    const wantLabels = !!(opts.labels?.top || opts.labels?.bottom);
    if (wantSubs || wantLabels) {
      await mkdir(join(dir, "fonts"), { recursive: true });
      await copyFile(join(FONTS_DIR, CAPTION_FONT_FILE), join(dir, "fonts", CAPTION_FONT_FILE)).catch((err) =>
        logger.warn("caption_font_missing", { dir: FONTS_DIR, err: String((err as Error)?.message ?? err) }),
      );
      if (wantSubs) await writeFile(join(dir, "subs.ass"), buildAss(cues), "utf8");
      if (wantLabels) await writeFile(join(dir, "labels.ass"), buildLabelsAss(opts.labels!, offset), "utf8");
    }
    const film = opts.filmLook === true ? `${FILM_LOOK},` : "";
    const finish = async (withSubs: boolean, withMusic: boolean) => {
      // Chemins relatifs (cwd = dossier temporaire) : le filtre subtitles n'aime pas les chemins Windows.
      const overlays = [wantLabels ? "subtitles=labels.ass:fontsdir=fonts" : "", withSubs ? "subtitles=subs.ass:fontsdir=fonts" : ""].filter(Boolean).join(",");
      const vf = `[0:v]${film}${overlays || "null"}[v]`;
      const af = withMusic
        ? `[1:a]volume=${MUSIC_GAIN},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, offset - 1.5).toFixed(2)}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
        : "[0:a]anull[a]";
      await ff(["-y", "-i", "joined.mp4", ...(withMusic ? ["-i", "music.mp3"] : []), "-filter_complex", `${vf};${af}`, "-map", "[v]", "-map", "[a]", ...FINAL_ENC, "final.mp4"], 300_000, dir);
    };
    let finalPath = join(dir, "joined.mp4");
    let subtitled = false;
    let musicMixed = false;
    const attempts: Array<[boolean, boolean]> = [[wantSubs, music], [false, music], [wantSubs, false], [false, false]];
    for (const [s, m] of attempts) {
      if (s && !wantSubs) continue;
      if (m && !music) continue;
      try {
        await finish(s, m);
        finalPath = join(dir, "final.mp4");
        subtitled = s;
        musicMixed = m;
        break;
      } catch (err) {
        logger.warn("hybrid_finish_failed", { subtitles: s, music: m, err: String((err as Error)?.message ?? err) });
      }
    }
    return { video: await readFile(finalPath), seconds: Math.round(offset * 100) / 100, subtitled, music: musicMixed, inserts: insertsDone, cues };
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
