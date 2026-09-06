import { ChevronDown, ChevronRight, Clapperboard, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type TaskState, type TaskView } from "../api";
import { Button, EmptyState, ErrorState, PageHeader, Pill, ProgressBar, Skeleton, useToast, type Tone } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// TASK CENTER — tout ce qui tourne, attend, a abouti ou a échoué,
// pour l'organisation active. Rafraîchi toutes les 5 secondes.
// ─────────────────────────────────────────────────────────────

const TABS: Array<{ key: TaskState; label: string }> = [
  { key: "running", label: "En cours" },
  { key: "review", label: "À valider" },
  { key: "upcoming", label: "À venir" },
  { key: "done", label: "Terminées" },
  { key: "failed", label: "Échouées" },
];

const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "En file", tone: "neutral" },
  generating: { label: "Génération", tone: "accent" },
  needs_review: { label: "À valider", tone: "cost" },
  scheduled: { label: "Programmé", tone: "info" },
  published: { label: "Publié", tone: "ok" },
  failed: { label: "Échec", tone: "warn" },
  canceled: { label: "Annulé", tone: "neutral" },
  pending: { label: "En file", tone: "neutral" },
  running: { label: "En cours", tone: "accent" },
  done: { label: "Terminé", tone: "ok" },
};

function relative(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "";
  const s = Math.round((Date.now() - d) / 1000);
  if (Math.abs(s) < 60) return s >= 0 ? "à l'instant" : "dans moins d'une minute";
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return m > 0 ? `il y a ${m} min` : `dans ${-m} min`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return h > 0 ? `il y a ${h} h` : `dans ${-h} h`;
  const j = Math.round(h / 24);
  return j > 0 ? `il y a ${j} j` : `dans ${-j} j`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "running") as TaskState;
  const avatarId = params.get("avatar") ?? undefined;
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [counts, setCounts] = useState<Record<TaskState, number>>({ running: 0, review: 0, upcoming: 0, done: 0, failed: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.tasks(avatarId);
      setTasks(r.tasks);
      setCounts(r.counts);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }, [avatarId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => (tasks ?? []).filter((t) => t.state === tab), [tasks, tab]);

  const act = async (t: TaskView, kind: "cancel" | "retry") => {
    setBusy(t.id);
    try {
      if (kind === "cancel") {
        await api.cancelContent(t.content_item_id);
        toast.push("info", `« ${t.title} » : production annulée.`);
      } else if (t.content_type === "job" && t.job) {
        await api.retryJob(t.job.id);
        toast.push("ok", `« ${t.title} » relancée.`);
      } else {
        await api.retryContent(t.content_item_id);
        toast.push("ok", `« ${t.title} » relancée depuis le début.`);
      }
      await load();
    } catch (e) {
      toast.push("warn", String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Task Center"
        title="Tâches"
        description="Générations en cours, contenus à valider, publications à venir. La liste se met à jour toute seule."
      />

      <div className="flex flex-wrap gap-1 border-b border-rule mb-5" role="tablist">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setParams((p) => { p.set("tab", t.key); return p; })}
              className={`flex items-center gap-2 px-3.5 py-2.5 -mb-px border-b-2 font-sans text-sm font-semibold transition-colors ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
              <span className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded-sm ${active ? "bg-accent-soft text-accent" : "bg-paper-2 text-muted"}`}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {err && <div className="mb-4"><ErrorState message={err} retry={() => void load()} /></div>}

      {tasks === null && !err && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px]" />)}
        </div>
      )}

      {tasks !== null && visible.length === 0 && (
        <EmptyState
          icon={<Clapperboard className="w-5 h-5" />}
          title={
            tab === "running" ? "Rien ne tourne pour l'instant" :
            tab === "review" ? "Aucun contenu à valider" :
            tab === "upcoming" ? "Rien de programmé" :
            tab === "done" ? "Aucune tâche terminée ces 14 derniers jours" : "Aucun échec"
          }
          hint={tab === "running" ? "Lance une production depuis le studio d'un influenceur : elle apparaîtra ici avec sa progression." : undefined}
          action={tab === "running" ? <Link to="/avatars" className="btn-primary inline-flex items-center gap-2">Voir les influenceurs</Link> : undefined}
        />
      )}

      {visible.length > 0 && (
        <div className="border-t border-ink">
          {visible.map((t) => {
            const st = STATUS_LABEL[t.status] ?? { label: t.status, tone: "neutral" as Tone };
            const isOpen = !!open[t.id];
            const studioLink = t.avatar ? `/avatars/${t.avatar.id}/studio` : "/content";
            return (
              <div key={t.id} className="border-b border-rule-soft py-3.5">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [t.id]: !isOpen }))}
                    className="mt-1 text-muted hover:text-ink shrink-0"
                    aria-label={isOpen ? "Replier" : "Déplier"}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <div className="w-9 h-9 rounded-sm bg-paper-2 border border-rule-soft overflow-hidden shrink-0 flex items-center justify-center font-sans text-xs font-semibold text-muted">
                    {t.image_urls[0] ? <img src={t.image_urls[t.image_urls.length - 1]} alt="" className="w-full h-full object-cover" /> : t.avatar?.image ? <img src={t.avatar.image} alt="" className="w-full h-full object-cover" /> : (t.avatar?.name ?? "?").charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-sans font-semibold text-ink truncate max-w-[52ch]">{t.title}</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {t.version > 0 && <span className="font-mono text-[11px] text-muted">v{t.version}</span>}
                    </div>
                    <div className="text-[13px] text-muted mt-0.5 flex flex-wrap gap-x-3">
                      {t.avatar && <span>{t.avatar.name}</span>}
                      <span>{t.subtitle}</span>
                      {t.job && t.state === "running" && <span>Étape : {t.job.label}{t.job.attempts > 1 ? ` (essai ${t.job.attempts}/${t.job.max_attempts})` : ""}</span>}
                      {t.scheduled_at && t.state === "upcoming" && <span>Prévu {relative(t.scheduled_at)}</span>}
                      {t.cost_usd != null && <span className="font-mono text-cost">≈ {t.cost_usd.toFixed(2)} $</span>}
                      <span>{relative(t.updated_at)}</span>
                    </div>
                    {t.state === "running" && <div className="mt-2 max-w-md"><ProgressBar value={t.progress} /></div>}
                    {t.error && t.state === "failed" && <div className="mt-1.5 text-[13px] text-warn break-words">{t.error}</div>}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.video_url && (
                      <a href={t.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans text-[13px] font-semibold text-accent hover:underline underline-offset-2 px-2 h-8">
                        <ExternalLink className="w-3.5 h-3.5" /> Vidéo
                      </a>
                    )}
                    {!t.video_url && t.image_urls[0] && (
                      <a href={t.image_urls[t.image_urls.length - 1]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans text-[13px] font-semibold text-accent hover:underline underline-offset-2 px-2 h-8">
                        <ExternalLink className="w-3.5 h-3.5" /> Image
                      </a>
                    )}
                    {t.content_type !== "job" && (
                      <Link to={studioLink} className="inline-flex items-center font-sans text-[13px] font-semibold text-ink-2 hover:text-ink px-2 h-8">Ouvrir</Link>
                    )}
                    {t.can_cancel && (
                      <Button variant="ghost" size="sm" icon={<XCircle className="w-3.5 h-3.5" />} loading={busy === t.id} onClick={() => void act(t, "cancel")}>Annuler</Button>
                    )}
                    {t.can_retry && (
                      <Button variant="secondary" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} loading={busy === t.id} onClick={() => void act(t, "retry")}>Relancer</Button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="ml-[3.75rem] mt-3 rounded border border-rule-soft bg-paper-2 px-3.5 py-3">
                    {t.logs.length === 0 ? (
                      <div className="text-[13px] text-muted">Pas encore de journal pour cette tâche.</div>
                    ) : (
                      <ol className="space-y-1 font-mono text-[12.5px] text-ink-2">
                        {t.logs.slice(-15).map((l, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="text-muted tabular-nums shrink-0">{hhmm(l.t)}</span>
                            <span className="break-words">{l.msg}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {t.job?.error && t.state === "running" && <div className="mt-2 text-[12.5px] text-warn">Dernier essai : {t.job.error}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
