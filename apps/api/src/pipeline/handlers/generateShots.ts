import { logger } from "../../logger";
import { piapiConfigured } from "../../providers/piapi";
import { jobLog, type JobRow } from "../../queue/queue";
import { loadShotContext, submitShot, totalShotCost, type ShotState } from "../hybrid";
import { advance, loadContentItem, mergeAssets, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// SOUMISSION DES PLANS — tous en parallèle (ils sont indépendants) :
// talk → avatar parlant piloté par l'audio, broll → Seedance muet.
// Les échecs de soumission sont retentés par poll_shots (3 essais).
// ─────────────────────────────────────────────────────────────

export const MAX_SUBMIT_ATTEMPTS = 3;

/**
 * PiAPI répond 429 quand le nombre de tâches simultanées du plan est atteint (constaté le
 * 4 sept. 2026 : 2 tâches Seedance 2.5 en vol, les suivantes refusées). Ce n'est pas un échec
 * du plan : on attend le prochain passage sans consommer d'essai, et on arrête de soumettre
 * pour ce passage.
 */
export function isRateLimited(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /\b429\b|rate limit|too many|concurren/i.test(msg);
}

/** Solde PiAPI épuisé (code 10002 « Insufficient credits ») : inutile de réessayer, le message doit être clair. */
export function isOutOfCredits(err: unknown): boolean {
  return /insufficient credits|10002/i.test(String((err as Error)?.message ?? err));
}
export const OUT_OF_CREDITS_MSG = "Crédits PiAPI insuffisants : recharge le compte PiAPI puis régénère le plan.";

export async function generateShotsJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") return;
  if (!piapiConfigured()) throw new Error("PiAPI non configuré (PIAPI_API_KEY manquante).");

  const shots = Array.isArray(item.assets.shots) ? (item.assets.shots as ShotState[]) : [];
  if (!shots.length) throw new Error("generate_shots: plans manquants (generate_voice n'a pas abouti)");
  const only = Array.isArray(job.payload.only_shots) ? (job.payload.only_shots as number[]) : null;

  const log: Array<{ t: string; msg: string }> = Array.isArray(item.assets.log) ? (item.assets.log as never[]) : [];
  const say = (msg: string) => log.push({ t: new Date().toISOString(), msg });

  const ctx = await loadShotContext(item);
  const targets = shots.filter((s) => (only ? only.includes(s.idx) : true) && s.phase === "waiting");
  let i = 0;
  for (const shot of targets) {
    i++;
    await jobLog(job, `Plan ${shot.idx + 1} : ${shot.role === "talk" ? "avatar parlant" : shot.role === "still" ? "image" : "plan Seedance"} — soumission`, Math.round((i / Math.max(1, targets.length)) * 90));
    try {
      await submitShot(ctx, shot, say);
      if (shot.role !== "still") say(`🎥 ${shot.titre} : ${shot.role === "talk" ? `avatar parlant (${shot.provider})` : "plan Seedance"} en cours — ≈ ${(shot.cost_usd ?? 0).toFixed(2)} $`);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (isRateLimited(err)) {
        shot.error = "file d'attente PiAPI (limite de tâches simultanées) — soumission différée";
        say(`⏳ ${shot.titre} : limite de tâches simultanées PiAPI, les plans restants partiront quand un rendu se libère`);
        logger.info("hybrid_submit_rate_limited", { itemId: id, idx: shot.idx });
        break;
      }
      if (isOutOfCredits(err)) {
        shot.phase = "failed";
        shot.error = OUT_OF_CREDITS_MSG;
        say(`💳 ${shot.titre} : ${OUT_OF_CREDITS_MSG}`);
        logger.warn("hybrid_out_of_credits", { itemId: id, idx: shot.idx });
        break;
      }
      shot.submit_attempts = (shot.submit_attempts ?? 0) + 1;
      shot.error = msg.slice(0, 200);
      if (shot.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
        shot.phase = "failed";
        say(`❌ ${shot.titre} : abandon (${msg.slice(0, 100)})`);
      } else {
        say(`⚠️ ${shot.titre} : soumission échouée (${msg.slice(0, 80)}) — nouvel essai au prochain passage`);
      }
      logger.warn("hybrid_submit_failed", { itemId: id, idx: shot.idx, err: msg.slice(0, 200) });
    }
  }

  await mergeAssets(id, { shots, log, estimated_cost_usd: totalShotCost(shots) });
  if (!shots.some((s) => s.phase === "video" || s.phase === "waiting")) {
    if (shots.some((s) => s.phase === "done")) { await advance(job); return; }
    throw new Error("hybride : aucun plan n'a pu être soumis");
  }
  await advance(job, { runAfterMs: 15_000 });
}
