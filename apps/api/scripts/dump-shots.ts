/**
 * Liste les dernières vidéos avec leurs plans (rôle, phase, clip) — pour retrouver un rendu.
 *   pnpm --filter @viralya/api exec tsx scripts/dump-shots.ts [n]
 */
import { supabase } from "../src/supabase";

const n = Number(process.argv[2]) || 5;
const { data, error } = await supabase
  .from("content_items")
  .select("id, avatar_id, title, status, created_at, assets, payload")
  .eq("type", "video")
  .order("created_at", { ascending: false })
  .limit(n);
if (error) throw new Error(error.message);
for (const row of data ?? []) {
  const a = (row.assets ?? {}) as Record<string, unknown>;
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const shots = (a.shots as Array<Record<string, unknown>> | undefined) ?? [];
  console.log(`\n=== ${row.created_at} ${row.status} « ${row.title} » ${row.id}`);
  console.log(`    avatar=${row.avatar_id} format=${p.format} single_take=${p.single_take} cuts=${p.cuts} res=${p.resolution} subtitles=${p.subtitles} music=${p.music}`);
  console.log(`    video=${a.video_url ?? "-"} v${a.video_version ?? "-"} ${a.video_seconds ?? "-"}s inserts=${a.inserts_count ?? "-"} music_mixed=${a.music_mixed ?? "-"}`);
  for (const s of shots) {
    console.log(`    plan ${s.idx} ${s.role} ${s.phase} ${s.provider ?? ""} dur=${s.duration}s audio=${s.audio_seconds ?? "-"}s clip=${s.clip_url ?? "-"} inserts=${(s.inserts as unknown[] | undefined)?.length ?? 0}`);
  }
}
process.exit(0);
