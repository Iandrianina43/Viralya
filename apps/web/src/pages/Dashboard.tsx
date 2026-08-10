import { ArrowRight, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock, Image as ImageIcon, Sparkles, Video, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Avatar, type ContentItem } from "../api";
import { useAuth } from "../auth";
import { AvatarPhoto } from "../components/AvatarPhoto";

// ─────────────────────────────────────────────────────────────
// Dashboard — l'état de la plateforme en un coup d'œil.
// Palette graphique validée (contraste + daltonisme) :
//   valeur #059669 · preuve #2563eb · vente #f0562b
// ─────────────────────────────────────────────────────────────

const RATIO_COLORS: Record<string, string> = { value: "#059669", proof: "#2563eb", sale: "#f0562b" };
const RATIO_LABELS: Record<string, string> = { value: "Valeur", proof: "Preuve", sale: "Vente" };
const RATIO_TARGETS: Record<string, number> = { value: 70, proof: 20, sale: 10 };

const IN_PROGRESS = ["queued", "generating"];
const LIVE = ["scheduled", "published", "approved", "live"];

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });
const fmtFullDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function StatTile({ label, value, delta, tone }: { label: string; value: number | string; delta?: string | null; tone?: "amber" | null }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold leading-tight mt-1 ${tone === "amber" ? "text-amber-600" : "text-ink"}`}>{value}</div>
      {delta && <div className={`text-xs mt-1 ${delta.startsWith("+") ? "text-green-600" : delta.startsWith("−") ? "text-rose-500" : "text-slate-400"}`}>{delta}</div>}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    api.listAvatars().then((r) => setAvatars(r.avatars)).catch((e) => setErr(String(e.message ?? e)));
    api.listContent().then((r) => setContent(r.content)).catch(() => {});
  }, []);

  const avatarName = useMemo(() => new Map(avatars.map((a) => [a.id, a.name])), [avatars]);

  // ── Agrégats ───────────────────────────────────────────────
  const computed = useMemo(() => {
    const now = new Date();
    const ms7 = 7 * 86_400_000;
    const week = content.filter((c) => now.getTime() - Date.parse(c.created_at) < ms7).length;
    const prevWeek = content.filter((c) => {
      const age = now.getTime() - Date.parse(c.created_at);
      return age >= ms7 && age < 2 * ms7;
    }).length;
    const review = content.filter((c) => c.status === "needs_review");
    const live = content.filter((c) => LIVE.includes(c.status)).length;
    const producing = content.filter((c) => IN_PROGRESS.includes(c.status));
    const failed = content.filter((c) => c.status === "failed").slice(0, 3);

    // Activité des 14 derniers jours.
    const days: Array<{ key: string; label: string; full: string; n: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: dayKey(d), label: fmtDay.format(d), full: fmtFullDay.format(d), n: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.key, i]));
    for (const c of content) {
      const i = idx.get(dayKey(new Date(c.created_at)));
      if (i !== undefined) days[i]!.n++;
    }

    // Équilibre éditorial (30 derniers jours).
    const recent = content.filter((c) => now.getTime() - Date.parse(c.created_at) < 30 * 86_400_000);
    const ratio: Record<string, number> = { value: 0, proof: 0, sale: 0 };
    for (const c of recent) ratio[c.ratio_class] = (ratio[c.ratio_class] ?? 0) + 1;
    const ratioTotal = ratio.value! + ratio.proof! + ratio.sale!;

    const perAvatar = new Map<string, number>();
    for (const c of content) perAvatar.set(c.avatar_id, (perAvatar.get(c.avatar_id) ?? 0) + 1);

    return { week, prevWeek, review, live, producing, failed, days, ratio, ratioTotal, perAvatar };
  }, [content]);

  const maxDay = Math.max(1, ...computed.days.map((d) => d.n));
  const weekDelta = computed.week - computed.prevWeek;
  const firstName = (user?.name || "").split(" ")[0];

  return (
    <div>
      {/* En-tête */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Bonjour{firstName ? ` ${firstName}` : ""} 👋</h1>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">{fmtFullDay.format(new Date())}</p>
        </div>
        <Link to="/avatars/create" className="btn-primary hidden sm:flex items-center gap-2 shrink-0">
          <Sparkles className="w-4 h-4" /> Créer un avatar
        </Link>
      </div>

      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatTile label="Avatars" value={avatars.length} />
        <StatTile label="Contenus cette semaine" value={computed.week} delta={weekDelta === 0 ? "= vs sem. passée" : `${weekDelta > 0 ? "+" : "−"}${Math.abs(weekDelta)} vs sem. passée`} />
        <StatTile label="À valider" value={computed.review.length} tone={computed.review.length > 0 ? "amber" : null} />
        <StatTile label="En ligne" value={computed.live} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* ── Colonne principale ── */}
        <div className="space-y-6 min-w-0">
          {/* Activité 14 jours */}
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-bold text-ink">Activité</h2>
              <span className="text-xs text-slate-400">contenus créés · 14 derniers jours</span>
            </div>
            <div className="relative">
              <div className="flex items-end gap-[2px] h-36" role="img" aria-label={`Contenus créés par jour : ${computed.days.map((d) => `${d.full} ${d.n}`).join(", ")}`}>
                {computed.days.map((d, i) => (
                  <div
                    key={d.key}
                    className="flex-1 flex flex-col items-center justify-end h-full cursor-default"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* barre : fine, bout arrondi côté données, base carrée */}
                    <div
                      className="w-full max-w-[24px] transition-colors"
                      style={{
                        height: `${Math.max(d.n > 0 ? 6 : 2, (d.n / maxDay) * 100)}%`,
                        background: d.n > 0 ? (hover === i ? "#d8461f" : "#f0562b") : "#e2e8f0",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                  </div>
                ))}
              </div>
              {/* tooltip */}
              {hover !== null && (
                <div
                  className="absolute -top-2 -translate-y-full -translate-x-1/2 bg-ink text-white text-xs rounded-lg px-2.5 py-1.5 pointer-events-none whitespace-nowrap shadow-card z-10"
                  style={{ left: `${((hover + 0.5) / computed.days.length) * 100}%` }}
                >
                  <span className="capitalize">{computed.days[hover]!.full}</span> · <b>{computed.days[hover]!.n}</b> contenu{computed.days[hover]!.n > 1 ? "s" : ""}
                </div>
              )}
            </div>
            <div className="flex gap-[2px] mt-2">
              {computed.days.map((d, i) => (
                <div key={d.key} className={`flex-1 text-center text-[10px] ${i === computed.days.length - 1 ? "text-slate-600 font-medium" : "text-slate-400"}`}>
                  {d.label.split(" ")[1]}
                </div>
              ))}
            </div>
          </div>

          {/* Équilibre éditorial */}
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-ink">Équilibre éditorial</h2>
              <span className="text-xs text-slate-400">30 derniers jours · cible 70 / 20 / 10</span>
            </div>
            {computed.ratioTotal === 0 ? (
              <div className="text-sm text-slate-400 py-4 text-center">Pas encore de contenu ce mois-ci.</div>
            ) : (
              <>
                <div className="flex h-3.5 gap-[2px] rounded-full overflow-hidden">
                  {(["value", "proof", "sale"] as const).map((k) => {
                    const pct = (computed.ratio[k]! / computed.ratioTotal) * 100;
                    if (pct === 0) return null;
                    return <div key={k} style={{ width: `${pct}%`, background: RATIO_COLORS[k] }} />;
                  })}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3.5">
                  {(["value", "proof", "sale"] as const).map((k) => {
                    const pct = computed.ratioTotal ? Math.round((computed.ratio[k]! / computed.ratioTotal) * 100) : 0;
                    return (
                      <div key={k} className="flex items-center gap-1.5 text-sm">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: RATIO_COLORS[k] }} />
                        <span className="text-slate-600">{RATIO_LABELS[k]}</span>
                        <span className="font-semibold text-ink">{pct}%</span>
                        <span className="text-xs text-slate-400">/ {RATIO_TARGETS[k]}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Avatars */}
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-ink">Tes influenceurs</h2>
              <Link to="/avatars" className="text-xs text-accent hover:underline">tout voir</Link>
            </div>
            {avatars.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-slate-400 mb-3">Aucun avatar pour l'instant.</p>
                <Link to="/avatars/create" className="btn-primary inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Créer le premier</Link>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2.5">
                {avatars.slice(0, 4).map((a) => (
                  <Link key={a.id} to={`/avatars/${a.id}/studio`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 hover:border-accent/40 hover:bg-accent/[0.02] transition group">
                    <AvatarPhoto src={a.ref_image_url} name={a.name} className="w-11 h-11" rounded="rounded-xl" position="object-top" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink truncate">{a.name}</div>
                      <div className="text-xs text-slate-400 truncate">{computed.perAvatar.get(a.id) ?? 0} contenu{(computed.perAvatar.get(a.id) ?? 0) > 1 ? "s" : ""} · {a.status}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-accent transition shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Colonne latérale ── */}
        <div className="space-y-6">
          {/* À valider */}
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-semibold text-ink flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-amber-500" /> À valider</h3>
              {computed.review.length > 0 && <span className="text-xs font-semibold text-amber-600">{computed.review.length}</span>}
            </div>
            {computed.review.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Tout est validé.</div>
            ) : (
              <div className="space-y-2">
                {computed.review.slice(0, 4).map((c) => {
                  const a = c.assets as { image_url?: string; keyframe_url?: string };
                  const p = c.payload as { caption?: string; theme?: string };
                  const img = a.image_url || a.keyframe_url;
                  return (
                    <Link key={c.id} to="/content" className="flex items-center gap-2.5 rounded-xl p-1.5 -mx-1.5 hover:bg-slate-50 transition">
                      <div className="w-9 h-12 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                        {img ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" /> : c.type === "video" ? <Video className="w-4 h-4 text-slate-300" /> : <ImageIcon className="w-4 h-4 text-slate-300" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-slate-700 truncate">{p.theme || p.caption || c.type}</div>
                        <div className="text-xs text-slate-400 truncate">{avatarName.get(c.avatar_id) ?? "—"} · {c.type} · {c.network}</div>
                      </div>
                    </Link>
                  );
                })}
                <Link to="/content" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1">Ouvrir la revue <ArrowRight className="w-3 h-3" /></Link>
              </div>
            )}
          </div>

          {/* En production */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-accent" /> En production</h3>
            {computed.producing.length === 0 ? (
              <div className="text-sm text-slate-400 py-1">Rien en cours.</div>
            ) : (
              <div className="space-y-2.5">
                {computed.producing.slice(0, 4).map((c) => {
                  const p = c.payload as { theme?: string };
                  return (
                    <Link key={c.id} to={`/avatars/${c.avatar_id}/studio`} className="block rounded-xl p-1.5 -mx-1.5 hover:bg-slate-50 transition">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                        <span className="text-sm text-slate-700 truncate flex-1">{p.theme || c.type}</span>
                      </div>
                      <div className="text-xs text-slate-400 ml-4 truncate">{avatarName.get(c.avatar_id) ?? "—"}</div>
                    </Link>
                  );
                })}
              </div>
            )}
            {computed.failed.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                {computed.failed.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs text-slate-500">
                    <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="truncate">Échec · {(c.payload as { theme?: string }).theme || c.type} ({avatarName.get(c.avatar_id) ?? "—"})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
