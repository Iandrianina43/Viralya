import { Check, ExternalLink, History, RotateCcw, Send, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ContentItem, type ContentVersion } from "../api";
import { Button, EmptyState, ErrorState, PageHeader, Pill, Skeleton, useToast, type Tone } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// CONTENUS — revue humaine : voir, valider, refuser, relancer, annuler,
// revenir à une version précédente.
// ─────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "En file", tone: "neutral" },
  generating: { label: "Génération", tone: "accent" },
  needs_review: { label: "À valider", tone: "cost" },
  scheduled: { label: "Programmé", tone: "info" },
  published: { label: "Publié", tone: "ok" },
  failed: { label: "Échec", tone: "warn" },
  canceled: { label: "Annulé", tone: "neutral" },
};
const RATIO: Record<string, { label: string; tone: Tone }> = {
  value: { label: "Valeur", tone: "ok" },
  proof: { label: "Preuve", tone: "cost" },
  sale: { label: "Vente", tone: "warn" },
};
const TYPE_LABEL: Record<string, string> = { video: "Vidéo", hook: "Accroche", carousel: "Carrousel", story: "Story", tweet: "Post" };
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Tous" },
  { key: "needs_review", label: "À valider" },
  { key: "generating", label: "En génération" },
  { key: "scheduled", label: "Programmés" },
  { key: "published", label: "Publiés" },
  { key: "failed", label: "Échecs" },
];

function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Versions({ item, onRestored }: { item: ContentItem; onRestored: () => void }) {
  const [list, setList] = useState<ContentVersion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.listVersions(item.id).then((r) => setList(r.versions)).catch((e) => setErr(String((e as Error)?.message ?? e)));
  }, [item.id]);

  const restore = async (no: number) => {
    setBusy(no);
    try {
      await api.restoreVersion(item.id, no);
      toast.push("ok", `Version ${no} restaurée. L'état précédent a été conservé.`);
      onRestored();
    } catch (e) {
      toast.push("warn", String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  if (err) return <ErrorState message={err} />;
  if (list === null) return <Skeleton className="h-10" />;
  if (list.length === 0) return <div className="text-[13px] text-muted">Pas encore de version enregistrée : la première apparaît à la fin de la prochaine génération.</div>;
  return (
    <ol className="divide-y divide-rule-soft">
      {list.map((v) => {
        const a = v.assets as { video_url?: string; image_urls?: string[] };
        return (
          <li key={v.id} className="flex items-center gap-3 py-2">
            <span className="font-mono text-[12px] text-accent w-8">v{v.version_no}</span>
            <span className="text-[13px] text-ink flex-1 min-w-0 truncate">{v.note ?? "—"}</span>
            <span className="text-[12px] text-muted shrink-0">{when(v.created_at)}</span>
            {a.video_url && <a href={a.video_url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-accent hover:underline">vidéo</a>}
            {v.version_no !== item.current_version && (
              <Button variant="secondary" size="sm" loading={busy === v.version_no} onClick={() => void restore(v.version_no)}>Restaurer</Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ContentReview() {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.listContent();
      setItems(r.content);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => (items ?? []).filter((it) => filter === "all" || it.status === filter), [items, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length ?? 0 };
    for (const it of items ?? []) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  const act = async (id: string, fn: (id: string) => Promise<unknown>, done: string) => {
    setBusy(id);
    try { await fn(id); toast.push("ok", done); await load(); }
    catch (e) { toast.push("warn", String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader eyebrow="Revue humaine" title="Contenus" description="Tout ce que les influenceurs ont produit. Rien n'est programmé sans ta validation." />

      <div className="flex flex-wrap gap-1.5 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border font-sans text-[13px] font-semibold transition-colors ${filter === f.key ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-rule hover:bg-paper-2"}`}
          >
            {f.label}
            <span className={`font-mono text-[11px] tabular-nums ${filter === f.key ? "text-white/70" : "text-muted"}`}>{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {err && <div className="mb-4"><ErrorState message={err} retry={() => void load()} /></div>}
      {items === null && !err && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>}

      {items !== null && visible.length === 0 && (
        <EmptyState
          title={filter === "all" ? "Aucun contenu pour l'instant" : "Rien dans ce filtre"}
          hint="Lance une production depuis le studio d'un influenceur : le résultat arrive ici pour validation."
          action={<Link to="/avatars" className="btn-primary">Voir les influenceurs</Link>}
        />
      )}

      <div className="space-y-3">
        {visible.map((it) => {
          const p = it.payload as { caption?: string; script?: string; theme?: string };
          const a = it.assets as { video_url?: string; image_url?: string; image_urls?: string[]; estimated_cost_usd?: number; image_model?: string; qc?: { face_score: number | null; verdict: string } };
          const qcTone: Tone = a.qc?.verdict === "pass" ? "ok" : a.qc?.verdict === "review" ? "cost" : a.qc?.verdict === "fail" ? "warn" : "neutral";
          const st = STATUS[it.status] ?? { label: it.status, tone: "neutral" as Tone };
          const rc = RATIO[it.ratio_class] ?? { label: it.ratio_class, tone: "neutral" as Tone };
          const canReview = it.status === "needs_review";
          const canCancel = it.status === "queued" || it.status === "generating";
          const canRetry = ["failed", "canceled", "needs_review"].includes(it.status);
          const title = it.title || p.theme || TYPE_LABEL[it.type] || it.type;
          return (
            <article key={it.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-sans font-semibold text-ink">{title}</span>
                <Pill tone={st.tone}>{st.label}</Pill>
                <Pill tone={rc.tone}>{rc.label}</Pill>
                <span className="text-[12.5px] text-muted">{TYPE_LABEL[it.type] ?? it.type} · {it.network}{it.avatar_name ? ` · ${it.avatar_name}` : ""}</span>
                {it.current_version ? <span className="font-mono text-[11px] text-muted">v{it.current_version}</span> : null}
                <span className="ml-auto text-[12px] text-muted">{when(it.created_at)}</span>
              </div>
              {(a.image_url || a.image_urls?.length) && (
                <div className="flex flex-wrap items-start gap-3 mb-3">
                  <a href={a.image_url ?? a.image_urls![a.image_urls!.length - 1]} target="_blank" rel="noreferrer" className="block shrink-0">
                    <img src={a.image_url ?? a.image_urls![a.image_urls!.length - 1]} alt={title} className="h-64 w-auto rounded border border-rule-soft object-cover" loading="lazy" />
                  </a>
                  <div className="text-[13px] text-muted space-y-1.5">
                    {a.qc && <div><Pill tone={qcTone}>{a.qc.verdict === "pass" ? "visage conforme" : a.qc.verdict === "review" ? "visage à vérifier" : a.qc.verdict === "fail" ? "visage douteux" : "visage non contrôlé"}{a.qc.face_score != null ? ` · ${a.qc.face_score.toFixed(2)}` : ""}</Pill></div>}
                    {a.image_model && <div className="font-mono text-[12px]">{a.image_model}</div>}
                    {(a.image_urls?.length ?? 0) > 1 && <div>{a.image_urls!.length} essais</div>}
                  </div>
                </div>
              )}
              {p.caption && <div className="text-sm text-ink">{p.caption}</div>}
              {p.script && it.type !== "photo" && <p className="font-serif text-[15px] text-ink-2 mt-1 max-w-[75ch]">{p.script}</p>}
              {it.error && <div className="text-[13px] text-warn mt-1.5">{it.error}</div>}
              {a.estimated_cost_usd != null && <div className="font-mono text-[12px] text-cost mt-1">≈ {a.estimated_cost_usd.toFixed(2)} $</div>}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {a.video_url && (
                  <a href={a.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-8 px-2 font-sans text-[13px] font-semibold text-accent hover:underline underline-offset-2">
                    <ExternalLink className="w-3.5 h-3.5" /> Voir la vidéo
                  </a>
                )}
                {canReview && <Button size="sm" icon={<Check className="w-3.5 h-3.5" />} loading={busy === it.id} onClick={() => void act(it.id, (id) => api.approveContent(id), "Contenu approuvé et programmé.")}>Approuver &amp; programmer</Button>}
                {(canReview || it.status === "scheduled") && <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5" />} loading={busy === it.id} onClick={() => void act(it.id, api.publishNow, "Publié sur le compte de l'influenceur.")}>Publier maintenant</Button>}
                {canReview && <Button size="sm" variant="secondary" icon={<X className="w-3.5 h-3.5" />} loading={busy === it.id} onClick={() => void act(it.id, api.rejectContent, "Contenu refusé.")}>Refuser</Button>}
                {canCancel && <Button size="sm" variant="ghost" icon={<XCircle className="w-3.5 h-3.5" />} loading={busy === it.id} onClick={() => void act(it.id, api.cancelContent, "Production annulée.")}>Annuler</Button>}
                {canRetry && <Button size="sm" variant="secondary" icon={<RotateCcw className="w-3.5 h-3.5" />} loading={busy === it.id} onClick={() => void act(it.id, api.retryContent, "Régénération lancée. L'état actuel est conservé en version.")}>Régénérer</Button>}
                <Button size="sm" variant="ghost" icon={<History className="w-3.5 h-3.5" />} onClick={() => setVersionsFor(versionsFor === it.id ? null : it.id)}>
                  Versions{it.current_version ? ` (${it.current_version})` : ""}
                </Button>
                <Link to={`/avatars/${it.avatar_id}/studio`} className="ml-auto font-sans text-[13px] font-semibold text-ink-2 hover:text-ink">Ouvrir le studio</Link>
              </div>

              {versionsFor === it.id && (
                <div className="mt-3 rounded border border-rule-soft bg-paper-2 px-3.5 py-2.5">
                  <Versions item={it} onRestored={() => void load()} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
