/**
 * Test HORS LIGNE du montage hybride (0 $ de génération) : réutilise les clips d'un
 * contenu déjà produit (JSON exporté de GET /content/:id) et vérifie inserts photo,
 * sous-titres karaoké, musique de fond et grain.
 *   pnpm --filter @viralya/api exec tsx scripts/test-montage.ts <item.json> <musique.mp3> <sortie.mp4>
 */
import { readFile, writeFile } from "node:fs/promises";
import { assembleHybrid, type HybridPart } from "../src/lib/ffmpeg";
import { uploadBytes } from "../src/lib/storage";
import { planInserts, type InsertState, type ShotState } from "../src/pipeline/hybrid";
import { supabase } from "../src/supabase";

const [jsonPath, musicPath, outPath] = process.argv.slice(2);
if (!jsonPath || !musicPath || !outPath) throw new Error("usage: test-montage.ts <item.json> <musique.mp3> <sortie.mp4>");

const item = JSON.parse(await readFile(jsonPath, "utf8")).item as { avatar_id: string; assets: { shots: ShotState[] } };
const shots = item.assets.shots.filter((s) => s.phase === "done" && s.clip_url).sort((a, b) => a.idx - b.idx);
if (!shots.length) throw new Error("aucun plan abouti dans ce contenu");

const musicUrl = await uploadBytes("bench/music/test-bed-15s.mp3", await readFile(musicPath), "audio/mpeg");
const { data: loc } = await supabase.from("avatar_locations").select("ref_image_url").eq("avatar_id", item.avatar_id).eq("key", "seville-santa-cruz-street-ziunc").maybeSingle();

const parts: HybridPart[] = shots.map((s) => {
  let inserts: HybridPart["inserts"] = null;
  if (s.role === "talk" && s.words?.length) {
    const cands: InsertState[] = [
      { anchor: "ruelles de Santa Cruz", framing: "location", url: (loc?.ref_image_url as string) ?? null },
      { anchor: "murs jaunes", framing: "close", url: s.keyframe_url ?? null },
    ];
    inserts = planInserts(s.words, cands, s.audio_seconds ?? s.duration);
    console.log("inserts planifiés :", cands.map((c) => ({ anchor: c.anchor, at: c.at, len: c.len, error: c.error })));
  }
  return { role: s.role, clipUrl: String(s.clip_url), voiceUrl: s.role === "broll" ? s.audio_url ?? null : null, voiceSeconds: s.audio_seconds ?? null, words: s.words ?? null, inserts };
});

const t0 = Date.now();
const r = await assembleHybrid(parts, { subtitles: true, musicUrl, filmLook: true });
await writeFile(outPath, r.video);
console.log(`montage OK en ${((Date.now() - t0) / 1000).toFixed(0)} s — ${r.seconds} s, sous-titres ${r.subtitled}, musique ${r.music}, inserts ${r.inserts}, ${r.cues.length} lignes, ${(r.video.length / 1e6).toFixed(1)} Mo`);
console.log("1re ligne karaoké :", JSON.stringify(r.cues[0]));
process.exit(0);
