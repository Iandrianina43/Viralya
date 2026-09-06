import { CheckCircle2, ChevronRight, Circle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Avatar, type ContentItem } from "../api";

// ─────────────────────────────────────────────────────────────
// ONBOARDING (BRIEF § 3) — intégré au produit : huit étapes du parcours principal,
// cochées automatiquement d'après les données réelles de l'organisation, chacune
// menant à l'écran où elle se fait. Se replie une fois tout accompli ou si l'utilisateur
// le ferme (mémorisé dans le navigateur).
// ─────────────────────────────────────────────────────────────

interface Step { key: string; title: string; hint: string; to: string; done: boolean }

const KEY = "viralya.onboarding.dismissed";

export function Onboarding({ avatars, content }: { avatars: Avatar[]; content: ContentItem[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [universe, setUniverse] = useState<boolean | null>(null);
  const [calendar, setCalendar] = useState<boolean | null>(null);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY) === "1"); } catch { /* stockage indisponible */ }
  }, []);

  const first = avatars[0];
  useEffect(() => {
    if (!first) { setUniverse(false); setCalendar(false); return; }
    api.listLocations(first.id, "all").then((r) => setUniverse(r.locations.length > 0)).catch(() => setUniverse(false));
    api.listPlans(first.id).then((r) => setCalendar(r.plans.length > 0)).catch(() => setCalendar(false));
  }, [first?.id]);

  const steps = useMemo<Step[]>(() => {
    const hasAvatar = avatars.length > 0;
    const hasPortrait = avatars.some((a) => !!a.ref_image_url);
    const anyContent = content.length > 0;
    const reviewed = content.some((c) => ["scheduled", "published"].includes(c.status));
    const video = content.some((c) => c.type === "video" && !!(c.assets as { video_url?: string })?.video_url);
    const published = content.some((c) => c.status === "published");
    const id = first?.id;
    return [
      { key: "avatar", title: "Créer ton premier influenceur", hint: "Identité, personnalité, voix et portrait.", to: "/avatars/create", done: hasAvatar && hasPortrait },
      { key: "universe", title: "Construire son univers", hint: "Ses lieux, sa garde-robe, ses références visuelles.", to: id ? `/avatars/${id}/bible` : "/avatars", done: !!universe },
      { key: "calendar", title: "Générer le calendrier du mois", hint: "Une stratégie et un planning qui racontent une histoire.", to: id ? `/avatars/${id}/calendar` : "/avatars", done: !!calendar },
      { key: "content", title: "Produire un premier contenu", hint: "Une photo ou une vidéo depuis le calendrier ou le studio.", to: id ? `/avatars/${id}/studio` : "/avatars", done: anyContent },
      { key: "review", title: "Valider les générations", hint: "Chaque contenu passe par ta revue avant d'être programmé.", to: "/content", done: reviewed },
      { key: "video", title: "Obtenir une vidéo finale", hint: "Prise unique Seedance 2.5 : voix, décor, montage.", to: id ? `/avatars/${id}/studio` : "/avatars", done: video },
      { key: "publish", title: "Programmer et publier", hint: "Sur le compte simulé, puis sur les vrais réseaux.", to: id ? `/avatars/${id}/social` : "/content", done: published },
      { key: "ugc", title: "Lancer une campagne UGC", hint: "Un produit, des angles, des accroches : une matrice de vidéos.", to: "/ugc", done: content.some((c) => (c.payload as { kind?: string })?.kind === "ugc") },
    ];
  }, [avatars, content, universe, calendar, first?.id]);

  const done = steps.filter((s) => s.done).length;
  if (dismissed || (universe !== null && calendar !== null && done === steps.length)) return null;
  const next = steps.find((s) => !s.done);

  const close = () => { setDismissed(true); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };

  return (
    <section className="card p-5 mb-6 border-accent/30 bg-gradient-to-br from-white to-orange-50/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">Premiers pas</div>
          <h2 className="text-lg font-bold text-ink mt-0.5">Viralya en 8 étapes : de l'influenceur à la publication</h2>
          <p className="text-sm text-slate-500 mt-1">Chaque étape se coche toute seule quand c'est fait. {next ? <>Prochaine : <span className="font-medium text-ink">{next.title}</span>.</> : "Tout est en place."}</p>
        </div>
        <button onClick={close} className="text-slate-400 hover:text-slate-600 p-1" title="Masquer"><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>
      <ol className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link to={s.to} className={`flex items-start gap-2.5 rounded-xl border p-3 h-full transition ${s.done ? "border-green-200 bg-green-50/60" : s === next ? "border-accent bg-white shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              {s.done ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> : <Circle className={`w-4 h-4 mt-0.5 shrink-0 ${s === next ? "text-accent" : "text-slate-300"}`} />}
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink leading-tight">{i + 1}. {s.title}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{s.hint}</span>
              </span>
              {!s.done && <ChevronRight className="w-4 h-4 text-slate-300 ml-auto mt-0.5 shrink-0" />}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
