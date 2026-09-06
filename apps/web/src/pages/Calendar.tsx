import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, Image as ImageIcon, Layers, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Avatar, type AvatarLocation, type ContentPlan, type PlanEntry, type PlanEntryType } from "../api";
import { Button, useToast } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// CALENDRIER ÉDITORIAL (BRIEF § 10-11) — « Générer le calendrier du mois prochain ».
// Grille mensuelle, stratégie (piliers, séries, arcs), entrées éditables, production à la demande.
// ─────────────────────────────────────────────────────────────

const TYPE: Record<PlanEntryType, { label: string; color: string; icon: typeof Clapperboard }> = {
  video: { label: "Vidéo", color: "bg-violet-100 text-violet-700 border-violet-200", icon: Clapperboard },
  photo: { label: "Photo", color: "bg-sky-100 text-sky-700 border-sky-200", icon: ImageIcon },
  carousel: { label: "Carrousel", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Layers },
  story: { label: "Story", color: "bg-amber-100 text-amber-700 border-amber-200", icon: Sparkles },
  ugc: { label: "UGC", color: "bg-rose-100 text-rose-700 border-rose-200", icon: Wand2 },
};
const STATUS: Record<string, { label: string; dot: string }> = {
  planned: { label: "prévu", dot: "bg-slate-300" }, generating: { label: "en production", dot: "bg-amber-400 animate-pulse" }, ready: { label: "à valider", dot: "bg-blue-500" },
  scheduled: { label: "programmé", dot: "bg-indigo-500" }, published: { label: "publié", dot: "bg-green-500" }, skipped: { label: "ignoré", dot: "bg-slate-200" }, failed: { label: "échec", dot: "bg-rose-500" },
};
const RATIO: Record<string, string> = { value: "Valeur", proof: "Preuve", sale: "Vente" };
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (key: string, n: number) => { const [y, m] = key.split("-").map(Number); return monthKey(new Date(y!, m! - 1 + n, 1)); };
const today = () => new Date().toISOString().slice(0, 10);

export function Calendar() {
  const { id } = useParams();
  const toast = useToast();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [locations, setLocations] = useState<AvatarLocation[]>([]);
  const [month, setMonth] = useState(() => monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)));
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [perWeek, setPerWeek] = useState(5);
  const [brief, setBrief] = useState("");
  const [arcs, setArcs] = useState("");
  const [selected, setSelected] = useState<PlanEntry | null>(null);
  const [draft, setDraft] = useState<Partial<PlanEntry>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");

  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    if (!quiet) setLoading(true);
    try {
      const r = await api.getPlan(id, month);
      setPlan(r.plan);
      setErr(null);
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setLoading(false); }
  }, [id, month]);

  useEffect(() => {
    if (!id) return;
    api.getAvatar(id).then((r) => setAvatar(r.avatar)).catch(() => {});
    api.listLocations(id, "all").then((r) => setLocations(r.locations)).catch(() => {});
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // Suivi : génération du plan (job) ou entrées en production → rafraîchissement périodique.
  const inProgress = generating || !!plan?.entries?.some((e) => e.status === "generating");
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => void load(true), 6000);
    return () => clearInterval(t);
  }, [inProgress, load]);
  useEffect(() => { if (generating && plan && Date.parse(plan.created_at) > Date.now() - 20 * 60_000 && plan.entries?.length) setGenerating(false); }, [plan, generating]);

  const generate = async () => {
    if (!id) return;
    setBusy("gen");
    try {
      await api.generatePlan(id, { month, posts_per_week: perWeek, brief: brief.trim() || undefined, arcs: arcs.split("\n").map((s) => s.trim()).filter(Boolean) });
      setGenerating(true);
      setShowGen(false);
      toast.push("ok", "Le stratège écrit le mois : une minute environ.");
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };

  const grid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y!, m! - 1, 1);
    const days = new Date(y!, m!, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells: Array<{ day: string | null; n: number }> = [];
    for (let i = 0; i < offset; i++) cells.push({ day: null, n: 0 });
    for (let d = 1; d <= days; d++) cells.push({ day: `${month}-${String(d).padStart(2, "0")}`, n: d });
    while (cells.length % 7) cells.push({ day: null, n: 0 });
    return cells;
  }, [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, PlanEntry[]>();
    for (const e of plan?.entries ?? []) map.set(e.day, [...(map.get(e.day) ?? []), e]);
    return map;
  }, [plan]);

  const select = (e: PlanEntry) => { setSelected(e); setDraft({ title: e.title, brief: e.brief, type: e.type, network: e.network, slot: e.slot, ratio_class: e.ratio_class, location_key: e.location_key, day: e.day }); setAdding(null); };
  const save = async () => {
    if (!selected) return;
    setBusy("save");
    try { const r = await api.updatePlanEntry(selected.id, draft); setSelected(r.entry); await load(true); toast.push("ok", "Entrée mise à jour."); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const skip = async (status: "skipped" | "planned") => {
    if (!selected) return;
    setBusy("skip");
    try { const r = await api.updatePlanEntry(selected.id, { status }); setSelected(r.entry); await load(true); } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!selected) return;
    setBusy("del");
    try { await api.deletePlanEntry(selected.id); setSelected(null); await load(true); } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const produce = async () => {
    if (!selected) return;
    setBusy("prod");
    try {
      const r = await api.producePlanEntry(selected.id, { resolution, talk_mode: resolution === "1080p" ? "pro" : "std" });
      toast.push("ok", `Production lancée (≈ ${r.estimated_cost_usd.toFixed(2)} $). Suivi dans le studio et les tâches.`);
      await load(true);
      setSelected((s) => (s ? { ...s, status: "generating", content_item_id: r.content_item_id } : s));
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const add = async () => {
    if (!id || !adding || !draft.title || !draft.brief) return;
    setBusy("add");
    try {
      const r = await api.addPlanEntry(id, month, { ...draft, day: adding, title: draft.title, brief: draft.brief });
      setAdding(null); setSelected(r.entry); await load(true);
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };

  const estimate = (t: PlanEntryType | undefined) => (t === "video" || t === "ugc" ? (resolution === "1080p" ? "≈ 22-27 $" : "≈ 10-12 $") : t === "photo" ? "≈ 0,10 $" : "≈ 0,30 $");
  const entries = plan?.entries ?? [];
  const counts = entries.reduce<Record<string, number>>((a, e) => ({ ...a, [e.type]: (a[e.type] ?? 0) + 1 }), {});

  // Pilote automatique du mois (7 sept. 2026) : production J-1 des entrées planifiées, dans la limite du budget.
  const toggleAuto = async (on: boolean) => {
    if (!id) return;
    try {
      await api.updatePlanAuto(id, month, { auto_produce: on });
      await load(true);
      toast.push("ok", on ? "Pilote automatique activé : les contenus partiront la veille, dans la limite du budget." : "Pilote automatique désactivé.");
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-xs text-slate-400"><Link to="/avatars" className="hover:underline">Influenceurs</Link> / {avatar?.name ?? "…"}</div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><CalendarDays className="w-6 h-6 text-accent" /> Calendrier éditorial</h1>
          <p className="text-sm text-slate-500 mt-0.5">Un mois qui raconte une histoire : piliers, séries, arcs, puis les contenus jour par jour. Chaque entrée se produit à la demande.</p>
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 mr-1" title="Les entrées planifiées partent seules la veille, dans la limite du budget du mois ; chaque résultat attend ta validation.">
              <input type="checkbox" checked={!!plan.auto_produce} onChange={(e) => toggleAuto(e.target.checked)} /> Pilote automatique
            </label>
          )}
          <Link to={`/avatars/${id}/social`} className="btn-secondary text-sm">Compte social</Link>
          <button onClick={() => setShowGen((s) => !s)} className="btn-primary flex items-center gap-2"><Wand2 className="w-4 h-4" /> {plan ? "Régénérer le mois" : "Générer le mois"}</button>
        </div>
      </div>

      {showGen && (
        <div className="card p-4 mb-4 grid md:grid-cols-[1fr_2fr] gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Cadence</label>
            <div className="flex items-center gap-2">
              <input type="range" min={2} max={14} value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} className="flex-1" />
              <span className="text-sm font-semibold text-ink w-28">{perWeek} / semaine</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">≈ {Math.round((perWeek * 30) / 7)} contenus sur le mois · mix conseillé 40 % vidéos, 35 % photos, 15 % carrousels, 10 % stories.</div>
            <div className="text-xs text-slate-400 mt-2">Coût de la génération du calendrier : quelques centimes (un appel au stratège). Les contenus se paient seulement quand tu les produis.</div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500">Consignes (objectifs, ton, partenariats…)</label>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} className="input w-full text-sm" placeholder="Ex. : mettre en avant sa routine matinale, préparer un partenariat café fin de mois…" />
            <label className="block text-xs font-semibold text-slate-500">Arcs imposés (un par ligne)</label>
            <textarea value={arcs} onChange={(e) => setArcs(e.target.value)} rows={2} className="input w-full text-sm" placeholder={"Voyage à Séville du 10 au 14\nLancement de sa marque de bougies le 25"} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGen(false)} className="btn-secondary text-sm">Annuler</button>
              <Button loading={busy === "gen"} onClick={() => void generate()}>Écrire le mois de {fmtMonth.format(new Date(`${month}-01T12:00:00`))}</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
          <div className="text-lg font-semibold text-ink capitalize w-44 text-center">{fmtMonth.format(new Date(`${month}-01T12:00:00`))}</div>
          <button onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {(Object.keys(TYPE) as PlanEntryType[]).filter((t) => counts[t]).map((t) => <span key={t} className={`px-2 py-0.5 rounded-full border ${TYPE[t].color}`}>{counts[t]} {TYPE[t].label.toLowerCase()}{counts[t]! > 1 ? "s" : ""}</span>)}
          {generating && <span className="flex items-center gap-1 text-amber-600"><Loader2 className="w-3.5 h-3.5 animate-spin" /> le stratège écrit…</span>}
        </div>
      </div>

      {err && <div className="text-sm text-rose-600 mb-3">Erreur : {err}</div>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
        <div>
          {plan?.strategy && (plan.strategy.pillars?.length || plan.strategy.arcs?.length) ? (
            <div className="card p-4 mb-4">
              <div className="flex flex-wrap gap-1.5 mb-2">{plan.strategy.pillars?.map((p) => <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{p}</span>)}</div>
              {plan.strategy.voice && <div className="text-sm text-slate-600 italic mb-2">« {plan.strategy.voice} »</div>}
              {plan.strategy.arcs?.length ? (
                <div className="grid sm:grid-cols-2 gap-2">
                  {plan.strategy.arcs.map((a) => (
                    <div key={a.name} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                      <div className="text-sm font-semibold text-ink">{a.name} <span className="text-xs font-normal text-slate-400">{a.start?.slice(8)} → {a.end?.slice(8)}</span></div>
                      <div className="text-xs text-slate-500 mt-0.5">{a.summary}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {plan.strategy.series?.length ? <div className="text-xs text-slate-400 mt-2">Séries : {plan.strategy.series.map((s) => `${s.name} (${s.cadence})`).join(" · ")}</div> : null}
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{DOW.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}</div>
            {loading ? <div className="p-10 text-center text-sm text-slate-400">Chargement…</div> : (
              <div className="grid grid-cols-7">
                {grid.map((c, i) => (
                  <div key={i} className={`min-h-[96px] border-b border-r border-slate-100 p-1.5 ${c.day ? "" : "bg-slate-50/60"} ${c.day === today() ? "bg-orange-50/50" : ""}`}>
                    {c.day && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs ${c.day === today() ? "font-bold text-accent" : "text-slate-400"}`}>{c.n}</span>
                          <button onClick={() => { setAdding(c.day); setSelected(null); setDraft({ type: "photo", network: "instagram", slot: "midi", ratio_class: "value", title: "", brief: "" }); }} className="text-slate-300 hover:text-accent" title="Ajouter"><Plus className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-1 mt-1">
                          {(byDay.get(c.day) ?? []).map((e) => {
                            const t = TYPE[e.type] ?? TYPE.photo;
                            const Icon = t.icon;
                            return (
                              <button key={e.id} onClick={() => select(e)} className={`w-full text-left rounded-md border px-1.5 py-1 text-[11px] leading-tight flex items-start gap-1 ${t.color} ${selected?.id === e.id ? "ring-2 ring-accent" : ""} ${e.status === "skipped" ? "opacity-40 line-through" : ""}`}>
                                <Icon className="w-3 h-3 mt-0.5 shrink-0" />
                                <span className="truncate flex-1">{e.title}</span>
                                <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${STATUS[e.status]?.dot ?? "bg-slate-300"}`} />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!loading && !plan && (
              <div className="p-8 text-center">
                <div className="text-sm text-slate-500">Aucun calendrier pour ce mois.</div>
                <button onClick={() => setShowGen(true)} className="btn-primary mt-3 inline-flex items-center gap-2"><Wand2 className="w-4 h-4" /> Générer le mois</button>
              </div>
            )}
          </div>
        </div>

        {/* Panneau latéral : entrée sélectionnée ou ajout */}
        {(selected || adding) && (
          <div className="card p-4 sticky top-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-ink">{adding ? `Nouvelle entrée · ${adding.slice(8)}/${adding.slice(5, 7)}` : `${selected!.day.slice(8)}/${selected!.day.slice(5, 7)} · ${selected!.slot}`}</div>
              <button onClick={() => { setSelected(null); setAdding(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            {selected && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
                <span className={`px-2 py-0.5 rounded-full border ${TYPE[selected.type]?.color}`}>{TYPE[selected.type]?.label}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{RATIO[selected.ratio_class]}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${STATUS[selected.status]?.dot}`} />{STATUS[selected.status]?.label}</span>
                {selected.arc && <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">{selected.arc}</span>}
                {selected.pillar && <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-500">{selected.pillar}</span>}
              </div>
            )}
            <div className="space-y-2">
              <input className="input w-full text-sm font-medium" placeholder="Titre" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <textarea className="input w-full text-sm" rows={5} placeholder="Ce qu'elle vit ou montre (le réalisateur s'en sert)" value={draft.brief ?? ""} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <select className="input text-sm" value={draft.type ?? "photo"} onChange={(e) => setDraft({ ...draft, type: e.target.value as PlanEntryType })}>{(Object.keys(TYPE) as PlanEntryType[]).filter((t) => t !== "ugc").map((t) => <option key={t} value={t}>{TYPE[t].label}</option>)}</select>
                <select className="input text-sm" value={draft.network ?? "instagram"} onChange={(e) => setDraft({ ...draft, network: e.target.value })}><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="facebook">Facebook</option></select>
                <select className="input text-sm" value={draft.slot ?? "midi"} onChange={(e) => setDraft({ ...draft, slot: e.target.value as PlanEntry["slot"] })}><option value="matin">Matin</option><option value="midi">Midi</option><option value="soir">Soir</option></select>
                <select className="input text-sm" value={draft.ratio_class ?? "value"} onChange={(e) => setDraft({ ...draft, ratio_class: e.target.value as PlanEntry["ratio_class"] })}><option value="value">Valeur</option><option value="proof">Preuve</option><option value="sale">Vente</option></select>
              </div>
              <select className="input text-sm w-full" value={draft.location_key ?? ""} onChange={(e) => setDraft({ ...draft, location_key: e.target.value || null })}>
                <option value="">Décor : à décrire dans le brief</option>
                {locations.map((l) => <option key={l.key} value={l.key}>{l.name}{l.scope === "oneoff" ? " (voyage)" : ""}</option>)}
              </select>
            </div>
            {adding ? (
              <div className="flex justify-end gap-2 mt-3"><Button loading={busy === "add"} onClick={() => void add()}>Ajouter</Button></div>
            ) : selected && (
              <>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button size="sm" variant="secondary" loading={busy === "save"} onClick={() => void save()}>Enregistrer</Button>
                  {selected.status === "planned" && <Button size="sm" variant="ghost" loading={busy === "skip"} onClick={() => void skip("skipped")}>Ignorer</Button>}
                  {selected.status === "skipped" && <Button size="sm" variant="ghost" loading={busy === "skip"} onClick={() => void skip("planned")}>Réactiver</Button>}
                  <button onClick={() => void remove()} className="ml-auto text-slate-300 hover:text-rose-600 p-1" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="border-t border-slate-100 mt-3 pt-3">
                  {selected.content_item_id ? (
                    <div className="text-sm">
                      <div className="text-slate-500 text-xs mb-1">Contenu {STATUS[selected.status]?.label}</div>
                      <Link to={`/avatars/${id}/studio`} className="text-accent hover:underline text-sm">Voir dans le studio →</Link>
                      <span className="text-slate-300 mx-2">·</span>
                      <Link to="/content" className="text-accent hover:underline text-sm">Revue des contenus →</Link>
                    </div>
                  ) : selected.status !== "skipped" && (
                    <div>
                      {(selected.type === "video" || selected.type === "ugc") && (
                        <div className="flex items-center gap-2 mb-2 text-xs">
                          <span className="text-slate-500">Qualité</span>
                          {(["720p", "1080p"] as const).map((r) => <button key={r} onClick={() => setResolution(r)} className={`px-2 py-0.5 rounded-full border ${resolution === r ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500"}`}>{r}</button>)}
                        </div>
                      )}
                      <Button loading={busy === "prod"} onClick={() => void produce()} icon={<Sparkles className="w-3.5 h-3.5" />}>Produire ce contenu ({estimate(selected.type)})</Button>
                      <div className="text-[11px] text-slate-400 mt-1.5">{selected.type === "video" ? "Le réalisateur écrit l'histoire depuis ce brief, puis une prise unique de 20-30 s (Seedance 2.5)." : "Légende + image multi-référence avec contrôle du visage."}</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
