import { ArrowLeft, ArrowRight, Check, Clapperboard, Home, Loader2, MapPin, Mic, RefreshCw, Sparkles, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type AvatarLocation, type LocationScope, type VideoModelInfo, type VlogProduction, type VlogScene } from "../api";

// ─────────────────────────────────────────────────────────────
// Assistant de réalisation : tu pilotes chaque étape.
//   1. Départ (preset ou brief libre)
//   2. Histoire — valider ou demander des changements
//   3. Durée — puis découpage en scènes, modifiable
//   4. Lancement de la production (les images seront validées ensuite)
// ─────────────────────────────────────────────────────────────

const PRESETS = [
  { key: "grwm", label: "Get Ready With Me" },
  { key: "coffee", label: "Prends un café avec moi" },
  { key: "walk", label: "Balade dans la rue" },
  { key: "vlog", label: "Mini-vlog du jour" },
];

const DURATIONS = [
  { sec: 15, label: "15 s", hint: "~2-3 scènes · rapide" },
  { sec: 30, label: "30 s", hint: "~5 scènes · équilibré" },
  { sec: 45, label: "45 s", hint: "~6 scènes · narratif" },
];

const STEPS = ["Départ", "Histoire", "Scènes", "Décors", "Production"];

export function VlogWizard({ avatarId, onClose, onLaunched }: { avatarId: string; onClose: () => void; onLaunched: (contentItemId: string, title: string) => void }) {
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Étape 1
  const [preset, setPreset] = useState<string | null>(null);
  const [brief, setBrief] = useState("");

  // Étape 2
  const [story, setStory] = useState("");
  const [meta, setMeta] = useState<{ title: string; caption: string; hashtags: string[] }>({ title: "", caption: "", hashtags: [] });
  const [streaming, setStreaming] = useState(false);
  const [instruction, setInstruction] = useState("");

  // Étape 3
  const [duration, setDuration] = useState(30);
  const [scenes, setScenes] = useState<VlogScene[]>([]);
  const [sceneInstruction, setSceneInstruction] = useState("");

  // Étape 4 (décors)
  const [universe, setUniverse] = useState<AvatarLocation[]>([]);
  const [scopes, setScopes] = useState<Record<string, LocationScope>>({});
  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [videoModel, setVideoModel] = useState("kling");
  useEffect(() => {
    api.listLocations(avatarId).then((r) => setUniverse(r.locations)).catch(() => setUniverse([]));
    api.listVideoModels().then((r) => { setModels(r.models); setVideoModel(r.default); }).catch(() => setModels([]));
  }, [avatarId]);

  // Décors utilisés par la vidéo : existants (univers) + nouveaux (à créer).
  const decors = useMemo(() => {
    const seen = new Map<string, { key: string; name: string; description: string; isNew: boolean; image: string | null; scope: LocationScope; usedBy: number[] }>();
    scenes.forEach((sc, i) => {
      const nl = sc.new_location;
      const key = nl?.key ?? sc.location_key;
      if (!key) return;
      const existing = seen.get(key);
      if (existing) { existing.usedBy.push(i + 1); return; }
      const known = universe.find((l) => l.key === key);
      seen.set(key, {
        key,
        name: nl?.name ?? known?.name ?? key,
        description: nl?.description ?? known?.description ?? "",
        isNew: !known,
        image: known?.ref_image_url ?? null,
        scope: scopes[key] ?? nl?.scope ?? "permanent",
        usedBy: [i + 1],
      });
    });
    return [...seen.values()];
  }, [scenes, universe, scopes]);

  const runStory = async (opts: { instruction?: string } = {}) => {
    setErr(null); setStreaming(true); setStory("");
    if (step === 0) setStep(1);
    try {
      const r = await api.vlogStory(
        avatarId,
        { preset: preset ?? undefined, brief: brief.trim() || undefined, previousStory: opts.instruction ? story : undefined, instruction: opts.instruction },
        (t) => setStory((s) => s + t),
      );
      setMeta({ title: r.title, caption: r.caption, hashtags: r.hashtags });
      if (r.story) setStory(r.story);
      setInstruction("");
    } catch (e) { setErr(String(e)); } finally { setStreaming(false); }
  };

  const runScenes = async (opts: { instruction?: string } = {}) => {
    setErr(null); setBusy(true);
    try {
      const r = await api.vlogScenes(avatarId, story, duration, { previousScenes: opts.instruction ? scenes : undefined, instruction: opts.instruction });
      setScenes(r.scenes);
      setSceneInstruction("");
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const produce = async () => {
    setErr(null); setBusy(true);
    try {
      const production: VlogProduction = { title: meta.title, story, caption: meta.caption, hashtags: meta.hashtags, scenes };
      const chosen: Record<string, LocationScope> = {};
      decors.forEach((d) => { if (d.isNew) chosen[d.key] = d.scope; });
      const r = await api.vlogProduce(avatarId, production, true, chosen, videoModel);
      onLaunched(r.content_item_id, meta.title || "Vlog");
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  return (
    <div className="card p-5 mb-6 border border-accent/30 ring-1 ring-accent/10">
      {/* En-tête + stepper */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-accent" />
          <h2 className="font-bold text-ink">Assistant de réalisation</h2>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-slate-200"}`} />
            <div className={`text-[11px] mt-1 ${i <= step ? "text-slate-600" : "text-slate-300"}`}>{i + 1}. {s}</div>
          </div>
        ))}
      </div>

      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      {/* ── Étape 1 : départ ── */}
      {step === 0 && (
        <div>
          <p className="text-sm text-slate-500 mb-3">De quoi parle la vidéo ? Choisis une ambiance ou décris ton idée.</p>
          <div className="grid sm:grid-cols-2 gap-2 mb-4">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => { setPreset(p.key); setBrief(""); }}
                className={`text-left rounded-xl border p-3 text-sm transition ${preset === p.key ? "border-accent bg-accent/5 text-ink font-medium" : "border-slate-200 text-slate-600 hover:border-accent/40"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="block mb-4">
            <span className="text-sm text-slate-600">Ou décris ton idée (prioritaire sur l'ambiance)</span>
            <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent mt-1 h-20 resize-none"
              placeholder="ex : elle teste un nouveau resto japonais et finit par une balade au parc…"
              value={brief} onChange={(e) => { setBrief(e.target.value); if (e.target.value) setPreset(null); }} />
          </label>
          <div className="flex justify-end">
            <button onClick={() => runStory()} disabled={!preset && brief.trim().length < 5} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <Sparkles className="w-4 h-4" /> Écrire l'histoire
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 2 : histoire ── */}
      {step === 1 && (
        <div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 mb-3">
            {meta.title && <div className="text-xs font-semibold uppercase tracking-wide text-accent mb-1.5">{meta.title}</div>}
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {story}
              {streaming && <span className="inline-block w-2 h-4 bg-accent align-text-bottom animate-pulse ml-0.5" />}
            </p>
          </div>

          {!streaming && (
            <>
              <label className="block mb-3">
                <span className="text-sm text-slate-600">Envie de changer quelque chose ?</span>
                <div className="flex gap-2 mt-1">
                  <input className="flex-1 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent"
                    placeholder="ex : plus drôle, moins long, ajoute son chat…"
                    value={instruction} onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && instruction.trim() && runStory({ instruction })} />
                  <button onClick={() => runStory({ instruction })} disabled={instruction.trim().length < 3} className="px-3.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm disabled:opacity-40 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Réécrire
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button onClick={() => setStep(0)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">Durée visée</span>
                  <div className="flex gap-1.5">
                    {DURATIONS.map((d) => (
                      <button key={d.sec} onClick={() => setDuration(d.sec)} title={d.hint}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${duration === d.sec ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => runScenes()} disabled={busy || story.length < 20} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Valider l'histoire
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Étape 3 : scènes ── */}
      {step === 2 && (
        <div>
          <p className="text-sm text-slate-500 mb-3">{scenes.length} scènes · ~{scenes.length * 6}s. Modifie les textes si besoin.</p>
          <div className="space-y-2.5 mb-4">
            {scenes.map((sc, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-accent/10 text-accent text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-sm font-semibold text-ink flex-1 truncate">{sc.titre}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                    {sc.mode === "talk" ? <><Mic className="w-2.5 h-2.5" /> parle</> : <><Volume2 className="w-2.5 h-2.5" /> voix off</>}
                  </span>
                  {sc.location_key && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">📍 {sc.location_key}</span>}
                </div>
                <textarea
                  className="w-full text-sm text-slate-600 border border-slate-100 rounded-lg px-2.5 py-1.5 outline-none focus:border-accent resize-none h-14"
                  value={sc.texte}
                  onChange={(e) => setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, texte: e.target.value } : s)))}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2 mb-4">
            <input className="flex-1 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent"
              placeholder="Modifier le découpage : ex : moins de scènes, plus de plans dehors…"
              value={sceneInstruction} onChange={(e) => setSceneInstruction(e.target.value)} />
            <button onClick={() => runScenes({ instruction: sceneInstruction })} disabled={busy || sceneInstruction.trim().length < 3} className="px-3.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm disabled:opacity-40 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Redécouper
            </button>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
            <button onClick={() => setStep(3)} disabled={busy || scenes.length === 0} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <ArrowRight className="w-4 h-4" /> Valider les scènes
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 4 : décors ── */}
      {step === 3 && (
        <div>
          <p className="text-sm text-slate-500 mb-3">Les décors de cette vidéo. Chaque scène tournera dans le décor de référence correspondant.</p>
          <div className="space-y-2.5 mb-4">
            {decors.map((d) => (
              <div key={d.key} className="rounded-xl border border-slate-200 p-3 flex gap-3">
                <div className="w-14 h-18 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center" style={{ height: "4.5rem" }}>
                  {d.image ? <img src={d.image} alt="" loading="lazy" className="w-full h-full object-cover" /> : <MapPin className="w-4 h-4 text-slate-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink">{d.name}</span>
                    {d.isNew
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">nouveau décor</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">déjà dans son univers ✓</span>}
                    <span className="text-[10px] text-slate-400">scène{d.usedBy.length > 1 ? "s" : ""} {d.usedBy.join(", ")}</span>
                  </div>
                  <div className="text-xs text-slate-400 line-clamp-2 mt-0.5">{d.description}</div>

                  {d.isNew && (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => setScopes((s) => ({ ...s, [d.key]: "permanent" }))}
                        className={`text-[11px] px-2 py-1 rounded-lg border flex items-center gap-1 ${d.scope === "permanent" ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        <Home className="w-3 h-3" /> Lieu de vie (garder)
                      </button>
                      <button onClick={() => setScopes((s) => ({ ...s, [d.key]: "oneoff" }))}
                        className={`text-[11px] px-2 py-1 rounded-lg border flex items-center gap-1 ${d.scope === "oneoff" ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        <MapPin className="w-3 h-3" /> Lieu de passage (cette vidéo)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {decors.length === 0 && <div className="text-sm text-slate-400 text-center py-6">Aucun décor identifié — les scènes utiliseront leur description.</div>}
          </div>

          {/* Moteur d'animation */}
          {models.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-3 mb-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Moteur d'animation</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {models.map((m) => (
                  <button key={m.id} onClick={() => setVideoModel(m.id)}
                    className={`text-left rounded-lg border p-2.5 transition ${videoModel === m.id ? "border-accent bg-accent/5" : "border-slate-200 hover:border-accent/40"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink truncate">{m.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">{m.credits} cr</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{m.hint}</div>
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">≈ {scenes.length} clip{scenes.length > 1 ? "s" : ""} à générer pour cette vidéo.</div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
            <button onClick={produce} disabled={busy || scenes.length === 0} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Lancer la production
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 text-right">Les nouveaux décors sont générés d'abord, puis les scènes. Tu valideras les images avant l'animation.</p>
        </div>
      )}
    </div>
  );
}
