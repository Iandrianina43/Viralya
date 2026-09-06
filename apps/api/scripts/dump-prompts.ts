/**
 * Affiche les derniers prompts Seedance réellement envoyés (assets.shots[].prompt) pour les auditer.
 *   pnpm --filter @viralya/api exec tsx scripts/dump-prompts.ts [n]
 */
import { supabase } from "../src/supabase";

const n = Number(process.argv[2]) || 3;
const { data, error } = await supabase
  .from("content_items")
  .select("id, title, status, created_at, assets, payload")
  .eq("type", "video")
  .order("created_at", { ascending: false })
  .limit(n);
if (error) throw new Error(error.message);
for (const row of data ?? []) {
  const assets = (row.assets ?? {}) as Record<string, unknown>;
  const shots = (assets.shots as Array<Record<string, unknown>> | undefined) ?? [];
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  console.log(`\n=== ${row.created_at} ${row.status} ${row.title} (${row.id}) single_take=${payload.single_take} cuts=${payload.cuts} res=${payload.resolution}`);
  for (const s of shots) {
    const p = String(s.prompt ?? "");
    console.log(`--- plan ${s.idx} ${s.role} ${s.provider ?? ""} ${s.duration ?? ""}s audio=${s.audio_seconds ?? ""}s mots=${p.split(/\s+/).length}`);
    console.log(p);
  }
}
process.exit(0);
