import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PlanEntry } from "../api";
import { EmptyState, ErrorState, PageHeader, SkeletonList } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// Calendrier global (audit P2) : les prochaines entrées planifiées de tous les influenceurs de l'espace,
// groupées par jour, avec le lien vers le calendrier de chacun.
// ─────────────────────────────────────────────────────────────

type Entry = PlanEntry & { avatar_name: string | null };
const STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: "Planifié", cls: "bg-slate-100 text-slate-600" },
  generating: { label: "En production", cls: "bg-accent-light text-accent" },
  ready: { label: "Prêt à valider", cls: "bg-ok-soft text-ok" },
  scheduled: { label: "Programmé", cls: "bg-accent-light text-accent" },
  published: { label: "Publié", cls: "bg-ok-soft text-ok" },
  skipped: { label: "Ignoré", cls: "bg-slate-100 text-slate-400" },
  failed: { label: "Échec", cls: "bg-warn-soft text-warn" },
};
const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

export function Upcoming() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.upcomingEntries().then((r) => { setEntries(r.entries); setErr(null); }).catch((e) => setErr(String((e as Error).message ?? e)));
  useEffect(() => { void load(); }, []);

  const byDay = new Map<string, Entry[]>();
  for (const e of entries ?? []) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  return (
    <div>
      <PageHeader eyebrow="Tous les influenceurs" title="Calendrier" description="Ce qui est prévu dans les prochains jours, influenceur par influenceur. Le détail et le pilote automatique se règlent dans le calendrier de chacun." />
      {err ? <ErrorState message={err} retry={load} /> : entries == null ? <SkeletonList rows={5} /> : entries.length === 0 ? (
        <EmptyState icon={<CalendarDays className="w-6 h-6" />} title="Rien de planifié" hint="Génère le calendrier du mois d'un influenceur depuis son onglet Calendrier." action={<Link to="/avatars" className="btn-primary">Voir les influenceurs</Link>} />
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{fmtDay.format(new Date(`${day}T12:00:00`))}</h2>
              <div className="card divide-y divide-slate-100">
                {list.map((e) => {
                  const st = STATUS[e.status] ?? { label: e.status, cls: "bg-slate-100 text-slate-500" };
                  return (
                    <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="text-xs text-slate-400 w-12 shrink-0">{e.slot}</span>
                      <Link to={`/avatars/${e.avatar_id}/calendar`} className="font-medium text-ink hover:underline">{e.avatar_name ?? "Influenceur"}</Link>
                      <span className="text-slate-600 flex-1 min-w-[200px] truncate">{e.title}</span>
                      <span className="text-xs text-slate-400">{e.type} · {e.network}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
