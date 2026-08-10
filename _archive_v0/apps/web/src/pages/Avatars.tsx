import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE, api, type Avatar } from "../api";

export function Avatars() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    api
      .listAvatars()
      .then((r) => setAvatars(r.avatars))
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    load();
  }, []);

  const planDay = async (id: string) => {
    setMsg(null);
    setErr(null);
    try {
      const r = await api.planDay(id);
      setMsg(`Contenu du jour lancé (job ${r.job_id.slice(0, 8)}…). Voir « Revue contenu » dans ~1 min.`);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink">Avatars</h1>
        <Link
          to="/avatars/new"
          className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nouvel avatar
        </Link>
      </div>

      {msg && <div className="text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm">{msg}</div>}
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="space-y-3">
        {avatars.map((a) => (
          <div
            key={a.id}
            className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between"
          >
            <div>
              <div className="font-semibold text-ink">
                {a.name}{" "}
                <span
                  className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    a.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {a.status}
                </span>
                {a.is_ai_disclosed && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    IA déclarée
                  </span>
                )}
              </div>
              <div className="text-sm text-slate-500">{a.niche}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => planDay(a.id)}
                className="text-sm px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-white"
              >
                Générer le contenu du jour
              </button>
              <a
                href={`${API_BASE}/capture/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100"
              >
                Landing ↗
              </a>
              <Link
                to={`/avatars/${a.id}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100"
              >
                Éditer
              </Link>
            </div>
          </div>
        ))}
        {avatars.length === 0 && !err && (
          <div className="text-slate-400 text-sm">Aucun avatar. Lance le seed Coach Business ou crée-en un.</div>
        )}
      </div>
    </div>
  );
}
