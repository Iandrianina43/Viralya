import { ChevronDown, ChevronRight, Globe2, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AvatarLocation } from "../api";
import { ConfirmModal, Modal } from "./Modal";

// ─────────────────────────────────────────────────────────────
// Univers : les lieux de vie récurrents de l'avatar (sa chambre, son café…).
// Ces décors sont réutilisés dans toutes ses vidéos → cohérence de sa vie.
// ─────────────────────────────────────────────────────────────

export function Universe({ avatarId }: { avatarId: string }) {
  const [locations, setLocations] = useState<AvatarLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<AvatarLocation | null>(null);
  const [open, setOpen] = useState(false); // replié par défaut (gain de place)
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDesc, setAddDesc] = useState("");

  const load = () => api.listLocations(avatarId)
    .then((r) => {
      setLocations(r.locations);
      setLoading(false);
      if (r.locations.length === 0) setOpen(true); // univers vide → on montre l'invitation à le créer
    })
    .catch((e) => { setErr(String(e)); setLoading(false); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [avatarId]);

  // Tant que des images de référence manquent (génération en cours), on rafraîchit.
  const pendingImages = locations.some((l) => !l.ref_image_url);
  useEffect(() => {
    if (!pendingImages) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImages, avatarId]);


  const generate = async () => {
    setGenerating(true); setErr(null);
    try { const r = await api.generateUniverse(avatarId); setLocations(r.locations); }
    catch (e) { setErr(String(e)); } finally { setGenerating(false); }
  };

  const regen = async (loc: AvatarLocation) => {
    setBusy(loc.id); setErr(null);
    try { const r = await api.regenerateLocation(avatarId, loc.id); setLocations((ls) => ls.map((l) => (l.id === loc.id ? r.location : l))); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    const locId = confirmDel.id; setConfirmDel(null);
    try { await api.deleteLocation(avatarId, locId); setLocations((ls) => ls.filter((l) => l.id !== locId)); }
    catch (e) { setErr(String(e)); }
  };

  const add = async () => {
    if (addName.trim().length < 2 || addDesc.trim().length < 10) return;
    setBusy("add"); setErr(null);
    try {
      const r = await api.createLocation(avatarId, { name: addName.trim(), description: addDesc.trim() });
      setLocations((ls) => [...ls, r.location]);
      setAddOpen(false); setAddName(""); setAddDesc("");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  return (
    <div className="card p-5">
      {/* En-tête repliable : aperçu compact quand c'est fermé */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
          <Globe2 className="w-5 h-5 text-accent shrink-0" />
          <h2 className="font-bold text-ink shrink-0">Univers</h2>
          {!loading && locations.length > 0 && (
            <>
              <span className="text-sm text-slate-400 shrink-0">· {locations.length} lieux</span>
              {!open && (
                <div className="flex -space-x-2 ml-2 overflow-hidden">
                  {locations.slice(0, 6).map((l) => (
                    l.ref_image_url
                      ? <img key={l.id} src={l.ref_image_url} alt="" loading="lazy" className="w-8 h-8 rounded-lg object-cover border-2 border-white shrink-0" />
                      : <div key={l.id} className="w-8 h-8 rounded-lg bg-slate-100 border-2 border-white shrink-0" />
                  ))}
                </div>
              )}
            </>
          )}
        </button>
        {open && locations.length > 0 && (
          <button onClick={() => setAddOpen(true)} className="text-sm px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 shrink-0"><Plus className="w-3.5 h-3.5" /> Ajouter un lieu</button>
        )}
      </div>

      {!open && <p className="text-xs text-slate-400 mt-1.5 ml-6">Ses lieux de vie — les mêmes décors dans toutes ses vidéos.</p>}

      {open && <>
      <p className="text-sm text-slate-500 mb-4 mt-1">Ses lieux de vie — les mêmes décors dans toutes ses vidéos.</p>
      {err && <div className="text-red-600 mb-3 text-sm">Erreur : {err}</div>}

      {loading ? (
        <div className="text-sm text-slate-400 py-6 text-center">Chargement…</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🏠</div>
          <div className="font-semibold text-ink text-sm">Aucun lieu pour l'instant</div>
          <p className="text-xs text-slate-500 mt-1 mb-4 max-w-sm mx-auto">L'IA peut créer son univers : sa chambre, sa cuisine, son café, sa rue… avec une image de référence par lieu.</p>
          <button onClick={generate} disabled={generating} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "Création de l'univers… (~1-2 min)" : "Générer son univers"}
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {locations.map((loc) => (
            <div key={loc.id} className="rounded-xl border border-slate-200 overflow-hidden group">
              <div className="relative aspect-[3/4] bg-slate-100">
                {loc.ref_image_url ? (
                  <img src={loc.ref_image_url} alt={loc.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1.5 animate-pulse">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-[10px] text-slate-400">image en cours…</span>
                  </div>
                )}
                {busy === loc.id && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>
                )}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => regen(loc)} disabled={!!busy} title="Régénérer l'image" className="w-7 h-7 rounded-lg bg-white/90 text-slate-600 hover:text-accent flex items-center justify-center"><RefreshCw className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setConfirmDel(loc)} title="Supprimer le lieu" className="w-7 h-7 rounded-lg bg-white/90 text-slate-600 hover:text-rose-600 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="p-2.5">
                <div className="text-sm font-semibold text-ink truncate">{loc.name}</div>
                <div className="text-xs text-slate-400 line-clamp-2 mt-0.5">{loc.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      </>}

      {/* Ajout manuel */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Ajouter un lieu">
        <div className="space-y-3">
          <label className="block"><span className="text-sm text-slate-600">Nom du lieu</span>
            <input className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent mt-1" placeholder="ex : Sa salle de sport" value={addName} onChange={(e) => setAddName(e.target.value)} />
          </label>
          <label className="block"><span className="text-sm text-slate-600">Description précise (décor figé — murs, meubles, lumière…)</span>
            <textarea className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent mt-1 h-24 resize-none" placeholder="ex : salle de sport moderne, murs béton clair, machines noires, grande baie vitrée, lumière naturelle…" value={addDesc} onChange={(e) => setAddDesc(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">Annuler</button>
            <button onClick={add} disabled={busy === "add" || addName.trim().length < 2 || addDesc.trim().length < 10} className="btn-primary disabled:opacity-50 flex items-center gap-2">
              {busy === "add" && <Loader2 className="w-4 h-4 animate-spin" />} Créer le lieu
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDel}
        title={`Supprimer « ${confirmDel?.name ?? ""} » ?`}
        message="Ce lieu ne sera plus utilisé dans les prochaines vidéos."
        confirmLabel="Supprimer"
        danger
        onConfirm={doDelete}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  );
}
