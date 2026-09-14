import { Check, Copy, ExternalLink, ImageIcon, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Avatar, type LaunchBanner, type LaunchKit, type LaunchNetwork } from "../api";
import { AvatarTabs } from "../components/AvatarTabs";
import { ConfirmModal } from "../components/Modal";
import { Button, PageHeader, SkeletonLines, useToast } from "../components/ui";

// ─────────────────────────────────────────────────────────────
// KIT DE LANCEMENT — tout ce qu'il faut pour créer les comptes d'un influenceur à la main, en
// copier-coller : identité de compte (réseaux, noms, e-mail, bios), bannières avec accroche dans la
// zone sûre, checklist des étapes manuelles. Rien n'est automatisé côté réseaux (pas de vérification
// de disponibilité, pas de validation par téléphone) : c'est volontaire, voir domain/launch.ts.
// ─────────────────────────────────────────────────────────────

const NETS: LaunchNetwork[] = ["instagram", "tiktok", "youtube", "x", "facebook"];
const BANNER_NETS = ["youtube", "facebook", "x"] as const;
const PRIORITY: Record<string, { label: string; cls: string }> = {
  principal: { label: "Principal", cls: "bg-accent text-white" },
  secondaire: { label: "Secondaire", cls: "bg-accent-light text-accent" },
  plus_tard: { label: "Plus tard", cls: "bg-slate-100 text-slate-500" },
};
const usd = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => toast.push("ok", "Copié.")); }}
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-ink px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50"
      title={label}
    ><Copy className="w-3 h-3" /> {label}</button>
  );
}

export function Launch() {
  const { id } = useParams();
  const toast = useToast();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [kit, setKit] = useState<LaunchKit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bios, setBios] = useState<Partial<Record<LaunchNetwork, string>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bannerNet, setBannerNet] = useState<(typeof BANNER_NETS)[number]>("youtube");
  const [withAvatar, setWithAvatar] = useState(true);
  const [hook, setHook] = useState("");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, k] = await Promise.all([api.getAvatar(id), api.launchKit(id)]);
      setAvatar(a.avatar);
      setKit(k.kit);
      setBios(k.kit.identity.bios ?? {});
      setNotes(k.kit.notes ?? {});
      if (!hook && k.kit.identity.hooks?.[0]) setHook(k.kit.identity.hooks[0]);
      setErr(null);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  }, [id, hook]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    api.launchBannerEstimate(id, withAvatar).then((r) => setEstimate(r.cost_usd)).catch(() => setEstimate(null));
  }, [id, withAvatar]);

  const identity = kit?.identity ?? {};
  const rules = kit?.rules;
  const domain = notes.email_domain || "votre-domaine.com";
  const chosen = identity.chosen_handle ?? identity.handles?.[0]?.handle ?? "";
  const bannerSpec = rules?.[bannerNet]?.banner ?? null;

  const generateIdentity = async () => {
    if (!id) return;
    setBusy("identity");
    try { await api.launchIdentity(id); await load(); toast.push("ok", "Identité de compte générée."); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const save = async (patch: Parameters<typeof api.launchPatch>[1], msg?: string) => {
    if (!id) return;
    try { const r = await api.launchPatch(id, patch); setKit(r.kit); if (msg) toast.push("ok", msg); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };
  const toggleStep = (network: string, step: string, value: boolean) => {
    setKit((k) => k && ({ ...k, checklist: { ...k.checklist, [network]: { ...(k.checklist[network] ?? {}), [step]: value } } }));
    void save({ checklist: { [network]: { [step]: value } } });
  };
  const generateBanner = async () => {
    if (!id) return;
    setBusy("banner");
    try {
      const r = await api.launchBanner(id, { network: bannerNet, with_avatar: withAvatar, hook: hook.trim() || null });
      setKit((k) => k && ({ ...k, banners: [r.banner, ...k.banners] }));
      toast.push("ok", `Bannière ${rules?.[bannerNet].label} générée (${usd(r.banner.cost_usd)}).`);
    } catch (e) { toast.push("warn", String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const removeBanner = async (b: LaunchBanner) => {
    if (!id) return;
    try { await api.launchDeleteBanner(id, b.id); setKit((k) => k && ({ ...k, banners: k.banners.filter((x) => x.id !== b.id) })); }
    catch (e) { toast.push("warn", String((e as Error).message ?? e)); }
  };

  const orderedNets = useMemo(() => {
    const rank = { principal: 0, secondaire: 1, plus_tard: 2 } as const;
    return [...(identity.networks ?? NETS.map((n) => ({ network: n, priority: "plus_tard" as const, why: "" })))].sort((a, b) => rank[a.priority] - rank[b.priority]);
  }, [identity.networks]);

  if (err) return <div className="text-sm text-rose-600">Erreur : {err}</div>;
  if (!kit || !rules) return <SkeletonLines n={8} />;

  return (
    <div className="space-y-6">
      <AvatarTabs id={id!} name={avatar?.name} />
      <PageHeader
        eyebrow="Avant le premier post"
        title="Kit de lancement"
        description="Tout ce qu'il faut pour créer ses comptes à la main : à copier-coller. La création, la validation par téléphone et la mise en place restent manuelles."
      />

      {/* 1. Identité */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold text-ink">1 · Identité de compte</h2>
            <p className="text-sm text-slate-500">Réseaux à ouvrir pour sa niche, nom de compte valable partout, e-mail, bios à la bonne longueur.</p>
          </div>
          <Button loading={busy === "identity"} onClick={() => setConfirm({ title: identity.generated_at ? "Regénérer l'identité ?" : "Générer l'identité ?", message: "≈ 0,05 $ de texte. Les bios que tu as modifiées à la main sont conservées.", run: () => void generateIdentity() })}>
            <Sparkles className="w-4 h-4" /> {identity.generated_at ? "Regénérer" : "Générer"} · ≈ 0,05 $
          </Button>
        </div>

        {!identity.generated_at ? (
          <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-5 text-center">Rien encore : lance la génération à partir de la fiche de {avatar?.name ?? "l'influenceur"}.</div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Réseaux</div>
              <div className="space-y-2">
                {orderedNets.map((n) => (
                  <div key={n.network} className="flex gap-3 items-start text-sm">
                    <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold ${PRIORITY[n.priority]?.cls ?? ""}`}>{PRIORITY[n.priority]?.label}</span>
                    <div><span className="font-medium text-ink">{rules[n.network].label}</span>{n.why && <span className="text-slate-500"> — {n.why}</span>}</div>
                  </div>
                ))}
              </div>

              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-2">Nom de compte (le même partout)</div>
              <p className="text-xs text-slate-500 mb-2">Lettres et chiffres seulement, 5 à 15 caractères : c'est le seul format accepté par les cinq réseaux à la fois. Vérifie la disponibilité en ouvrant chaque page (nous ne le faisons pas automatiquement : ce serait contraire aux conditions des réseaux).</p>
              <div className="space-y-2">
                {(identity.handles ?? []).map((h) => (
                  <div key={h.handle} className={`rounded-xl border p-3 ${chosen === h.handle ? "border-accent bg-accent-light/40" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void save({ chosen_handle: h.handle }, `@${h.handle} retenu.`)} className="font-mono font-semibold text-ink flex items-center gap-1.5">
                        {chosen === h.handle && <Check className="w-4 h-4 text-accent" />}@{h.handle}
                      </button>
                      <CopyButton text={h.handle} />
                      <div className="flex gap-1 ml-auto">
                        {NETS.map((n) => (
                          <a key={n} href={rules[n].profileUrl.replace("{h}", h.handle)} target="_blank" rel="noreferrer" className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50" title={`Vérifier sur ${rules[n].label}`}>{rules[n].label}</a>
                        ))}
                      </div>
                    </div>
                    {h.why && <div className="text-xs text-slate-500 mt-1">{h.why}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Nom affiché</div>
                <div className="flex items-center gap-2 text-sm"><span className="font-semibold text-ink">{identity.display_name}</span><CopyButton text={identity.display_name ?? ""} /></div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Adresse e-mail</div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-500">Domaine :</span>
                  <input className="input text-sm py-1 max-w-[220px]" value={notes.email_domain ?? ""} placeholder="votre-domaine.com" onChange={(e) => setNotes({ ...notes, email_domain: e.target.value })} onBlur={() => void save({ notes: { email_domain: notes.email_domain ?? "" } })} />
                </div>
                <div className="space-y-1">
                  {(identity.email_local_parts ?? []).map((e) => <div key={e} className="flex items-center gap-2 text-sm font-mono"><span>{e}@{domain}</span><CopyButton text={`${e}@${domain}`} /></div>)}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Photo de profil</div>
                <p className="text-sm text-slate-600">{identity.profile_picture_hint} Tailles : {NETS.map((n) => `${rules[n].label} ${rules[n].picture}`).join(" · ")}.</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Lien en bio</div>
                <p className="text-sm text-slate-600">{identity.link_suggestion}</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Mots-clés et hashtags</div>
                <div className="flex flex-wrap gap-1 text-xs">{(identity.keywords ?? []).map((k) => <span key={k} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{k}</span>)}</div>
                <div className="flex items-center gap-2 mt-2 text-xs text-slate-600"><span className="truncate">{(identity.hashtags ?? []).map((h) => `#${h}`).join(" ")}</span><CopyButton text={(identity.hashtags ?? []).map((h) => `#${h}`).join(" ")} /></div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. Bios */}
      {identity.generated_at && (
        <section className="card p-5">
          <h2 className="font-semibold text-ink">2 · Bios par réseau</h2>
          <p className="text-sm text-slate-500 mb-3">Chaque réseau a sa limite ; le compteur passe au rouge au-delà. Tes modifications sont gardées, même après une régénération.</p>
          <div className="grid md:grid-cols-2 gap-4">
            {NETS.map((n) => {
              const v = bios[n] ?? "";
              const over = v.length > rules[n].bioMax;
              return (
                <div key={n}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-ink">{rules[n].label} <span className="text-slate-400 font-normal">· {rules[n].bioLabel}</span></span>
                    <span className={`text-xs font-mono ${over ? "text-rose-600 font-semibold" : "text-slate-400"}`}>{v.length} / {rules[n].bioMax}</span>
                  </div>
                  <textarea className={`input text-sm w-full ${over ? "border-rose-400" : ""}`} rows={n === "youtube" ? 6 : 3} value={v} onChange={(e) => setBios({ ...bios, [n]: e.target.value })} onBlur={() => { if ((kit.identity.bios ?? {})[n] !== v) void save({ bios: { [n]: v } }, "Bio enregistrée."); }} />
                  <div className="flex items-center justify-between mt-1">
                    <CopyButton text={v} label="Copier la bio" />
                    {rules[n].aiLabel && <span className="text-[11px] text-violet-700" title="Obligation légale (AI Act art. 50, règles des plateformes)">{rules[n].aiLabel}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Bannières */}
      <section className="card p-5">
        <h2 className="font-semibold text-ink">3 · Bannières</h2>
        <p className="text-sm text-slate-500 mb-3">Fond généré par l'IA, accroche composée par nous dans la zone sûre du réseau (la partie visible sur tous les écrans). Instagram et TikTok n'ont pas de bannière : leur photo de profil suffit.</p>
        <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-slate-500 mb-1">Réseau</span>
              <select className="input text-sm w-full" value={bannerNet} onChange={(e) => setBannerNet(e.target.value as (typeof BANNER_NETS)[number])}>
                {BANNER_NETS.map((n) => <option key={n} value={n}>{rules[n].label} · {rules[n].banner?.w}×{rules[n].banner?.h}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-500 mb-1">Contenu</span>
              <select className="input text-sm w-full" value={withAvatar ? "avatar" : "world"} onChange={(e) => setWithAvatar(e.target.value === "avatar")}>
                <option value="avatar">Avec {avatar?.name ?? "l'influenceur"}</option>
                <option value="world">Son univers seul</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-500 mb-1">Accroche ({hook.trim().length}/{kit.hook_max_chars})</span>
              <input className="input text-sm w-full" list="hooks" value={hook} maxLength={kit.hook_max_chars} onChange={(e) => setHook(e.target.value)} placeholder="Sans accroche : fond seul" />
              <datalist id="hooks">{(identity.hooks ?? []).map((h) => <option key={h} value={h} />)}</datalist>
            </label>
          </div>
          <Button loading={busy === "banner"} onClick={() => setConfirm({ title: `Générer la bannière ${rules[bannerNet].label} ?`, message: `Image en 2K${withAvatar ? " avec ses références validées" : ""} : ≈ ${estimate != null ? usd(estimate) : "0,10 $"}. Le visage est demandé au centre, mais l'IA ne le garantit pas : vérifie l'aperçu avec la zone sûre et relance si besoin.`, run: () => void generateBanner() })}>
            <ImageIcon className="w-4 h-4" /> Générer{estimate != null ? ` · ≈ ${usd(estimate)}` : ""}
          </Button>
        </div>
        {bannerSpec && <p className="text-xs text-slate-500 mt-2">{rules[bannerNet].label} : {bannerSpec.note}</p>}

        {kit.banners.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {kit.banners.map((b) => {
              const spec = rules[b.network].banner!;
              const pct = (v: number, t: number) => `${(v / t) * 100}%`;
              return (
                <div key={b.id} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="relative bg-slate-100" style={{ aspectRatio: `${spec.w} / ${spec.h}` }}>
                    <img src={b.url} alt={b.hook ?? "Bannière"} className="absolute inset-0 w-full h-full object-cover" />
                    {/* Zone sûre : ce que tous les appareils affichent. En dehors, c'est rogné sur téléphone. */}
                    <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(20,23,28,.45)", clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${pct(spec.safe.y, spec.h)}, ${pct(spec.safe.x, spec.w)} ${pct(spec.safe.y, spec.h)}, ${pct(spec.safe.x, spec.w)} ${pct(spec.safe.y + spec.safe.h, spec.h)}, ${pct(spec.safe.x + spec.safe.w, spec.w)} ${pct(spec.safe.y + spec.safe.h, spec.h)}, ${pct(spec.safe.x + spec.safe.w, spec.w)} ${pct(spec.safe.y, spec.h)}, 0 ${pct(spec.safe.y, spec.h)})` }} />
                    <div className="absolute border border-white/80 border-dashed pointer-events-none" style={{ left: pct(spec.safe.x, spec.w), top: pct(spec.safe.y, spec.h), width: pct(spec.safe.w, spec.w), height: pct(spec.safe.h, spec.h) }} />
                  </div>
                  <div className="flex items-center gap-2 p-2.5 text-xs text-slate-500">
                    <span className="font-medium text-ink">{rules[b.network].label}</span>
                    <span>· {b.with_avatar ? "avec l'influenceur" : "univers"}</span>
                    {b.hook && <span className="truncate">· « {b.hook} »</span>}
                    <span className="ml-auto">{usd(b.cost_usd)}</span>
                    <a href={b.url} target="_blank" rel="noreferrer" className="p-1 hover:text-ink" title="Ouvrir en taille réelle (clic droit → enregistrer)"><ExternalLink className="w-3.5 h-3.5" /></a>
                    <button type="button" onClick={() => setConfirm({ title: "Supprimer cette bannière ?", message: "Le fichier est effacé.", run: () => void removeBanner(b) })} className="p-1 hover:text-rose-600" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">Zone claire = visible partout ; zone sombre = rognée sur téléphone. Si le visage touche la zone sombre, relance : le placement de l'IA n'est pas garanti.</p>
      </section>

      {/* 4. Checklist */}
      <section className="card p-5">
        <h2 className="font-semibold text-ink">4 · Mise en place, à la main</h2>
        <p className="text-sm text-slate-500 mb-3">Instagram et TikTok exigent un vrai numéro de téléphone ; les numéros virtuels sont refusés et contourner fait bannir le compte. Note ici ce qui a servi pour le retrouver.</p>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          {([["email", "E-mail utilisé"], ["phone", "Numéro utilisé"], ["password_hint", "Où est le mot de passe (jamais le mot de passe)"]] as Array<[string, string]>).map(([k, l]) => (
            <label key={k} className="text-sm">
              <span className="block text-xs text-slate-500 mb-1">{l}</span>
              <input className="input text-sm w-full" value={notes[k] ?? ""} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} onBlur={() => void save({ notes: { [k]: notes[k] ?? "" } })} />
            </label>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="text-xs text-slate-400 text-left"><th className="py-1 pr-3 font-medium">Étape</th>{NETS.map((n) => <th key={n} className="py-1 px-2 font-medium text-center">{rules[n].label}</th>)}</tr></thead>
            <tbody>
              {kit.steps.map((s) => (
                <tr key={s.key} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 text-ink">{s.label}</td>
                  {NETS.map((n) => {
                    const applies = !("networks" in s) || (s.networks as readonly string[]).includes(n);
                    const auto = "auto" in s && s.auto;
                    const done = Boolean(kit.checklist[n]?.[s.key]);
                    return (
                      <td key={n} className="py-1.5 px-2 text-center">
                        {!applies ? <span className="text-slate-300">—</span> : auto ? (done ? <Check className="w-4 h-4 text-ok inline" /> : <Link to={`/avatars/${id}/social`} className="text-xs text-accent hover:underline">Connecter</Link>) : (
                          <input type="checkbox" checked={done} onChange={(e) => toggleStep(n, s.key, e.target.checked)} className="w-4 h-4 accent-accent" aria-label={`${s.label} — ${rules[n].label}`} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-slate-500"><RefreshCw className="w-3 h-3" /> La ligne « connecté à Viralya » se coche seule quand le compte est relié dans Compte social.</div>
      </section>

      <ConfirmModal open={!!confirm} title={confirm?.title ?? ""} message={confirm?.message ?? ""} onClose={() => setConfirm(null)} onConfirm={() => { confirm?.run(); setConfirm(null); }} />
    </div>
  );
}
