import { CheckCircle2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useJourney } from "../lib/journey";

// ─────────────────────────────────────────────────────────────
// GUIDE FLOTTANT (14 sept. 2026, demande de Jérôme) — remplace la page d'accueil dédiée : un petit
// personnage en bas à droite, une bulle avec l'étape en cours, et un panneau qui suit l'utilisateur
// sur toutes les pages. Les étapes viennent de lib/journey.ts (cochées d'après les données réelles).
//   • la bulle propose l'étape suivante ; le panneau détaille (quoi, comment, où, coût) ;
//   • « Plus tard » replie, « Ne plus afficher » masque pour ce navigateur ;
//   • l'étape affichée suit la page ouverte (Studio → étape « Génération », etc.).
// ─────────────────────────────────────────────────────────────

const HIDE_KEY = "viralya.guide.hidden";
const OPEN_KEY = "viralya.guide.open";
const read = (k: string): boolean => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const write = (k: string, v: boolean): void => { try { if (v) localStorage.setItem(k, "1"); else localStorage.removeItem(k); } catch { /* stockage indisponible */ } };

/** Le petit bonhomme : rond, deux yeux, un sourire, une antenne — dans les couleurs de la charte. */
export function Mascot({ size = 56, mood = "happy", className = "" }: { size?: number; mood?: "happy" | "done" | "think"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      {/* antenne */}
      <line x1="32" y1="14" x2="32" y2="6" stroke="#2A3EAF" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3" fill="#F2B84B" />
      {/* corps */}
      <rect x="22" y="40" width="20" height="16" rx="8" fill="#2A3EAF" />
      {/* bras */}
      <path d="M22 45 L14 50" stroke="#2A3EAF" strokeWidth="4" strokeLinecap="round" />
      <path d={mood === "done" ? "M42 45 L50 38" : "M42 45 L50 50"} stroke="#2A3EAF" strokeWidth="4" strokeLinecap="round" />
      {/* pieds */}
      <ellipse cx="27" cy="58" rx="4" ry="2.2" fill="#1F2F8C" />
      <ellipse cx="37" cy="58" rx="4" ry="2.2" fill="#1F2F8C" />
      {/* tête */}
      <circle cx="32" cy="27" r="15" fill="#FFFFFF" stroke="#2A3EAF" strokeWidth="2.5" />
      {/* yeux */}
      {mood === "think" ? (
        <>
          <path d="M25 26 Q27.5 24 30 26" stroke="#14171C" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="37.5" cy="26" r="2.2" fill="#14171C" />
        </>
      ) : (
        <>
          <circle cx="26.5" cy="26" r="2.2" fill="#14171C" />
          <circle cx="37.5" cy="26" r="2.2" fill="#14171C" />
        </>
      )}
      {/* joues */}
      <circle cx="22.5" cy="30" r="2" fill="#F5C6C0" opacity="0.8" />
      <circle cx="41.5" cy="30" r="2" fill="#F5C6C0" opacity="0.8" />
      {/* bouche */}
      {mood === "think" ? <path d="M28 34 Q32 33 36 34" stroke="#14171C" strokeWidth="2" fill="none" strokeLinecap="round" /> : <path d="M26.5 32.5 Q32 38 37.5 32.5" stroke="#14171C" strokeWidth="2" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

/** Étape à mettre en avant selon la page ouverte. */
function stepForPath(path: string): string | null {
  if (/^\/avatars\/(create|new)/.test(path)) return "avatar";
  if (/\/bible/.test(path)) return "universe";
  if (/\/calendar/.test(path)) return "calendar";
  if (/\/studio/.test(path)) return "content";
  if (/\/social/.test(path)) return "publish";
  if (path.startsWith("/content")) return "review";
  if (path.startsWith("/ugc")) return "ugc";
  return null;
}

export function Guide() {
  const location = useLocation();
  const journey = useJourney();
  const [hidden, setHidden] = useState(() => read(HIDE_KEY));
  const [open, setOpen] = useState(() => read(OPEN_KEY));
  const [cursor, setCursor] = useState<number | null>(null);

  // L'étape suit la page ; sinon la prochaine étape non faite.
  const contextual = useMemo(() => stepForPath(location.pathname), [location.pathname]);
  useEffect(() => { setCursor(null); }, [location.pathname]);

  const steps = journey.steps;
  const nextIdx = Math.max(0, steps.findIndex((s) => !s.done));
  const ctxIdx = contextual ? steps.findIndex((s) => s.key === contextual) : -1;
  const idx = cursor ?? (ctxIdx >= 0 ? ctxIdx : nextIdx);
  const step = steps[idx];
  const allDone = !journey.loading && journey.done === steps.length;

  if (hidden || !step || location.pathname === "/bienvenue") return null;

  const toggle = (v: boolean) => { setOpen(v); write(OPEN_KEY, v); };
  const hide = () => { setHidden(true); write(HIDE_KEY, true); };
  const mood = allDone || step.done ? "done" : journey.loading ? "think" : "happy";

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)]" aria-live="polite">
      {open ? (
        <section className="w-[340px] max-w-full bg-white rounded-2xl shadow-card border border-rule-soft overflow-hidden" style={{ animation: "modalIn .16s ease-out" }} role="dialog" aria-label="Guide de démarrage">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-rule-soft">
            <Mascot size={40} mood={mood} />
            <div className="min-w-0 flex-1">
              <div className="eyebrow">Guide · étape {idx + 1} sur {steps.length}</div>
              <div className="h-1.5 rounded-full bg-paper mt-1.5 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round((journey.done / steps.length) * 100)}%` }} /></div>
            </div>
            <button onClick={() => toggle(false)} className="p-1 rounded text-muted hover:text-ink hover:bg-paper-2" aria-label="Replier le guide"><X className="w-4 h-4" /></button>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-start gap-2">
              {step.done && <CheckCircle2 className="w-4 h-4 text-ok mt-0.5 shrink-0" />}
              <h2 className="font-sans font-bold text-[15px] text-ink leading-tight" style={{ textWrap: "balance" } as never}>{step.title}</h2>
            </div>
            <p className="text-sm text-ink-2 mt-1.5">{step.explain}</p>
            <ul className="mt-2 space-y-1">
              {step.points.map((p) => <li key={p} className="text-xs text-muted flex gap-1.5"><span className="text-accent">•</span><span>{p}</span></li>)}
            </ul>
            {step.cost && <div className="text-[11px] text-cost mt-2">Coût : {step.cost}</div>}
            <div className="flex items-center gap-2 mt-3">
              <Link to={step.to} onClick={() => toggle(false)} className="btn-primary text-sm flex-1 justify-center">{step.done ? "Y retourner" : step.cta}</Link>
              <button onClick={() => setCursor(Math.max(0, idx - 1))} disabled={idx === 0} className="p-2 rounded border border-rule text-ink-2 hover:bg-paper-2 disabled:opacity-30" aria-label="Étape précédente"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setCursor(Math.min(steps.length - 1, idx + 1))} disabled={idx === steps.length - 1} className="p-2 rounded border border-rule text-ink-2 hover:bg-paper-2 disabled:opacity-30" aria-label="Étape suivante"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center justify-between mt-3 text-[11px] text-muted">
              <button onClick={() => toggle(false)} className="hover:text-ink">Plus tard</button>
              <button onClick={hide} className="hover:text-ink">Ne plus afficher</button>
            </div>
          </div>
        </section>
      ) : (
        <button onClick={() => toggle(true)} className="group flex items-end gap-2" aria-label="Ouvrir le guide de démarrage">
          <span className="hidden sm:block max-w-[220px] bg-white border border-rule-soft shadow-card rounded-2xl rounded-br-sm px-3 py-2 text-left text-xs text-ink-2 group-hover:text-ink" style={{ animation: "modalIn .2s ease-out" }}>
            {allDone ? "Tout est en place. Je reste là si tu as besoin." : journey.loading ? "Je regarde où tu en es…" : <>{journey.done > 0 ? "Prochaine étape : " : "On commence ? "}<span className="font-semibold text-ink">{steps[nextIdx]?.title}</span></>}
          </span>
          <span className="guide-mascot rounded-full bg-white shadow-card border border-rule-soft p-1"><Mascot size={48} mood={mood} /></span>
        </button>
      )}
    </div>
  );
}
