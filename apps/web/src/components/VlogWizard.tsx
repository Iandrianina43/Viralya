import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, Clapperboard, Copy, Home, Image as ImageIcon, Link2, Loader2, MapPin, Megaphone, Mic, RefreshCw, ShoppingBag, Sparkles, Upload, Volume2 } from "lucide-react";
import { X } from "lucide-react";

const INSERT_LABEL: Record<string, string> = { illustration: "illustration", location: "décor seul", close: "gros plan", full: "en pied", selfie: "selfie" };
import { useEffect, useMemo, useState } from "react";
import { api, type AvatarLocation, type CloneSource, type FormatKind, type FormatProduct, type LocationScope, type SeedanceResolution, type TalkProvider, type TalkProviderInfo, type VideoFormat, type VideoModelInfo, type VlogProduction, type VlogScene } from "../api";

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

// Formats (6 sept. 2026, docs/RECHERCHE-FORMATS.md) — le choix se fait en première étape.
const FORMATS: Array<{ key: FormatKind; label: string; hint: string; icon: typeof Clapperboard }> = [
  { key: "vlog", label: "Vlog", hint: "Face caméra, prise unique", icon: Clapperboard },
  { key: "ad_product", label: "Pub produit", hint: "Sans visage, le produit est la star", icon: ShoppingBag },
  { key: "ad_creator", label: "Pub avec l'influenceur", hint: "Il présente le produit face caméra", icon: Megaphone },
  { key: "explainer", label: "Explicative", hint: "Sans visage, sa voix off explique", icon: BookOpen },
  { key: "clone", label: "Clone vidéo", hint: "Même vidéo, avec l'influenceur", icon: Copy },
];
const FORMAT_DURATIONS = [15, 20, 30];

export function VlogWizard({ avatarId, onClose, onLaunched }: { avatarId: string; onClose: () => void; onLaunched: (contentItemId: string, title: string) => void }) {
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Étape 1
  const [preset, setPreset] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  // Format : vlog, pub produit / avec l'influenceur, explicative sans visage, clone de vidéo.
  const [kind, setKind] = useState<FormatKind>("vlog");
  const [product, setProduct] = useState<FormatProduct>({ name: "", description: "", image_url: "" });
  const [voiceOver, setVoiceOver] = useState(true);
  const [imgBusy, setImgBusy] = useState(false);
  const [source, setSource] = useState<CloneSource | null>(null);
  const [cloneLink, setCloneLink] = useState("");
  const [cloneText, setCloneText] = useState("");
  const [cloneBusy, setCloneBusy] = useState<string | null>(null);
  const [fmtEstimate, setFmtEstimate] = useState<number | null>(null);
  // B-roll (inserts photo pendant la parole + plans de coupe) — désactivé par défaut depuis le 6 sept.
  const [broll, setBroll] = useState(false);

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
    if (step !== 3 || !scenes.length || kind !== "vlog") return;
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
      const r = await api.vlogProduce(avatarId, production, chosen, videoModel, resolution, { format, talkProvider, singleTake, inserts: broll });
      onLaunched(r.content_item_id, meta.title || "Vlog");
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  // ── Formats (pub, explicative, clone) ──
  const productPayload = (): FormatProduct => ({ name: product.name.trim(), description: product.description.trim(), image_url: product.image_url?.trim() || null });
  const runFormatScript = async (opts: { instruction?: string } = {}) => {
    setErr(null); setBusy(true);
    try {
      const r = await api.formatScript(avatarId, kind, {
        brief: brief.trim() || undefined, product: kind.startsWith("ad") ? productPayload() : undefined,
        duration_sec: duration, voice_over: voiceOver, instruction: opts.instruction,
      });
      setMeta({ title: r.production.title, caption: r.production.caption, hashtags: r.production.hashtags });
      setStory(r.production.story);
      setScenes(r.production.scenes);
      setSceneInstruction("");
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const uploadProductImage = async (file: File) => {
    setImgBusy(true); setErr(null);
    try { const r = await api.uploadImage(avatarId, file); setProduct((p) => ({ ...p, image_url: r.url })); }
    catch (e) { setErr(String(e)); } finally { setImgBusy(false); }
  };
  const loadSource = async (file?: File) => {
    setErr(null); setCloneBusy(file ? "Envoi et préparation de la vidéo…" : "Téléchargement du lien…");
    try {
      const s = file ? await api.cloneUpload(avatarId, file) : await api.cloneLink(avatarId, cloneLink.trim());
      setSource(s);
      setCloneBusy("Transcription de la vidéo…");
      const t = await api.cloneTranscribe(avatarId, s.url);
      setCloneText(t.text);
    } catch (e) { setErr(String(e)); } finally { setCloneBusy(null); }
  };
  const cloneContinue = () => {
    if (!source) return;
    const seconds = Math.max(4, Math.min(30, Math.ceil(source.seconds)));
    const sc: VlogScene = {
      titre: "Clone", mode: "talk", texte: cloneText.trim(), duration_sec: seconds, action: "reproduce the source video shot for shot", shots: [],
      scene_desc: "", camera: "as in the source video", lighting: "as in the source video", audio_ambiance: "ambience of the source video", constraints: "",
    };
    setMeta({ title: "Clone vidéo", caption: "", hashtags: [] });
    setStory(`Même vidéo que la source (${seconds} s), avec l'influenceur à la place de la personne et sa voix sur le même texte.`);
    setScenes([sc]);
    setStep(3);
  };
  const produceFormat = async () => {
    setErr(null); setBusy(true);
    try {
      const production: VlogProduction = { title: meta.title, story, caption: meta.caption, hashtags: meta.hashtags, scenes };
      const r = await api.formatProduce(avatarId, kind, production, {
        resolution, music: kind !== "clone", inserts: broll,
        product: kind.startsWith("ad") ? productPayload() : undefined,
        source_video_url: source?.url, source_seconds: source?.seconds,
      });
      onLaunched(r.content_item_id, meta.title || "Vidéo");
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  useEffect(() => {
    if (step !== 3 || kind === "vlog" || !scenes.length) return;
    setFmtEstimate(null);
    const production: VlogProduction = { title: meta.title, story, caption: meta.caption, hashtags: meta.hashtags, scenes };
    api.formatEstimate(kind, production, { resolution, music: kind !== "clone", inserts: broll }).then((r) => setFmtEstimate(r.total_usd)).catch(() => setFmtEstimate(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, kind, scenes, resolution, broll]);
  const shownEstimate = kind === "vlog" ? estimate : fmtEstimate;

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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            {FORMATS.map((f) => (
              <button key={f.key} onClick={() => { setKind(f.key); setErr(null); }} title={f.hint}
                className={`text-left rounded-xl border p-2.5 transition ${kind === f.key ? "border-accent bg-accent/5" : "border-slate-200 hover:border-accent/40"}`}>
                <f.icon className={`w-4 h-4 mb-1 ${kind === f.key ? "text-accent" : "text-slate-400"}`} />
                <div className="text-xs font-semibold text-ink">{f.label}</div>
                <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{f.hint}</div>
              </button>
            ))}
          </div>

          {(kind === "ad_product" || kind === "ad_creator") && (
            <div>
              <p className="text-sm text-slate-500 mb-3">{kind === "ad_product" ? "Pub produit sans visage : le produit est la star, sa voix off raconte. Une prise de 30 s en 4 plans, image finale propre pour ton texte." : "Pub avec l'influenceur : une prise unique où il tient et montre le produit (accroche, bénéfice, preuve, appel à l'action)."}</p>
              <div className="grid sm:grid-cols-2 gap-2 mb-2">
                <input className="input w-full text-sm" placeholder="Nom du produit *" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
                <div className="flex gap-1.5">
                  <input className="input w-full text-sm" placeholder="URL de la photo du produit" value={product.image_url ?? ""} onChange={(e) => setProduct({ ...product, image_url: e.target.value })} />
                  <label className="px-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs flex items-center gap-1 cursor-pointer shrink-0" title="Déposer une photo du produit">
                    {imgBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Photo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProductImage(e.target.files[0])} />
                  </label>
                </div>
              </div>
              {product.image_url && <img src={product.image_url} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200 mb-2" />}
              <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent h-16 resize-none mb-2"
                placeholder="Description du produit : à quoi il sert, matière, couleur, ce qui le distingue…" value={product.description} onChange={(e) => setProduct({ ...product, description: e.target.value })} />
              <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent h-14 resize-none"
                placeholder={kind === "ad_product" ? "Brief (optionnel) : LE bénéfice à montrer, l'ambiance, la cible…" : "Brief (optionnel) : l'angle, la situation, le code promo…"} value={brief} onChange={(e) => setBrief(e.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="flex items-center gap-3 text-xs">
                  {kind === "ad_product" && (
                    <label className="flex items-center gap-1.5 text-slate-500"><input type="checkbox" checked={voiceOver} onChange={(e) => setVoiceOver(e.target.checked)} /> Voix off avec sa voix</label>
                  )}
                  <span className="text-slate-400">Durée</span>
                  {FORMAT_DURATIONS.map((d) => (
                    <button key={d} onClick={() => setDuration(d)} className={`px-2.5 py-1.5 rounded-lg border ${duration === d ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{d} s</button>
                  ))}
                </div>
                <button onClick={() => runFormatScript()} disabled={busy || product.name.trim().length < 2} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Écrire la pub
                </button>
              </div>
            </div>
          )}

          {kind === "explainer" && (
            <div>
              <p className="text-sm text-slate-500 mb-3">Vidéo explicative sans visage : sa voix off explique, l'image montre (objets, lieux, mains, écrans). Un ou deux clips générés pour les moments forts, des images animées pour le reste.</p>
              <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent h-20 resize-none"
                placeholder="Le sujet : ex. pourquoi ton café filtre est amer, et les trois réglages qui changent tout" value={brief} onChange={(e) => setBrief(e.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Durée</span>
                  {FORMAT_DURATIONS.map((d) => (
                    <button key={d} onClick={() => setDuration(d)} className={`px-2.5 py-1.5 rounded-lg border ${duration === d ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{d} s</button>
                  ))}
                </div>
                <button onClick={() => runFormatScript()} disabled={busy || brief.trim().length < 5} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Écrire le script
                </button>
              </div>
            </div>
          )}

          {kind === "clone" && (
            <div>
              <p className="text-sm text-slate-500 mb-2">Clone : dépose une vidéo de 4 à 30 s ; on refait la même avec l'influenceur à la place de la personne, et sa voix sur le même texte (transcrit, modifiable).</p>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-3">Utilise des vidéos dont tu as les droits (tes tournages, banques libres). Cloner la vidéo d'un autre créateur reprend sa mise en scène.</p>
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <label className="btn-primary flex items-center gap-2 cursor-pointer text-sm">
                  <Upload className="w-4 h-4" /> Déposer une vidéo
                  <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadSource(e.target.files[0])} />
                </label>
                <span className="text-xs text-slate-400">ou</span>
                <input className="input flex-1 min-w-[220px] text-sm" placeholder="Lien TikTok / Instagram / YouTube" value={cloneLink} onChange={(e) => setCloneLink(e.target.value)} />
                <button onClick={() => loadSource()} disabled={!!cloneBusy || !/^https?:\/\//.test(cloneLink.trim())} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm disabled:opacity-40 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Télécharger
                </button>
              </div>
              {cloneBusy && <div className="text-xs text-slate-500 flex items-center gap-1.5 mb-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {cloneBusy}</div>}
              {source && (
                <div className="rounded-xl border border-slate-200 p-3 mb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <video src={source.url} controls className="w-24 rounded-lg bg-black shrink-0" />
                    <div className="text-xs text-slate-500">Source prête : {source.seconds} s{source.trimmed ? ` (coupée à 30 s, l'original faisait ${source.original} s)` : ""}. Relis le texte transcrit : c'est ce qu'il dira avec sa voix.</div>
                  </div>
                  <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent h-24 resize-none" value={cloneText} onChange={(e) => setCloneText(e.target.value)} placeholder="Texte de la vidéo (transcription)…" />
                  <div className="flex justify-end mt-2">
                    <button onClick={cloneContinue} disabled={cloneText.trim().length < 3} className="btn-primary flex items-center gap-2 disabled:opacity-50"><ArrowRight className="w-4 h-4" /> Continuer</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {kind === "vlog" && (<>
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
          </>)}
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
                <label className="flex items-center gap-1.5 text-slate-500" title="Inserts photo pendant la parole et plans de coupe rendus séparément. Désactivé par défaut : une seule prise, même tenue, même voix.">
                  <input type="checkbox" checked={broll} onChange={(e) => { setBroll(e.target.checked); if (!e.target.checked) setSingleTake(true); }} /> B-roll (inserts photo, plans de coupe)
                </label>
                {broll && (<>
                <span className="text-slate-400">Réalisation</span>
                <button onClick={() => setSingleTake(true)} className={`px-2.5 py-1.5 rounded-lg border ${singleTake ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} title="Un seul rendu de 20-30 s : même tenue, même voix, coupes internes entre 3-5 angles">Prise unique (recommandé)</button>
                <button onClick={() => setSingleTake(false)} className={`px-2.5 py-1.5 rounded-lg border ${!singleTake ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} title="Plans parlés courts et plans de coupe rendus séparément, puis montés : plus de rythme, risque de ruptures entre plans">Montage en plans</button>
                <span className="text-slate-400">{singleTake ? "un seul rendu Seedance 2.5, le modèle coupe lui-même entre les angles" : "chaque plan est un rendu séparé"}</span>
                </>)}
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
            {kind === "explainer"
              ? <>{scenes.filter((s) => s.visual === "clip").length} clip(s) Seedance + {scenes.filter((s) => s.visual !== "clip").length} image(s) animée(s) · {scenes.reduce((a, s) => a + s.texte.split(/\s+/).filter(Boolean).length, 0)} mots de voix off. Modifie les textes si besoin.</>
              : kind === "ad_product"
              ? <>Une prise de {scenes[0]?.duration_sec ?? 30} s en {scenes[0]?.shots.length ?? 4} plans, produit verrouillé{scenes[0]?.texte.trim() ? ` · voix off de ${scenes[0].texte.split(/\s+/).filter(Boolean).length} mots` : " · sans voix off"}. Modifie le texte ou les plans si besoin.</>
              : format === "hybrid" && singleTake
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
                  {sc.visual && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{sc.visual === "still" ? "image animée" : "clip"}</span>}
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
                    {(sc.visual || sc.image_prompt !== undefined) && (
                      <label className="block">
                        <span className="text-[11px] text-slate-500 font-medium">Image de la scène</span>
                        <span className="text-[10px] text-slate-400 ml-1.5">{sc.visual === "still" ? "image fixe animée au montage" : "première image du clip"} (EN, sans visage)</span>
                        <textarea className="w-full text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-accent resize-none bg-white" rows={2}
                          value={sc.image_prompt ?? ""} onChange={(e) => patchScene(i, { image_prompt: e.target.value })} />
                      </label>
                    )}
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
                      {(sc.shots ?? []).length < 5 && (
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
            <button onClick={() => (kind === "vlog" ? runScenes({ instruction: sceneInstruction }) : runFormatScript({ instruction: sceneInstruction }))} disabled={busy || sceneInstruction.trim().length < 3} className="px-3.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm disabled:opacity-40 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Redécouper
            </button>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button onClick={() => setStep(kind === "vlog" ? 1 : 0)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
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

          {/* Format de production (vlog uniquement : les autres formats sont toujours en Seedance 2.5) */}
          {kind === "vlog" && (
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
          )}

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
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{kind !== "vlog" ? "Rendu Seedance 2.5" : format === "hybrid" ? "Modèle Seedance 2.0 (plans b-roll)" : "Modèle Seedance 2.0"}</div>
              {kind === "vlog" && (
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
              )}
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
                {shownEstimate != null && (
                  <span className="ml-auto text-sm font-semibold text-ink bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1" title="Estimation : prix × durée + raccords plan-séquence">
                    ≈ {shownEstimate.toFixed(2)} $
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                {kind === "explainer"
                  ? `${scenes.filter((s) => s.visual === "clip").length} clip(s) Seedance 2.5 sans personne + ${scenes.filter((s) => s.visual !== "clip").length} image(s) animée(s), sa voix off, musique de fond.`
                  : kind === "ad_product"
                  ? "Une prise Seedance 2.5, produit en référence exacte, voix off optionnelle avec sa voix, musique de fond."
                  : kind === "ad_creator"
                  ? "Prise unique face caméra avec le produit en référence, sa voix, musique de fond."
                  : kind === "clone"
                  ? "Une prise Seedance 2.5 sur la vidéo source (@video1), l'influenceur à la place de la personne, sa voix sur le texte, sans musique. La vidéo d'entrée est facturée à moitié du tarif."
                  : format === "hybrid"
                  ? `${scenes.filter((s) => s.mode === "talk").length} plan(s) parlé(s) en lip-sync + ${scenes.filter((s) => s.mode !== "talk").length} plan(s) de coupe avec voix off, ${scenes.reduce((a, s) => a + (s.mode === "talk" ? s.inserts?.length ?? 0 : 0), 0)} insert(s) photo, sous-titres karaoké, musique de fond.`
                  : `${scenes.length} segment${scenes.length > 1 ? "s" : ""} enchaîné${scenes.length > 1 ? "s" : ""} en plan-séquence (audio + voix générés par Seedance).`}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Retour</button>
            <button
              onClick={kind === "vlog" ? produce : produceFormat}
              disabled={busy || scenes.length === 0 || decors.some((d) => !d.image)}
              title={decors.some((d) => !d.image) ? "Génère d'abord l'image de chaque décor : elle sert de référence visuelle à Seedance." : ""}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Lancer la production{shownEstimate != null ? ` (≈ ${shownEstimate.toFixed(2)} $)` : ""}
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
