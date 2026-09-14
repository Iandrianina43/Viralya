/**
 * Nettoyage du stockage (14 sept. 2026).
 *   pnpm --filter @viralya/api exec tsx scripts/storage-cleanup.ts                → rapport (rien n'est supprimé)
 *   pnpm --filter @viralya/api exec tsx scripts/storage-cleanup.ts --sources      → purge les sources de clone > 7 jours (comme le balayage quotidien)
 *   pnpm --filter @viralya/api exec tsx scripts/storage-cleanup.ts --purge-orphans → supprime les préfixes racine qu'AUCUNE ligne en base ne référence
 *   pnpm --filter @viralya/api exec tsx scripts/storage-cleanup.ts --prefix bench/ → supprime un préfixe donné (explicite)
 * ⚠️ Le bucket est partagé entre le poste local et la production.
 */
import { config } from "../src/config";
import { listFilesUnder, purgeOldSources, referencedStoragePaths, removePrefix } from "../src/lib/storageCleanup";
import { supabase } from "../src/supabase";

const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} Mo`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function report(): Promise<Array<{ prefix: string; files: number; bytes: number; referenced: number }>> {
  const keep = await referencedStoragePaths();
  const { data: root } = await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).list("", { limit: 1000 });
  const rows: Array<{ prefix: string; files: number; bytes: number; referenced: number }> = [];
  let total = 0;
  for (const e of root ?? []) {
    if (e.id) continue; // fichier à la racine : ignoré
    const files = await listFilesUnder(`${e.name}/`);
    const referenced = files.filter((f) => keep.has(f.path)).length;
    const bytes = files.reduce((s, f) => s + f.size, 0);
    total += bytes;
    rows.push({ prefix: `${e.name}/`, files: files.length, bytes, referenced });
  }
  console.log(`Bucket ${config.SUPABASE_STORAGE_BUCKET} : ${rows.length} préfixes, ${mb(total)}, ${keep.size} fichiers référencés en base`);
  for (const r of rows.sort((a, b) => b.bytes - a.bytes)) {
    const state = r.files === 0 ? "vide" : r.referenced === 0 ? "ORPHELIN (rien en base)" : r.referenced < r.files ? `${r.files - r.referenced} fichiers non référencés` : "tout référencé";
    console.log(`  ${r.prefix.padEnd(40)} ${String(r.files).padStart(5)} fichiers ${mb(r.bytes).padStart(10)}  ${state}`);
  }
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--prefix" && args[1]) {
    const n = await removePrefix(args[1]);
    console.log(`Préfixe ${args[1]} : ${n} fichiers supprimés.`);
    return;
  }
  if (args[0] === "--sources") {
    const r = await purgeOldSources(7);
    console.log(`Sources de clone > 7 jours : ${r.deleted} fichiers supprimés (${mb(r.bytes)}).`);
    return;
  }
  const rows = await report();
  if (args[0] === "--purge-orphans") {
    const orphans = rows.filter((r) => r.files > 0 && r.referenced === 0 && UUID.test(r.prefix.replace(/\/$/, "")));
    let n = 0;
    for (const o of orphans) n += await removePrefix(o.prefix);
    console.log(`Préfixes orphelins (identifiants) : ${orphans.length}, ${n} fichiers supprimés. Les dossiers nommés (bench/, tests/…) se suppriment avec --prefix.`);
  }
}

main().catch((err) => { console.error("Échec :", String((err as Error)?.message ?? err)); process.exit(1); });
