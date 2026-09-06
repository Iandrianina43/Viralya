import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Contrôle qualité d'identité : similarité de visage entre le portrait de
// référence et une image générée (tools/qc/face_score.py — OpenCV YuNet + SFace).
// Seuils calibrés sur le banc du 3 septembre 2026 (visages synthétiques) :
//   ≥ 0,55 acceptée · 0,40–0,55 à revoir · < 0,40 régénérée.
// Le score trie, l'humain tranche. Si Python/OpenCV manquent, le QC est
// « inconnu » et n'empêche jamais la production.
// ─────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, "../../../../tools/qc/face_score.py");

// minFaceHeight : sous 12 % de la hauteur de l'image (plan large, visage de profil ou
// baissé), SFace décroche même quand c'est bien la personne (photo du 3 sept. : 0,30
// sur un plan large pourtant fidèle) → jamais « fail » automatique, l'humain tranche.
export const QC_THRESHOLDS = { pass: 0.55, review: 0.4, samePerson: 0.363, minFaceHeight: 0.12 } as const;
export type QcVerdict = "pass" | "review" | "fail" | "unknown";

export interface FaceScore {
  url: string;
  score: number | null;
  faces: number;
  /** Hauteur du visage retenu / hauteur de l'image (null si inconnue). */
  faceHeight: number | null;
  verdict: QcVerdict;
  /** Pourquoi le verdict a été adouci (ex. visage trop petit pour être fiable). */
  note?: string;
  error?: string;
}

export function qcVerdict(score: number | null | undefined, faceHeight?: number | null): QcVerdict {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score >= QC_THRESHOLDS.pass) return "pass";
  if (score >= QC_THRESHOLDS.review) return "review";
  if (faceHeight != null && faceHeight < QC_THRESHOLDS.minFaceHeight) return "review";
  return "fail";
}

export function smallFace(faceHeight: number | null | undefined): boolean {
  return faceHeight != null && faceHeight < QC_THRESHOLDS.minFaceHeight;
}

/** Score chaque candidat contre le portrait de référence. Jamais bloquant. */
export async function faceScores(refUrl: string, candidates: string[], timeoutMs = 180_000): Promise<FaceScore[]> {
  const unknown = (error: string): FaceScore[] => candidates.map((url) => ({ url, score: null, faces: 0, faceHeight: null, verdict: "unknown", error }));
  if (!candidates.length) return [];
  return new Promise<FaceScore[]>((resolveP) => {
    const child = spawn(config.PYTHON_BIN, [SCRIPT, "--ref", refUrl, ...candidates], { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolveP(unknown("qc_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      logger.warn("qc_unavailable", { err: String(e?.message ?? e) });
      resolveP(unknown("qc_unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const byUrl = new Map<string, FaceScore>();
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const j = JSON.parse(t) as { url?: string; score?: number | null; faces?: number; face_h?: number | null; error?: string };
          if (!j.url) continue;
          const faceHeight = typeof j.face_h === "number" ? j.face_h : null;
          const verdict = qcVerdict(j.score, faceHeight);
          const softened = verdict === "review" && j.score != null && j.score < QC_THRESHOLDS.review && smallFace(faceHeight);
          byUrl.set(j.url, {
            url: j.url,
            score: j.score ?? null,
            faces: j.faces ?? 0,
            faceHeight,
            verdict,
            ...(softened ? { note: `visage petit (${Math.round(faceHeight! * 100)} % de la hauteur) : score peu fiable, à vérifier à l'œil` } : {}),
            ...(j.error ? { error: j.error } : {}),
          });
        } catch { /* ligne ignorée */ }
      }
      if (byUrl.size === 0) {
        logger.warn("qc_no_output", { code, err: err.slice(0, 300) });
        resolveP(unknown(err.trim().split(/\r?\n/).pop()?.slice(0, 200) || "qc_no_output"));
        return;
      }
      resolveP(candidates.map((url) => byUrl.get(url) ?? { url, score: null, faces: 0, faceHeight: null, verdict: "unknown", error: "qc_missing" }));
    });
  });
}

/** Archive un rapport QC (table qc_reports). Non bloquant. */
export async function saveQcReport(input: {
  targetType: "image" | "video" | "content" | "reference" | "keyframe";
  targetId: string;
  avatarId?: string | null;
  checks: Record<string, unknown>;
  score?: number | null;
  passed?: boolean | null;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.from("qc_reports").insert({
    target_type: input.targetType,
    target_id: input.targetId,
    avatar_id: input.avatarId ?? null,
    checks: input.checks,
    score: input.score ?? null,
    passed: input.passed ?? null,
    notes: input.notes ?? null,
  });
  if (error) logger.warn("qc_report_insert_failed", { err: error.message });
}
