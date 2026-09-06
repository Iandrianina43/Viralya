/**
 * Smoke test phase 3 (après application de la migration 0016) — aucune vidéo, ≈ 0,10 $ de LLM :
 *   1. calendrier du mois prochain pour un influenceur (stratège LLM) ;
 *   2. campagne UGC minimale (1 influenceur × 2 angles × 1 accroche × 30 s → 2 scripts) ;
 *   3. compte social simulé : profil + publication simulée d'un contenu prêt + feed.
 *   pnpm --filter @viralya/api exec tsx scripts/test-phase3.ts <avatar_id> [content_item_id à publier]
 */
import { generatePlan } from "../src/domain/calendar";
import { getFeed, publishSimulated } from "../src/domain/social";
import { createCampaign } from "../src/domain/ugc";
import { supabase } from "../src/supabase";

const [avatarId, contentId] = process.argv.slice(2);
if (!avatarId) throw new Error("usage: test-phase3.ts <avatar_id> [content_item_id]");
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const { data: avatar } = await supabase.from("avatars").select("id, name, org_id").eq("id", avatarId).single();
if (!avatar) throw new Error("avatar introuvable");

// 1) Calendrier
const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1, 1);
const month = next.toISOString().slice(0, 7);
log(`1) Calendrier ${month} pour ${avatar.name}…`);
const plan = await generatePlan(avatarId, { month, postsPerWeek: 5, brief: "Un mois vivant, un voyage court, un partenariat café en fin de mois." }, (m, p) => log(`   ${p}% ${m}`));
log(`   piliers : ${plan.strategy.pillars.join(" · ")}`);
for (const a of plan.strategy.arcs) log(`   arc « ${a.name} » ${a.start} → ${a.end} : ${a.summary.slice(0, 90)}`);
for (const e of plan.entries ?? []) log(`   ${e.day} ${e.slot.padEnd(5)} ${e.type.padEnd(8)} ${e.network.padEnd(9)} ${e.ratio_class.padEnd(5)} @${e.location_key ?? "-"} — ${e.title} :: ${e.brief.slice(0, 80)}`);

// 2) UGC
log("2) Campagne UGC (2 variantes)…");
const camp = await createCampaign(String(avatar.org_id), {
  brand: "Terra Café", product: { name: "Terra Cold Brew", description: "Café infusé à froid pendant dix-huit heures, en bouteille de deux cent cinquante millilitres, sans sucre ajouté, à boire glacé. Notes de cacao et de noisette.", price: "3,90 €" },
  objective: "consideration", target: "actifs urbains 25-40 ans", tone: "complice",
  avatar_ids: [avatarId], angles: ["Praticité au quotidien", "Témoignage honnête"], hooks_per_angle: 1, durations: [30], ctas: ["Lien en bio"],
}, (m) => log(`   ${m}`));
for (const v of camp.variants ?? []) {
  log(`   ${v.label} (${v.script.hook_type ?? "?"}) — ${v.script.beats.reduce((a, b) => a + b.line.split(/\s+/).length, 0)} mots — ≈ ${v.est_cost_usd} $`);
  for (const b of v.script.beats) log(`      ${b.beat.padEnd(8)} ${String(b.seconds).padStart(2)} s  « ${b.line} »  [${b.action}]`);
  log(`      légende : ${v.script.caption}`);
}

// 3) Social
if (contentId) {
  log(`3) Publication simulée de ${contentId}…`);
  const post = await publishSimulated(contentId);
  log(`   publié : vues finales ${post.stats.views}, j'aime ${post.stats.likes}`);
}
const feed = await getFeed(avatarId, "tiktok");
log(`   @${feed.profile.handle} — ${feed.profile.followers} abonnés, ${feed.profile.posts} posts, ${feed.profile.total_views} vues, engagement ${feed.profile.engagement_rate} % — bio : ${feed.profile.bio}`);
for (const p of feed.posts.slice(0, 5)) log(`   post ${p.id.slice(0, 8)} ${p.type} ${p.published_at?.slice(0, 16)} vues ${p.stats.views} likes ${p.stats.likes} +${p.stats.followers_gained} abonnés`);
process.exit(0);
