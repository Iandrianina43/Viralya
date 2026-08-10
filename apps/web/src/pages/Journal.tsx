import { BookOpen, CalendarDays, FileText, Info, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type MemoryEntry } from "../api";
import { ConfirmModal } from "../components/Modal";

const KIND: Record<string, { label: string; color: string; icon: typeof Info }> = {
  fact: { label: "Fait", color: "bg-blue-100 text-blue-700", icon: Info },
  storyline: { label: "Histoire", color: "bg-purple-100 text-purple-700", icon: BookOpen },
  life_event: { label: "Événement", color: "bg-amber-100 text-amber-700", icon: CalendarDays },
  content_ref: { label: "Publié", color: "bg-slate-100 text-slate-500", icon: FileText },
};

export function Journal() {
  const { id } = useParams();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [kind, setKind] = useState("fact");
  const [summary, setSummary] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<MemoryEntry | null>(null);

  const load = () => id && api.getMemory(id).then((r) => setEntries(r.memory)).catch((e) => setErr(String(e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const add = async () => {
    if (!id || summary.trim().length < 2) return;
    try { await api.addMemory(id, { kind, summary, status: kind === "storyline" ? "open" : "active" }); setSummary(""); await load(); }
    catch (e) { setErr(String(e)); }
  };
  const doDelete = async () => {
    if (!id || !confirmDel) return;
    const mid = confirmDel.id; setConfirmDel(null);
    try { await api.deleteMemory(id, mid); await load(); } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-ink">Journal de vie 🧠</h1>
        <Link to="/avatars" className="text-sm text-slate-500 hover:underline">← Avatars</Link>
      </div>
      <p className="text-sm text-slate-500 mb-6">La mémoire de l'avatar : faits, histoires en cours, événements. Il l'enrichit tout seul à chaque publication.</p>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="card p-3 mb-6 flex gap-2">
        <select className="border border-slate-200 rounded-xl px-3 text-sm outline-none focus:border-accent" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="fact">Fait</option><option value="storyline">Histoire</option><option value="life_event">Événement</option>
        </select>
        <input className="flex-1 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent" placeholder="Ajouter à la mémoire de l'avatar…" value={summary} onChange={(e) => setSummary(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add} className="btn-primary">Ajouter</button>
      </div>

      <div className="space-y-2.5">
        {entries.map((m) => {
          const k = KIND[m.kind] ?? { label: "Fait", color: "bg-blue-100 text-blue-700", icon: Info };
          const Icon = k.icon;
          return (
            <div key={m.id} className="card p-3.5 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${k.color}`}><Icon className="w-4 h-4" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${k.color}`}>{k.label}</span>
                  {m.status === "open" && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">en cours</span>}
                </div>
                <div className="text-sm text-slate-700 mt-1">{m.summary}</div>
              </div>
              <button onClick={() => setConfirmDel(m)} className="text-slate-300 hover:text-rose-600 p-1"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {entries.length === 0 && !err && (
          <div className="card p-8 text-center text-slate-400 text-sm">Mémoire vide. L'avatar l'enrichit tout seul à chaque publication.</div>
        )}
      </div>

      <ConfirmModal
        open={!!confirmDel}
        title="Supprimer cette entrée ?"
        message="Cette entrée de mémoire sera définitivement supprimée."
        confirmLabel="Supprimer"
        danger
        onConfirm={doDelete}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  );
}
