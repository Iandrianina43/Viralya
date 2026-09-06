import { Loader2, Mic, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Avatar, type ElevenVoice } from "../api";
import { AvatarPhoto } from "../components/AvatarPhoto";

import { errMsg } from "../lib/errMsg";
const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook"];
const field = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none transition";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-6 mt-6 border-t border-slate-100 first:pt-0 first:mt-0 first:border-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function AvatarEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState<Partial<Avatar>>({
    name: "", niche: "", sex_age: "", city: "", timezone: "Europe/Paris",
    status: "draft", is_ai_disclosed: true, priority_networks: ["instagram", "tiktok"],
    products: [], video_provider: "piapi", ref_image_url: null,
  });
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>([]);
  const [preview, setPreview] = useState<HTMLAudioElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [samplesBusy, setSamplesBusy] = useState(false);

  useEffect(() => {
    if (id) api.getAvatar(id).then((r) => setForm(r.avatar)).catch((e) => setErr(errMsg(e)));
    api.listElevenVoices().then((r) => setElevenVoices(r.voices)).catch(() => setElevenVoices([]));
  }, [id]);

  // Références Seedance : planche d'identité 8 vues + échantillons de timbre.
  const genSheet = async () => {
    if (!id) return;
    setSheetBusy(true); setErr(null);
    try {
      const r = await api.generateCharacterSheet(id);
      setForm((f) => ({ ...f, character_sheet_url: r.character_sheet_url }));
    } catch (e) { setErr(errMsg(e)); } finally { setSheetBusy(false); }
  };
  const genSamples = async () => {
    if (!id) return;
    setSamplesBusy(true); setErr(null);
    try {
      const r = await api.generateVoiceSamples(id);
      setForm((f) => ({ ...f, voice_sample_urls: r.voice_sample_urls }));
    } catch (e) { setErr(errMsg(e)); } finally { setSamplesBusy(false); }
  };

  // Écoute d'un extrait de la voix ElevenLabs sélectionnée.
  const playPreview = () => {
    const v = elevenVoices.find((x) => x.voice_id === form.eleven_voice_id);
    if (!v?.preview_url) return;
    preview?.pause();
    const a = new Audio(v.preview_url);
    setPreview(a);
    void a.play();
  };

  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true); setErr(null);
    try {
      if (editing && id) await api.updateAvatar(id, form);
      else await api.createAvatar(form);
      nav("/avatars");
    } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink">{editing ? "Éditer l'avatar" : "Nouvel avatar"}</h1>
        <button onClick={() => nav("/avatars")} className="text-sm text-slate-500 hover:underline">← Avatars</button>
      </div>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Aperçu profil */}
        <div className="card p-5 h-fit lg:sticky lg:top-2">
          <AvatarPhoto src={form.ref_image_url} name={form.name || "?"} className="w-full aspect-[4/5]" rounded="rounded-2xl" />
          <div className="mt-4">
            <div className="font-bold text-ink text-lg">{form.name || "Sans nom"}</div>
            <div className="text-sm text-slate-500">{form.niche || "—"}</div>
            {form.city && <div className="text-xs text-slate-400 mt-0.5">📍 {form.city}</div>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className={`text-xs px-2 py-0.5 rounded-full ${form.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{form.status}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Seedance 2.0</span>
            {form.is_ai_disclosed && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">IA déclarée</span>}
          </div>
          {form.eleven_voice_name && <div className="text-xs text-slate-400 mt-3">🎙️ {form.eleven_voice_name}</div>}
        </div>

        {/* Formulaire */}
        <div className="card p-6">
          <Section title="Identité">
            <label className="block"><span className="text-sm text-slate-600">Nom complet</span><input className={field} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="block"><span className="text-sm text-slate-600">Niche</span><input className={field} value={form.niche ?? ""} onChange={(e) => set("niche", e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block"><span className="text-sm text-slate-600">Sexe & âge perçu</span><input className={field} value={form.sex_age ?? ""} onChange={(e) => set("sex_age", e.target.value)} /></label>
              <label className="block"><span className="text-sm text-slate-600">Statut</span>
                <select className={field} value={form.status ?? "draft"} onChange={(e) => set("status", e.target.value as Avatar["status"])}>
                  <option value="draft">Brouillon</option><option value="active">Actif</option><option value="paused">En pause</option>
                </select>
              </label>
            </div>
          </Section>

          <Section title="Localisation & contexte">
            <div className="grid grid-cols-2 gap-4">
              <label className="block"><span className="text-sm text-slate-600">Ville de vie (météo/heure)</span><input className={field} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></label>
              <label className="block"><span className="text-sm text-slate-600">Fuseau (ex. Asia/Dubai)</span><input className={field} value={form.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} /></label>
            </div>
          </Section>

          <Section title="Produits & réseaux">
            <label className="block"><span className="text-sm text-slate-600">Produits (séparés par des virgules)</span>
              <input className={field} value={(form.products ?? []).join(", ")} onChange={(e) => set("products", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
            </label>
            <div>
              <span className="text-sm text-slate-600">Réseaux prioritaires</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {NETWORKS.map((n) => {
                  const on = (form.priority_networks ?? []).includes(n);
                  return (
                    <button key={n} type="button" onClick={() => set("priority_networks", on ? (form.priority_networks ?? []).filter((x) => x !== n) : [...(form.priority_networks ?? []), n])}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium ${on ? "bg-accent text-white border-accent" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{n}</button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_ai_disclosed ?? true} onChange={(e) => set("is_ai_disclosed", e.target.checked)} className="accent-[#f0562b]" />
              <span className="text-sm text-slate-600">Avatar ouvertement déclaré IA (conformité)</span>
            </label>
          </Section>

          <Section title="Voix & vidéo">
            {/* LA voix de l'avatar (ElevenLabs) — celle choisie à la création, utilisée dans les vlogs. */}
            <label className="block"><span className="text-sm text-slate-600">Voix de l'avatar (ElevenLabs — utilisée dans les vlogs)</span>
              <div className="flex gap-2">
                {elevenVoices.length > 0 ? (
                  <select
                    className={field}
                    value={form.eleven_voice_id ?? ""}
                    onChange={(e) => {
                      const v = elevenVoices.find((x) => x.voice_id === e.target.value);
                      setForm((f) => ({ ...f, eleven_voice_id: v?.voice_id ?? null, eleven_voice_name: v?.name ?? null }));
                    }}
                  >
                    <option value="">— aucune —</option>
                    {elevenVoices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}{v.language ? ` · ${v.language}` : ""}{v.gender ? ` · ${v.gender === "female" ? "♀" : "♂"}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className={field} value={form.eleven_voice_name ?? ""} disabled placeholder="Voix ElevenLabs (chargement…)" />
                )}
                <button type="button" onClick={playPreview} disabled={!form.eleven_voice_id} className="px-3.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm shrink-0 disabled:opacity-40" title="Écouter un extrait">▶</button>
              </div>
            </label>

            {/* Échantillons de timbre : les 2 mp3 passés à Seedance (@audio1/@audio2). */}
            {editing && (
              <div className="rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-slate-600 flex items-center gap-2">
                    <Mic className="w-4 h-4 text-slate-400" />
                    Échantillons de timbre ({(form.voice_sample_urls ?? []).length}/2)
                    <span className="text-xs text-slate-400">— donnent sa voix aux vidéos Seedance</span>
                  </div>
                  <button type="button" onClick={genSamples} disabled={samplesBusy || !form.eleven_voice_id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40">
                    {samplesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {(form.voice_sample_urls ?? []).length ? "Régénérer" : "Générer"}
                  </button>
                </div>
                {(form.voice_sample_urls ?? []).length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-2 mt-2.5">
                    {(form.voice_sample_urls ?? []).map((u, i) => (
                      <audio key={u} controls preload="none" src={u} className="w-full h-9" title={`Échantillon ${i + 1}`} />
                    ))}
                  </div>
                )}
                {!form.eleven_voice_id && <p className="text-xs text-amber-600 mt-2">Choisis d'abord sa voix ci-dessus, puis enregistre.</p>}
              </div>
            )}
          </Section>

          {/* Références d'identité Seedance : portrait + planche 8 vues. */}
          {editing && (
            <Section title="Identité visuelle (références Seedance)">
              <div className="rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
                  <div className="text-sm text-slate-600">
                    Character sheet (planche 8 vues)
                    <span className="text-xs text-slate-400 block">Verrouille son identité sous tous les angles dans les vidéos.</span>
                  </div>
                  <button type="button" onClick={genSheet} disabled={sheetBusy || !form.ref_image_url}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40">
                    {sheetBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {form.character_sheet_url ? "Régénérer" : "Générer la planche"}
                  </button>
                </div>
                {form.character_sheet_url ? (
                  <a href={form.character_sheet_url} target="_blank" rel="noreferrer">
                    <img src={form.character_sheet_url} alt="character sheet" className="w-full rounded-lg border border-slate-100" />
                  </a>
                ) : (
                  <p className="text-xs text-slate-400">{form.ref_image_url ? "Pas encore de planche — génère-la (1 image, ~30 s)." : "Génère d'abord son portrait."}</p>
                )}
              </div>
            </Section>
          )}

          {form.system_prompt && (
            <Section title="Prompt système généré">
              <pre className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-wrap text-slate-600">{form.system_prompt}</pre>
            </Section>
          )}

          <div className="pt-6 mt-6 border-t border-slate-100 flex justify-end">
            <button onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
