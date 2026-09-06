import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireContentItem } from "../lib/scope";
import { listVersions, restoreVersion, snapshotVersion } from "../lib/versions";
import { enqueue, requestCancel } from "../queue/queue";
import { supabase } from "../supabase";

// Contenus de l'organisation active (via l'influenceur propriétaire).
export const contentRouter = Router();

contentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    let q = supabase
      .from("content_items")
      .select("*, avatars!inner(org_id, name)")
      .eq("avatars.org_id", req.org!.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (req.query.avatar_id) q = q.eq("avatar_id", String(req.query.avatar_id));
    if (req.query.status) q = q.eq("status", String(req.query.status));
    if (req.query.type) q = q.eq("type", String(req.query.type));
    const { data, error } = await q;
    if (error) throw error;
    const content = (data ?? []).map((row: Record<string, any>) => {
      const { avatars, ...item } = row;
      return { ...item, avatar_name: avatars?.name ?? null };
    });
    res.json({ content });
  }),
);

contentRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ item: await requireContentItem(req.org!.id, String(req.params.id)) });
  }),
);

// Approbation humaine → enfile un job schedule.
contentRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, status, avatar_id, title");
    if (item.status !== "needs_review") throw new HttpError(409, `statut ${item.status} non approuvable (seul un contenu prêt à valider peut être approuvé)`);
    const scheduledAt = req.body?.scheduled_at as string | undefined;
    const job = await enqueue(
      "schedule",
      { content_item_id: item.id, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) },
      { contentItemId: item.id, avatarId: item.avatar_id, label: item.title ?? "Programmation" },
    );
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// Annule une production en cours : les jobs en file sont annulés, ceux en cours
// s'arrêtent à leur prochaine étape ; le contenu passe en "canceled".
contentRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, status, assets");
    if (!["queued", "generating"].includes(item.status)) throw new HttpError(409, `production ${item.status} — rien à annuler`);
    await requestCancel(item.id);
    await supabase.from("content_items").update({ status: "canceled", error: "Production annulée" }).eq("id", item.id);
    // Registre : seul ce qui a réellement été rendu reste compté.
    const { settleUsage } = await import("../domain/billing");
    await settleUsage(item.id, Number((item.assets as Record<string, unknown> | null)?.estimated_cost_usd ?? 0));
    res.json({ ok: true });
  }),
);

contentRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id");
    const { error } = await supabase.from("content_items").update({ status: "failed", error: "rejeté en revue" }).eq("id", item.id);
    if (error) throw error;
    res.json({ ok: true });
  }),
);

// Régénère depuis le début. L'état courant est figé en version avant relance.
contentRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, avatar_id, title, status, type, payload, assets");
    // Une régénération complète coûte autant qu'un premier rendu : budget vérifié et inscrit.
    const { assertBudget, recordUsage } = await import("../domain/billing");
    const retryEstimate = item.type === "video" ? Number((item.assets as Record<string, unknown> | null)?.estimated_cost_usd ?? 0) || 10 : 0.3;
    await assertBudget(req.org!.id, retryEstimate);
    await snapshotVersion(item.id, "Avant régénération", req.user?.id ?? null);
    await recordUsage({ orgId: req.org!.id, avatarId: item.avatar_id, contentItemId: item.id, kind: "retry", estimatedUsd: retryEstimate });
    await supabase.from("content_items").update({ status: "queued", error: null }).eq("id", item.id);
    const job = await enqueue(
      "generate_text",
      { avatar_id: item.avatar_id, content_item_id: item.id },
      { contentItemId: item.id, avatarId: item.avatar_id, label: item.title ?? "Régénération" },
    );
    res.status(202).json({ ok: true, job_id: job.id });
  }),
);

// ── Régénération d'UN plan (vidéo hybride) ───────────────────
// body : { texte?: string (nouvelle réplique → voix refaite), talk_provider?: "kling-avatar"|"omnihuman" }
// Les autres plans sont conservés ; la vidéo est remontée à la fin. L'état courant est figé en version.
contentRouter.post(
  "/:id/shots/:idx/regenerate",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, avatar_id, title, status, type, payload, assets");
    if (item.type !== "video" || item.payload?.format !== "hybrid") throw new HttpError(409, "ce contenu n'est pas une vidéo hybride");
    if (["queued", "generating"].includes(item.status)) throw new HttpError(409, "production en cours — attends la fin ou annule-la");
    const idx = Number(req.params.idx);
    const shots = Array.isArray(item.assets?.shots) ? (item.assets.shots as Array<Record<string, any>>) : [];
    const shot = shots.find((s) => Number(s.idx) === idx);
    if (!Number.isInteger(idx) || !shot) throw new HttpError(404, "plan introuvable");
    {
      const { assertBudget, recordUsage } = await import("../domain/billing");
      const shotEstimate = Number(shot.cost_usd) || 5;
      await assertBudget(req.org!.id, shotEstimate);
      await recordUsage({ orgId: req.org!.id, avatarId: item.avatar_id, contentItemId: item.id, kind: "shot_retry", estimatedUsd: shotEstimate });
    }

    await snapshotVersion(item.id, `Avant régénération du plan ${idx + 1}`, req.user?.id ?? null);

    const payload = { ...(item.payload as Record<string, any>) };
    const { isTalkProvider } = await import("../providers/talkingAvatar");
    if (isTalkProvider(req.body?.talk_provider)) payload.talk_provider = req.body.talk_provider;

    const newText = typeof req.body?.texte === "string" ? req.body.texte.trim() : null;
    const textChanged = newText != null && newText !== String(shot.texte ?? "").trim();
    if (textChanged) {
      shot.texte = newText;
      const scenes = (payload.production?.scenes ?? []) as Array<Record<string, any>>;
      if (scenes[idx]) scenes[idx] = { ...scenes[idx], texte: newText };
      payload.script = scenes.map((s) => s.texte).join(" ");
    }
    Object.assign(shot, {
      phase: textChanged ? "voice" : "waiting",
      version: Number(shot.version ?? 1) + 1,
      task_id: undefined, clip_url: undefined, qc: null, error: undefined, submit_attempts: 0, cost_usd: 0,
      ...(textChanged ? { audio_url: null, audio_seconds: null, words: null } : {}),
    });
    const log = Array.isArray(item.assets?.log) ? [...(item.assets.log as unknown[])] : [];
    log.push({ t: new Date().toISOString(), msg: `🔁 Plan ${idx + 1} : régénération demandée${textChanged ? " (nouvelle réplique)" : ""}` });

    await supabase
      .from("content_items")
      .update({ status: "generating", error: null, payload, assets: { ...(item.assets as Record<string, unknown>), shots, log, assembling: false } })
      .eq("id", item.id);

    const job = await enqueue(
      textChanged ? "generate_voice" : "generate_shots",
      { avatar_id: item.avatar_id, content_item_id: item.id, only_shots: [idx] },
      { contentItemId: item.id, avatarId: item.avatar_id, label: `${item.title ?? "Vidéo"} — plan ${idx + 1}` },
    );
    res.status(202).json({ ok: true, job_id: job.id, voice_regenerated: textChanged });
  }),
);

// ── Versions ─────────────────────────────────────────────────
contentRouter.get(
  "/:id/versions",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id, current_version");
    const versions = await listVersions(item.id);
    res.json({ current_version: item.current_version ?? 0, versions });
  }),
);

contentRouter.post(
  "/:id/versions/:no/restore",
  asyncHandler(async (req, res) => {
    const item = await requireContentItem(req.org!.id, String(req.params.id), "id");
    const no = Number(req.params.no);
    if (!Number.isInteger(no) || no < 1) throw new HttpError(400, "numéro de version invalide");
    const saved = await restoreVersion(item.id, no, req.user?.id ?? null);
    res.json({ ok: true, restored: no, previous_saved_as: saved });
  }),
);
