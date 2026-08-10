import { FileVideo, Send, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ContentItem, type Setup, type Stats } from "../api";

function Tile({ label, value, icon: Icon, tint }: { label: string; value: string; icon: typeof Users; tint: string }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tint}`}>
        <Icon className="w-5 h-5" strokeWidth={2.2} />
      </div>
      <div>
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-ink leading-tight">{value}</div>
      </div>
    </div>
  );
}

const INTEGRATIONS: Array<{ key: keyof Setup; label: string }> = [
  { key: "llm", label: "Scripts (LLM)" },
  { key: "image", label: "Images" },
  { key: "heygen", label: "Vidéo HeyGen" },
  { key: "argil", label: "Vidéo Argil" },
];

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setErr(String(e)));
    api.setup().then(setSetup).catch(() => {});
    api.listContent().then((r) => setContent(r.content)).catch(() => {});
  }, []);

  const byStatus = content.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
  const max = Math.max(1, ...Object.values(byStatus));

  return (
    <div>
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-accent to-orange-400 text-white p-8 mb-6 flex items-center justify-between shadow-card">
        <div>
          <h1 className="text-2xl font-bold">Bienvenue sur Viralya 👋</h1>
          <p className="text-white/90 mt-1 max-w-lg">Crée des influenceurs IA vivants, génère leur contenu et pilote tout depuis un seul endroit.</p>
        </div>
        <Link to="/avatars/create" className="hidden sm:flex items-center gap-2 bg-white text-accent font-semibold rounded-xl px-5 py-2.5 shadow-sm hover:bg-white/90">
          <Sparkles className="w-4 h-4" /> Créer un avatar
        </Link>
      </div>

      {err && <div className="text-red-600 mb-4 text-sm">Erreur API : {err}</div>}

      {setup && (
        <div className="card p-4 mb-6">
          <div className="text-sm font-semibold text-ink mb-2">Intégrations</div>
          <div className="flex flex-wrap gap-2">
            {INTEGRATIONS.map(({ key, label }) => {
              const on = (setup[key] as { configured: boolean }).configured;
              return (
                <span key={key} className={`text-xs px-3 py-1.5 rounded-full font-medium ${on ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                  {on ? "●" : "○"} {label}
                </span>
              );
            })}
            <span className="text-xs px-3 py-1.5 rounded-full bg-accent-light text-accent-dark font-medium">moteur défaut : {setup.default_video_provider}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Tile label="Avatars" value={String(stats?.avatars ?? "—")} icon={Users} tint="bg-accent-light text-accent" />
        <Tile label="Contenus (total)" value={String(stats?.content_total ?? "—")} icon={FileVideo} tint="bg-blue-50 text-blue-500" />
        <Tile label="Contenus live" value={String(stats?.content_live ?? "—")} icon={Send} tint="bg-green-50 text-green-600" />
      </div>

      <div className="card p-5">
        <div className="font-semibold text-ink mb-4">Contenu par statut</div>
        <div className="space-y-2.5">
          {Object.entries(byStatus).map(([status, n]) => (
            <div key={status} className="flex items-center gap-3 text-sm">
              <div className="w-28 text-slate-500">{status}</div>
              <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                <div className="bg-accent h-5 rounded-full" style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <div className="w-8 text-right text-slate-600 font-medium">{n}</div>
            </div>
          ))}
          {Object.keys(byStatus).length === 0 && <div className="text-slate-400 text-sm">Aucun contenu encore.</div>}
        </div>
      </div>
    </div>
  );
}
