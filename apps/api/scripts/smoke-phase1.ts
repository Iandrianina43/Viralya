/* eslint-disable no-console */
// Vérification rapide de la phase 1 sans toucher aux données métier :
//  1) provider image PiAPI (texte → image, puis multi-référence) ;
//  2) contrôle qualité visage depuis Node (spawn de tools/qc/face_score.py).
//   pnpm --filter @viralya/api exec tsx scripts/smoke-phase1.ts <portrait_url> [sheet_url]
import { config } from "../src/config";
import { faceScores } from "../src/lib/qc";
import { composeKeyframe, generateImage, imageConfigured } from "../src/providers/image";

const portrait = process.argv[2] ?? "";
const sheet = process.argv[3] ?? "";
if (!portrait) throw new Error("usage: smoke-phase1.ts <portrait_url> [sheet_url]");

async function main() {
  console.log(`provider=${config.IMAGE_PROVIDER} model=${config.IMAGE_MODEL} configured=${imageConfigured()} python=${config.PYTHON_BIN}`);

  let t0 = Date.now();
  const t2i = await generateImage("Photorealistic empty modern kitchen at sunrise, no people, natural light, vertical", `smoke/t2i-${Date.now()}`, "1024x1536");
  console.log(`✓ texte→image ${((Date.now() - t0) / 1000).toFixed(0)}s → ${t2i.imageUrl}`);

  t0 = Date.now();
  const kf = await composeKeyframe(
    [portrait, ...(sheet ? [sheet] : [])],
    t2i.imageUrl,
    "Create a NEW photo of the SAME person with an identical face: standing in this kitchen holding a mug, smiling at the camera, medium shot. Photorealistic, natural skin texture, no beauty filter.",
    `smoke/keyframe-${Date.now()}`,
    "1024x1536",
  );
  console.log(`✓ multi-référence + décor ${((Date.now() - t0) / 1000).toFixed(0)}s → ${kf.imageUrl}`);

  t0 = Date.now();
  const scores = await faceScores(portrait, [kf.imageUrl, t2i.imageUrl]);
  console.log(`✓ QC visage ${((Date.now() - t0) / 1000).toFixed(0)}s :`, scores.map((s) => ({ score: s.score, faces: s.faces, verdict: s.verdict, error: s.error })));
}

main().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
