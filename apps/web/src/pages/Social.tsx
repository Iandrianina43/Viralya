import { Bookmark, CalendarClock, ExternalLink, Eye, Heart, Link2, MessageCircle, Pencil, Play, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Avatar, type SocialConnection, type SocialFeed, type SocialPost } from "../api";
import { AvatarPhoto } from "../components/AvatarPhoto";
import { ConfirmModal } from "../components/Modal";
import { Button, useToast } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// COMPTE SOCIAL (BRIEF § 9) — profil, feed, statistiques par réseau ; simulé tant qu'aucune
// connexion réelle n'existe (phase 4 : Ayrshare, un profil par influenceur).
// ─────────────────────────────────────────────────────────────

const NETWORKS = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
] as const;
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 10_000 ? `${Math.round(n / 1000)} k` : n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));
const fmtDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Social() {
  const { id } = useParams();
  const toast = useToast();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [network, setNetwork] = useState<string>("instagram");
  const [feed, setFeed] = useState<SocialFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ handle: "", display_name: "", bio: "", link: "" });
  const [open, setOpen] = useState<SocialPost | null>(null);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [providerOk, setProviderOk] = useState(false);
  const [connForm, setConnForm] = useState({ profile_key: "", networks: ["instagram", "tiktok"] as string[] });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try { const r = await api.socialFeed(id, network); setFeed(r); setErr(null); }
    catch (e) { setErr(String((e as Error).message ?? e)); }
  }, [id, network]);
  useEffect(() => { if (id) api.getAvatar(id).then((r) => setAvatar(r.avatar)).catch(() => {}); }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.listConnections().then((r) => { setConnections(r.connections.filter((c) => !c.avatar_id || c.avatar_id === id)); setProviderOk(r.provider_configured); }).catch(() => {}); }, [id]);
  // Les statistiques simulées progressent dans le temps : rafraîchissement doux.
  useEffect(() => { const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);

  const startEdit = () => { if (!feed) return; setDraft({ handle: feed.profile.handle, display_name: feed.profile.display_name, bio: feed.profile.bio, link: feed.profile.link ?? "" }); setEditing(true); };
  const saveProfile = async () => {
    if (!id) return;
    setBusy("profile");
    try { await api.updateSocialProfile(id, { network, ...draft, link: draft.link || null }); setEditing(false); await load(); toast.push("ok", "Profil mis à jour."); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  // Confirmation avant une action payante, irréversible ou publique.
  const [confirmAct, setConfirmAct] = useState<{ title: string; message: string; danger?: boolean; confirmLabel?: string; run: () => void } | null>(null);
  const publish = async (post: SocialPost) => {
    setBusy(post.id);
    try { await api.publishNow(post.id); await load(); toast.push("ok", "Publié."); } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const addConnection = async () => {
    if (!id) return;
    setBusy("conn");
    try {
      const r = await api.createConnection({ provider: "ayrshare", avatar_id: id, profile_key: connForm.profile_key.trim() || undefined, networks: connForm.networks, display_name: avatar?.name });
      setConnections((c) => [r.connection, ...c]); toast.push("ok", "Connexion enregistrée : les prochaines publications partent en réel.");
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const removeConnection = async (cid: string) => {
    try { await api.deleteConnection(cid); setConnections((c) => c.filter((x) => x.id !== cid)); } catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };

  const p = feed?.profile;
  const real = connections.some((c) => c.provider === "ayrshare" && c.networks.includes(network) && c.status === "active");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-xs text-slate-400"><Link to="/avatars" className="hover:underline">Influenceurs</Link> / {avatar?.name ?? "…"}</div>
          <h1 className="text-2xl font-bold text-ink">Compte social</h1>
          <p className="text-sm text-slate-500 mt-0.5">{real ? "Publication réelle active sur ce réseau." : "Compte simulé : le feed et les statistiques vivent dans Viralya, comme sur le vrai réseau, sans rien publier dehors."}</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {NETWORKS.map((n) => <button key={n.id} onClick={() => setNetwork(n.id)} className={`px-3 py-1.5 rounded-lg text-sm ${network === n.id ? "bg-white shadow-sm text-ink font-semibold" : "text-slate-500"}`}>{n.label}</button>)}
        </div>
      </div>
      {err && <div className="text-sm text-rose-600 mb-3">Erreur : {err}</div>}

      {p && (
        <div className="card p-5 mb-4">
          <div className="flex flex-col sm:flex-row gap-5">
            <AvatarPhoto src={avatar?.ref_image_url} name={p.display_name} className="w-24 h-24" rounded="rounded-full" position="object-top" />
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="grid sm:grid-cols-2 gap-2">
                  <input className="input text-sm" value={draft.handle} onChange={(e) => setDraft({ ...draft, handle: e.target.value })} placeholder="handle" />
                  <input className="input text-sm" value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder="Nom affiché" />
                  <textarea className="input text-sm sm:col-span-2" rows={2} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} placeholder="Bio" />
                  <input className="input text-sm sm:col-span-2" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="Lien (optionnel)" />
                  <div className="flex gap-2 sm:col-span-2"><Button size="sm" loading={busy === "profile"} onClick={() => void saveProfile()}>Enregistrer</Button><button onClick={() => setEditing(false)} className="btn-secondary text-sm">Annuler</button></div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold text-ink">@{p.handle}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{real ? "réel" : "simulé"}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700" title="Label obligatoire (Meta depuis le 31 août 2026, AI Act art. 50)">profil IA déclaré</span>
                    <button onClick={startEdit} className="text-slate-400 hover:text-ink p-1" title="Modifier le profil"><Pencil className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-sm font-semibold text-ink mt-0.5">{p.display_name}</div>
                  <div className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{p.bio}</div>
                  {p.link && <a href={p.link} className="text-sm text-accent flex items-center gap-1 mt-1" target="_blank" rel="noreferrer"><Link2 className="w-3.5 h-3.5" /> {p.link}</a>}
                </>
              )}
              <div className="grid grid-cols-4 gap-3 mt-4 max-w-md">
                {[["Publications", p.posts], ["Abonnés", p.followers], ["Vues", p.total_views], ["Engagement", `${p.engagement_rate} %`]].map(([l, v]) => (
                  <div key={String(l)}><div className="text-lg font-bold text-ink leading-tight">{typeof v === "number" ? fmt(v) : v}</div><div className="text-[11px] text-slate-500">{l}</div></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {feed && feed.upcoming.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> Programmés</div>
          <div className="space-y-2">
            {feed.upcoming.map((u) => (
              <div key={u.id} className="flex items-center gap-3 text-sm">
                <div className="w-10 h-14 rounded-md bg-slate-100 overflow-hidden shrink-0">{u.cover_url && <img src={u.cover_url} className="w-full h-full object-cover" alt="" />}</div>
                <div className="flex-1 min-w-0"><div className="font-medium text-ink truncate">{u.title ?? u.caption.slice(0, 60)}</div><div className="text-xs text-slate-500">{u.scheduled_at ? fmtDate.format(new Date(u.scheduled_at)) : "—"} · {u.type}</div></div>
                <Button size="sm" variant="secondary" loading={busy === u.id} onClick={() => setConfirmAct({ title: "Publier maintenant ?", message: "Le contenu part sur ce compte (réellement si le réseau est connecté). Une publication réelle ne se retire pas depuis Viralya.", confirmLabel: "Publier", run: () => void publish(u) })}>Publier maintenant</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Feed</div>
          <button onClick={() => void load()} className="text-slate-400 hover:text-ink" title="Actualiser"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        {!feed?.posts.length ? (
          <div className="text-sm text-slate-500 py-8 text-center">Rien de publié sur {NETWORKS.find((n) => n.id === network)?.label} pour l'instant. Approuve un contenu dans <Link to="/content" className="text-accent hover:underline">Contenus</Link>, puis « Publier maintenant » ou attends l'heure programmée.</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {feed.posts.map((post) => (
              <button key={post.id} onClick={() => setOpen(post)} className="relative aspect-[3/4] rounded-lg overflow-hidden bg-slate-900 group">
                {post.cover_url ? <img src={post.cover_url} className="w-full h-full object-cover" alt="" /> : post.video_url ? <video src={post.video_url} className="w-full h-full object-cover" muted playsInline preload="metadata" /> : <div className="w-full h-full flex items-center justify-center text-white/40 text-xs p-2 text-center">{post.caption.slice(0, 60)}</div>}
                {post.video_url && <Play className="absolute top-2 right-2 w-4 h-4 text-white drop-shadow" />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-white text-[11px] flex items-center gap-2 opacity-90">
                  <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> {fmt(post.stats.views)}</span>
                  <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" /> {fmt(post.stats.likes)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Publication réelle (phase 4) */}
      <div className="card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Publication réelle</div>
        <p className="text-xs text-slate-500 mb-3">Agrégateur Ayrshare : un profil par influenceur, les réseaux choisis, le label « contenu IA » envoyé automatiquement. {providerOk ? "Publication réelle activée sur ce serveur." : "La publication réelle n'est pas encore activée sur cet espace : les connexions resteront inactives (contacte le support)."}</p>
        {connections.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm rounded-lg border border-slate-100 px-3 py-2">
                <span className="font-medium text-ink">{c.provider}</span>
                <span className="text-slate-500 text-xs">{c.networks.join(", ")}</span>
                {c.profile_key && <span className="text-slate-400 text-xs font-mono truncate">{c.profile_key.slice(0, 8)}…</span>}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{c.status}</span>
                <button onClick={() => setConfirmAct({ title: "Déconnecter ce réseau ?", message: "Les publications réelles de cet influenceur sur ce réseau s'arrêtent immédiatement.", danger: true, run: () => void removeConnection(c.id) })} className="ml-auto text-slate-300 hover:text-rose-600" aria-label="Déconnecter"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input className="input text-sm flex-1 min-w-[200px]" placeholder="Profile-Key Ayrshare de cet influenceur" value={connForm.profile_key} onChange={(e) => setConnForm({ ...connForm, profile_key: e.target.value })} />
          <div className="flex gap-1">
            {NETWORKS.map((n) => (
              <button key={n.id} onClick={() => setConnForm({ ...connForm, networks: connForm.networks.includes(n.id) ? connForm.networks.filter((x) => x !== n.id) : [...connForm.networks, n.id] })} className={`text-xs px-2 py-1 rounded-full border ${connForm.networks.includes(n.id) ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500"}`}>{n.label}</button>
            ))}
          </div>
          <Button size="sm" variant="secondary" loading={busy === "conn"} disabled={!providerOk || !connForm.networks.length} onClick={() => void addConnection()}>Connecter</Button>
        </div>
        <div className="text-[11px] text-slate-400 mt-2">Avant la première publication réelle : activer le label « profil généré par IA » sur Instagram et la mention IA dans la bio TikTok.</div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden grid md:grid-cols-[minmax(0,1fr)_320px]" onClick={(e) => e.stopPropagation()}>
            <div className="bg-black flex items-center justify-center">
              {open.video_url ? <video src={open.video_url} controls autoPlay className="max-h-[85vh] w-auto" /> : open.cover_url ? <img src={open.cover_url} className="max-h-[85vh] w-auto" alt="" /> : null}
            </div>
            <div className="p-4 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between"><div className="font-semibold text-ink">@{p?.handle}</div><button onClick={() => setOpen(null)} className="text-slate-400 hover:text-ink"><X className="w-4 h-4" /></button></div>
              <div className="text-xs text-slate-400">{open.published_at ? fmtDate.format(new Date(open.published_at)) : ""} · {open.real ? "statistiques réelles" : "statistiques simulées"}{open.ai_label ? " · contenu IA" : ""}</div>
              <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap">{open.caption}</p>
              {open.hashtags.length > 0 && <div className="text-xs text-accent mt-1">{open.hashtags.join(" ")}</div>}
              <div className="grid grid-cols-5 gap-2 mt-4 text-center">
                {[[Eye, open.stats.views, "vues"], [Heart, open.stats.likes, "j'aime"], [MessageCircle, open.stats.comments, "comm."], [Share2, open.stats.shares, "partages"], [Bookmark, open.stats.saves, "enreg."]].map(([Icon, v, l]) => {
                  const I = Icon as typeof Eye;
                  return <div key={String(l)}><I className="w-4 h-4 mx-auto text-slate-400" /><div className="text-sm font-semibold text-ink">{fmt(v as number)}</div><div className="text-[10px] text-slate-400">{l as string}</div></div>;
                })}
              </div>
              <div className="text-xs text-slate-500 mt-3">+{open.stats.followers_gained} abonnés attribués à ce contenu</div>
              {open.external_url && <a href={open.external_url} target="_blank" rel="noreferrer" className="text-sm text-accent flex items-center gap-1 mt-3"><ExternalLink className="w-3.5 h-3.5" /> Voir sur le réseau</a>}
            </div>
          </div>
        </div>
      )}
      <ConfirmModal open={!!confirmAct} title={confirmAct?.title ?? ""} message={confirmAct?.message ?? ""} danger={confirmAct?.danger} confirmLabel={confirmAct?.confirmLabel ?? "Confirmer"}
        onConfirm={() => { const c = confirmAct; setConfirmAct(null); c?.run(); }} onClose={() => setConfirmAct(null)} />
    </div>
  );
}
