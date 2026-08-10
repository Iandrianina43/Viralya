import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Avatar, type AvatarInfo, type ElevenVoice, type VideoProviderName, type VoiceInfo } from "../api";
import { AvatarPhoto } from "../components/AvatarPhoto";

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
    products: [], video_provider: "heygen", video_avatar_id: null, voice_id: null, ref_image_url: null,
  });
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [mediaAvatars, setMediaAvatars] = useState<AvatarInfo[]>([]);
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>([]);
  const [preview, setPreview] = useState<HTMLAudioElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) api.getAvatar(id).then((r) => setForm(r.avatar)).catch((e) => setErr(String(e)));
    api.listElevenVoices().then((r) => setElevenVoices(r.voices)).catch(() => setElevenVoices([]));
  }, [id]);

  const provider = form.video_provider ?? "heygen";
  const isTalkingHead = provider === "heygen" || provider === "argil";
  useEffect(() => {
    if (!isTalkingHead) { setVoices([]); setMediaAvatars([]); return; }
    api.listVoices(provider).then((r) => setVoices(r.voices)).catch(() => setVoices([]));
    api.listMediaAvatars(provider).then((r) => setMediaAvatars(r.avatars)).catch(() => setMediaAvatars([]));
  }, [provider, isTalkingHead]);

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
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
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
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{provider}</span>
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
                  <option value="draft">draft</option><option value="active">active</option><option value="paused">paused</option>
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

            <label className="block"><span className="text-sm text-slate-600">Moteur vidéo</span>
              <select className={field} value={provider} onChange={(e) => set("video_provider", e.target.value as VideoProviderName)}>
                <option value="higgsfield">Higgsfield (vlog cinématique) ⭐ recommandé</option>
                <option value="heygen">HeyGen (talking-head)</option>
                <option value="argil">Argil (talking-head)</option>
                <option value="stub">Stub (test)</option>
              </select>
              {provider === "higgsfield" && (
                <p className="text-xs text-slate-400 mt-1.5">Rien d'autre à configurer : l'identité vient du portrait, la voix d'ElevenLabs. ✓</p>
              )}
            </label>

            {/* Champs spécifiques talking-head — uniquement si HeyGen/Argil est choisi. */}
            {isTalkingHead && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-3">
                <p className="text-xs text-amber-700">Réglages propres au moteur talking-head {provider} (indépendants de la voix ElevenLabs ci-dessus).</p>
                <label className="block"><span className="text-sm text-slate-600">Voix native {provider}</span>
                  {voices.length > 0 ? (
                    <select className={field} value={form.voice_id ?? ""} onChange={(e) => set("voice_id", e.target.value || null)}>
                      <option value="">— auto —</option>
                      {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}{v.category ? ` (${v.category})` : ""}</option>)}
                    </select>
                  ) : <input className={field} placeholder="voice_id du moteur" value={form.voice_id ?? ""} onChange={(e) => set("voice_id", e.target.value || null)} />}
                </label>
                <label className="block"><span className="text-sm text-slate-600">Avatar / visage {provider} (requis pour ce moteur)</span>
                  {mediaAvatars.length > 0 ? (
                    <select className={field} value={form.video_avatar_id ?? ""} onChange={(e) => set("video_avatar_id", e.target.value || null)}>
                      <option value="">— aucun —</option>
                      {mediaAvatars.map((a) => <option key={a.avatar_id} value={a.avatar_id}>{a.name}</option>)}
                    </select>
                  ) : <input className={field} placeholder="avatar_id du moteur (studio HeyGen/Argil)" value={form.video_avatar_id ?? ""} onChange={(e) => set("video_avatar_id", e.target.value || null)} />}
                </label>
              </div>
            )}
          </Section>

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
