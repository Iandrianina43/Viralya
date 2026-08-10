import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ContentItem, type SetupStatus, type Stats } from "../api";

const SETUP_LABELS: Array<{ key: keyof SetupStatus; label: string }> = [
  { key: "llm", label: "Scripts (LLM)" },
  { key: "voice", label: "Voix (ElevenLabs)" },
  { key: "video", label: "Vidéo (HeyGen)" },
  { key: "image", label: "Images" },
  { key: "stripe", label: "Paiement (Stripe)" },
  { key: "email", label: "Email (Brevo)" },
  { key: "scheduler", label: "Publication" },
];

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-bold text-ink mt-1">{value}</div>
    </div>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.stats(), api.listContent()])
      .then(([s, c]) => {
        setStats(s);
        setContent(c.content);
      })
      .catch((e) => setErr(String(e)));
    api.setup().then(setSetup).catch(() => {});
  }, []);

  const byStatus = Object.entries(
    content.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([status, count]) => ({ status, count }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-6">Dashboard</h1>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur API : {err}</div>}

      {setup && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="text-sm font-semibold text-ink mb-2">Intégrations</div>
          <div className="flex flex-wrap gap-2">
            {SETUP_LABELS.map(({ key, label }) => {
              const it = setup[key];
              return (
                <span
                  key={key}
                  title={it.provider ? `provider: ${it.provider}` : undefined}
                  className={`text-xs px-3 py-1 rounded-full font-medium ${
                    it.configured
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {it.configured ? "●" : "○"} {label}
                </span>
              );
            })}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Gris = mode stub (le pipeline tourne avec des assets factices). Ajoute la clé API dans
            le .env puis relance l'API.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Tile label="Avatars" value={String(stats?.avatars ?? "—")} />
        <Tile label="Leads confirmés" value={String(stats?.leads_confirmed ?? "—")} />
        <Tile label="Contenus live" value={String(stats?.content_live ?? "—")} />
        <Tile
          label="Revenus (payés)"
          value={stats ? `${(stats.revenue_cents / 100).toFixed(0)} €` : "—"}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-semibold text-ink mb-4">Contenu par statut</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byStatus}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="status" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} />
            <Tooltip />
            <Bar dataKey="count" fill="#22a7f0" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
