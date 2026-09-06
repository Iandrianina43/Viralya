import {
  BookOpen, CheckCircle2, Clapperboard, Coffee, Film, Footprints, Image as ImageIcon,
  Loader2, Mic, Pencil, Play, Sparkles, Sunrise, Video, Wand2, X, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Avatar, type ContentItem, type MemoryEntry, type VlogProduction } from "../api";
import { AvatarPhoto } from "../components/AvatarPhoto";
import { Modal } from "../components/Modal";
import { ProductionRoom } from "../components/ProductionRoom";
import { Universe } from "../components/Universe";
import { VlogWizard } from "../components/VlogWizard";

// Mappe le statut brut d'un content_item vers un libellé + couleur lisibles.
function statusBadge(status: string): { label: string; cls: string } {
  if (status === "needs_review") return { label: "à valider", cls: "bg-amber-100 text-amber-700" };
  if (["approved", "scheduled"].includes(status)) return { label: "planifié", cls: "bg-blue-100 text-blue-700" };
  if (["published", "live", "done"].includes(status)) return { label: "publié", cls: "bg-green-100 text-green-700" };
  if (["failed", "error"].includes(status)) return { label: "échec", cls: "bg-rose-100 text-rose-700" };
  if (status === "rejected") return { label: "rejeté", cls: "bg-slate-100 text-slate-500" };
  return { label: "en cours…", cls: "bg-slate-100 text-slate-500" };
}

const TYPE_ICON: Record<string, typeof Video> = {
  video: Video, hook: Sparkles, carousel: ImageIcon, story: ImageIcon, tweet: Sparkles,
};

const GEN_STEPS = ["Préparation", "Segments Seedance", "Assemblage", "Prêt"];
const TERMINAL = ["needs_review", "failed", "scheduled", "published", "rejected", "live", "done"];

interface GenProgress {
  pct: number; stepIdx: number; label: string; done: boolean; failed: boolean;
  keyframe: string | null; videoUrl: string | null; error: string | null;
}

// Dérive une progression réelle depuis les segments Seedance du content_item en cours.
function computeGen(item: ContentItem | null, startedAt: number, now: number): GenProgress {
  const assets = (item?.assets ?? {}) as Record<string, unknown>;
  const status = item?.status;
  const keyframe = (assets.image_url as string) || null;
  if (status === "failed") return { pct: 100, stepIdx: 3, label: "Échec de la génération", done: false, failed: true, keyframe, videoUrl: null, error: (item?.error as string) || null };
  if (status === "needs_review") return { pct: 100, stepIdx: 3, label: "Prêt à valider ✓", done: true, failed: false, keyframe, videoUrl: (assets.video_url as string) || null, error: null };
  const el = Math.max(0, (now - startedAt) / 1000);
  const segments = (assets.segments as Array<{ phase: string }> | undefined) ?? [];
  if (!segments.length) return { pct: Math.min(15, 6 + el * 0.8), stepIdx: 0, label: "Préparation…", done: false, failed: false, keyframe, videoUrl: null, error: null };
  const doneCount = segments.filter((s) => s.phase === "done").length;
  if (assets.assembling) return { pct: 94, stepIdx: 2, label: "Assemblage final…", done: false, failed: false, keyframe, videoUrl: null, error: null };
  const base = 18 + (doneCount / segments.length) * 72;
  return { pct: Math.min(92, base + el * 0.05), stepIdx: 1, label: `Tournage plan-séquence (${doneCount}/${segments.length} segments)…`, done: false, failed: false, keyframe, videoUrl: null, error: null };
}

// Presets de vlog (ambiances du réalisateur IA — moteur Seedance 2.0).
const VLOG_PRESETS = [
  { key: "grwm", label: "Get Ready With Me", icon: Sunrise, hint: "Elle se prépare, lumière du matin" },
  { key: "coffee", label: "Prends un café avec moi", icon: Coffee, hint: "Terrasse, ambiance cosy" },
  { key: "walk", label: "Balade dans la rue", icon: Footprints, hint: "Elle marche, plan cinématique" },
  { key: "vlog", label: "Mini-vlog du jour", icon: Film, hint: "Plusieurs plans montés" },
];

export function Studio() {
  const { id } = useParams();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clipBusy, setClipBusy] = useState<string | null>(null);
  const [activeGen, setActiveGen] = useState<{ id: string; label: string; startedAt: number } | null>(null);
  const [genItem, setGenItem] = useState<ContentItem | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Salle de production (moteur vlog complet)
  const [prod, setProd] = useState<{ presetLabel: string; story: string; streaming: boolean; stepLabel: string; production: VlogProduction | null } | null>(null);
  const [historyItem, setHistoryItem] = useState<ContentItem | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Prix du clip rapide (preset = 1 segment de 15 s au modèle/résolution par défaut).
  const [quickClipCost, setQuickClipCost] = useState<number | null>(null);
  useEffect(() => {
    api.listVideoModels().then((r) => {
      const m = r.models.find((x) => x.id === r.default);
      const unit = m?.price_per_sec?.[r.default_resolution];
      setQuickClipCost(unit != null ? Math.round(unit * r.duration.default * 100) / 100 : null);
    }).catch(() => setQuickClipCost(null));
  }, []);

  const load = () => {
    if (!id) return;
    api.getAvatar(id).then((r) => setAvatar(r.avatar)).catch((e) => setErr(String(e)));
    api.listContent({ avatar_id: id }).then((r) => {
      setContent(r.content);
      // Suivi auto : reprend la production en cours (même après refresh).
      const inProg = r.content.find((c) => c.type === "video" && !TERMINAL.includes(c.status));
      setActiveGen((cur) => {
        if (cur) return cur;
        if (!inProg) return null;
        return { id: inProg.id, label: String((inProg.payload as { theme?: string })?.theme ?? "Vlog"), startedAt: Date.parse(inProg.created_at) || Date.now() };
      });
      if (inProg) {
        setGenItem((g) => g ?? inProg);
        const production = (inProg.payload as { production?: VlogProduction }).production;
        if (production) setProd((p) => p ?? { presetLabel: production.title, story: production.story, streaming: false, stepLabel: "", production });
      }
    }).catch(() => {});
    api.getMemory(id).then((r) => setMemory(r.memory)).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const generateDay = async () => {
    if (!id) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.planDay(id);
      setMsg(`Contenu du jour lancé (job ${r.job_id.slice(0, 8)}…). Il apparaît ci-dessous d'ici ~1 min.`);
      setTimeout(load, 4000);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  // Moteur vlog complet : histoire streamée en direct → scènes → suivi live.
  const genClip = async (preset: string, label: string) => {
    if (!id) return;
    setClipBusy(preset); setErr(null); setMsg(null);
    setGenItem(null); setActiveGen(null);
    setProd({ presetLabel: label, story: "", streaming: true, stepLabel: "Connexion au réalisateur…", production: null });
    try {
      await api.generateVlogStream(id, preset, {
        onStep: (l) => setProd((p) => (p ? { ...p, stepLabel: l } : p)),
        onToken: (t) => setProd((p) => (p ? { ...p, story: p.story + t } : p)),
        onProduction: (production) => setProd((p) => (p ? { ...p, production, streaming: false } : p)),
        onEnqueued: (cid) => setActiveGen({ id: cid, label, startedAt: Date.now() }),
      });
    } catch (e) {
      setErr(String(e));
      setProd((p) => (p ? { ...p, streaming: false } : p));
    } finally { setClipBusy(null); }
  };

  // Suivi live de la génération en cours (poll du content_item toutes les 3.5s).
  useEffect(() => {
    if (!activeGen) return;
    let stopped = false;
    const poll = async () => {
      try {
        const { item } = await api.getContent(activeGen.id);
        if (stopped) return false;
        setGenItem(item);
        // Hydrate la salle de production (histoire + scènes) depuis le contenu en base.
        const p = (item.payload as { production?: VlogProduction }).production;
        if (p) setProd((cur) => (cur && !cur.production ? { ...cur, production: p, story: p.story || cur.story } : cur));
        if (item.status === "needs_review" || item.status === "failed") { load(); return true; }
      } catch { /* transitoire */ }
      return false;
    };
    const iv = setInterval(async () => { if (await poll()) clearInterval(iv); }, 3500);
    void poll();
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGen]);

  // Horloge pour une barre qui avance en continu entre deux polls.
  useEffect(() => {
    if (!activeGen) return;
    const iv = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [activeGen]);

  const gp = activeGen ? computeGen(genItem, activeGen.startedAt, nowTs) : null;

  const stats = useMemo(() => {
    const total = content.length;
    const review = content.filter((c) => c.status === "needs_review").length;
    const live = content.filter((c) => ["published", "live", "scheduled", "approved"].includes(c.status)).length;
    return { total, review, live };
  }, [content]);

  // Checklist "prêt à générer".
  const ready = avatar
    ? [
        {
          ok: !!avatar.ref_image_url,
          label: "Visage verrouillé",
          hint: avatar.ref_image_url ? "Son portrait sert de référence à toutes les scènes." : "Génère son portrait — c'est l'ancre de son identité.",
        },
        {
          ok: !!avatar.eleven_voice_id,
          label: "Voix choisie",
          hint: avatar.eleven_voice_name ? `${avatar.eleven_voice_name} — utilisée dans les vlogs.` : "Choisis une voix ElevenLabs dans l'éditeur.",
        },
        {
          ok: !!avatar.character_sheet_url,
          label: "Planche d'identité",
          hint: avatar.character_sheet_url
            ? "Character sheet 8 vues — l'identité tient sous tous les angles."
            : "Génère sa planche 8 vues dans l'éditeur (référence Seedance).",
        },
        {
          ok: (avatar.voice_sample_urls ?? []).length > 0,
          label: "Timbre de voix",
          hint: (avatar.voice_sample_urls ?? []).length
            ? "Échantillons prêts — Seedance parle avec sa voix."
            : "Génère ses échantillons de timbre dans l'éditeur.",
        },
      ]
    : [];
  const allReady = ready.every((r) => r.ok);

  if (err && !avatar) return <div className="text-red-600 text-sm">Erreur : {err}</div>;
  if (!avatar) return <div className="text-slate-400 text-sm">Chargement du studio…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <Link to="/avatars" className="text-sm text-slate-500 hover:underline">← Tous les avatars</Link>
        <div className="flex gap-2">
          <Link to={`/avatars/${id}/journal`} className="text-sm px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> Journal</Link>
          <Link to={`/avatars/${id}`} className="text-sm px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Éditer</Link>
        </div>
      </div>

      {/* Hero — fond flouté + portrait bien cadré */}
      <div className="card overflow-hidden mb-6 relative">
        {avatar.ref_image_url && (
          <>
            <img src={avatar.ref_image_url} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-30" />
            <div className="absolute inset-0 bg-white/50" />
          </>
        )}
        <div className="relative flex items-center gap-5 p-5">
          <div className="w-24 h-32 sm:w-28 sm:h-36 rounded-2xl overflow-hidden border-4 border-white shadow-card shrink-0 bg-slate-100">
            <AvatarPhoto src={avatar.ref_image_url} name={avatar.name} className="w-full h-full" rounded="rounded-none" position="object-top" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-xs px-2 py-0.5 rounded-full ${avatar.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>● {avatar.status}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Seedance 2.0</span>
              {avatar.is_ai_disclosed && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">IA déclarée</span>}
            </div>
            <div className="text-2xl font-bold text-ink truncate">{avatar.name}</div>
            <div className="text-sm text-slate-500 truncate">{avatar.niche}{avatar.city ? ` · ${avatar.city}` : ""}</div>
          </div>
        </div>
      </div>

      {msg && <div className="text-green-700 bg-green-50 border border-green-200 rounded-xl p-3 mb-4 text-sm">{msg}</div>}
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      {/* Assistant de réalisation (mode piloté) */}
      {wizardOpen && id && (
        <VlogWizard
          avatarId={id}
          onClose={() => setWizardOpen(false)}
          onLaunched={(contentItemId, title) => {
            setWizardOpen(false);
            setGenItem(null);
            setProd({ presetLabel: title, story: "", streaming: false, stepLabel: "Production lancée…", production: null });
            setActiveGen({ id: contentItemId, label: title, startedAt: Date.now() });
          }}
        />
      )}

      {/* Salle de production (moteur vlog complet) */}
      {prod && (
        <ProductionRoom
          presetLabel={prod.presetLabel}
          story={prod.story}
          streaming={prod.streaming}
          stepLabel={prod.stepLabel}
          production={prod.production}
          item={genItem}
          onCancel={activeGen ? async () => {
            try { await api.cancelContent(activeGen.id); await load(); setMsg("Production annulée."); }
            catch (e) { setErr(String(e)); }
          } : undefined}
          onRegenerateShot={async (idx, texte) => {
            const cid = genItem?.id ?? activeGen?.id;
            if (!cid) return;
            setErr(null); setMsg(null);
            try {
              await api.regenerateShot(cid, idx, texte ? { texte } : {});
              setActiveGen({ id: cid, label: prod.presetLabel, startedAt: Date.now() });
              setMsg(`Plan ${idx + 1} relancé — la vidéo sera remontée à la fin.`);
            } catch (e) { setErr(String(e)); }
          }}
          onClose={() => { setProd(null); setActiveGen(null); setGenItem(null); }}
        />
      )}

      {/* Progression live (clips simples, hors production vlog) */}
      {!prod && activeGen && gp && (
        <div className="card p-5 mb-6 border border-accent/30 ring-1 ring-accent/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              {gp.done ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : gp.failed ? <XCircle className="w-5 h-5 text-rose-600" /> : <Loader2 className="w-5 h-5 text-accent animate-spin" />}
              <div>
                <div className="font-semibold text-ink">Vlog « {activeGen.label} »</div>
                <div className={`text-xs ${gp.failed ? "text-rose-600" : "text-slate-500"}`}>{gp.label}</div>
              </div>
            </div>
            <button onClick={() => { setActiveGen(null); setGenItem(null); }} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex gap-4 items-center">
            {gp.keyframe && <img src={gp.keyframe} alt="scène" className="w-16 h-24 rounded-lg object-cover border border-slate-200 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ease-out ${gp.failed ? "bg-rose-500" : "bg-accent"}`} style={{ width: `${gp.pct}%` }} />
              </div>
              <div className="flex justify-end mt-1"><span className="text-xs text-slate-400">{Math.round(gp.pct)}%</span></div>
              <div className="flex gap-1.5 mt-2">
                {GEN_STEPS.map((s, i) => (
                  <div key={s} className="flex-1">
                    <div className={`h-1 rounded-full ${i <= gp.stepIdx ? (gp.failed ? "bg-rose-400" : "bg-accent") : "bg-slate-200"}`} />
                    <div className={`text-[10px] mt-1 ${i <= gp.stepIdx ? "text-slate-600" : "text-slate-300"}`}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {gp.done && gp.videoUrl && <a href={gp.videoUrl} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-2 mt-4"><Play className="w-4 h-4" /> Voir la vidéo</a>}
          {gp.done && !gp.videoUrl && <div className="text-sm text-amber-600 mt-3">Terminé — retrouve-le dans la galerie / la revue.</div>}
          {gp.failed && <div className="text-sm text-rose-600 mt-3">{gp.error || "Génération échouée. Réessaie."}</div>}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        {/* Colonne principale */}
        <div className="space-y-6">
          {/* Studio vidéo cinématique */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <Clapperboard className="w-5 h-5 text-accent" />
              <h2 className="font-bold text-ink">Studio vidéo</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4">Génère un contenu vivant pour {avatar.name.split(" ")[0]}.</p>

            {/* Mode piloté : tu valides chaque étape */}
            <button onClick={() => setWizardOpen(true)} className="btn-primary w-full flex items-center justify-center gap-2 mb-2">
              <Clapperboard className="w-4 h-4" /> Créer une vidéo (assistant)
            </button>
            <p className="text-xs text-slate-400 mb-4 text-center">Histoire → scènes → images : tu valides à chaque étape.</p>

            {/* Mode automatique */}
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Mode automatique</div>
            <button onClick={generateDay} disabled={busy} className="w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50 mb-2">
              <Wand2 className="w-4 h-4" /> {busy ? "Lancement…" : "Générer le contenu du jour"}
            </button>
            <div className="grid sm:grid-cols-2 gap-2">
              {VLOG_PRESETS.map((p) => {
                const Icon = p.icon;
                const on = clipBusy === p.key;
                return (
                  <button key={p.key} onClick={() => genClip(p.key, p.label)} disabled={!!clipBusy}
                    className="text-left rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5 hover:border-accent hover:bg-accent/5 transition disabled:opacity-50">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0"><Icon className="w-3.5 h-3.5" /></div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink truncate">{p.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">{on ? "Lancement…" : quickClipCost != null ? `≈ ${quickClipCost.toFixed(2)} $ · sans validation` : "sans validation"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-slate-400 mt-2 flex items-center gap-1"><Film className="w-3 h-3" /> Tout d'un trait, sans étape de validation.</div>
          </div>

          {/* Univers de lieux */}
          {id && <Universe avatarId={id} />}

          {/* Galerie de contenus */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-ink">Contenus générés</h2>
              <span className="text-xs text-slate-400">{content.length} élément{content.length > 1 ? "s" : ""}</span>
            </div>
            {content.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">
                <Clapperboard className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Rien encore. Clique sur « Générer le contenu du jour ».
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {content.map((c) => {
                  const b = statusBadge(c.status);
                  const Icon = TYPE_ICON[c.type] ?? Video;
                  const a = c.assets as { video_url?: string; image_url?: string };
                  const p = c.payload as { caption?: string; script?: string };
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
                        {a.image_url ? (
                          <img src={a.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Icon className="w-8 h-8 text-white/40" />
                        )}
                        {a.video_url && (
                          <a href={a.video_url} target="_blank" rel="noreferrer" className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/45 transition">
                            <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center"><Play className="w-5 h-5 text-ink fill-ink ml-0.5" /></span>
                          </a>
                        )}
                        <span className={`absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
                        {!TERMINAL.includes(c.status) && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/30">
                            <div className="h-full bg-accent transition-all duration-1000 ease-out" style={{ width: `${computeGen(c, Date.parse(c.created_at) || nowTs, nowTs).pct}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Icon className="w-3.5 h-3.5" /> {c.type} · {c.network}
                        </div>
                        <div className="text-sm text-slate-700 line-clamp-2">{p.caption || p.script || "—"}</div>
                        {c.error && <div className="text-xs text-rose-600 mt-1 line-clamp-1">{c.error}</div>}
                        {(c.payload as { production?: unknown }).production != null && (
                          <button onClick={() => setHistoryItem(c)} className="text-xs text-accent hover:underline mt-1.5 flex items-center gap-1">
                            <Clapperboard className="w-3 h-3" /> Voir la production
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <Link to="/content" className="text-sm text-accent hover:underline mt-4 inline-block">Ouvrir la revue de contenu →</Link>
          </div>
        </div>

        {/* Colonne latérale */}
        <div className="space-y-6">
          {/* Prêt à générer */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink mb-1">Prêt à générer ?</h3>
            <p className="text-xs text-slate-400 mb-3">Les 3 ingrédients d'une vidéo.</p>
            <div className="space-y-3">
              {ready.map((r) => (
                <div key={r.label} className="flex items-start gap-2 text-sm">
                  {r.ok ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <div className={r.ok ? "text-slate-700" : "text-slate-500 font-medium"}>{r.label}</div>
                    <div className={`text-xs mt-0.5 ${r.ok ? "text-slate-400" : "text-amber-600"}`}>{r.hint}</div>
                  </div>
                </div>
              ))}
            </div>
            {!allReady && (
              <Link to={`/avatars/${id}`} className="text-xs text-accent hover:underline mt-3 inline-block">Compléter dans l'éditeur →</Link>
            )}
          </div>

          {/* Stats */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink mb-3">Activité</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-xl font-bold text-ink">{stats.total}</div><div className="text-xs text-slate-400">total</div></div>
              <div><div className="text-xl font-bold text-amber-600">{stats.review}</div><div className="text-xs text-slate-400">à valider</div></div>
              <div><div className="text-xl font-bold text-green-600">{stats.live}</div><div className="text-xs text-slate-400">en ligne</div></div>
            </div>
          </div>

          {/* Infos clés */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink mb-3">Fiche</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-slate-600"><Mic className="w-3.5 h-3.5 text-slate-400" /> {avatar.eleven_voice_name || "Aucune voix"}</div>
              <div className="flex items-center gap-2 text-slate-600"><Video className="w-3.5 h-3.5 text-slate-400" /> Moteur : Seedance 2.0 (PiAPI)</div>
              <div className="flex items-center gap-2 text-slate-600"><Clapperboard className="w-3.5 h-3.5 text-slate-400" /> {avatar.timezone}</div>
            </div>
          </div>

          {/* Mémoire */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">Mémoire</h3>
              <Link to={`/avatars/${id}/journal`} className="text-xs text-accent hover:underline">tout voir</Link>
            </div>
            {memory.length === 0 ? (
              <div className="text-xs text-slate-400">Vide. L'avatar l'enrichit à chaque publication.</div>
            ) : (
              <div className="space-y-2">
                {memory.slice(0, 4).map((m) => (
                  <div key={m.id} className="text-sm text-slate-600 flex items-start gap-2">
                    <span className="text-accent mt-1">•</span><span className="line-clamp-2">{m.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historique : fiche de production d'une vidéo passée */}
      <Modal open={!!historyItem} onClose={() => setHistoryItem(null)} title="Fiche de production" maxWidth="max-w-3xl">
        {historyItem && (
          <ProductionRoom
            embedded
            presetLabel={String((historyItem.payload as { theme?: string }).theme ?? "Vlog")}
            story={(historyItem.payload as { production?: VlogProduction }).production?.story ?? ""}
            streaming={false}
            stepLabel=""
            production={(historyItem.payload as { production?: VlogProduction }).production ?? null}
            item={historyItem}
            onRegenerateShot={async (idx, texte) => {
              const it = historyItem;
              const production = (it.payload as { production?: VlogProduction }).production ?? null;
              const label = String((it.payload as { theme?: string }).theme ?? it.title ?? "Vidéo");
              setErr(null); setMsg(null);
              try {
                await api.regenerateShot(it.id, idx, texte ? { texte } : {});
                setHistoryItem(null);
                setGenItem(it);
                setProd({ presetLabel: label, story: production?.story ?? "", streaming: false, stepLabel: `Régénération du plan ${idx + 1}…`, production });
                setActiveGen({ id: it.id, label, startedAt: Date.now() });
              } catch (e) { setErr(String(e)); }
            }}
          />
        )}
      </Modal>
    </div>
  );
}
