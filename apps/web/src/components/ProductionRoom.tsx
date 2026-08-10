import { CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Film, Loader2, Mic, Play, RefreshCw, ScrollText, StopCircle, Volume2, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { ContentItem, VlogLogEntry, VlogProduction, VlogSceneState } from "../api";
import { ConfirmModal } from "./Modal";

// ─────────────────────────────────────────────────────────────
// Salle de production : l'histoire (streamée), le tableau des scènes qui se
// remplit en direct, et le journal des étapes. Sert aussi d'historique.
// ─────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, { label: string; pct: number }> = {
  waiting: { label: "en file…", pct: 0.05 },
  soul: { label: "Image (Soul)…", pct: 0.3 },
  soul_done: { label: "Voix + attente vidéo…", pct: 0.5 },
  video: { label: "Vidéo…", pct: 0.75 },
  done: { label: "Prêt ✓", pct: 1 },
  failed: { label: "Échec", pct: 1 },
};

export function ProductionRoom({
  presetLabel,
  story,
  streaming,
  stepLabel,
  production,
  item,
  onClose,
  onCancel,
  onApproveImages,
  onRegenerateImage,
  embedded = false,
}: {
  presetLabel: string;
  story: string;
  streaming: boolean;
  stepLabel: string;
  production: VlogProduction | null;
  item: ContentItem | null;
  onClose?: () => void;
  onCancel?: () => Promise<void> | void;
  onApproveImages?: () => Promise<void> | void;
  onRegenerateImage?: (idx: number) => Promise<void> | void;
  embedded?: boolean; // affiché dans un modal → pas de carte ni de marge
}) {
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [regenIdx, setRegenIdx] = useState<number | null>(null);

  const assets = (item?.assets ?? {}) as { scenes?: VlogSceneState[]; log?: VlogLogEntry[]; assembling?: boolean; video_url?: string; awaiting_approval?: boolean };
  const awaitingApproval = !!assets.awaiting_approval;
  const states = assets.scenes ?? [];
  const log = assets.log ?? [];
  const scenes = production?.scenes ?? [];
  const finished = item?.status === "needs_review" || item?.status === "published" || item?.status === "scheduled";
  const failed = item?.status === "failed";

  const progress = useMemo(() => {
    if (finished) return 100;
    if (!scenes.length) return streaming ? 4 : 8;
    let p = 12; // histoire écrite
    const per = 80 / scenes.length;
    for (let i = 0; i < scenes.length; i++) {
      const st = states.find((s) => s.idx === i);
      p += per * (st ? PHASE_LABEL[st.phase]?.pct ?? 0 : 0);
    }
    if (assets.assembling) p = Math.max(p, 93);
    return Math.min(97, Math.round(p));
  }, [scenes, states, finished, streaming, assets.assembling]);

  const globalLabel = finished
    ? "Vlog terminé ✓"
    : failed
      ? (item?.error || "Échec de la production")
      : awaitingApproval
        ? "Images prêtes — valide-les pour lancer l'animation"
        : assets.assembling
        ? "Montage final…"
        : streaming
          ? stepLabel || "Le réalisateur écrit…"
          : scenes.length
            ? "Tournage des scènes…"
            : stepLabel || "Préparation…";

  return (
    <div className={embedded ? "" : "card p-5 mb-6 border border-accent/30 ring-1 ring-accent/10"}>
      {/* En-tête + barre globale */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          {finished ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : failed ? <XCircle className="w-5 h-5 text-rose-600" /> : <Loader2 className="w-5 h-5 text-accent animate-spin" />}
          <div>
            <div className="font-semibold text-ink flex items-center gap-2"><Clapperboard className="w-4 h-4 text-accent" /> Production « {production?.title || presetLabel} »</div>
            <div className={`text-xs ${failed ? "text-rose-600" : "text-slate-500"}`}>{globalLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onCancel && !finished && !failed && (
            <button onClick={() => setConfirmCancel(true)} disabled={canceling} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center gap-1.5 disabled:opacity-50">
              {canceling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />} Annuler
            </button>
          )}
          {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>}
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden mb-1">
        <div className={`h-full rounded-full transition-all duration-1000 ease-out ${failed ? "bg-rose-500" : "bg-accent"}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="flex justify-end mb-4"><span className="text-xs text-slate-400">{progress}%</span></div>

      {/* L'histoire (streaming mot à mot) */}
      {(story || streaming) && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5"><ScrollText className="w-3.5 h-3.5" /> L'histoire</div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {story}
            {streaming && <span className="inline-block w-2 h-4 bg-accent align-text-bottom animate-pulse ml-0.5" />}
          </p>
        </div>
      )}

      {/* Validation des images avant animation */}
      {awaitingApproval && onApproveImages && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-slate-700">
            <b>Valide les images</b> — l'animation ne démarre qu'après ton accord.
            <div className="text-xs text-slate-500 mt-0.5">Survole une image pour la régénérer si elle ne te plaît pas.</div>
          </div>
          <button onClick={async () => { setApproving(true); try { await onApproveImages(); } finally { setApproving(false); } }} disabled={approving} className="btn-primary flex items-center gap-2 disabled:opacity-50 shrink-0">
            {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Valider et animer
          </button>
        </div>
      )}

      {/* Tableau des scènes */}
      {scenes.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {scenes.map((sc, i) => {
            const st = states.find((s) => s.idx === i);
            const ph = st ? PHASE_LABEL[st.phase] : null;
            return (
              <div key={i} className="rounded-xl border border-slate-200 overflow-hidden group">
                <div className="relative aspect-[3/4] bg-slate-900 flex items-center justify-center">
                  {st?.keyframe_url ? (
                    <img src={st.keyframe_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  ) : (
                    <Film className="w-6 h-6 text-white/30" />
                  )}
                  {awaitingApproval && onRegenerateImage && st?.keyframe_url && (
                    <button
                      onClick={async () => { setRegenIdx(i); try { await onRegenerateImage(i); } finally { setRegenIdx(null); } }}
                      disabled={regenIdx !== null}
                      className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition flex items-center justify-center opacity-0 group-hover:opacity-100 disabled:opacity-100"
                    >
                      <span className="text-xs font-medium text-white bg-accent px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                        {regenIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Régénérer
                      </span>
                    </button>
                  )}
                  {st?.clip_url && (
                    <a href={st.clip_url} target="_blank" rel="noreferrer" className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/40 transition">
                      <span className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center"><Play className="w-4 h-4 text-ink fill-ink ml-0.5" /></span>
                    </a>
                  )}
                  <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full ${st?.phase === "done" ? "bg-green-100 text-green-700" : st?.phase === "failed" ? "bg-rose-100 text-rose-700" : "bg-white/85 text-slate-600"}`}>
                    {ph ? ph.label : "en attente"}
                  </span>
                  <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/85 text-slate-600 flex items-center gap-0.5">
                    {sc.mode === "talk" ? <><Mic className="w-2.5 h-2.5" /> parle</> : <><Volume2 className="w-2.5 h-2.5" /> voix off</>}
                  </span>
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-semibold text-ink truncate">{i + 1}. {sc.titre}</div>
                  <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">« {sc.texte} »</div>
                  <button onClick={() => setOpenPrompt(openPrompt === i ? null : i)} className="text-[11px] text-accent hover:underline mt-1 flex items-center gap-0.5">
                    {openPrompt === i ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} prompt technique
                  </button>
                  {openPrompt === i && (
                    <div className="mt-1.5 space-y-1">
                      <div className="text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-slate-500"><b>Image :</b> {sc.soul_prompt}</div>
                      <div className="text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-slate-500"><b>Mouvement :</b> {sc.motion_prompt}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Journal live */}
      {log.length > 0 && (
        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <button onClick={() => setShowLog(!showLog)} className="w-full flex items-center justify-between px-3.5 py-2 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Journal de production {showLog ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {showLog && (
            <div className="max-h-44 overflow-y-auto px-3.5 py-2 space-y-1">
              {[...log].reverse().map((l, i) => (
                <div key={i} className="text-xs text-slate-600 flex gap-2">
                  <span className="text-slate-300 shrink-0 tabular-nums">{new Date(l.t).toLocaleTimeString("fr-FR")}</span>
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Résultat final */}
      {finished && assets.video_url && (
        <a href={assets.video_url} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-2 mt-4"><Play className="w-4 h-4" /> Voir le vlog complet</a>
      )}

      <ConfirmModal
        open={confirmCancel}
        title="Annuler la production ?"
        message="La génération s'arrête immédiatement. Les scènes déjà produites sont conservées mais la vidéo finale ne sera pas montée."
        confirmLabel="Arrêter la production"
        danger
        onConfirm={async () => {
          setConfirmCancel(false);
          setCanceling(true);
          try { await onCancel?.(); } finally { setCanceling(false); }
        }}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  );
}
