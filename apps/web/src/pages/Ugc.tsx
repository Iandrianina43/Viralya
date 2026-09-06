import { ChevronDown, ChevronRight, Loader2, Megaphone, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Avatar, type UgcBeat, type UgcCampaign, type UgcCampaignInput, type UgcEstimate, type UgcVariant } from "../api";
import { ConfirmModal } from "../components/Modal";
import { Button, useToast, SkeletonCard } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// CAMPAGNES UGC (BRIEF § 12, 14) — « cette influenceuse doit présenter ce produit ».
// Constructeur : produit, marque, objectif, angles, accroches, durées, CTA, influenceurs →
// matrice de variantes scriptées (LLM), puis production vidéo à la demande, variante par variante.
// ─────────────────────────────────────────────────────────────

const ANGLE_PRESETS = ["Praticité au quotidien", "Avant / après", "Témoignage honnête", "Erreur que je faisais avant", "Rapport qualité-prix", "Routine du matin"];
const CTA_PRESETS = ["Code promo avec une vraie date de fin", "Lien en bio", "Commente un mot-clé pour recevoir le lien"];
const BEAT_LABEL: Record<UgcBeat["beat"], string> = { hook: "Accroche", problem: "Problème", product: "Produit", demo: "Démo", benefits: "Bénéfices", proof: "Preuve", cta: "Appel à l'action" };
const STATUS: Record<string, { label: string; cls: string }> = {
  scripted: { label: "scripté", cls: "bg-slate-100 text-slate-600" }, generating: { label: "en production", cls: "bg-amber-100 text-amber-700" },
  ready: { label: "vidéo prête", cls: "bg-green-100 text-green-700" }, failed: { label: "échec", cls: "bg-rose-100 text-rose-700" }, archived: { label: "archivée", cls: "bg-slate-100 text-slate-400" },
};

const emptyForm = (): UgcCampaignInput & { image_url: string; url: string; price: string } => ({
  brand: "", product: { name: "", description: "" }, objective: "awareness", target: "", tone: "", avatar_ids: [], angles: [ANGLE_PRESETS[0]!, ANGLE_PRESETS[2]!], hooks_per_angle: 2, durations: [30], ctas: [CTA_PRESETS[1]!], image_url: "", url: "", price: "",
});

export function Ugc() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<UgcCampaign[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [current, setCurrent] = useState<UgcCampaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [estimate, setEstimate] = useState<UgcEstimate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openVariant, setOpenVariant] = useState<string | null>(null);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [err, setErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const loadList = useCallback(() => api.listCampaigns().then((r) => setCampaigns(r.campaigns)).catch((e) => setErr(String((e as Error).message ?? e))).finally(() => setLoading(false)), []);
  useEffect(() => { void loadList(); api.listAvatars().then((r) => setAvatars(r.avatars.filter((a) => a.status !== "draft"))).catch(() => {}); }, [loadList]);
  useEffect(() => {
    if (!id) { setCurrent(null); return; }
    api.getCampaign(id).then((r) => setCurrent(r.campaign)).catch((e) => setErr(String((e as Error).message ?? e)));
  }, [id]);
  // Variantes en production → suivi.
  const producing = !!current?.variants?.some((v) => v.status === "generating");
  useEffect(() => {
    if (!producing || !id) return;
    const t = setInterval(() => api.getCampaign(id).then((r) => setCurrent(r.campaign)).catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [producing, id]);

  // Estimation en direct (aucun appel IA).
  const input = useMemo<UgcCampaignInput>(() => ({
    brand: form.brand, product: { name: form.product.name, description: form.product.description, image_url: form.image_url || null, url: form.url || null, price: form.price || null },
    objective: form.objective, target: form.target, tone: form.tone, avatar_ids: form.avatar_ids, angles: form.angles.filter(Boolean), hooks_per_angle: form.hooks_per_angle, durations: form.durations, ctas: form.ctas,
  }), [form]);
  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => api.estimateCampaign({ ...input, resolution }).then(setEstimate).catch(() => setEstimate(null)), 300);
    return () => clearTimeout(t);
  }, [input, creating, resolution]);

  const create = async () => {
    if (!form.brand.trim() || !form.product.name.trim() || !form.product.description.trim()) { toast.push("warn", "Marque, nom et description du produit sont obligatoires."); return; }
    if (!form.avatar_ids.length) { toast.push("warn", "Choisis au moins un influenceur."); return; }
    setBusy("create");
    try {
      const r = await api.createCampaign(input);
      toast.push("ok", `${r.campaign.variants?.length ?? 0} variantes scriptées.`);
      setCreating(false); setForm(emptyForm()); await loadList(); nav(`/ugc/${r.campaign.id}`);
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const produce = async (v: UgcVariant) => {
    setBusy(v.id);
    try {
      const r = await api.produceVariant(v.id, { resolution, talk_mode: resolution === "1080p" ? "pro" : "std" });
      toast.push("ok", `Vidéo lancée (≈ ${r.estimated_cost_usd.toFixed(2)} $).`);
      if (id) api.getCampaign(id).then((r2) => setCurrent(r2.campaign)).catch(() => {});
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const saveLine = async (v: UgcVariant, idx: number, line: string) => {
    const script = { ...v.script, beats: v.script.beats.map((b, i) => (i === idx ? { ...b, line } : b)) };
    try { const r = await api.updateVariant(v.id, { script }); setCurrent((c) => (c ? { ...c, variants: c.variants?.map((x) => (x.id === v.id ? r.variant : x)) } : c)); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };
  const archive = async (v: UgcVariant) => {
    try { const r = await api.updateVariant(v.id, { status: v.status === "archived" ? "scripted" : "archived" }); setCurrent((c) => (c ? { ...c, variants: c.variants?.map((x) => (x.id === v.id ? r.variant : x)) } : c)); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };
  // Confirmation avant une action payante, irréversible ou publique.
  const [confirmAct, setConfirmAct] = useState<{ title: string; message: string; danger?: boolean; confirmLabel?: string; run: () => void } | null>(null);
  const removeCampaign = async (cid: string) => {
    try { await api.deleteCampaign(cid); await loadList(); if (id === cid) nav("/ugc"); } catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };

  const avatarName = (aid: string) => avatars.find((a) => a.id === aid)?.name ?? "—";
  const words = (v: UgcVariant) => v.script.beats.reduce((a, b) => a + b.line.split(/\s+/).filter(Boolean).length, 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Megaphone className="w-6 h-6 text-accent" /> Campagnes UGC</h1>
          <p className="text-sm text-slate-500 mt-0.5">Un produit, une marque, des angles et des accroches : une matrice de vidéos où l'influenceur présente le produit (accroche → problème → produit → démo → bénéfices → preuve → appel à l'action).</p>
        </div>
        <button onClick={() => setCreating((c) => !c)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Nouvelle campagne</button>
      </div>
      {err && <div className="text-sm text-rose-600 mb-3">Erreur : {err}</div>}

      {creating && (
        <div className="card p-5 mb-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Produit</div>
              <input className="input w-full text-sm" placeholder="Marque" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              <input className="input w-full text-sm" placeholder="Nom du produit" value={form.product.name} onChange={(e) => setForm({ ...form, product: { ...form.product, name: e.target.value } })} />
              <textarea className="input w-full text-sm" rows={4} placeholder="Description : ce que c'est, ce que ça fait, pour qui. Seule source de vérité des scripts (aucune promesse inventée)." value={form.product.description} onChange={(e) => setForm({ ...form, product: { ...form.product, description: e.target.value } })} />
              <input className="input w-full text-sm" placeholder="URL de la photo du produit (référence visuelle pour la vidéo)" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input text-sm" placeholder="Lien produit (optionnel)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                <input className="input text-sm" placeholder="Prix (optionnel)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="input text-sm" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}><option value="awareness">Notoriété</option><option value="consideration">Considération</option><option value="conversion">Conversion</option></select>
                <input className="input text-sm" placeholder="Cible (ex. femmes 25-35, urbaines)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
              </div>
              <input className="input w-full text-sm" placeholder="Ton (ex. complice, drôle, sérieux)" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Influenceurs</div>
                <div className="flex flex-wrap gap-1.5">
                  {avatars.map((a) => (
                    <button key={a.id} onClick={() => setForm({ ...form, avatar_ids: form.avatar_ids.includes(a.id) ? form.avatar_ids.filter((x) => x !== a.id) : [...form.avatar_ids, a.id] })} className={`text-xs px-2.5 py-1 rounded-full border ${form.avatar_ids.includes(a.id) ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-600"}`}>{a.name}</button>
                  ))}
                  {!avatars.length && <span className="text-xs text-slate-400">Aucun influenceur actif.</span>}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Angles</div>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {ANGLE_PRESETS.map((a) => <button key={a} onClick={() => setForm({ ...form, angles: form.angles.includes(a) ? form.angles.filter((x) => x !== a) : [...form.angles, a].slice(0, 5) })} className={`text-xs px-2.5 py-1 rounded-full border ${form.angles.includes(a) ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-600"}`}>{a}</button>)}
                </div>
                <input className="input w-full text-sm" placeholder="Angle personnalisé + Entrée" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v) { setForm({ ...form, angles: [...form.angles, v].slice(0, 5) }); (e.target as HTMLInputElement).value = ""; } }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Accroches par angle</div>
                  <div className="flex gap-1">{[1, 2, 3, 4].map((n) => <button key={n} onClick={() => setForm({ ...form, hooks_per_angle: n })} className={`w-8 h-8 rounded-lg border text-sm ${form.hooks_per_angle === n ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-600"}`}>{n}</button>)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Durées</div>
                  <div className="flex gap-1">{[20, 30, 45].map((d) => <button key={d} onClick={() => setForm({ ...form, durations: form.durations!.includes(d) ? form.durations!.filter((x) => x !== d) : [...form.durations!, d].sort() })} className={`px-2.5 h-8 rounded-lg border text-sm ${form.durations!.includes(d) ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-600"}`}>{d} s</button>)}</div>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Appels à l'action</div>
                <div className="flex flex-wrap gap-1.5">{CTA_PRESETS.map((c) => <button key={c} onClick={() => setForm({ ...form, ctas: form.ctas!.includes(c) ? form.ctas!.filter((x) => x !== c) : [...form.ctas!, c] })} className={`text-xs px-2.5 py-1 rounded-full border ${form.ctas!.includes(c) ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-600"}`}>{c}</button>)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm">
                <div className="flex items-center gap-2 text-xs mb-1"><span className="text-slate-500">Qualité vidéo</span>{(["720p", "1080p"] as const).map((r) => <button key={r} onClick={() => setResolution(r)} className={`px-2 py-0.5 rounded-full border ${resolution === r ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500"}`}>{r}</button>)}</div>
                {estimate ? (
                  <>
                    <div className="font-semibold text-ink">{estimate.variants} variante{estimate.variants > 1 ? "s" : ""}</div>
                    <div className="text-xs text-slate-500">Scripts ≈ {estimate.scripts_cost_usd.toFixed(2)} $ maintenant · vidéos ≈ {estimate.production_cost_usd.toFixed(2)} $ si tu produis tout (à la demande, variante par variante).</div>
                  </>
                ) : <div className="text-xs text-slate-400">Estimation…</div>}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setCreating(false)} className="btn-secondary text-sm">Annuler</button>
                <Button loading={busy === "create"} onClick={() => void create()} icon={<Sparkles className="w-4 h-4" />}>Écrire les scripts</Button>
              </div>
              <div className="text-[11px] text-slate-400">Chaque vidéo incruste « Collaboration commerciale avec la marque » et « Images virtuelles · Contenu généré par IA » pendant toute sa durée (loi du 9 juin 2023, AI Act art. 50).</div>
            </div>
          </div>
        </div>
      )}

      {current ? (
        <div>
          <div className="flex items-center gap-2 mb-3 text-sm">
            <Link to="/ugc" className="text-slate-500 hover:underline">← Campagnes</Link>
            <span className="text-slate-300">/</span>
            <span className="font-semibold text-ink">{current.name}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS[current.status]?.cls ?? "bg-slate-100 text-slate-500"}`}>{STATUS[current.status]?.label ?? current.status}</span>
            <div className="ml-auto flex items-center gap-2 text-xs"><span className="text-slate-500">Qualité</span>{(["720p", "1080p"] as const).map((r) => <button key={r} onClick={() => setResolution(r)} className={`px-2 py-0.5 rounded-full border ${resolution === r ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500"}`}>{r}</button>)}</div>
          </div>
          <div className="card p-4 mb-4 grid md:grid-cols-[auto_1fr] gap-4">
            {current.product.image_url && <img src={current.product.image_url} alt="" className="w-24 h-24 rounded-xl object-cover border border-slate-200" />}
            <div className="text-sm">
              <div className="font-semibold text-ink">{current.product.name} <span className="text-slate-400 font-normal">· {current.brand}</span></div>
              <div className="text-slate-600 mt-1">{current.product.description}</div>
              <div className="text-xs text-slate-400 mt-2">Objectif {current.objective}{current.target ? ` · cible ${current.target}` : ""}{current.tone ? ` · ton ${current.tone}` : ""} · angles : {current.matrix.angles.join(", ")} · {current.matrix.hooks_per_angle} accroche(s)/angle · {current.matrix.durations.join("/")} s</div>
            </div>
          </div>
          <div className="space-y-2">
            {(current.variants ?? []).map((v) => {
              const opened = openVariant === v.id;
              return (
                <div key={v.id} className={`card ${v.status === "archived" ? "opacity-50" : ""}`}>
                  <div className="p-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => setOpenVariant(opened ? null : v.id)} className="text-slate-400 hover:text-ink">{opened ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink truncate">« {v.hook} »</div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">{v.label} · {avatarName(v.avatar_id)} · {v.angle} · {v.duration_sec} s · {words(v)} mots{v.script.hook_type ? ` · ${v.script.hook_type}` : ""}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS[v.status]?.cls}`}>{STATUS[v.status]?.label}</span>
                    <span className="text-xs text-slate-500">≈ {(resolution === "1080p" ? v.est_cost_usd * 2.2 : v.est_cost_usd).toFixed(2)} $</span>
                    {v.status === "generating" ? <Loader2 className="w-4 h-4 animate-spin text-amber-500" /> : v.content_item_id ? <Link to="/content" className="text-xs text-accent hover:underline">voir le contenu →</Link> : v.status !== "archived" && <Button size="sm" loading={busy === v.id} onClick={() => void produce(v)} icon={<Sparkles className="w-3.5 h-3.5" />}>Produire</Button>}
                    <button onClick={() => void archive(v)} className="text-slate-300 hover:text-slate-600" title={v.status === "archived" ? "Réactiver" : "Archiver"}><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {opened && (
                    <div className="border-t border-slate-100 p-3 grid md:grid-cols-[1fr_260px] gap-4">
                      <div className="space-y-2">
                        {v.script.beats.map((b, i) => (
                          <div key={b.beat} className="grid grid-cols-[90px_1fr] gap-2 items-start">
                            <div className="text-[11px] text-slate-500 pt-1.5"><span className="font-semibold text-ink">{BEAT_LABEL[b.beat]}</span><br />{b.seconds} s</div>
                            <div>
                              <textarea defaultValue={b.line} rows={2} onBlur={(e) => { if (e.target.value !== b.line) void saveLine(v, i, e.target.value); }} disabled={v.status === "generating" || !!v.content_item_id} className="input w-full text-sm" />
                              <div className="text-[11px] text-slate-400 mt-0.5 italic">{b.action}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-slate-600">
                        <div className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mb-1">Légende</div>
                        <div className="whitespace-pre-wrap">{v.script.caption}</div>
                        <div className="text-accent mt-1">{v.script.hashtags.join(" ")}</div>
                        {v.cta && <div className="mt-2"><span className="text-slate-400">CTA :</span> {v.cta}</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {campaigns.map((c) => {
            const vs = c.variants ?? [];
            const ready = vs.filter((v) => v.status === "ready").length;
            return (
              <div key={c.id} className="card p-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/ugc/${c.id}`} className="font-semibold text-ink hover:text-accent">{c.name}</Link>
                  <div className="text-xs text-slate-500 mt-0.5">{c.brand} · {vs.length} variante{vs.length > 1 ? "s" : ""}{ready ? ` · ${ready} vidéo${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""}` : ""} · {c.matrix.avatar_ids.length} influenceur{c.matrix.avatar_ids.length > 1 ? "s" : ""}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{c.matrix.angles.join(" · ")}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS[c.status]?.cls ?? "bg-slate-100 text-slate-500"}`}>{STATUS[c.status]?.label ?? c.status}</span>
                <button onClick={() => setConfirmAct({ title: `Supprimer la campagne « ${c.name} » ?`, message: "Ses scripts et ses variantes sont supprimés définitivement (les vidéos déjà produites restent dans Contenus).", danger: true, run: () => void removeCampaign(c.id) })} className="text-slate-300 hover:text-rose-600" aria-label="Supprimer la campagne"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
          {loading && !campaigns.length && [0, 1].map((i) => <SkeletonCard key={`sk-${i}`} media={false} />)}
          {!loading && !campaigns.length && !creating && <div className="card p-10 text-center text-sm text-slate-500 md:col-span-2">Aucune campagne. Crée la première : un produit, une marque, tes influenceurs, et le système écrit toutes les variantes.</div>}
        </div>
      )}
      <ConfirmModal open={!!confirmAct} title={confirmAct?.title ?? ""} message={confirmAct?.message ?? ""} danger={confirmAct?.danger} confirmLabel={confirmAct?.confirmLabel ?? "Confirmer"}
        onConfirm={() => { const c = confirmAct; setConfirmAct(null); c?.run(); }} onClose={() => setConfirmAct(null)} />
    </div>
  );
}
