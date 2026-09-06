import { MediaButton } from "../components/MediaViewer";
import { Camera, Check, Clapperboard, ExternalLink, Images, Shirt, Sparkles, Star, Trash2, UserSquare2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type Avatar,
  type AvatarKeyframe,
  type AvatarLocation,
  type AvatarReference,
  type ContentItem,
  type ImageAspect,
  type ImageModelInfo,
  type KeyframeFraming,
  type KeyframeFramingInfo,
  type WardrobeItem,
} from "../api";
import { Button, EmptyState, ErrorState, PageHeader, Pill, Skeleton, useToast, type Tone } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// CHARACTER BIBLE — les références d'identité validées, la garde-robe,
// les keyframes (l'influenceur dans ses décors), la commande d'une photo
// et le feed des photos produites. Chaque image générée porte son score
// de similarité de visage (seuils 0,55 / 0,40).
// ─────────────────────────────────────────────────────────────

function scoreTone(s: number | null): { tone: Tone; label: string } {
  if (s == null) return { tone: "neutral", label: "non scoré" };
  if (s >= 0.55) return { tone: "ok", label: `visage ${s.toFixed(2)}` };
  if (s >= 0.4) return { tone: "cost", label: `à revoir ${s.toFixed(2)}` };
  return { tone: "warn", label: `douteux ${s.toFixed(2)}` };
}

const ASPECTS: Array<{ v: ImageAspect; l: string }> = [
  { v: "3:4", l: "3:4 portrait (feed)" },
  { v: "9:16", l: "9:16 story / reel" },
  { v: "1:1", l: "1:1 carré" },
  { v: "4:3", l: "4:3 paysage" },
];

const STATUS_FR: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "en file", tone: "neutral" },
  generating: { label: "en cours", tone: "accent" },
  needs_review: { label: "à valider", tone: "cost" },
  scheduled: { label: "programmée", tone: "ok" },
  published: { label: "publiée", tone: "ok" },
  failed: { label: "échec", tone: "warn" },
  canceled: { label: "annulée", tone: "neutral" },
};

const IN_PROGRESS = new Set(["queued", "generating"]);

interface PhotoAssets {
  image_url?: string;
  image_urls?: string[];
  estimated_cost_usd?: number;
  image_model?: string;
  keyframe_id?: string | null;
  qc?: { face_score: number | null; verdict: string };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Bible() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [refs, setRefs] = useState<AvatarReference[] | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[] | null>(null);
  const [locations, setLocations] = useState<AvatarLocation[]>([]);
  const [keyframes, setKeyframes] = useState<AvatarKeyframe[] | null>(null);
  const [framings, setFramings] = useState<KeyframeFramingInfo[]>([]);
  const [photos, setPhotos] = useState<ContentItem[] | null>(null);
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Formulaire keyframe
  const [kfLocation, setKfLocation] = useState("");
  const [kfOutfit, setKfOutfit] = useState("");
  const [kfFraming, setKfFraming] = useState<KeyframeFraming>("medium");

  // Formulaire photo
  const [scene, setScene] = useState("");
  const [locationKey, setLocationKey] = useState("");
  const [outfitId, setOutfitId] = useState("");
  const [model, setModel] = useState("");
  const [aspect, setAspect] = useState<ImageAspect>("3:4");

  const loadPhotos = useCallback(async () => {
    try {
      const r = await api.listContent({ avatar_id: id, type: "photo", limit: 60 });
      setPhotos(r.content);
    } catch {
      /* le feed n'est pas bloquant */
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const [a, r, w, l, k, m] = await Promise.all([
        api.getAvatar(id),
        api.listReferences(id),
        api.listWardrobe(id),
        api.listLocations(id, "all").catch(() => ({ locations: [] as AvatarLocation[] })),
        api.listKeyframes(id).catch(() => ({ keyframes: [] as AvatarKeyframe[], framings: [] as KeyframeFramingInfo[] })),
        api.listImageModels().catch(() => ({ models: [] as ImageModelInfo[], default: "" })),
      ]);
      setAvatar(a.avatar); setRefs(r.references); setWardrobe(w.wardrobe); setLocations(l.locations);
      setKeyframes(k.keyframes); setFramings(k.framings); setModels(m.models); setDefaultModel(m.default);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
    void loadPhotos();
  }, [id, loadPhotos]);
  useEffect(() => { void load(); }, [load]);

  // Le feed se rafraîchit tant qu'une photo est en production.
  const photosInProgress = (photos ?? []).some((p) => IN_PROGRESS.has(p.status));
  useEffect(() => {
    if (!photosInProgress) return;
    const t = setInterval(() => void loadPhotos(), 8000);
    return () => clearInterval(t);
  }, [photosInProgress, loadPhotos]);

  useEffect(() => {
    if (!kfLocation && locations.length) setKfLocation(locations.find((l) => l.ref_image_url)?.id ?? locations[0]!.id);
  }, [locations, kfLocation]);

  const selectedModel = useMemo(() => models.find((m) => m.id === (model || defaultModel)), [models, model, defaultModel]);
  const extraRef = (m: ImageModelInfo | undefined, refs: number) => (m?.id === "seedream-5-pro" ? Math.max(0, refs - 1) * 0.003 : 0);
  const photoCost = selectedModel ? selectedModel.price_per_image["1K"] + extraRef(selectedModel, 8) : null;
  const defaultModelInfo = models.find((m) => m.id === defaultModel);
  const keyframeCost = defaultModelInfo ? defaultModelInfo.price_per_image["1K"] + extraRef(defaultModelInfo, 7) : null;

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    try { await fn(); toast.push("ok", done); await load(); }
    catch (e) { toast.push("warn", String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };

  const validatedCount = (refs ?? []).filter((r) => r.validated).length;
  const defaultOutfit = (wardrobe ?? []).find((o) => o.is_default) ?? null;
  const framingLabel = (f: string | null) => framings.find((x) => x.id === f)?.label ?? f ?? "";

  // Décors couverts par un keyframe validé pour la tenue choisie dans le formulaire photo.
  const photoOutfitId = outfitId || defaultOutfit?.id || null;
  const coveredLocationIds = useMemo(
    () => new Set((keyframes ?? []).filter((k) => k.validated && (k.outfit_id ?? null) === photoOutfitId).map((k) => k.location_id)),
    [keyframes, photoOutfitId],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Character Bible"
        title={avatar ? avatar.name : "Influenceur"}
        description="L'identité visuelle n'est pas un prompt : ce sont des références validées, une garde-robe fixe et une fiche figée. Tout ce qui est généré est scoré contre le portrait, puis c'est toi qui valides."
        actions={avatar && (
          <>
            <Link to={`/avatars/${id}`} className="btn-secondary">Fiche</Link>
            <Link to={`/avatars/${id}/studio`} className="btn-secondary">Studio</Link>
          </>
        )}
      />

      {err && <div className="mb-4"><ErrorState message={err} retry={() => void load()} /></div>}

      {/* ── Références d'identité ── */}
      <section className="mb-10">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="font-sans text-lg font-bold text-ink flex items-center gap-2"><UserSquare2 className="w-4.5 h-4.5 text-accent" /> Références d'identité</h2>
            <p className="text-sm text-muted mt-0.5">Portrait, planche, puis vues générées. Les vues validées servent de références à chaque photo et vidéo.</p>
          </div>
          <Button
            icon={<Sparkles className="w-4 h-4" />}
            loading={busy === "refs"}
            disabled={!avatar?.ref_image_url}
            onClick={() => void run("refs", async () => { await api.generateReferences(id); }, "Six vues générées et scorées.")}
          >
            Générer les 6 vues <span className="font-mono text-[11px] opacity-80">≈ 0,45 $</span>
          </Button>
        </div>

        {refs === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {avatar?.ref_image_url && (
              <figure className="card overflow-hidden">
                <img src={avatar.ref_image_url} alt="Portrait" className="w-full aspect-[3/4] object-cover" />
                <figcaption className="px-2.5 py-2 text-[12.5px]"><b className="font-sans">Portrait</b><div className="mt-1"><Pill tone="accent">référence</Pill></div></figcaption>
              </figure>
            )}
            {avatar?.character_sheet_url && (
              <figure className="card overflow-hidden">
                <img src={avatar.character_sheet_url} alt="Planche" className="w-full aspect-[3/4] object-cover" />
                <figcaption className="px-2.5 py-2 text-[12.5px]"><b className="font-sans">Planche 8 vues</b><div className="mt-1"><Pill tone="accent">référence</Pill></div></figcaption>
              </figure>
            )}
            {refs.map((r) => {
              const st = scoreTone(r.face_score);
              return (
                <figure key={r.id} className={`card overflow-hidden ${r.validated ? "ring-2 ring-ok" : ""}`}>
                  <img src={r.url} alt={r.label ?? r.kind} className="w-full aspect-[3/4] object-cover" loading="lazy" />
                  <figcaption className="px-2.5 py-2 text-[12.5px]">
                    <div className="flex items-center justify-between gap-1"><b className="font-sans truncate">{r.label ?? r.kind}</b>{r.validated && <Check className="w-3.5 h-3.5 text-ok" />}</div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <div className="flex items-center gap-0.5">
                        <button title={r.validated ? "Retirer la validation" : "Valider comme référence"} className={`p-1 rounded hover:bg-paper-2 ${r.validated ? "text-ok" : "text-muted"}`} onClick={() => void run(`v-${r.id}`, async () => { await api.updateReference(id, r.id, { validated: !r.validated }); }, r.validated ? "Validation retirée." : "Référence validée.")}><Check className="w-4 h-4" /></button>
                        <button title="Supprimer" className="p-1 rounded text-muted hover:bg-warn-soft hover:text-warn" onClick={() => void run(`d-${r.id}`, async () => { await api.deleteReference(id, r.id); }, "Référence supprimée.")}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </figcaption>
                </figure>
              );
            })}
            {refs.length === 0 && !avatar?.ref_image_url && (
              <div className="col-span-full"><EmptyState title="Pas encore de portrait" hint="Crée d'abord le portrait de l'influenceur depuis sa fiche." action={<Link to={`/avatars/${id}`} className="btn-primary">Ouvrir la fiche</Link>} /></div>
            )}
          </div>
        )}
        {refs && refs.length > 0 && (
          <p className="text-[13px] text-muted mt-2">{validatedCount} vue{validatedCount > 1 ? "s" : ""} validée{validatedCount > 1 ? "s" : ""}. Valide celles où le visage est fidèle : elles rejoignent les références envoyées aux modèles.</p>
        )}
      </section>

      {/* ── Garde-robe ── */}
      <section className="mb-10">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="font-sans text-lg font-bold text-ink flex items-center gap-2"><Shirt className="w-4.5 h-4.5 text-accent" /> Garde-robe</h2>
            <p className="text-sm text-muted mt-0.5">Des tenues décrites une fois pour toutes. Sans tenue explicite, les modèles recopient les vêtements du portrait.</p>
          </div>
          <Button
            variant="secondary"
            icon={<Sparkles className="w-4 h-4" />}
            loading={busy === "wardrobe"}
            disabled={!avatar?.ref_image_url}
            onClick={() => void run("wardrobe", async () => { await api.generateWardrobe(id, { count: 4 }); }, "Quatre tenues proposées et illustrées.")}
          >
            Proposer 4 tenues <span className="font-mono text-[11px] opacity-80">≈ 0,30 $</span>
          </Button>
        </div>
        {wardrobe === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : wardrobe.length === 0 ? (
          <EmptyState icon={<Shirt className="w-5 h-5" />} title="Garde-robe vide" hint="Propose des tenues : l'IA en écrit la description figée et les fait porter au personnage." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {wardrobe.map((o) => (
              <figure key={o.id} className={`card overflow-hidden flex flex-col ${o.is_default ? "ring-2 ring-accent" : ""}`}>
                {o.ref_url ? <img src={o.ref_url} alt={o.name} className="w-full aspect-[3/4] object-cover" loading="lazy" /> : <div className="w-full aspect-[3/4] bg-paper-2 flex items-center justify-center text-muted"><Shirt className="w-6 h-6" /></div>}
                <figcaption className="px-2.5 py-2 text-[12.5px] flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-1"><b className="font-sans truncate">{o.name}</b>{o.is_default && <Pill tone="accent">défaut</Pill>}</div>
                  <p className="text-muted mt-1 line-clamp-3">{o.description_en}</p>
                  <div className="mt-auto pt-2 flex items-center gap-0.5 justify-end">
                    {!o.is_default && <button title="Tenue par défaut" className="p-1 rounded text-muted hover:bg-paper-2" onClick={() => void run(`o-${o.id}`, async () => { await api.updateOutfit(id, o.id, { is_default: true }); }, "Tenue par défaut mise à jour.")}><Star className="w-4 h-4" /></button>}
                    <button title="Supprimer" className="p-1 rounded text-muted hover:bg-warn-soft hover:text-warn" onClick={() => void run(`od-${o.id}`, async () => { await api.deleteOutfit(id, o.id); }, "Tenue supprimée.")}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {/* ── Keyframes : l'influenceur dans ses décors ── */}
      <section className="mb-10">
        <div className="mb-3">
          <h2 className="font-sans text-lg font-bold text-ink flex items-center gap-2"><Clapperboard className="w-4.5 h-4.5 text-accent" /> Keyframes</h2>
          <p className="text-sm text-muted mt-0.5">
            L'influenceur dans un décor de son univers, avec une tenue, dans un cadrage fixe. Générés une fois puis réutilisés : ils ancrent les photos prises dans ce décor et serviront de première image aux vidéos.
            Un trio décor + tenue + cadrage déjà validé n'est jamais regénéré (0 $).
          </p>
        </div>

        {locations.length === 0 ? (
          <EmptyState icon={<Clapperboard className="w-5 h-5" />} title="Aucun décor" hint="Crée d'abord l'univers de lieux de l'influenceur depuis le Studio : chaque keyframe se rattache à un décor." action={<Link to={`/avatars/${id}/studio`} className="btn-secondary">Ouvrir le studio</Link>} />
        ) : (
          <form
            className="card p-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end mb-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!kfLocation) { toast.push("warn", "Choisis un décor."); return; }
              void run("keyframe", async () => {
                const r = await api.generateKeyframe(id, { location_id: kfLocation, outfit_id: kfOutfit || null, framing: kfFraming });
                if (r.cached) toast.push("ok", "Keyframe déjà en cache pour ce trio : rien n'a été regénéré.");
              }, "Keyframe prêt.");
            }}
          >
            <label>
              <span className="label">Décor</span>
              <select className="input" value={kfLocation} onChange={(e) => setKfLocation(e.target.value)}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.scope === "oneoff" ? " (voyage)" : ""}{l.ref_image_url ? "" : " (sans image)"}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Tenue</span>
              <select className="input" value={kfOutfit} onChange={(e) => setKfOutfit(e.target.value)}>
                <option value="">Tenue par défaut{defaultOutfit ? ` (${defaultOutfit.name})` : " (aucune)"}</option>
                {(wardrobe ?? []).filter((o) => !o.is_default).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Cadrage</span>
              <select className="input" value={kfFraming} onChange={(e) => setKfFraming(e.target.value as KeyframeFraming)}>
                {(framings.length ? framings : [{ id: "medium" as KeyframeFraming, label: "Plan taille", aspect: "3:4" as ImageAspect }]).map((f) => <option key={f.id} value={f.id}>{f.label} · {f.aspect}</option>)}
              </select>
            </label>
            <Button type="submit" icon={<Sparkles className="w-4 h-4" />} loading={busy === "keyframe"} disabled={!avatar?.ref_image_url}>
              Générer {keyframeCost != null && <span className="font-mono text-[11px] opacity-80">≈ {keyframeCost.toFixed(3)} $</span>}
            </Button>
          </form>
        )}

        {keyframes === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : keyframes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {keyframes.map((k) => {
              const st = scoreTone(k.face_score);
              return (
                <figure key={k.id} className={`card overflow-hidden ${k.validated ? "ring-2 ring-ok" : ""}`}>
                  <MediaButton url={k.url} kind="image" title={k.location_name ?? "Keyframe"} subtitle={k.outfit_name} className="block w-full"><img src={k.url} alt={k.location_name ?? "keyframe"} className="w-full aspect-[3/4] object-cover" loading="lazy" /></MediaButton>
                  <figcaption className="px-2.5 py-2 text-[12.5px]">
                    <div className="flex items-center justify-between gap-1"><b className="font-sans truncate">{k.location_name ?? "Décor"}</b>{k.validated && <Check className="w-3.5 h-3.5 text-ok" />}</div>
                    <div className="text-muted truncate">{framingLabel(k.framing)}{k.outfit_name ? ` · ${k.outfit_name}` : " · sans tenue"}</div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <div className="flex items-center gap-0.5">
                        <button title={k.validated ? "Retirer la validation (ne sera plus réutilisé)" : "Valider (sera réutilisé comme référence)"} className={`p-1 rounded hover:bg-paper-2 ${k.validated ? "text-ok" : "text-muted"}`} onClick={() => void run(`kv-${k.id}`, async () => { await api.updateKeyframe(id, k.id, { validated: !k.validated }); }, k.validated ? "Validation retirée." : "Keyframe validé.")}><Check className="w-4 h-4" /></button>
                        <button title="Supprimer" className="p-1 rounded text-muted hover:bg-warn-soft hover:text-warn" onClick={() => void run(`kd-${k.id}`, async () => { await api.deleteKeyframe(id, k.id); }, "Keyframe supprimé.")}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
        {keyframes && keyframes.length > 0 && (
          <p className="text-[13px] text-muted mt-2">Validé automatiquement quand le visage est reconnu (score ≥ 0,55). Un keyframe validé est ajouté aux références de chaque photo prise dans le même décor avec la même tenue.</p>
        )}
      </section>

      {/* ── Nouvelle photo ── */}
      <section className="card p-5 mb-10">
        <h2 className="font-sans text-lg font-bold text-ink flex items-center gap-2 mb-1"><Camera className="w-4.5 h-4.5 text-accent" /> Nouvelle photo</h2>
        <p className="text-sm text-muted mb-4">Décris la scène. Les références validées, la tenue, le décor et son keyframe sont ajoutés automatiquement, puis le visage est contrôlé.</p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (scene.trim().length < 5) { toast.push("warn", "Décris la scène en quelques mots."); return; }
            void run("photo", async () => {
              await api.createPhoto({ avatar_id: id, scene: scene.trim(), location_key: locationKey || null, outfit_id: outfitId || null, model: model || undefined, aspect });
              setScene("");
            }, "Photo lancée. Elle apparaît ci-dessous et dans Tâches.");
          }}
        >
          <label className="sm:col-span-2">
            <span className="label">Scène</span>
            <textarea className="input h-24 py-2 resize-y" value={scene} onChange={(e) => setScene(e.target.value)} placeholder="Ex. selfie dans sa cuisine le matin, tasse de café à la main, lumière douce de la fenêtre" />
          </label>
          <label>
            <span className="label">Décor (univers)</span>
            <select className="input" value={locationKey} onChange={(e) => setLocationKey(e.target.value)}>
              <option value="">Libre (décrit dans la scène)</option>
              {locations.map((l) => <option key={l.id} value={l.key}>{l.name}{l.scope === "oneoff" ? " (voyage)" : ""}{l.ref_image_url ? "" : " (sans image)"}{coveredLocationIds.has(l.id) ? " · keyframe ✓" : ""}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Tenue</span>
            <select className="input" value={outfitId} onChange={(e) => setOutfitId(e.target.value)}>
              <option value="">Tenue par défaut{defaultOutfit ? ` (${defaultOutfit.name})` : " (aucune : décris-la dans la scène)"}</option>
              {(wardrobe ?? []).filter((o) => !o.is_default).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Modèle</span>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Par défaut ({models.find((m) => m.id === defaultModel)?.label ?? defaultModel})</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.price_per_image["1K"].toFixed(3)} $ · {m.hint}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Format</span>
            <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value as ImageAspect)}>
              {ASPECTS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
            <span className="font-mono text-[12.5px] text-cost">{photoCost != null ? `≈ ${photoCost.toFixed(3)} $ par photo, contrôle du visage inclus` : ""}</span>
            <Button type="submit" icon={<Camera className="w-4 h-4" />} loading={busy === "photo"} disabled={!avatar?.ref_image_url}>Générer la photo</Button>
          </div>
        </form>
      </section>

      {/* ── Feed photo ── */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="font-sans text-lg font-bold text-ink flex items-center gap-2"><Images className="w-4.5 h-4.5 text-accent" /> Photos</h2>
            <p className="text-sm text-muted mt-0.5">Toutes les photos produites pour {avatar?.name ?? "l'influenceur"}, de la plus récente à la plus ancienne. La validation se fait dans Contenus.</p>
          </div>
          <Link to="/content" className="btn-secondary"><ExternalLink className="w-4 h-4" /> Contenus</Link>
        </div>

        {photos === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : photos.length === 0 ? (
          <EmptyState icon={<Images className="w-5 h-5" />} title="Aucune photo pour l'instant" hint="Commande une première photo ci-dessus : elle apparaîtra ici avec son score de visage." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((p) => {
              const a = p.assets as PhotoAssets;
              const url = a.image_url ?? (a.image_urls?.length ? a.image_urls[a.image_urls.length - 1] : undefined);
              const st = STATUS_FR[p.status] ?? { label: p.status, tone: "neutral" as Tone };
              const qcTone: Tone = a.qc?.verdict === "pass" ? "ok" : a.qc?.verdict === "review" ? "cost" : a.qc?.verdict === "fail" ? "warn" : "neutral";
              const caption = String((p.payload as { caption?: string }).caption ?? "");
              return (
                <figure key={p.id} className="card overflow-hidden flex flex-col">
                  {url ? (
                    <MediaButton url={url} kind="image" title={p.title ?? "Photo"} className="block w-full"><img src={url} alt={p.title ?? "photo"} className="w-full aspect-[3/4] object-cover" loading="lazy" /></MediaButton>
                  ) : (
                    <div className="w-full aspect-[3/4] bg-paper-2 flex flex-col items-center justify-center gap-2 text-muted">
                      {IN_PROGRESS.has(p.status) ? <><span className="w-5 h-5 rounded-full border-2 border-rule border-t-accent animate-spin" /><span className="text-[12px]">génération…</span></> : <Camera className="w-6 h-6" />}
                    </div>
                  )}
                  <figcaption className="px-2.5 py-2 text-[12.5px] flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {a.qc && <Pill tone={qcTone}>{a.qc.face_score != null ? `visage ${a.qc.face_score.toFixed(2)}` : "visage ?"}</Pill>}
                    </div>
                    <b className="font-sans truncate" title={p.title ?? ""}>{p.title ?? "Photo"}</b>
                    {caption && <p className="text-muted line-clamp-2">{caption}</p>}
                    {p.error && <p className="text-warn line-clamp-2">{p.error}</p>}
                    <div className="mt-auto pt-1 flex items-center justify-between gap-2 text-[11.5px] text-muted font-mono">
                      <span>{fmtDate(p.created_at)}</span>
                      <span>{a.estimated_cost_usd != null ? `${a.estimated_cost_usd.toFixed(3)} $` : ""}{a.keyframe_id ? " · keyframe" : ""}</span>
                    </div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
