import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ClipboardCheck, Film, Megaphone, Send, Sparkles, UserRound, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { markWelcomeSeen, useJourney } from "../lib/journey";

import { Skeleton } from "../components/ui";
// ─────────────────────────────────────────────────────────────
// GUIDE DE DÉMARRAGE (BRIEF § 3) — le parcours complet en huit étapes, chacune expliquée
// simplement, avec le bouton pour aller le faire, et cochée dès que c'est fait.
// S'ouvre à la première connexion ; reste dans le menu (« Guide »).
// ─────────────────────────────────────────────────────────────

const ICONS = [UserRound, BookOpen, CalendarDays, Wand2, ClipboardCheck, Film, Send, Megaphone];
const TONES = [
  "from-orange-400 to-rose-500", "from-sky-400 to-indigo-500", "from-emerald-400 to-teal-600", "from-violet-400 to-fuchsia-500",
  "from-amber-400 to-orange-500", "from-slate-600 to-slate-900", "from-pink-400 to-rose-600", "from-lime-400 to-emerald-600",
];

export function Welcome() {
  const nav = useNavigate();
  const journey = useJourney();
  const [i, setI] = useState(0);
  const step = journey.steps[i]!;
  const Icon = ICONS[i] ?? Sparkles;

  useEffect(() => { markWelcomeSeen(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, journey.steps.length - 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0)); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [journey.steps.length]);

  const last = i === journey.steps.length - 1;

  return (
    <div className="max-w-5xl mx-auto">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Guide de démarrage</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mt-1">Viralya, de l'influenceur à la publication</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">Tu crées un influenceur IA, tu construis son univers, puis Viralya écrit son calendrier, génère ses contenus, te les fait valider, monte les vidéos et publie. Huit étapes, toujours dans cet ordre.</p>
        </div>
        <div className="text-right">
          {journey.loading ? <Skeleton className="h-7 w-14 ml-auto" /> : <div className="text-2xl font-bold text-ink leading-none">{journey.done}<span className="text-slate-300">/{journey.steps.length}</span></div>}
          <div className="text-xs text-slate-500">étapes faites</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Stepper */}
        <ol className="card p-2 flex lg:flex-col gap-1 overflow-x-auto">
          {journey.steps.map((s, k) => {
            const I = ICONS[k] ?? Sparkles;
            const active = k === i;
            return (
              <li key={s.key} className="shrink-0">
                <button onClick={() => setI(k)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition ${active ? "bg-accent-soft text-accent" : "hover:bg-paper-2 text-ink-2"}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s.done ? "bg-green-500 text-white" : active ? "bg-accent text-white" : "bg-slate-100 text-slate-500"}`}>
                    {s.done ? <Check className="w-3.5 h-3.5" /> : k + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold truncate ${active ? "text-accent" : "text-ink"}`}>{s.short}</span>
                    <span className="hidden lg:block text-[11px] text-slate-400 truncate">{s.done ? "fait" : s.cost ?? "gratuit"}</span>
                  </span>
                  <I className="w-4 h-4 ml-auto shrink-0 opacity-60 hidden lg:block" />
                </button>
              </li>
            );
          })}
        </ol>

        {/* Carte de l'étape */}
        <div className="card overflow-hidden">
          <div className={`relative h-44 sm:h-52 bg-gradient-to-br ${TONES[i]} flex items-center justify-center`}>
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, white 0, transparent 40%), radial-gradient(circle at 80% 70%, white 0, transparent 35%)" }} />
            <div className="relative flex items-center gap-5 text-white">
              <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center border border-white/30"><Icon className="w-10 h-10" strokeWidth={1.6} /></div>
              <div>
                <div className="text-xs uppercase tracking-[0.15em] opacity-80">Étape {i + 1} sur {journey.steps.length}</div>
                <div className="text-2xl sm:text-3xl font-bold leading-tight mt-1" style={{ textWrap: "balance" }}>{step.title}</div>
                {step.done && <div className="inline-flex items-center gap-1 mt-2 text-xs bg-white/20 rounded-full px-2 py-0.5"><CheckCircle2 className="w-3.5 h-3.5" /> déjà fait</div>}
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            <p className="text-[15px] text-ink leading-relaxed max-w-2xl">{step.explain}</p>
            <ul className="mt-4 space-y-2">
              {step.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-slate-600"><span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-accent shrink-0" />{p}</li>
              ))}
            </ul>
            {step.cost && <div className="mt-4 inline-block text-xs px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800">Coût : {step.cost}</div>}

            <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-rule-soft">
              <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} className="btn-secondary disabled:opacity-40"><ArrowLeft className="w-4 h-4" /> Précédent</button>
              <Link to={step.to} className={step.done ? "btn-secondary" : "btn-primary"}>{step.done ? "Revoir" : step.cta} <ArrowRight className="w-4 h-4" /></Link>
              <div className="ml-auto flex items-center gap-2">
                {!last ? (
                  <button onClick={() => setI((x) => Math.min(journey.steps.length - 1, x + 1))} className="btn-secondary">Suivant <ArrowRight className="w-4 h-4" /></button>
                ) : (
                  <button onClick={() => nav("/dashboard")} className="btn-primary"><Sparkles className="w-4 h-4" /> C'est parti</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-400 mt-4">Flèches ← → pour naviguer · ce guide reste dans le menu « Guide »</div>
    </div>
  );
}
