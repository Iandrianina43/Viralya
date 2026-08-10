import { useEffect, useState } from "react";
import { api, type Avatar, type Memory } from "../api";

const KIND_LABEL: Record<string, string> = {
  fact: "Fait",
  storyline: "Histoire en cours",
  life_event: "Événement de vie",
  content_ref: "Publié",
};
const KIND_COLOR: Record<string, string> = {
  fact: "bg-blue-100 text-blue-700",
  storyline: "bg-purple-100 text-purple-700",
  life_event: "bg-amber-100 text-amber-700",
  content_ref: "bg-slate-100 text-slate-500",
};

export function Journal() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [avatarId, setAvatarId] = useState<string>("");
  const [memory, setMemory] = useState<Memory[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [kind, setKind] = useState<Memory["kind"]>("life_event");
  const [summary, setSummary] = useState("");
  const [importance, setImportance] = useState(3);

  useEffect(() => {
    api.listAvatars().then((r) => {
      setAvatars(r.avatars);
      if (r.avatars[0]) setAvatarId(r.avatars[0].id);
    });
  }, []);

  const load = (id: string) =>
    api
      .getMemory(id)
      .then((r) => setMemory(r.memory))
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    if (avatarId) load(avatarId);
  }, [avatarId]);

  const add = async () => {
    if (!summary.trim()) return;
    setErr(null);
    try {
      const status = kind === "storyline" ? "open" : "active";
      await api.addMemory(avatarId, { kind, summary, importance, status });
      setSummary("");
      await load(avatarId);
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (memoryId: string) => {
    await api.deleteMemory(avatarId, memoryId).catch((e) => setErr(String(e)));
    await load(avatarId);
  };

  const field = "border border-slate-300 rounded-lg px-3 py-2 text-sm";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink">Journal de vie</h1>
        <select className={field} value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
          {avatars.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        La mémoire de l'avatar : ce qu'il sait de sa vie, ses histoires en cours, et ce qu'il a
        déjà publié. Injectée à chaque génération pour la continuité (il ne se répète pas et fait
        avancer ses histoires).
      </p>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-2 items-end">
        <label className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Type</span>
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Memory["kind"])}>
            <option value="fact">Fait durable</option>
            <option value="storyline">Histoire en cours</option>
            <option value="life_event">Événement de vie</option>
          </select>
        </label>
        <label className="flex flex-col flex-1 min-w-[240px]">
          <span className="text-xs text-slate-500 mb-1">Résumé</span>
          <input
            className={field}
            placeholder="Ex : Lucas part à une conférence IA à Dubaï cette semaine"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Importance</span>
          <select
            className={field}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={add} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium">
          Ajouter
        </button>
      </div>

      <div className="space-y-2">
        {memory.map((m) => (
          <div
            key={m.id}
            className="bg-white rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${KIND_COLOR[m.kind]}`}>
                {KIND_LABEL[m.kind]}
                {m.kind === "storyline" && m.status === "open" ? " ·  ouverte" : ""}
              </span>
              <span className="text-sm text-slate-700">{m.summary}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400">imp {m.importance}</span>
              {m.kind !== "content_ref" && (
                <button
                  onClick={() => remove(m.id)}
                  className="text-xs text-slate-400 hover:text-rose-600"
                  title="Supprimer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        {memory.length === 0 && !err && (
          <div className="text-slate-400 text-sm">Aucune mémoire pour l'instant.</div>
        )}
      </div>
    </div>
  );
}
