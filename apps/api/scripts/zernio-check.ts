/**
 * Vérifie la configuration Zernio (publication réelle) : clé, profils, comptes connectés, webhook, usage.
 *   pnpm --filter @viralya/api exec tsx scripts/zernio-check.ts [--webhook]
 * `--webhook` enregistre (ou met à jour) le webhook vers cette instance — fait aussi au démarrage de l'API.
 */
import { config } from "../src/config";
import { ensureZernioWebhook } from "../src/domain/connections";
import * as zernio from "../src/providers/zernio";

async function main(): Promise<void> {
  if (!config.ZERNIO_API_KEY) {
    console.log("ZERNIO_API_KEY absente : la publication reste simulée.");
    return;
  }
  const v = await zernio.verifyCredential();
  console.log(`Clé Zernio : ${v.valid ? "valide" : "INVALIDE"} (${v.authType ?? "?"})`);

  const profiles = await zernio.listProfiles();
  console.log(`Profils : ${profiles.length}`);
  for (const p of profiles) console.log(`  - ${p._id} ${p.name}${p.isDefault ? " (défaut)" : ""}`);

  const accounts = await zernio.listAccounts();
  console.log(`Comptes connectés : ${accounts.length} (2 gratuits, puis 6 $/compte/mois jusqu'à 10, 3 $ jusqu'à 100, 1 $ au-delà)`);
  for (const a of accounts) {
    const profile = typeof a.profileId === "string" ? a.profileId : a.profileId?.name ?? a.profileId?._id;
    console.log(`  - ${a.platform.padEnd(10)} @${a.username ?? "?"} ${a.isActive ? "actif" : "INACTIF"}${a.needsReconnection ? " (à reconnecter)" : ""} · profil ${profile}${typeof a.followersCount === "number" ? ` · ${a.followersCount} abonnés` : ""}`);
  }

  const hooks = await zernio.listWebhooks();
  console.log(`Webhooks : ${hooks.length}`);
  for (const h of hooks) console.log(`  - ${h.url} ${h.isActive ? "actif" : "inactif"} · ${h.events.length} événements · échecs consécutifs ${h.failureCount ?? 0}`);

  try {
    const u = await zernio.usageStats();
    console.log("Usage :", JSON.stringify(u).slice(0, 500));
  } catch (err) {
    console.log("Usage : indisponible —", String((err as Error)?.message ?? err).slice(0, 120));
  }

  if (process.argv.includes("--webhook")) {
    const r = await ensureZernioWebhook();
    console.log("Webhook :", r.ok ? `enregistré → ${r.url}` : `non enregistré (${r.reason})`);
  }
}

main().catch((err) => {
  console.error("Échec :", String((err as Error)?.message ?? err));
  process.exit(1);
});
