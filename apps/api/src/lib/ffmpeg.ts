import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { logger } from "../logger";

// Montage vidéo local (ffmpeg-static) : normalise chaque scène puis assemble le vlog.
// Format cible : 1080x1920 (9:16), 30 fps, H.264 + AAC — prêt pour TikTok/Reels.

const FF = ffmpegPath as unknown as string;

function ff(args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FF, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${String(stderr).split("\n").slice(-6).join(" ").slice(0, 500)}`));
      else resolve();
    });
  });
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

/** Convertit un audio (mp3…) en WAV 44.1kHz stéréo — requis par Higgsfield Speak. */
export async function toWav(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-audio-"));
  try {
    const src = join(dir, "in.bin");
    const dst = join(dir, "out.wav");
    await writeFile(src, audio);
    await ff(["-y", "-i", src, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", dst], 60_000);
    return await readFile(dst);
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface SceneInput {
  clipUrl: string; // clip vidéo de la scène (parlé = audio inclus ; ambiance = muet)
  audioUrl?: string | null; // voix-off à poser sur la scène (mode voiceover)
}

const V_NORM = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p";
const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"];

/** Assemble les scènes en un seul MP4 (Buffer). */
export async function assembleVlog(scenes: SceneInput[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-vlog-"));
  try {
    const parts: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!;
      const clip = join(dir, `clip${i}.mp4`);
      const out = join(dir, `part${i}.mp4`);
      await download(s.clipUrl, clip);

      if (s.audioUrl) {
        // Scène voix-off : la durée = la voix (tpad clone la dernière image si la voix dépasse le clip).
        const audio = join(dir, `audio${i}.mp3`);
        await download(s.audioUrl, audio);
        await ff([
          "-y", "-i", clip, "-i", audio,
          "-filter_complex", `[0:v]${V_NORM},tpad=stop_mode=clone:stop_duration=20[v]`,
          "-map", "[v]", "-map", "1:a", "-shortest", ...ENC, out,
        ]);
      } else {
        // Scène parlée (audio embarqué) — normalisation simple.
        try {
          await ff(["-y", "-i", clip, "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "0:a", ...ENC, out]);
        } catch {
          // Clip muet → on pose une piste silencieuse (concat exige 1 piste audio partout).
          await ff([
            "-y", "-i", clip, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-filter_complex", `[0:v]${V_NORM}[v]`, "-map", "[v]", "-map", "1:a", "-shortest", ...ENC, out,
          ]);
        }
      }
      parts.push(out);
      logger.info("vlog_scene_normalized", { i, voiceover: !!s.audioUrl });
    }

    // Concat (mêmes codecs/params → demuxer concat sans ré-encodage).
    const list = join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const final = join(dir, "final.mp4");
    await ff(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final]);

    return await readFile(final);
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
