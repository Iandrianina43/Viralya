import { ArrowLeft, Check, ChevronDown, ChevronRight, Play, RefreshCw, Sparkles, Square, Volume2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type AvatarDraft, type ChatMessage, type ElevenVoice, type PortraitSpec } from "../api";
import { Loader, LoaderTile } from "../components/Loader";

const WELCOME =
  "Salut ! 👋 Je suis là pour t'aider à créer ton influenceur IA de A à Z.\n\n" +
  "Décris-moi simplement le personnage que tu veux : son domaine/niche, un nom si tu en as un, " +
  "le style (homme/femme, jeune/plus mûr…). Pas d'idée précise ? Donne-moi juste un secteur ou " +
  "un vibe, et je te fais des propositions concrètes. 🚀";

// Libellés FR des champs de la fiche portrait structurée (valeurs en anglais).
const SPEC_LABELS: Record<string, string> = {
  aspect_ratio: "Ratio", age: "Âge", ethnicity: "Origine", shot_style: "Style de photo",
  framing: "Cadrage", skin_tone: "Peau", hair_style: "Coiffure", hair_color: "Couleur cheveux",
  eyes: "Yeux", brows: "Sourcils", nose: "Nez", lips: "Lèvres", facial_hair: "Pilosité faciale",
  face_shape: "Forme du visage", expression: "Expression", clothing: "Tenue", makeup: "Maquillage",
  lighting: "Lumière", background: "Arrière-plan", realism: "Réalisme",
};

const LANG_LABELS: Record<string, string> = {
  en: "Anglais", fr: "Français", es: "Espagnol", de: "Allemand", it: "Italien",
  pt: "Portugais", ar: "Arabe", nl: "Néerlandais", pl: "Polonais", hi: "Hindi",
  ja: "Japonais", ko: "Coréen", zh: "Chinois", tr: "Turc", ru: "Russe",
};
const langLabel = (c: string) => LANG_LABELS[c] ?? c.toUpperCase();

type Phase = "persona" | "face" | "voice" | "review";

function Stepper({ phase, ready, canCreate, onGo }: { phase: Phase; ready: boolean; canCreate: boolean; onGo: (p: Phase) => void }) {
  const steps: Array<{ key: Phase; label: string; enabled: boolean }> = [
    { key: "persona", label: "1. Personnage", enabled: true },
    { key: "face", label: "2. Visage", enabled: ready },
    { key: "voice", label: "3. Voix", enabled: ready },
    { key: "review", label: "4. Créer", enabled: canCreate },
  ];
  return (
    <div className="flex gap-2 mb-6">
      {steps.map((s) => {
        const active = s.key === phase;
        return (
          <button
            key={s.key}
            disabled={!s.enabled}
            onClick={() => s.enabled && onGo(s.key as Phase)}
            className={`text-sm px-3.5 py-1.5 rounded-full font-medium transition ${active ? "bg-accent text-white shadow-sm" : s.enabled ? "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50" : "bg-slate-50 text-slate-300"}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function DraftCard({ draft, ready }: { draft: AvatarDraft; ready: boolean }) {
  const rows: Array<[string, string | undefined]> = [
    ["Nom", draft.name],
    ["Niche", draft.niche],
    ["Sexe & âge", draft.sex_age],
    ["Ville", draft.city],
    ["Ton", draft.tone_of_voice],
    ["Personnalité", (draft.personality ?? []).join(", ") || undefined],
    ["Voix", draft.eleven_voice_name || undefined],
  ];
  return (
    <div className="w-72 shrink-0 card p-4 h-fit sticky top-2">
      <div className="font-semibold text-ink mb-3">Fiche du personnage</div>
      {draft.ref_image_url && <img src={draft.ref_image_url} alt="visage" className="w-full rounded-xl mb-3 border border-slate-200" />}
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-slate-400">{label}</div>
            <div className={`text-sm ${value ? "text-slate-700" : "text-slate-300 italic"}`}>{value ?? "à définir…"}</div>
          </div>
        ))}
      </div>
      {ready && <div className="mt-4 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">✅ Fiche assez complète</div>}
    </div>
  );
}

export function CreateAvatar() {
  const { draftId } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("persona");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<AvatarDraft>({});
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Visage — fiche portrait structurée (IA pré-remplit, tu ajustes) → génération.
  const [spec, setSpec] = useState<PortraitSpec | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [refine, setRefine] = useState("");
  const [faceLoading, setFaceLoading] = useState(false);

  // Voix
  const [voices, setVoices] = useState<ElevenVoice[]>([]);
  const [voicesConfigured, setVoicesConfigured] = useState(true);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState<"all" | "male" | "female">("all");
  const audioRef = useRef<HTMLAudioElement>(null);

  // Étape 4/5
  const [creating, setCreating] = useState(false);
  const [createdAvatar, setCreatedAvatar] = useState<{ id: string; name: string } | null>(null);

  const recordId = useRef<string | null>(draftId ?? null);
  const started = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (draftId) {
      api.getDraft(draftId)
        .then((r) => {
          const rec = r.record;
          setMessages(rec.messages?.length ? rec.messages : [{ role: "assistant", content: WELCOME }]);
          setDraft(rec.fiche ?? {});
          setReady(Boolean(rec.ready));
          if (rec.fiche?.eleven_voice_id) setPhase("voice");
          else if (rec.fiche?.ref_image_url || (rec.fiche?.face_options ?? []).length) setPhase("face");
        })
        .catch((e) => { setErr(String(e)); setMessages([{ role: "assistant", content: WELCOME }]); });
    } else {
      setMessages([{ role: "assistant", content: WELCOME }]);
    }
  }, [draftId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // Charge les voix ElevenLabs à l'entrée de la phase voix.
  useEffect(() => {
    if (phase !== "voice" || voices.length || voicesLoading) return;
    setVoicesLoading(true);
    api.listElevenVoices()
      .then((r) => { setVoicesConfigured(r.configured); setVoices(r.voices); })
      .catch((e) => setErr(String(e)))
      .finally(() => setVoicesLoading(false));
  }, [phase]);

  const saveDraft = async (msgs: ChatMessage[], dft: AvatarDraft, rdy: boolean) => {
    const title = dft.name || dft.niche || "Brouillon";
    setSaving(true);
    try {
      if (recordId.current) await api.updateDraft(recordId.current, { title, messages: msgs, fiche: dft, ready: rdy });
      else {
        const r = await api.createDraft({ title, messages: msgs, fiche: dft, ready: rdy });
        recordId.current = r.record.id;
        navigate(`/avatars/create/${r.record.id}`, { replace: true });
      }
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  const runStream = async (history: ChatMessage[], curDraft: AvatarDraft) => {
    setLoading(true); setErr(null);
    setMessages([...history, { role: "assistant", content: "" }]);
    let acc = "";
    try {
      const res = await api.chatAvatarStream(history, curDraft, (tok) => {
        acc += tok;
        setMessages([...history, { role: "assistant", content: acc }]);
      });
      const finalMessages: ChatMessage[] = [...history, { role: "assistant", content: acc }];
      const merged: AvatarDraft = { ...res.draft, ref_image_url: curDraft.ref_image_url, face_options: curDraft.face_options, eleven_voice_id: curDraft.eleven_voice_id, eleven_voice_name: curDraft.eleven_voice_name };
      setMessages(finalMessages); setDraft(merged); setReady(res.ready);
      await saveDraft(finalMessages, merged, res.ready);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    await runStream([...messages, { role: "user", content: text }], draft);
  };

  // Pré-remplit (ou re-propose) la fiche portrait depuis le personnage + consigne libre.
  const draftSpec = async () => {
    setSpecLoading(true); setErr(null);
    try {
      const r = await api.draftPortraitSpec(draft, refine.trim() || undefined);
      setSpec(r.spec);
      setSpecOpen(true);
      const nd: AvatarDraft = { ...draft, portrait_spec: r.spec };
      setDraft(nd);
      await saveDraft(messages, nd, ready);
    } catch (e) { setErr(String(e)); } finally { setSpecLoading(false); }
  };

  const genFace = async () => {
    setFaceLoading(true); setErr(null);
    try {
      const r = await api.generateFace(draft, spec ?? draft.portrait_spec ?? null, refine.trim() || undefined);
      if (!spec) setSpec(r.spec);
      const nd: AvatarDraft = { ...draft, portrait_spec: r.spec, face_options: [...(draft.face_options ?? []), r.imageUrl] };
      setDraft(nd);
      await saveDraft(messages, nd, ready);
    } catch (e) { setErr(String(e)); } finally { setFaceLoading(false); }
  };

  const selectFace = async (url: string) => {
    const nd: AvatarDraft = { ...draft, ref_image_url: url };
    setDraft(nd);
    await saveDraft(messages, nd, ready);
  };

  const playPreview = (v: ElevenVoice) => {
    const a = audioRef.current;
    if (!a || !v.preview_url) return;
    if (playingId === v.voice_id) { a.pause(); setPlayingId(null); return; }
    a.src = v.preview_url; void a.play(); setPlayingId(v.voice_id);
  };

  const selectVoice = async (v: ElevenVoice) => {
    const nd: AvatarDraft = { ...draft, eleven_voice_id: v.voice_id, eleven_voice_name: v.name };
    setDraft(nd);
    await saveDraft(messages, nd, ready);
  };

  const createAvatar = async () => {
    if (!recordId.current) return;
    setCreating(true); setErr(null);
    try {
      const r = await api.finalizeDraft(recordId.current);
      setCreatedAvatar({ id: r.avatar.id, name: r.avatar.name });
    } catch (e) { setErr(String(e)); } finally { setCreating(false); }
  };

  const genFirst = async () => {
    if (!createdAvatar) return;
    try { await api.planDay(createdAvatar.id); navigate("/content"); } catch (e) { setErr(String(e)); }
  };

  const last = messages[messages.length - 1];
  const thinking = loading && last?.role === "assistant" && last.content === "";
  const options = draft.face_options ?? [];
  const langs = Array.from(new Set(voices.map((v) => v.language).filter(Boolean))) as string[];
  const filteredVoices = voices.filter(
    (v) => (langFilter === "all" || v.language === langFilter) && (genderFilter === "all" || v.gender === genderFilter),
  );
  const canCreate = ready && !!draft.ref_image_url;

  // Écran de fin (étape 5) : avatar créé → proposer la 1re production.
  if (createdAvatar) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-ink">{createdAvatar.name} est créé !</h1>
        <p className="text-slate-500 mt-2">Ton influenceur est prêt. On lance sa première production de contenu ?</p>
        {err && <div className="text-red-600 mt-3 text-sm">Erreur : {err}</div>}
        <div className="flex items-center justify-center gap-3 mt-6">
          <button onClick={genFirst} className="btn-primary">🎬 Générer son 1er contenu</button>
          <button onClick={() => navigate("/avatars")} className="text-sm px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50">Voir mes avatars</button>
        </div>
        <p className="text-xs text-slate-400 mt-8">💡 Sa planche d'identité (8 vues) et ses échantillons de voix se préparent en arrière-plan — visibles dans l'éditeur.</p>
      </div>
    );
  }

  return (
    <div>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-ink">Créer un avatar</h1>
        <div className="flex items-center gap-3">
          {saving ? <Loader label="enregistrement…" /> : recordId.current ? <span className="text-xs text-green-600">brouillon enregistré ✓</span> : null}
          <Link to="/avatars" className="text-sm text-slate-500 hover:underline">← Avatars</Link>
        </div>
      </div>

      <Stepper phase={phase} ready={ready} canCreate={canCreate} onGo={setPhase} />
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="flex gap-6">
        <div className="flex-1">
          {/* ── PERSONNAGE ── */}
          {phase === "persona" && (
            <div className="flex flex-col card" style={{ height: "66vh" }}>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-accent text-white" : "bg-slate-100 text-slate-800"}`}>
                      {m.content}
                      {m.role === "assistant" && i === messages.length - 1 && loading && m.content !== "" && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-slate-400 animate-pulse" />}
                    </div>
                  </div>
                ))}
                {thinking && <Loader label="L'IA écrit…" />}
                <div ref={bottomRef} />
              </div>
              {ready && (
                <div className="px-4 py-2.5 bg-green-50 border-t border-green-200 flex items-center justify-between">
                  <span className="text-sm text-green-700">✅ La fiche est prête !</span>
                  <button onClick={() => setPhase("face")} className="text-sm px-4 py-1.5 rounded-lg bg-green-600 text-white font-medium">Passer au visage →</button>
                </div>
              )}
              <div className="border-t border-slate-200 p-3 flex gap-2">
                <input className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Décris ton influenceur…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={loading} />
                <button onClick={send} disabled={loading} className="btn-primary disabled:opacity-50">Envoyer</button>
              </div>
            </div>
          )}

          {/* ── VISAGE ── */}
          {phase === "face" && (
            <div className="card p-5">
              <div className="font-semibold text-ink mb-1">Le visage de {draft.name || "ton avatar"}</div>
              <p className="text-sm text-slate-500 mb-4">L'IA propose une fiche portrait détaillée, tu l'ajustes champ par champ, puis tu génères les portraits.</p>

              <div className="flex flex-wrap items-end gap-3 mb-3">
                <label className="text-sm flex-1 min-w-[220px]">
                  <span className="text-slate-600 block mb-1">Consigne libre (optionnel)</span>
                  <input className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="ex : plus jeune, lunettes, cheveux bruns, fond bureau…" value={refine} onChange={(e) => setRefine(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !faceLoading && genFace()} />
                </label>
                <button onClick={draftSpec} disabled={specLoading} className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm flex items-center gap-2 disabled:opacity-50">
                  {specLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {spec ? "Re-proposer la fiche" : "Proposer la fiche (IA)"}
                </button>
                <button onClick={genFace} disabled={faceLoading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  {options.length ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  {faceLoading ? "Génération…" : options.length ? "Générer un autre" : "Générer un portrait"}
                </button>
              </div>

              {/* Fiche portrait structurée, ajustable champ par champ */}
              {spec && (
                <div className="rounded-xl border border-slate-200 mb-3 overflow-hidden">
                  <button onClick={() => setSpecOpen(!specOpen)} className="w-full flex items-center justify-between px-3.5 py-2 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Fiche portrait ({Object.keys(spec).length} champs, en anglais) {specOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  {specOpen && (
                    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 p-3.5">
                      {Object.entries(spec).map(([k, v]) => (
                        <label key={k} className="block">
                          <span className="text-[11px] text-slate-400">{SPEC_LABELS[k] ?? k}</span>
                          <input className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                            value={v} onChange={(e) => setSpec((s) => (s ? { ...s, [k]: e.target.value } : s))} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {options.length === 0 && !faceLoading && <div className="text-slate-400 text-sm mb-3">Aucun portrait encore. Propose la fiche, ajuste-la, puis « Générer un portrait ».</div>}

              <div className="grid grid-cols-3 gap-3">
                {options.map((url) => {
                  const selected = draft.ref_image_url === url;
                  return (
                    <button key={url} onClick={() => selectFace(url)} className={`relative rounded-xl overflow-hidden border-2 ${selected ? "border-accent ring-2 ring-accent" : "border-slate-200 hover:border-slate-300"}`}>
                      <img src={url} alt="portrait" className="w-full aspect-[2/3] object-cover" />
                      {selected && <div className="absolute top-1.5 right-1.5 bg-accent text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1"><Check className="w-3 h-3" />choisi</div>}
                    </button>
                  );
                })}
                {faceLoading && <LoaderTile label="génération…" />}
              </div>

              <div className="flex items-center justify-between mt-6">
                <button onClick={() => setPhase("persona")} className="text-sm text-slate-500 hover:underline flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Retour au personnage</button>
                <button onClick={() => setPhase("voice")} disabled={!draft.ref_image_url} className="btn-primary disabled:opacity-40" title={draft.ref_image_url ? "" : "Choisis d'abord un portrait"}>Continuer vers la voix →</button>
              </div>
            </div>
          )}

          {/* ── VOIX ── */}
          {phase === "voice" && (
            <div className="card p-5">
              <div className="font-semibold text-ink mb-1">La voix de {draft.name || "ton avatar"}</div>
              <p className="text-sm text-slate-500 mb-1">Écoute les voix ElevenLabs et choisis celle qui colle au personnage.</p>
              <p className="text-xs text-slate-400 mb-4">💡 Toutes ces voix sont multilingues — elles parlent français même si l'accent d'origine diffère. Le filtre « langue » = accent.</p>

              {voicesLoading && <Loader label="Chargement des voix…" />}
              {!voicesLoading && !voicesConfigured && <div className="text-sm text-amber-600">Clé ElevenLabs non configurée dans le .env (ELEVENLABS_API_KEY).</div>}

              {/* Filtres langue + genre */}
              {voices.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <select className="border border-slate-300 rounded-xl px-3 py-2 text-sm" value={langFilter} onChange={(e) => setLangFilter(e.target.value)}>
                    <option value="all">Toutes les langues</option>
                    {langs.map((c) => <option key={c} value={c}>{langLabel(c)}</option>)}
                  </select>
                  <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                    {([["all", "Tous"], ["male", "Masculin"], ["female", "Féminin"]] as const).map(([g, label]) => (
                      <button key={g} onClick={() => setGenderFilter(g)} className={`text-sm px-3 py-1.5 rounded-lg font-medium ${genderFilter === g ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}>{label}</button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 ml-auto">{filteredVoices.length} voix</span>
                </div>
              )}

              <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                {filteredVoices.map((v) => {
                  const selected = draft.eleven_voice_id === v.voice_id;
                  const playing = playingId === v.voice_id;
                  return (
                    <div key={v.voice_id} onClick={() => selectVoice(v)} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${selected ? "border-accent bg-accent-light" : "border-slate-200 hover:bg-slate-50"}`}>
                      <button onClick={(e) => { e.stopPropagation(); playPreview(v); }} disabled={!v.preview_url} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0 hover:bg-slate-50 disabled:opacity-40">
                        {playing ? <Square className="w-3.5 h-3.5 text-accent fill-accent" /> : <Play className="w-4 h-4 text-slate-600" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink flex items-center gap-2">{v.name}{playing && <Volume2 className="w-3.5 h-3.5 text-accent animate-pulse" />}</div>
                        {v.description && <div className="text-xs text-slate-400 truncate">{v.description}</div>}
                      </div>
                      {selected && <Check className="w-5 h-5 text-accent shrink-0" />}
                    </div>
                  );
                })}
                {voices.length > 0 && filteredVoices.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">Aucune voix pour ce filtre.</div>}
              </div>

              <div className="flex items-center justify-between mt-6">
                <button onClick={() => setPhase("face")} className="text-sm text-slate-500 hover:underline flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Retour au visage</button>
                <button onClick={() => setPhase("review")} disabled={!canCreate} className="btn-primary disabled:opacity-40">Continuer → Créer l'avatar</button>
              </div>
            </div>
          )}

          {/* ── RÉCAP / CRÉER ── */}
          {phase === "review" && (
            <div className="card p-6">
              <div className="font-semibold text-ink text-lg mb-4">Récapitulatif</div>
              <div className="flex gap-6">
                {draft.ref_image_url ? (
                  <img src={draft.ref_image_url} alt="visage" className="w-40 rounded-xl border border-slate-200" />
                ) : (
                  <div className="w-40 aspect-[2/3] rounded-xl bg-slate-100 flex items-center justify-center text-slate-300 text-xs">pas de visage</div>
                )}
                <div className="flex-1 space-y-2 text-sm">
                  {([["Nom", draft.name], ["Niche", draft.niche], ["Sexe & âge", draft.sex_age], ["Ville", draft.city], ["Ton", draft.tone_of_voice], ["Personnalité", (draft.personality ?? []).join(", ")], ["Voix", draft.eleven_voice_name ?? undefined]] as Array<[string, string | undefined]>).map(([k, v]) => (
                    <div key={k}><span className="text-slate-400 text-xs">{k} : </span><span className="text-slate-700">{v || "—"}</span></div>
                  ))}
                </div>
              </div>
              {!draft.eleven_voice_id && <div className="text-xs text-amber-600 mt-4">Aucune voix choisie (optionnel) — tu peux revenir à l'étape Voix.</div>}
              <div className="flex items-center justify-between mt-6">
                <button onClick={() => setPhase("voice")} className="text-sm text-slate-500 hover:underline flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Retour à la voix</button>
                <button onClick={createAvatar} disabled={!canCreate || creating} className="btn-primary disabled:opacity-50">{creating ? "Création…" : "✨ Créer l'avatar"}</button>
              </div>
            </div>
          )}
        </div>

        <DraftCard draft={draft} ready={ready} />
      </div>
    </div>
  );
}
