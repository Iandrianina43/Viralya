import { Clapperboard, FilePlus2, Mic, Pencil, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Avatar, type DraftSummary } from "../api";
import { AvatarPhoto } from "../components/AvatarPhoto";
import { ConfirmModal } from "../components/Modal";

import { errMsg } from "../lib/errMsg";
import { SkeletonCard } from "../components/ui";
const STATUS_FR: Record<string, string> = { active: "actif", draft: "brouillon", paused: "en pause" };

export function Avatars() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [confirmPlan, setConfirmPlan] = useState<Avatar | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<DraftSummary | null>(null);
  const [confirmAvatar, setConfirmAvatar] = useState<Avatar | null>(null);

  const [loading, setLoading] = useState(true);
  const load = () => {
    void Promise.allSettled([
      api.listAvatars().then((r) => setAvatars(r.avatars)).catch((e) => setErr(errMsg(e))),
      api.listDrafts().then((r) => setDrafts(r.drafts)).catch(() => {}),
    ]).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const planDay = async (id: string) => {
    setMsg(null); setErr(null); setBusy(id);
    try {
      await api.planDay(id);
      setMsg("Contenu du jour lancé : suis l'avancement dans le Task Center, les contenus arrivent dans « Contenus ».");
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const doDeleteDraft = async () => {
    if (!confirmDraft) return;
    const id = confirmDraft.id;
    setConfirmDraft(null);
    try { await api.deleteDraft(id); load(); } catch (e) { setErr(errMsg(e)); }
  };

  const doDeleteAvatar = async () => {
    if (!confirmAvatar) return;
    const id = confirmAvatar.id;
    setConfirmAvatar(null);
    try { await api.deleteAvatar(id); load(); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Avatars</h1>
          <p className="text-sm text-slate-500 mt-0.5">Tes influenceurs IA — crée, édite, génère leur contenu.</p>
        </div>
        <Link to="/avatars/create" className="btn-primary flex items-center gap-2"><Sparkles className="w-4 h-4" /> Créer un avatar</Link>
      </div>

      {msg && <div className="text-green-700 bg-green-50 border border-green-200 rounded-xl p-3 mb-4 text-sm">{msg}</div>}
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      {/* Brouillons */}
      {drafts.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Brouillons en cours</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {drafts.map((d) => (
              <div key={d.id} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-200/70 text-amber-700 flex items-center justify-center shrink-0"><FilePlus2 className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">{d.title}</div>
                  <div className="text-xs text-amber-700">{d.ready ? "fiche prête ✓" : "en cours…"}</div>
                </div>
                <Link to={`/avatars/create/${d.id}`} className="text-sm px-3 py-1.5 rounded-lg bg-accent text-white font-medium">Reprendre</Link>
                <button onClick={() => setConfirmDraft(d)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grille de cartes avatars */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {avatars.map((a) => (
          <div key={a.id} className="card overflow-hidden flex flex-col">
            <Link to={`/avatars/${a.id}/studio`} className="relative block group">
              <AvatarPhoto src={a.ref_image_url} name={a.name} className="w-full aspect-square" rounded="rounded-none" />
              <span className={`absolute top-3 left-3 text-xs px-2 py-0.5 rounded-full backdrop-blur bg-white/85 ${a.status === "active" ? "text-green-700" : "text-slate-500"}`}>● {STATUS_FR[a.status] ?? a.status}</span>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                <span className="text-sm font-semibold text-white bg-accent px-4 py-2 rounded-xl flex items-center gap-2"><Clapperboard className="w-4 h-4" /> Ouvrir le studio</span>
              </div>
            </Link>
            <div className="p-4 flex flex-col flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link to={`/avatars/${a.id}/studio`} className="font-bold text-ink text-lg leading-tight hover:text-accent transition">{a.name}</Link>
                {a.is_ai_disclosed && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">IA déclarée</span>}
              </div>
              <div className="text-sm text-slate-500 mt-1">{a.niche}{a.city ? ` · ${a.city}` : ""}</div>
              {a.eleven_voice_name && <div className="text-xs text-slate-400 mt-1 flex items-center gap-1"><Mic className="w-3 h-3" /> {a.eleven_voice_name}</div>}

              <div className="mt-auto pt-4 space-y-2">
                <Link to={`/avatars/${a.id}/studio`} className="btn-primary w-full flex items-center justify-center gap-2">
                  <Clapperboard className="w-4 h-4" /> Ouvrir le studio
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <Link to={`/avatars/${a.id}/calendar`} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center" title="Calendrier éditorial du mois">📅 Calendrier</Link>
                  <Link to={`/avatars/${a.id}/social`} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center" title="Compte social : profil, feed, statistiques">📱 Compte</Link>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  <button onClick={() => setConfirmPlan(a)} disabled={busy === a.id} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center flex items-center justify-center gap-1 disabled:opacity-50" title="Générer le contenu du jour (payant)" aria-label="Générer le contenu du jour"><Wand2 className="w-3.5 h-3.5" /></button>
                  <Link to={`/avatars/${a.id}/bible`} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center" title="Character Bible : références, garde-robe, photos">Bible</Link>
                  <Link to={`/avatars/${a.id}/journal`} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center">Journal</Link>
                  <Link to={`/avatars/${a.id}`} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-center flex items-center justify-center gap-1" title="Éditer"><Pencil className="w-3.5 h-3.5" /></Link>
                  <button onClick={() => setConfirmAvatar(a)} className="text-sm px-2 py-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 text-center flex items-center justify-center" title="Supprimer l'avatar"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {loading && [0, 1, 2].map((i) => <SkeletonCard key={`sk-${i}`} />)}
        {!loading && avatars.length === 0 && drafts.length === 0 && !err && (
          <div className="card p-10 text-center col-span-full">
            <div className="text-4xl mb-3">✨</div>
            <div className="font-semibold text-ink">Aucun avatar pour l'instant</div>
            <p className="text-sm text-slate-500 mt-1 mb-4">Crée ton premier influenceur IA en discutant avec l'assistant.</p>
            <Link to="/avatars/create" className="btn-primary inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Créer un avatar</Link>
          </div>
        )}
      </div>

      <ConfirmModal open={!!confirmPlan} title={`Générer le contenu du jour de ${confirmPlan?.name ?? ""} ?`}
        message="Une vidéo courte, deux accroches et un carrousel sont produits maintenant (≈ 12 $ de génération, décomptés du budget du mois). Tout attend ta validation avant publication."
        confirmLabel="Lancer" onConfirm={() => { const a = confirmPlan; setConfirmPlan(null); if (a) void planDay(a.id); }} onClose={() => setConfirmPlan(null)} />
      <ConfirmModal
        open={!!confirmDraft}
        title="Supprimer le brouillon ?"
        message={`Le brouillon « ${confirmDraft?.title ?? ""} » sera définitivement supprimé.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={doDeleteDraft}
        onClose={() => setConfirmDraft(null)}
      />
      <ConfirmModal
        open={!!confirmAvatar}
        title={`Supprimer ${confirmAvatar?.name ?? "cet avatar"} ?`}
        message="L'avatar, sa mémoire et tous ses contenus générés seront définitivement supprimés. Cette action est irréversible."
        confirmLabel="Supprimer définitivement"
        danger
        onConfirm={doDeleteAvatar}
        onClose={() => setConfirmAvatar(null)}
      />
    </div>
  );
}
