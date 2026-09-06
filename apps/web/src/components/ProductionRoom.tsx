import { MediaButton } from "./MediaViewer";
import { CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Film, Link2, Loader2, Mic, Play, RefreshCw, ScrollText, StopCircle, Volume2, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { ContentItem, SegmentState, ShotState, VlogLogEntry, VlogProduction } from "../api";
import { ConfirmModal } from "./Modal";

// ─────────────────────────────────────────────────────────────
// Salle de production : l'histoire (streamée), puis
//  - vidéo HYBRIDE : les plans (parlés en lip-sync / b-roll avec voix off), leur
//    voix, leur score visage, et la régénération plan par plan ;
//  - plan-séquence Seedance (historique) : les segments enchaînés.
// Journal des étapes. Sert aussi d'historique.
// ─────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, { label: string; pct: number }> = {
  waiting: { label: "en attente…", pct: 0.05 },
  video: { label: "Tournage…", pct: 0.55 },
  done: { label: "Prêt ✓", pct: 1 },
  failed: { label: "Échec", pct: 1 },
};

const SHOT_PHASE: Record<string, { label: string; pct: number }> = {
  voice: { label: "Voix…", pct: 0.1 },
  waiting: { label: "en attente…", pct: 0.25 },
  video: { label: "Rendu…", pct: 0.6 },
  done: { label: "Prêt ✓", pct: 1 },
  failed: { label: "Échec", pct: 1 },
};

const PROVIDER_LABEL: Record<string, string> = { "seedance-2.5": "Seedance 2.5", "kling-avatar": "Kling Avatar", omnihuman: "OmniHuman", seedance: "Seedance" };

export function ProductionRoom({
  presetLabel,
  story,
  streaming,
  stepLabel,
  production,
  item,
  onClose,
  onCancel,
  onRegenerateShot,
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
  /** Vidéo hybride : régénère UN plan (texte modifié → voix refaite). */
  onRegenerateShot?: (idx: number, texte?: string) => Promise<void> | void;
  embedded?: boolean; // affiché dans un modal → pas de carte ni de marge
}) {
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [editShot, setEditShot] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [regenBusy, setRegenBusy] = useState<number | null>(null);

  const assets = (item?.assets ?? {}) as {
    segments?: SegmentState[]; shots?: ShotState[]; format?: string; log?: VlogLogEntry[]; assembling?: boolean;
    video_url?: string; estimated_cost_usd?: number; subtitled?: boolean; video_seconds?: number;
  };
  const payload = (item?.payload ?? {}) as { format?: string; talk_provider?: string };
  const hybrid = payload.format === "hybrid" || (assets.shots?.length ?? 0) > 0;
  const states = assets.segments ?? [];
  const shots = assets.shots ?? [];
  const log = assets.log ?? [];
  const scenes = production?.scenes ?? [];
  const count = hybrid ? Math.max(scenes.length, shots.length) : Math.max(scenes.length, states.length);
  const finished = item?.status === "needs_review" || item?.status === "published" || item?.status === "scheduled";
  const failed = item?.status === "failed";
  const canRegenerate = !!onRegenerateShot && hybrid && (finished || failed);

  const progress = useMemo(() => {
    if (finished) return 100;
    if (!count) return streaming ? 4 : 8;
    let p = 12; // histoire écrite
    const per = 80 / count;
    for (let i = 0; i < count; i++) {
      if (hybrid) {
        const sh = shots.find((s) => s.idx === i);
        p += per * (sh ? SHOT_PHASE[sh.phase]?.pct ?? 0 : 0);
      } else {
        const st = states.find((s) => s.idx === i);
        p += per * (st ? PHASE_LABEL[st.phase]?.pct ?? 0 : 0);
      }
    }
    if (assets.assembling) p = Math.max(p, 93);
    return Math.min(97, Math.round(p));
  }, [count, states, shots, hybrid, finished, streaming, assets.assembling]);

  const globalLabel = finished
    ? "Vidéo terminée ✓"
    : failed
      ? (item?.error || "Échec de la production")
      : assets.assembling
        ? "Montage final (voix off, sous-titres)…"
        : streaming
          ? stepLabel || "Le réalisateur écrit…"
          : count
            ? hybrid
              ? shots.some((s) => s.phase === "voice") || !shots.length
                ? "Voix ElevenLabs en cours…"
                : "Plans en rendu (avatar parlant, b-roll)…"
              : "Tournage plan-séquence (les segments s'enchaînent)…"
            : stepLabel || "Préparation…";

  const regenerate = async (idx: number, texte?: string) => {
    if (!onRegenerateShot) return;
    setRegenBusy(idx);
    try { await onRegenerateShot(idx, texte); setEditShot(null); } finally { setRegenBusy(null); }
  };

  return (
    <div className={embedded ? "" : "card p-5 mb-6 border border-accent/30 ring-1 ring-accent/10"}>
      {/* En-tête + barre globale */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          {finished ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : failed ? <XCircle className="w-5 h-5 text-rose-600" /> : <Loader2 className="w-5 h-5 text-accent animate-spin" />}
          <div>
            <div className="font-semibold text-ink flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-accent" /> Production « {production?.title || presetLabel} »
              {hybrid && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">hybride</span>}
            </div>
            <div className={`text-xs ${failed ? "text-rose-600" : "text-slate-500"}`}>{globalLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {typeof assets.estimated_cost_usd === "number" && (
            <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500" title="Coût estimé de la production">≈ {assets.estimated_cost_usd.toFixed(2)} $</span>
          )}
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

      {/* ── Plans (vidéo hybride) ── */}
      {hybrid && count > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {Array.from({ length: count }, (_, i) => {
            const sc = scenes[i];
            const sh = shots.find((s) => s.idx === i);
            const ph = sh ? SHOT_PHASE[sh.phase] : null;
            const role = sh?.role ?? (sc?.mode === "talk" ? "talk" : "broll");
            const qc = sh?.qc;
            const qcCls = qc?.verdict === "pass" ? "bg-green-100 text-green-700" : qc?.verdict === "review" ? "bg-amber-100 text-amber-700" : qc?.verdict === "fail" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500";
            return (
              <div key={i} className="rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="relative aspect-[3/4] bg-slate-900 flex items-center justify-center">
                  {sh?.clip_url ? (
                    <video src={sh.clip_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : sh?.keyframe_url && role === "talk" ? (
                    <img src={sh.keyframe_url} alt="" className="w-full h-full object-cover opacity-60" />
                  ) : (
                    <Film className={`w-6 h-6 ${sh?.phase === "video" ? "text-accent animate-pulse" : "text-white/30"}`} />
                  )}
                  {sh?.clip_url && (
                    <MediaButton url={sh.clip_url} title={`${i + 1}. ${sh.titre}`} subtitle={sh.provider ? PROVIDER_LABEL[sh.provider] ?? sh.provider : null} className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/40 transition">
                      <span className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center"><Play className="w-4 h-4 text-ink fill-ink ml-0.5" /></span>
                    </MediaButton>
                  )}
                  <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full ${sh?.phase === "done" ? "bg-green-100 text-green-700" : sh?.phase === "failed" ? "bg-rose-100 text-rose-700" : "bg-white/85 text-slate-600"}`}>
                    {ph ? ph.label : "en attente"}
                  </span>
                  <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/85 text-slate-600 flex items-center gap-0.5">
                    {role === "talk" ? <><Mic className="w-2.5 h-2.5" /> parle</> : <><Volume2 className="w-2.5 h-2.5" /> voix off</>}
                  </span>
                  {sh?.provider && (
                    <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/85 text-slate-500">{PROVIDER_LABEL[sh.provider] ?? sh.provider}</span>
                  )}
                  {(sh?.audio_seconds ?? sh?.duration ?? sc?.duration_sec) != null && (
                    <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-black/50 text-white">{Math.round(sh?.audio_seconds ?? sh?.duration ?? sc?.duration_sec ?? 0)}s</span>
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col">
                  <div className="text-xs font-semibold text-ink truncate">{i + 1}. {sh?.titre ?? sc?.titre ?? `Plan ${i + 1}`}</div>
                  {editShot === i ? (
                    <div className="mt-1.5">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent h-20 resize-none" />
                      <div className="flex gap-1.5 mt-1.5">
                        <button onClick={() => void regenerate(i, editText.trim())} disabled={regenBusy !== null || editText.trim().length < 3} className="text-[11px] px-2 py-1 rounded-lg bg-accent text-white disabled:opacity-50 flex items-center gap-1">
                          {regenBusy === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Régénérer avec ce texte
                        </button>
                        <button onClick={() => setEditShot(null)} className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-500">Annuler</button>
                      </div>
                    </div>
                  ) : (
                    (sh?.texte || sc?.texte) && <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">« {sh?.texte || sc?.texte} »</div>
                  )}
                  {sh?.audio_url && <audio controls preload="none" src={sh.audio_url} className="w-full h-7 mt-1.5" />}
                  <div className="flex items-center gap-1 flex-wrap mt-1.5">
                    {role === "talk" && qc && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${qcCls}`} title={qc.note ?? ""}>
                        visage {qc.face_score != null ? qc.face_score.toFixed(2) : "?"}
                      </span>
                    )}
                    {typeof sh?.dialogue_score === "number" && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sh.dialogue_score >= 0.85 ? "bg-green-100 text-green-700" : sh.dialogue_score >= 0.6 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`} title={sh.transcript ?? ""}>
                        texte {Math.round(sh.dialogue_score * 100)} %
                      </span>
                    )}
                    {typeof sh?.cost_usd === "number" && sh.cost_usd > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{sh.cost_usd.toFixed(2)} $</span>}
                    {sh?.tts_model && <span className="text-[10px] text-slate-400">{sh.tts_model === "eleven_v3" ? "voix v3" : "voix v2"}</span>}
                  </div>
                  {(sh?.inserts?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sh!.inserts!.map((ins, k) => (
                        <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded-full ${ins.error ? "bg-slate-100 text-slate-400 line-through" : "bg-violet-50 text-violet-700"}`} title={ins.error ?? ins.desc ?? ""}>
                          insert « {ins.anchor} »{ins.at != null ? ` à ${ins.at.toFixed(1)} s` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {sh?.error && <div className="text-[11px] text-rose-600 line-clamp-2 mt-0.5">{sh.error}</div>}
                  {sh?.prompt && (
                    <>
                      <button onClick={() => setOpenPrompt(openPrompt === i ? null : i)} className="text-[11px] text-accent hover:underline mt-1 flex items-center gap-0.5">
                        {openPrompt === i ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} prompt envoyé
                      </button>
                      {openPrompt === i && <pre className="mt-1.5 text-[10px] leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-slate-600 whitespace-pre-wrap">{sh.prompt}</pre>}
                    </>
                  )}
                  {canRegenerate && sh && editShot !== i && (
                    <div className="flex gap-1.5 mt-auto pt-2">
                      <button onClick={() => void regenerate(i)} disabled={regenBusy !== null} className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1" title="Même texte, nouveau rendu">
                        {regenBusy === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Régénérer
                      </button>
                      {sh.texte && (
                        <button onClick={() => { setEditShot(i); setEditText(sh.texte); }} disabled={regenBusy !== null} className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                          Modifier le texte
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Segments du plan-séquence Seedance (historique) ── */}
      {!hybrid && count > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {Array.from({ length: count }, (_, i) => {
            const sc = scenes[i];
            const st = states.find((s) => s.idx === i);
            const ph = st ? PHASE_LABEL[st.phase] : null;
            return (
              <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="relative aspect-[3/4] bg-slate-900 flex items-center justify-center">
                  {st?.clip_url ? (
                    <video src={st.clip_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <Film className={`w-6 h-6 ${st?.phase === "video" ? "text-accent animate-pulse" : "text-white/30"}`} />
                  )}
                  {st?.clip_url && (
                    <MediaButton url={st.clip_url} title={`Segment ${i + 1}`} className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/40 transition">
                      <span className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center"><Play className="w-4 h-4 text-ink fill-ink ml-0.5" /></span>
                    </MediaButton>
                  )}
                  <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full ${st?.phase === "done" ? "bg-green-100 text-green-700" : st?.phase === "failed" ? "bg-rose-100 text-rose-700" : "bg-white/85 text-slate-600"}`}>
                    {ph ? ph.label : "en attente"}
                  </span>
                  <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/85 text-slate-600 flex items-center gap-0.5">
                    {sc?.mode === "talk" ? <><Mic className="w-2.5 h-2.5" /> parle</> : <><Volume2 className="w-2.5 h-2.5" /> voix off</>}
                  </span>
                  {i > 0 && (
                    <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/85 text-slate-500 flex items-center gap-0.5" title="Ce segment prolonge le précédent (plan-séquence)">
                      <Link2 className="w-2.5 h-2.5" /> enchaîné
                    </span>
                  )}
                  {(sc?.duration_sec ?? st?.duration) != null && (
                    <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-black/50 text-white">{sc?.duration_sec ?? st?.duration}s</span>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-semibold text-ink truncate">{i + 1}. {sc?.titre ?? st?.titre ?? `Segment ${i + 1}`}</div>
                  {sc?.texte && <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">« {sc.texte} »</div>}
                  {st?.error && <div className="text-[11px] text-rose-600 line-clamp-2 mt-0.5">{st.error}</div>}
                  {(st?.prompt || sc?.action) && (
                    <>
                      <button onClick={() => setOpenPrompt(openPrompt === i ? null : i)} className="text-[11px] text-accent hover:underline mt-1 flex items-center gap-0.5">
                        {openPrompt === i ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {st?.prompt ? "prompt envoyé à Seedance" : "direction cinématographique"}
                      </button>
                      {openPrompt === i && (
                        st?.prompt ? (
                          <pre className="mt-1.5 text-[10px] leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-slate-600 whitespace-pre-wrap">{st.prompt}</pre>
                        ) : (
                          <div className="mt-1.5 text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-slate-500 space-y-0.5">
                            <div><b>Action :</b> {sc!.action}</div>
                            {(sc!.shots ?? []).length > 0 && <div><b>Timeline :</b> {sc!.shots.map((sh) => `${sh.t ? `${sh.t}: ` : ""}${sh.desc}`).join(" · ")}</div>}
                            {sc!.scene_desc && <div><b>Scène :</b> {sc!.scene_desc}</div>}
                            {sc!.camera && <div><b>Caméra :</b> {sc!.camera}</div>}
                            {sc!.lighting && <div><b>Éclairage :</b> {sc!.lighting}</div>}
                            {sc!.audio_ambiance && <div><b>Audio :</b> {sc!.audio_ambiance}</div>}
                            {sc!.constraints && <div><b>Contraintes :</b> {sc!.constraints}</div>}
                          </div>
                        )
                      )}
                    </>
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
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <MediaButton url={assets.video_url} title="Vidéo complète" subtitle={assets.video_seconds ? `${Math.round(assets.video_seconds)} s` : null} className="btn-primary inline-flex items-center gap-2"><Play className="w-4 h-4" /> Voir la vidéo complète</MediaButton>
          {hybrid && <span className="text-xs text-slate-400">{assets.video_seconds ? `${Math.round(assets.video_seconds)} s` : ""}{assets.subtitled ? " · sous-titrée" : ""}{canRegenerate ? " · chaque plan peut être régénéré, la vidéo est remontée" : ""}</span>}
        </div>
      )}

      <ConfirmModal
        open={confirmCancel}
        title="Annuler la production ?"
        message="La génération s'arrête immédiatement. Les plans déjà produits sont conservés mais la vidéo finale ne sera pas assemblée."
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
