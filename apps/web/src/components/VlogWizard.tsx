import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Clapperboard, Home, Image as ImageIcon, Loader2, MapPin, Mic, RefreshCw, Sparkles, Volume2 } from "lucide-react";
import { X } from "lucide-react";

const INSERT_LABEL: Record<string, string> = { illustration: "illustration", location: "décor seul", close: "gros plan", full: "en pied", selfie: "selfie" };
import { useEffect, useMemo, useState } from "react";
import { api, type AvatarLocation, type LocationScope, type SeedanceResolution, type TalkProvider, type TalkProviderInfo, type VideoFormat, type VideoModelInfo, type VlogProduction, type VlogScene } from "../api";

// Libellés FR des éléments de direction cinématographique (valeurs en anglais).
const ELEMENT_FIELDS: Array<{ key: "action" | "scene_desc" | "camera" | "lighting" | "audio_ambiance" | "constraints"; label: string; hint: string }> = [
  { key: "action", label: "Action", hint: "ce qu'elle fait (verbes concrets)" },
  { key: "scene_desc", label: "Scène", hint: "détails du décor au-delà du lieu" },
  { key: "camera", label: "Caméra", hint: "mouvement + angle" },
  { key: "lighting", label: "Éclairage & style", hint: "ambiance lumineuse, style visuel" },
  { key: "audio_ambiance", label: "Audio (ambiance)", hint: "sons attendus — le dialogue vient du texte" },
  { key: "constraints", label: "Contraintes", hint: "cohérence contextuelle (tenue, pas de texte à l'écran…)" },
];

// ─────────────────────────────────────────────────────────────
// Assistant de réalisation : tu pilotes chaque étape.
//   1. Départ (preset ou brief libre)
//   2. Histoire — valider ou demander des changements
//   3. Durée — puis découpage en segments (4-15 s), modifiable
//   4. Décors + modèle Seedance + coût estimé → production
// Le vlog est un PLAN-SÉQUENCE : chaque segment prolonge le précédent.
// ─────────────────────────────────────────────────────────────

const PRESETS = [
  { key: "grwm", label: "Get Ready With Me" },
  { key: "coffee", label: "Prends un café avec moi" },
  { key: "walk", label: "Balade dans la rue" },
  { key: "vlog", label: "Mini-vlog du jour" },
];

const DURATIONS = [
  { sec: 15, label: "15 s", hint: "1 segment · rapide" },
  { sec: 30, label: "30 s", hint: "~2 segments" },
  { sec: 45, label: "45 s", hint: "~3 segments · narratif" },
  { sec: 60, label: "60 s", hint: "~4 segments · immersif" },
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
  // Réalisation : prise unique (un rendu de 20-30 s, coupes internes entre angles — recommandé)
  // ou montage en plans courts (plans parlés + plans de coupe rendus séparément).
  const [singleTake, setSingleTake] = useState(true);
  const [scenes, setScenes] = useState<VlogScene[]>([]);
  const [sceneInstruction, setSceneInstruction] = useState("");
  const [openElements, setOpenElements] = useState<number | null>(null); // éditeur 8 éléments ouvert
  const patchScene = (i: number, patch: Partial<VlogScene>) =>
    setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  // Étape 4 (décors + modèle Seedance)
  const [universe, setUniverse] = useState<AvatarLocation[]>([]);
  const [scopes, setScopes] = useState<Record<string, LocationScope>>({});
  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [videoModel, setVideoModel] = useState("seedance-2-mini");
  const [resolution, setResolution] = useState<SeedanceResolution>("720p");
  // Format : hybride (voix ElevenLabs + avatar parlant en lip-sync + b-roll Seedance muet) ou plan-séquence Seedance.
  const [format, setFormat] = useState<VideoFormat>("hybrid");
  const [talkProviders, setTalkProviders] = useState<TalkProviderInfo[]>([]);
  const [talkProvider, setTalkProvider] = useState<TalkProvider>("seedance-2.5");
  const [elevenOk, setElevenOk] = useState(true);
  useEffect(() => {
    api.listLocations(avatarId).then((r) => setUniverse(r.locations)).catch(() => setUniverse([]));
    api.listVideoModels().then((r) => { setModels(r.models); setVideoModel(r.default); setResolution(r.default_resolution); }).catch(() => setModels([]));
    api.listTalkProviders().then((r) => { setTalkProviders(r.providers); setTalkProvider(r.default); setElevenOk(r.elevenlabs_configured); }).catch(() => setTalkProviders([]));
  }, [avatarId]);

  // Coût estimé.
  //  - Seedance : prix × durée + extension (prix/2 × durée du segment PRÉCÉDENT, passé en @video1) par raccord.
  //  - Hybride : avatar parlant prix/s × durée parlée (≈ 14 caractères/s), b-roll Seedance × durée, voix ≈ 0,0025 $/s.
  const estimate = useMemo(() => {
    const m = models.find((x) => x.id === videoModel);
    const unit = m?.price_per_sec?.[resolution];
    if (!unit || !scenes.length) return null;
    const clamp = (d: number) => Math.min(15, Math.max(4, d || 12));
    if (format === "hybrid") {
      const tp = talkProviders.find((p) => p.id === talkProvider);
      const talkUnit = tp?.price_per_sec?.std;
      if (talkUnit == null) return null;
      const total = scenes.reduce((acc, sc) => {
        const speech = sc.texte.trim() ? Math.max(1.5, sc.texte.trim().length / 14) : 0;
        if (sc.mode === "talk") return acc + talkUnit * Math.max(1, Math.ceil(speech + 0.5)) + speech * 0.0025;
        return acc + unit * clamp(Math.max(sc.duration_sec, Math.ceil(speech + 0.5))) + speech * 0.0025;
      }, 0);
      return Math.round(total * 100) / 100;
    }
    const total = scenes.reduce((acc, sc, i) => {
      const input = i > 0 ? clamp(scenes[i - 1]!.duration_sec) : 0;
      return acc + unit * clamp(sc.duration_sec) + (unit / 2) * input;
    }, 0);
    return Math.round(total * 100) / 100;
  }, [models, videoModel, resolution, scenes, format, talkProviders, talkProvider]);

  // Prompts finaux Seedance (prévisualisation) — chargés à l'étape Décors.
  const [prompts, setPrompts] = useState<string[] | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [prepBusy, setPrepBusy] = useState<string | null>(null); // décor en cours de préparation
  useEffect(() => {
    if (step !== 3 || !scenes.length) return;
    setPrompts(null);
    const production: VlogProduction = { title: meta.title, story, caption: meta.caption, hashtags: meta.hashtags, scenes };
    api.vlogPreviewPrompts(avatarId, production).then((r) => setPrompts(r.prompts)).catch(() => setPrompts(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, scenes, universe]);

  // Prépare un décor (création + image, ou régénération d'image) avant de payer.
  const prepareDecor = async (d: { key: string; name: string; description: string; scope: LocationScope }) => {
    setPrepBusy(d.key); setErr(null);
    try {
      const r = await api.vlogPrepareLocation(avatarId, { key: d.key, name: d.name, description: d.description, scope: d.scope });
      setUniverse((u) => {
        const rest = u.filter((l) => l.key !== r.location.key);
        return [...rest, r.location];
      });
    } catch (e) { setErr(String(e)); } finally { setPrepBusy(null); }
  };

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
      const r = await api.vlogScenes(avatarId, story, duration, { previousScenes: opts.instruction ? scenes : undefined, instruction: opts.instruction, format, singleTake });
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
      const r = await api.vlogProduce(avatarId, production, chosen, videoModel, resolution, { format, talkProvider, singleTake });
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

              <div className="flex flex-wrap items-center gap-2 pt-3 mt-1 text-xs">
                <span className="text-slate-400">Réalisation</span>
                <button onClick={() => setSingleTake(true)} className={`px-2.5 py-1.5 rounded-lg border ${singleTake ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} title="Un seul rendu de 20-30 s : même tenue, même voix, coupes internes entre 3-5 angles">Prise unique (recommandé)</button>
                <button onClick={() => setSingleTake(false)} className={`px-2.5 py-1.5 rounded-lg border ${!singleTake ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} title="Plans parlés courts et plans de coupe rendus séparément, puis montés : plus de rythme, risque de ruptures entre plans">Montage en plans</button>
                <span className="text-slate-400">{singleTake ? "un seul rendu Seedance 2.5, le modèle coupe lui-même entre les angles" : "chaque plan est un rendu séparé"}</span>
              </div>
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

      {/* ── Étape 3 : scènes (segments du plan-séquence) ── */}
      {step === 2 && (
        <div>
          <p className="text-sm text-slate-500 mb-3">
            {format === "hybrid" && singleTake
              ? <>Prise unique · {scenes[0]?.texte.split(/\s+/).filter(Boolean).length ?? 0} mots (≈ {Math.round((scenes[0]?.texte.split(/\s+/).filter(Boolean).length ?? 0) / 2.3)} s) · {scenes[0]?.shots.length ?? 0} angles. Modifie le texte si besoin, il sera dit d'une traite.</>
              : format === "hybrid"
              ? <>{scenes.length} plan{scenes.length > 1 ? "s" : ""} montés · ~{scenes.reduce((a, s) => a + (s.duration_sec || 12), 0)}s. Plans parlés courts, plans de coupe entre deux, inserts photo pendant la parole. Modifie les textes si besoin.</>
              : <>{scenes.length} segment{scenes.length > 1 ? "s" : ""} · ~{scenes.reduce((a, s) => a + (s.duration_sec || 12), 0)}s en plan-séquence continu. Modifie les textes si besoin.</>}
          </p>
          <div className="space-y-2.5 mb-4">
            {scenes.map((sc, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-accent/10 text-accent text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-sm font-semibold text-ink flex-1 truncate">{sc.titre}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{sc.duration_sec || 12}s</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                    {sc.mode === "talk" ? <><Mic className="w-2.5 h-2.5" /> parle</> : <><Volume2 className="w-2.5 h-2.5" /> voix off</>}
                  </span>
                  {sc.location_key && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">📍 {sc.location_key}</span>}
                </div>
                <textarea
                  className="w-full text-sm text-slate-600 border border-slate-100 rounded-lg px-2.5 py-1.5 outline-none focus:border-accent resize-none h-14"
                  value={sc.texte}
                  onChange={(e) => patchScene(i, { texte: e.target.value })}
                />
                {sc.mode === "talk" && (sc.inserts?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {sc.inserts!.map((ins, k) => (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 flex items-center gap-1" title={ins.desc ?? ""}>
                        <ImageIcon className="w-2.5 h-2.5" /> insert « {ins.anchor} » · {INSERT_LABEL[ins.framing] ?? ins.framing}
                        <button onClick={() => patchScene(i, { inserts: sc.inserts!.filter((_, m) => m !== k) })} className="text-violet-300 hover:text-rose-500" title="Retirer cet insert">✕</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Direction cinématographique : les 8 éléments du prompt, éditables */}
                <button onClick={() => setOpenElements(openElements === i ? null : i)} className="text-[11px] text-accent hover:underline mt-1.5 flex items-center gap-0.5">
                  {openElements === i ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} direction cinématographique (8 éléments)
                </button>
                {openElements === i && (
                  <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 p-2.5 space-y-2">
                    <div className="text-[10px] text-slate-400">Sujet (références identité) et suffixe Qualité sont ajoutés automatiquement. Valeurs en anglais.</div>
                    {ELEMENT_FIELDS.map((f) => (
                      <label key={f.key} className="block">
                        <span className="text-[11px] text-slate-500 font-medium">{f.label}</span>
                        <span className="text-[10px] text-slate-400 ml-1.5">{f.hint}</span>
                        <textarea
                          className="w-full text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-accent resize-none bg-white"
                          rows={f.key === "action" ? 2 : 1}
                          value={sc[f.key] ?? ""}
                          onChange={(e) => patchScene(i, { [f.key]: e.target.value } as Partial<VlogScene>)}
                        />
                      </label>
                    ))}
                    {/* Shot list avec timeline */}
                    <div>
                      <span className="text-[11px] text-slate-500 font-medium">Shot list</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">timeline à l'intérieur du segment ({sc.duration_sec || 12}s)</span>
                      {(sc.shots ?? []).map((sh, k) => (
                        <div key={k} className="flex gap-1.5 mt-1">
                          <input className="w-20 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-accent bg-white" placeholder="0-5s"
                            value={sh.t} onChange={(e) => patchScene(i, { shots: sc.shots.map((x, m) => (m === k ? { ...x, t: e.target.value } : x)) })} />
                          <input className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-accent bg-white" placeholder="description du plan (EN)"
                            value={sh.desc} onChange={(e) => patchScene(i, { shots: sc.shots.map((x, m) => (m === k ? { ...x, desc: e.target.value } : x)) })} />
                          <button onClick={() => patchScene(i, { shots: sc.shots.filter((_, m) => m !== k) })} className="text-slate-300 hover:text-rose-500 px-1" title="Retirer ce shot">✕</button>
                        </div>
                      ))}
                      {(sc.shots ?? []).length < 4 && (
                        <button onClick={() => patchScene(i, { shots: [...(sc.shots ?? []), { t: "", desc: "" }] })} className="text-[11px] text-accent hover:underline mt-1">+ ajouter un shot</button>
                      )}
                    </div>
                  </div>
                )}
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
                  {/* Image de décor OBLIGATOIRE : elle part en référence @image à Seedance. */}
                  {!d.image && (
                    <button
                      onClick={() => prepareDecor({ key: d.key, name: d.name, description: d.description, scope: d.scope })}
                      disabled={prepBusy !== null || d.description.length < 10}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500 text-white font-medium mt-2 flex items-center gap-1.5 disabled:opacity-50">
                      {prepBusy === d.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {prepBusy === d.key ? "Génération de l'image…" : "Générer l'image du décor (requis)"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {decors.length === 0 && <div className="text-sm text-slate-400 text-center py-6">Aucun décor identifié — les scènes utiliseront leur description.</div>}
          </div>

          {/* Format de production */}
          <div className="rounded-xl border border-slate-200 p-3 mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Format</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <button onClick={() => setFormat("hybrid")} disabled={!elevenOk} title={elevenOk ? "" : "ElevenLabs non configuré côté serveur"}
                className={`text-left rounded-lg border p-2.5 transition disabled:opacity-40 ${format === "hybrid" ? "border-accent bg-accent/5" : "border-slate-200 hover:border-accent/40"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">Hybride <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 ml-1">recommandé</span></span>
                </div>
                <div className="text-[11px] text-slate-400">Voix française ElevenLabs v3, avatar parlant en lip-sync, b-roll Seedance muet, sous-titres. Chaque plan se régénère seul.</div>
              </button>
              <button onClick={() => setFormat("seedance")}
                className={`text-left rounded-lg border p-2.5 transition ${format === "seedance" ? "border-accent bg-accent/5" : "border-slate-200 hover:border-accent/40"}`}>
                <span className="text-sm font-medium text-ink">Seedance plan-séquence</span>
                <div className="text-[11px] text-slate-400">Voix synthétisée par Seedance (français médiocre), segments enchaînés. Réservé aux vlogs sans dialogue.</div>
              </button>
            </div>
            {format === "hybrid" && talkProviders.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <span className="text-xs text-slate-400 mr-1">Avatar parlant</span>
                {talkProviders.map((p) => (
                  <button key={p.id} onClick={() => setTalkProvider(p.id)} title={p.hint}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border ${talkProvider === p.id ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    {p.label} · {p.price_per_sec.std.toFixed(3)} $/s
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Prompts finaux Seedance — le texte exact qui sera envoyé, segment par segment (plan-séquence uniquement). */}
          <div className={`rounded-xl border border-slate-200 mb-4 overflow-hidden ${format === "hybrid" ? "hidden" : ""}`}>
            <button onClick={() => setPromptsOpen(!promptsOpen)} className="w-full flex items-center justify-between px-3.5 py-2 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Prompts finaux Seedance ({prompts ? `${prompts.length} segments` : "chargement…"})
              {promptsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {promptsOpen && (
              <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
                {prompts === null && <div className="text-xs text-slate-400">Assemblage des prompts…</div>}
                {prompts?.map((p, i) => (
                  <div key={i}>
                    <div className="text-[11px] font-semibold text-ink mb-1">
                      Segment {i + 1} — {scenes[i]?.titre ?? ""} {i > 0 && <span className="text-accent">(extension de @video1)</span>}
                    </div>
                    <pre className="text-[10px] leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-2 whitespace-pre-wrap text-slate-600">{p}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Modèle Seedance 2.0 + résolution + coût estimé */}
          {models.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-3 mb-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{format === "hybrid" ? "Modèle Seedance 2.0 (plans b-roll)" : "Modèle Seedance 2.0"}</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {models.map((m) => {
                  const unit = m.price_per_sec?.[resolution] ?? Object.values(m.price_per_sec ?? {})[0];
                  return (
                    <button key={m.id} onClick={() => setVideoModel(m.id)}
                      className={`text-left rounded-lg border p-2.5 transition ${videoModel === m.id ? "border-accent bg-accent/5" : "border-slate-200 hover:border-accent/40"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink truncate">{m.label}</span>
                        {unit != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">{unit.toFixed(3)} $/s</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">{m.hint}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="text-xs text-slate-400 mr-1">Résolution</span>
                {(["480p", "720p", "1080p"] as SeedanceResolution[]).map((r) => {
                  const available = models.find((m) => m.id === videoModel)?.price_per_sec?.[r] != null;
                  return (
                    <button key={r} onClick={() => available && setResolution(r)} disabled={!available}
                      title={available ? "" : "Indisponible sur ce modèle (1080p = Pro uniquement)"}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border ${resolution === r ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"} disabled:opacity-30`}>
                      {r}
                    </button>
                  );
                })}
                {estimate != null && (
                  <span className="ml-auto text-sm font-semibold text-ink bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1" title="Estimation : prix × durée + raccords plan-séquence">
                    ≈ {estimate.toFixed(2)} $
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                {format === "hybrid"
                  ? `${scenes.filter((s) => s.mode === "talk").length} plan(s) parlé(s) en lip-sync + ${scenes.filter((s) => s.mode !== "talk").length} plan(s) de coupe avec voix off, ${scenes.reduce((a, s) => a + (s.mode === "talk" ? s.inserts?.length ?? 0 : 0), 0)} insert(s) photo, sous-titres karaoké, musique de fond.`
                  : `${scenes.length} segment${scenes.length > 1 ? "s" : ""} enchaîné${scenes.length > 1 ? "s" : ""} en plan-séquence (audio + voix générés par Seedance).`}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
            <button
              onClick={produce}
              disabled={busy || scenes.length === 0 || decors.some((d) => !d.image)}
              title={decors.some((d) => !d.image) ? "Génère d'abord l'image de chaque décor : elle sert de référence visuelle à Seedance." : ""}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Lancer la production{estimate != null ? ` (≈ ${estimate.toFixed(2)} $)` : ""}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 text-right">
            {decors.some((d) => !d.image)
              ? "⚠️ Chaque décor doit avoir son image avant de lancer (elle sert de référence au keyframe et à Seedance)."
              : format === "hybrid"
                ? "La voix est générée d'abord ; les plans parlés sont animés sur cet audio depuis un keyframe du décor."
                : "Chaque segment prolonge le précédent (extension @video1 avec le segment entier)."}
          </p>
        </div>
      )}
    </div>
  );
}
