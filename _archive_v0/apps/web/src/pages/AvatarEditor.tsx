import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Avatar, type HeygenAvatarInfo, type VoiceInfo } from "../api";

const NETWORKS = ["instagram", "tiktok", "youtube", "x", "facebook", "email"];

export function AvatarEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState<Partial<Avatar>>({
    name: "",
    niche: "",
    sex_age: "",
    status: "draft",
    is_ai_disclosed: true,
    priority_networks: ["instagram", "tiktok", "email"],
    affiliate_products: [],
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [heygenAvatars, setHeygenAvatars] = useState<HeygenAvatarInfo[]>([]);

  useEffect(() => {
    if (id)
      api
        .getAvatar(id)
        .then((r) => setForm(r.avatar))
        .catch((e) => setErr(String(e)));
    // Intégrations média (listes vides si clés non configurées → champs texte).
    api.listVoices().then((r) => setVoices(r.voices)).catch(() => {});
    api.listHeygenAvatars().then((r) => setHeygenAvatars(r.avatars)).catch(() => {});
  }, [id]);

  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      if (editing && id) await api.updateAvatar(id, form);
      else await api.createAvatar(form);
      nav("/avatars");
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm";

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-ink mb-6">
        {editing ? "Éditer l'avatar" : "Nouvel avatar"}
      </h1>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="space-y-4 bg-white rounded-xl border border-slate-200 p-6">
        <label className="block">
          <span className="text-sm text-slate-600">Nom complet</span>
          <input className={field} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Niche</span>
          <input className={field} value={form.niche ?? ""} onChange={(e) => set("niche", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Sexe & âge perçu</span>
          <input className={field} value={form.sex_age ?? ""} onChange={(e) => set("sex_age", e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-slate-600">Ville (météo)</span>
            <input
              className={field}
              placeholder="Dubaï"
              value={form.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Fuseau horaire</span>
            <input
              className={field}
              placeholder="Asia/Dubai"
              value={form.timezone ?? ""}
              onChange={(e) => set("timezone", e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-slate-600">Statut</span>
          <select
            className={field}
            value={form.status ?? "draft"}
            onChange={(e) => set("status", e.target.value as Avatar["status"])}
          >
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Produits (séparés par des virgules)</span>
          <input
            className={field}
            value={(form.affiliate_products ?? []).join(", ")}
            onChange={(e) =>
              set(
                "affiliate_products",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              )
            }
          />
        </label>
        <div>
          <span className="text-sm text-slate-600">Réseaux prioritaires</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {NETWORKS.map((n) => {
              const on = (form.priority_networks ?? []).includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    set(
                      "priority_networks",
                      on
                        ? (form.priority_networks ?? []).filter((x) => x !== n)
                        : [...(form.priority_networks ?? []), n],
                    )
                  }
                  className={`text-xs px-3 py-1 rounded-full border ${
                    on ? "bg-accent text-white border-accent" : "border-slate-300 text-slate-500"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_ai_disclosed ?? true}
            onChange={(e) => set("is_ai_disclosed", e.target.checked)}
          />
          <span className="text-sm text-slate-600">Avatar ouvertement déclaré IA (conformité)</span>
        </label>

        <div className="border-t border-slate-200 pt-4">
          <div className="font-semibold text-ink text-sm mb-3">Intégrations média</div>
          <label className="block mb-3">
            <span className="text-sm text-slate-600">Voix (HeyGen — TTS de la vidéo)</span>
            {voices.length > 0 ? (
              <select
                className={field}
                value={form.voice_id ?? ""}
                onChange={(e) => set("voice_id", e.target.value || null)}
              >
                <option value="">— aucune voix —</option>
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name} {v.category ? `(${v.category})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={field}
                placeholder="voice_id HeyGen (studio → Voices)"
                value={form.voice_id ?? ""}
                onChange={(e) => set("voice_id", e.target.value || null)}
              />
            )}
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Avatar HeyGen (talking-head)</span>
            {heygenAvatars.length > 0 ? (
              <select
                className={field}
                value={form.heygen_avatar_id ?? ""}
                onChange={(e) => set("heygen_avatar_id", e.target.value || null)}
              >
                <option value="">— aucun avatar —</option>
                {heygenAvatars.map((a) => (
                  <option key={a.avatar_id} value={a.avatar_id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={field}
                placeholder="avatar_id HeyGen (clé API non configurée)"
                value={form.heygen_avatar_id ?? ""}
                onChange={(e) => set("heygen_avatar_id", e.target.value || null)}
              />
            )}
          </label>
        </div>

        {form.system_prompt && (
          <div>
            <span className="text-sm text-slate-600">Prompt système généré</span>
            <pre className="mt-1 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">
              {form.system_prompt}
            </pre>
          </div>
        )}

        <button
          onClick={submit}
          disabled={saving}
          className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
