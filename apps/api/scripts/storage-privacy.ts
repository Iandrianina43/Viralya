/**
 * Confidentialité du bucket de stockage (14 sept. 2026).
 *   pnpm --filter @viralya/api exec tsx scripts/storage-privacy.ts            → état du bucket + test d'une URL
 *   pnpm --filter @viralya/api exec tsx scripts/storage-privacy.ts --private  → passe le bucket en privé
 *   pnpm --filter @viralya/api exec tsx scripts/storage-privacy.ts --public   → repasse en public (retour arrière)
 * ⚠️ Le bucket est PARTAGÉ entre le poste local et la production : le basculer touche les deux.
 */
import { config } from "../src/config";
import { canonicalUrl, signPaths, SIGN_TTL } from "../src/lib/storage";
import { supabase } from "../src/supabase";

const bucket = config.SUPABASE_STORAGE_BUCKET;

async function status(): Promise<void> {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error || !data) { console.log(`Bucket ${bucket} : introuvable (${error?.message ?? "?"})`); return; }
  console.log(`Bucket ${bucket} : ${data.public ? "PUBLIC" : "privé"}`);
  const { data: files } = await supabase.storage.from(bucket).list("", { limit: 1 });
  const first = files?.[0];
  if (!first) { console.log("Aucun objet à la racine pour tester."); return; }
  // Cherche un vrai fichier (les entrées racine sont des dossiers <avatar_id>).
  const { data: inner } = await supabase.storage.from(bucket).list(first.name, { limit: 50 });
  const file = inner?.find((f) => f.id && /\.(jpg|jpeg|png|mp4|mp3)$/i.test(f.name));
  const sub = file ? null : inner?.[0];
  let path: string | null = file ? `${first.name}/${file.name}` : null;
  if (!path && sub) {
    const { data: deeper } = await supabase.storage.from(bucket).list(`${first.name}/${sub.name}`, { limit: 50 });
    const f2 = deeper?.find((f) => f.id);
    if (f2) path = `${first.name}/${sub.name}/${f2.name}`;
  }
  if (!path) { console.log("Aucun fichier trouvé pour le test."); return; }
  const pub = canonicalUrl(path);
  const signed = (await signPaths([path], SIGN_TTL.web)).get(path);
  const head = async (u: string) => { try { const r = await fetch(u, { method: "HEAD" }); return r.status; } catch { return "erreur"; } };
  console.log(`Test ${path}`);
  console.log(`  URL canonique (publique) : HTTP ${await head(pub)}  ${data.public ? "(attendu 200 tant que le bucket est public)" : "(attendu 400/404 : bucket privé)"}`);
  console.log(`  URL signée              : HTTP ${signed ? await head(signed) : "non signée"}  (attendu 200)`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--private" || arg === "--public") {
    const { error } = await supabase.storage.updateBucket(bucket, { public: arg === "--public" });
    if (error) { console.error("Échec :", error.message); process.exit(1); }
    console.log(`Bucket ${bucket} passé en ${arg === "--public" ? "PUBLIC" : "privé"}.`);
  }
  await status();
}

main().catch((err) => { console.error("Échec :", String((err as Error)?.message ?? err)); process.exit(1); });
