import { avatarImageModel, IDENTITY_SELECT, identityBlock, identityRefs, pronouns, resolveOutfit, type AvatarIdentity } from "../../domain/characterBible";
import { findKeyframe } from "../../domain/keyframes";
import { faceScores, qcVerdict, saveQcReport } from "../../lib/qc";
import { snapshotVersion } from "../../lib/versions";
import { logger } from "../../logger";
import { estimateImageCost, piapiImageToStorage, type ImageAspect } from "../../providers/piapiImage";
import { jobLog, type JobRow } from "../../queue/queue";
import { supabase } from "../../supabase";
import { advance, loadContentItem, mergeAssets, patchContentItem, requireContentItemId } from "../pipelines";

// ─────────────────────────────────────────────────────────────
// PHOTO — une image de l'influenceur dans une scène, avec ses références
// d'identité (portrait, planche, vues validées), sa tenue (garde-robe) et
// son décor (univers), puis contrôle qualité d'identité. Une régénération
// automatique si le visage n'est pas reconnu ; ensuite l'humain tranche.
// ─────────────────────────────────────────────────────────────

const MAX_AUTO_RETRIES = 1;

interface PhotoPayload {
  scene?: string;
  theme?: string;
  location_key?: string | null;
  outfit_id?: string | null;
  model?: string;
  aspect?: ImageAspect;
  framing?: string;
  photo_attempts?: number;
}

export async function generatePhotoJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  const item = await loadContentItem(id);
  if (item.status === "failed" || item.status === "canceled") return;
  const payload = item.payload as PhotoPayload;

  const { data: avatarRow } = await supabase.from("avatars").select(IDENTITY_SELECT).eq("id", item.avatar_id).single();
  const avatar = avatarRow as AvatarIdentity | null;
  if (!avatar?.ref_image_url) throw new Error("L'influenceur n'a pas de portrait — génère-le d'abord.");
  const p = pronouns(avatar);
  const model = avatarImageModel(avatar, payload.model);
  const aspect: ImageAspect = payload.aspect ?? "3:4";

  // Références : identité (portrait, planche, vues validées), tenue, décor, keyframe du décor (cache).
  const refs = await identityRefs(avatar, 5);
  const identityCount = refs.length;

  const outfitRow = await resolveOutfit(avatar.id, payload.outfit_id);
  const outfit = outfitRow?.description_en ?? "";
  let outfitIdx = 0;
  if (outfitRow?.ref_url) { refs.push(outfitRow.ref_url); outfitIdx = refs.length; }

  let locationDesc = "";
  let locationIdx = 0;
  let keyframeIdx = 0;
  let keyframeId: string | null = null;
  if (payload.location_key) {
    const { data: loc } = await supabase.from("avatar_locations").select("id, description, ref_image_url").eq("avatar_id", avatar.id).eq("key", payload.location_key).maybeSingle();
    if (loc) {
      locationDesc = String(loc.description ?? "");
      if (loc.ref_image_url) { refs.push(String(loc.ref_image_url)); locationIdx = refs.length; }
      // Cache : un keyframe validé du même décor avec la même tenue ancre à la fois le lieu et les vêtements portés.
      const kf = await findKeyframe(avatar.id, { locationId: String(loc.id), outfitId: outfitRow?.id ?? null }, { validatedOnly: true });
      if (kf && !refs.includes(kf.url)) { refs.push(kf.url); keyframeIdx = refs.length; keyframeId = kf.id; }
    }
  }

  const scene = String(payload.scene ?? payload.theme ?? "candid lifestyle moment").trim();
  const prompt = [
    `Reference image 1 is the face and identity of ${avatar.name}.`,
    identityCount === 2 ? "Reference image 2 shows the same person (character sheet)." : identityCount > 2 ? `Reference images 2-${identityCount} show the same person (character sheet, other views).` : "",
    outfitIdx ? `Reference image ${outfitIdx} shows ${p.poss} outfit.` : "",
    locationIdx ? `Reference image ${locationIdx} is the EXACT location: reuse its walls, furniture, colors and layout.` : "",
    keyframeIdx ? `Reference image ${keyframeIdx} shows ${avatar.name} already in this exact location wearing this outfit: match ${p.poss} look, clothes and the setting.` : "",
    `Create a NEW photo of the SAME person with an identical face: ${scene}${payload.framing ? `, ${payload.framing}` : ""}.`,
    locationDesc && !locationIdx ? `Location: ${locationDesc}.` : "",
    outfit ? `${p.Subj} is wearing ${outfit} — do NOT copy the clothes from the identity references.` : "",
    `Keep the face, features, hairstyle and skin exactly like the references. ${identityBlock(avatar)}.`,
    `Photorealistic, natural unretouched skin texture, no beauty filter, candid social-media photo.`,
  ].filter(Boolean).join(" ");

  const attempt = Number(payload.photo_attempts ?? 0) + 1;
  await jobLog(job, `Génération photo (${model}, ${refs.length} références${keyframeId ? " dont le keyframe du décor" : ""}, essai ${attempt})`, 20);
  const { imageUrl, cost, ms } = await piapiImageToStorage({ prompt, refs, model, aspect }, `${avatar.id}/${id}/photo-${attempt}-${Date.now()}`);
  await jobLog(job, `Image reçue en ${Math.round(ms / 1000)} s — contrôle du visage…`, 70);

  const [qc] = await faceScores(avatar.ref_image_url, [imageUrl]);
  const verdict = qc?.verdict ?? qcVerdict(null);
  const previous = Array.isArray(item.assets.image_urls) ? (item.assets.image_urls as string[]) : [];
  const estimated = estimateImageCost(model, refs.length, "1K");

  await mergeAssets(id, {
    image_url: imageUrl,
    image_urls: [...previous.filter((u) => u !== imageUrl), imageUrl],
    image_model: model,
    prompt,
    refs_used: refs.length,
    keyframe_id: keyframeId,
    estimated_cost_usd: Math.round((Number(item.assets.estimated_cost_usd ?? 0) + (cost || estimated)) * 1000) / 1000,
    qc: { face_score: qc?.score ?? null, faces: qc?.faces ?? 0, face_height: qc?.faceHeight ?? null, verdict, attempt, ...(qc?.note ? { note: qc.note } : {}) },
  });
  await saveQcReport({ targetType: "content", targetId: id, avatarId: avatar.id, checks: { face_score: qc?.score ?? null, faces: qc?.faces ?? 0, face_height: qc?.faceHeight ?? null, model, attempt }, score: qc?.score ?? null, passed: verdict === "pass", notes: qc?.note });

  if (verdict === "fail" && attempt <= MAX_AUTO_RETRIES) {
    await jobLog(job, `Visage non reconnu (score ${qc?.score?.toFixed(2) ?? "?"}) — nouvelle génération automatique`, 75);
    await patchContentItem(id, { payload: { ...item.payload, photo_attempts: attempt } });
    logger.warn("photo_qc_fail_retry", { itemId: id, score: qc?.score ?? null });
    await generatePhotoJob({ ...job, payload: { ...job.payload } });
    return;
  }

  await jobLog(
    job,
    verdict === "pass"
      ? `Visage conforme (score ${qc?.score?.toFixed(2)})`
      : verdict === "unknown"
        ? "Contrôle du visage indisponible — à vérifier à l'œil"
        : `Visage à vérifier (score ${qc?.score?.toFixed(2)})${qc?.note ? ` — ${qc.note}` : ""}`,
    90,
  );
  try {
    await snapshotVersion(id, `Photo générée (${model})`);
  } catch (err) {
    logger.warn("version_snapshot_failed", { itemId: id, err: String((err as Error)?.message ?? err) });
  }
  await advance(job);
}
