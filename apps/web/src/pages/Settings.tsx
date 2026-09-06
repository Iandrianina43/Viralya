import { Ban, Check, CheckCircle2, Loader2, Shield, ShieldOff, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type BillingStatus, type ManagedUser, type OrgInvite, type OrgMember, type Setup } from "../api";
import { errMsg } from "../lib/errMsg";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/Modal";

import { Skeleton, SkeletonGrid } from "../components/ui";
const field = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent transition";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-bold text-ink">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

export function Settings() {
  const { user, setUser, logout, org, orgs, refreshOrgs, switchOrg } = useAuth();
  const isAdmin = user?.role === "admin";

  // Profil
  const [name, setName] = useState(user?.name ?? "");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  // Mot de passe
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // Admin
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [adminErr, setAdminErr] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<ManagedUser | null>(null);

  // Abonnement et budget de génération (7 sept. 2026).
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMsg, setBillingMsg] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const loadBilling = () =>
    api.billing().then((b) => { setBilling(b); setBudgetInput(b.budget_source === "manual" && b.budget_usd != null ? String(b.budget_usd) : ""); }).catch((e) => setBillingMsg(String(e.message ?? e)));
  useEffect(() => {
    loadBilling();
    const q = new URLSearchParams(window.location.search);
    if (q.get("billing") === "success") setBillingMsg("Abonnement enregistré ✓ — la mise à jour prend quelques secondes.");
    if (q.get("billing") === "cancel") setBillingMsg("Paiement annulé.");
  }, []);
  const checkout = async (plan: string) => {
    setBillingBusy(true); setBillingMsg(null);
    try { const r = await api.billingCheckout(plan); window.location.href = r.url; }
    catch (e) { setBillingMsg(String((e as Error).message ?? e)); setBillingBusy(false); }
  };
  const portal = async () => {
    setBillingBusy(true); setBillingMsg(null);
    try { const r = await api.billingPortal(); window.location.href = r.url; }
    catch (e) { setBillingMsg(String((e as Error).message ?? e)); setBillingBusy(false); }
  };
  const saveBudget = async () => {
    setBillingBusy(true); setBillingMsg(null);
    try { await api.billingSetBudget(budgetInput.trim() === "" ? null : Number(budgetInput)); await loadBilling(); setBillingMsg("Budget enregistré ✓"); }
    catch (e) { setBillingMsg(String((e as Error).message ?? e)); } finally { setBillingBusy(false); }
  };

  const loadAdmin = () => {
    if (!isAdmin) return;
    api.listUsers().then((r) => setUsers(r.users)).catch((e) => setAdminErr(String(e.message ?? e)));
    api.setup().then(setSetup).catch(() => {});
  };
  useEffect(() => { loadAdmin(); /* eslint-disable-next-line */ }, [isAdmin]);

  // Espace (organisation) : nom, membres, invitations, départ, suppression.
  const canManageOrg = !!org && (org.role === "owner" || org.role === "admin" || isAdmin);
  const [orgName, setOrgName] = useState(org?.name ?? "");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgMsg, setOrgMsg] = useState<string | null>(null);
  const [confirmAct, setConfirmAct] = useState<{ title: string; message: string; danger?: boolean; run: () => void } | null>(null);
  const loadOrg = useCallback(() => {
    if (!org) return;
    setOrgName(org.name);
    api.orgMembers(org.id).then((r) => setMembers(r.members)).catch(() => setMembers([]));
    api.orgInvites(org.id).then((r) => setInvites(r.invites)).catch(() => setInvites([]));
  }, [org]);
  useEffect(() => { loadOrg(); }, [loadOrg]);
  const orgAction = async (fn: () => Promise<void>, done?: string) => {
    if (!org) return;
    setOrgBusy(true); setOrgMsg(null);
    try { await fn(); if (done) setOrgMsg(done); loadOrg(); }
    catch (e) { setOrgMsg(errMsg(e)); } finally { setOrgBusy(false); }
  };
  const renameOrg = () => orgAction(async () => { await api.renameOrg(org!.id, orgName.trim()); await refreshOrgs(); }, "Nom enregistré ✓");
  const addMember = () => orgAction(async () => { const r = await api.addOrgMember(org!.id, inviteEmail.trim(), inviteRole); setInviteEmail(""); setOrgMsg(r.invited ? "Invitation envoyée par e-mail ✓" : "Membre ajouté ✓"); });
  const changeRole = (m: OrgMember, role: "owner" | "admin" | "member") => orgAction(async () => { await api.addOrgMember(org!.id, m.email, role); }, "Rôle mis à jour ✓");
  const removeMember = (m: OrgMember) => orgAction(async () => { await api.removeOrgMember(org!.id, m.user_id); }, "Membre retiré.");
  const leaveOrg = () => orgAction(async () => { await api.removeOrgMember(org!.id, user!.id); await refreshOrgs(); window.location.assign("/dashboard"); });
  const cancelInvite = (inviteId: string) => orgAction(async () => { await api.deleteOrgInvite(org!.id, inviteId); });
  const createOrg = () => {
    const name = window.prompt("Nom du nouvel espace :");
    if (!name || name.trim().length < 2) return;
    void orgAction(async () => { const r = await api.createOrg(name.trim()); await refreshOrgs(); switchOrg(r.org.id); });
  };
  const deleteOrg = () => {
    if (!org) return;
    const typed = window.prompt(`Suppression DÉFINITIVE de l'espace et de tout son contenu. Tape son nom exact pour confirmer : ${org.name}`);
    if (typed == null) return;
    void orgAction(async () => { await api.deleteOrg(org.id, typed); await refreshOrgs(); window.location.assign("/dashboard"); });
  };
  const ROLE_FR: Record<string, string> = { owner: "propriétaire", admin: "admin", member: "membre" };

  // Suppression de son propre compte.
  const [delPw, setDelPw] = useState("");
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const deleteAccount = async () => {
    try { await api.deleteAccount(delPw); logout(); } catch (e) { setDelMsg(errMsg(e)); }
  };

  const saveProfile = async () => {
    setProfileBusy(true); setProfileMsg(null);
    try {
      const r = await api.updateProfile(name.trim());
      setUser(r.user);
      setProfileMsg("Profil mis à jour ✓");
    } catch (e) { setProfileMsg(e instanceof Error ? e.message : errMsg(e)); }
    finally { setProfileBusy(false); }
  };

  const changePw = async () => {
    setPwMsg(null);
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: "Les mots de passe ne correspondent pas." }); return; }
    setPwBusy(true);
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(""); setNewPw(""); setConfirmPw("");
      setPwMsg({ ok: true, text: "Mot de passe changé ✓" });
    } catch (e) { setPwMsg({ ok: false, text: e instanceof Error ? e.message : errMsg(e) }); }
    finally { setPwBusy(false); }
  };

  const patchUser = async (u: ManagedUser, patch: { role?: "admin" | "user"; banned?: boolean }) => {
    setRowBusy(u.id); setAdminErr(null);
    try { await api.updateUser(u.id, patch); loadAdmin(); }
    catch (e) { setAdminErr(e instanceof Error ? e.message : errMsg(e)); }
    finally { setRowBusy(null); }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    const id = confirmDel.id; setConfirmDel(null); setRowBusy(id);
    try { await api.deleteUser(id); loadAdmin(); }
    catch (e) { setAdminErr(e instanceof Error ? e.message : errMsg(e)); }
    finally { setRowBusy(null); }
  };

  const integ: Array<{ label: string; ok: boolean }> = setup
    ? [
        { label: `Texte (${setup.llm.provider})`, ok: setup.llm.configured },
        { label: "Images (OpenAI)", ok: setup.image.configured },
        { label: "Vidéo Seedance 2.0 (PiAPI)", ok: setup.piapi.configured },
        { label: "Voix (ElevenLabs)", ok: setup.elevenlabs.configured },
        { label: "Paiement (Stripe)", ok: !!setup.stripe?.configured },
        { label: "E-mails (Resend)", ok: !!setup.email?.configured },
      ]
    : [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-ink mb-1">Paramètres</h1>
      <p className="text-sm text-slate-500 mb-6">Ton compte, ta sécurité{isAdmin ? " et la gestion de la plateforme" : ""}.</p>

      <div className="space-y-6">
        {/* Profil */}
        <Section title="Profil">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block"><span className="text-sm text-slate-600">Nom</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block"><span className="text-sm text-slate-600">Email</span>
              <input className={`${field} bg-slate-50 text-slate-400`} value={user?.email ?? ""} disabled />
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={saveProfile} disabled={profileBusy || name.trim().length < 2} className="btn-primary disabled:opacity-50 flex items-center gap-2">
              {profileBusy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
            </button>
            {profileMsg && <span className={`text-sm ${profileMsg.includes("✓") ? "text-green-600" : "text-red-600"}`}>{profileMsg}</span>}
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${isAdmin ? "bg-accent/10 text-accent" : "bg-slate-100 text-slate-500"}`}>
              {isAdmin ? "Administrateur" : "Membre"}
            </span>
          </div>
        </Section>

        {/* Mot de passe */}
        <Section title="Mot de passe" subtitle="8 caractères minimum.">
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="block"><span className="text-sm text-slate-600">Actuel</span>
              <input className={field} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="block"><span className="text-sm text-slate-600">Nouveau</span>
              <input className={field} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="block"><span className="text-sm text-slate-600">Confirmer</span>
              <input className={field} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={changePw} disabled={pwBusy || !curPw || newPw.length < 8} className="btn-primary disabled:opacity-50 flex items-center gap-2">
              {pwBusy && <Loader2 className="w-4 h-4 animate-spin" />} Changer le mot de passe
            </button>
            {pwMsg && <span className={`text-sm ${pwMsg.ok ? "text-green-600" : "text-red-600"}`}>{pwMsg.text}</span>}
          </div>
        </Section>

        {/* Espace de travail : équipe */}
        <Section title={`Espace : ${org?.name ?? "…"}`} subtitle="Ton espace de travail : nom, membres et rôles. Les invitations partent par e-mail.">
          {org && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${field} max-w-xs`} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Nom de l'espace" disabled={!canManageOrg} aria-label="Nom de l'espace" />
                {canManageOrg && <button onClick={renameOrg} disabled={orgBusy || orgName.trim().length < 2 || orgName.trim() === org.name} className="text-sm px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Renommer</button>}
                {orgs.length > 1 && (
                  <select value={org.id} onChange={(e) => switchOrg(e.target.value)} className={`${field} max-w-xs`} aria-label="Changer d'espace">
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                <button onClick={createOrg} disabled={orgBusy} className="text-sm px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">+ Nouvel espace</button>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Membres</div>
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <div key={m.user_id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-ink font-medium">{m.name || m.email}</span>
                      <span className="text-slate-400 text-xs">{m.email}</span>
                      {canManageOrg && m.user_id !== user?.id ? (
                        <select value={m.role} onChange={(e) => changeRole(m, e.target.value as "owner" | "admin" | "member")} disabled={orgBusy || (m.role === "owner" && org.role !== "owner" && !isAdmin)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1" aria-label="Rôle">
                          <option value="member">membre</option><option value="admin">admin</option>{(org.role === "owner" || isAdmin) && <option value="owner">propriétaire</option>}
                        </select>
                      ) : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{ROLE_FR[m.role] ?? m.role}</span>}
                      {m.user_id === user?.id
                        ? <button onClick={() => setConfirmAct({ title: "Quitter cet espace ?", message: "Tu n'auras plus accès à ses influenceurs et contenus.", danger: true, run: () => void leaveOrg() })} className="ml-auto text-xs text-slate-400 hover:text-rose-600">Quitter</button>
                        : canManageOrg && <button onClick={() => setConfirmAct({ title: `Retirer ${m.name || m.email} ?`, message: "La personne perd l'accès à cet espace immédiatement.", danger: true, run: () => void removeMember(m) })} className="ml-auto text-xs text-slate-400 hover:text-rose-600">Retirer</button>}
                    </div>
                  ))}
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-2 text-sm text-slate-500">
                      <span>{inv.email}</span><span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">invitation envoyée</span>
                      {canManageOrg && <button onClick={() => void cancelInvite(inv.id)} className="ml-auto text-xs text-slate-400 hover:text-rose-600">Annuler</button>}
                    </div>
                  ))}
                </div>
                {canManageOrg && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <input className={`${field} max-w-xs`} type="email" placeholder="email@exemple.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} aria-label="E-mail à inviter" />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "admin" | "member")} className="text-sm border border-slate-200 rounded-xl px-2" aria-label="Rôle du nouveau membre"><option value="member">membre</option><option value="admin">admin</option></select>
                    <button onClick={addMember} disabled={orgBusy || !/\S+@\S+\.\S+/.test(inviteEmail)} className="text-sm px-3.5 py-2 rounded-xl bg-ink text-white disabled:opacity-40">Inviter</button>
                  </div>
                )}
                {orgMsg && <div className="text-sm text-slate-600 mt-2">{orgMsg}</div>}
              </div>
              {(org.role === "owner" || isAdmin) && (
                <div className="pt-3 border-t border-slate-100">
                  <button onClick={deleteOrg} className="text-xs text-rose-600 hover:underline">Supprimer cet espace…</button>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Abonnement et budget de génération */}
        <Section title="Abonnement et budget" subtitle="Ce que Viralya dépense en IA pour cet espace ce mois-ci, et ton forfait.">
          {billing ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-1 gap-3">
                  <span className="text-slate-600">
                    {billing.plan ? `Forfait ${billing.plan.name}` : billing.budget_source === "manual" ? "Budget fixé par l'administrateur" : billing.budget_usd == null ? "Sans limite (espace interne)" : "Sans forfait"}
                    {billing.subscription_status && billing.subscription_status !== "active" ? ` · ${billing.subscription_status}` : ""}
                  </span>
                  <span className="font-semibold text-ink whitespace-nowrap">{billing.spent_usd.toFixed(2)} $ {billing.budget_usd != null ? `/ ${billing.budget_usd.toFixed(0)} $` : ""} <span className="text-xs font-normal text-slate-400">ce mois</span></span>
                </div>
                {billing.budget_usd != null && billing.budget_usd > 0 && (
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${billing.spent_usd / billing.budget_usd > 0.8 ? "bg-rose-500" : "bg-accent"}`} style={{ width: `${Math.min(100, (billing.spent_usd / billing.budget_usd) * 100)}%` }} />
                  </div>
                )}
                {billing.current_period_end && <div className="text-xs text-slate-400 mt-1">Renouvellement le {new Date(billing.current_period_end).toLocaleDateString("fr-FR")}</div>}
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {billing.plans.map((p) => (
                  <div key={p.code} className={`rounded-xl border p-3 ${billing.plan?.code === p.code ? "border-accent bg-accent/5" : "border-slate-200"}`}>
                    <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-ink">{p.name}</span><span className="text-sm text-slate-600">{p.price_eur} €/mois</span></div>
                    <div className="text-xs text-slate-500 mt-1">{p.description}</div>
                    <div className="text-xs text-slate-400 mt-1">Budget IA : {p.budget_usd} $ par mois</div>
                    {billing.plan?.code !== p.code && (
                      <button onClick={() => checkout(p.code)} disabled={!billing.stripe_configured || billingBusy}
                        title={billing.stripe_configured ? "" : "Paiement indisponible : Stripe n'est pas configuré sur ce serveur"}
                        className="mt-2 text-xs px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">Choisir</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {billing.has_customer && (
                  <button onClick={portal} disabled={billingBusy} className="text-sm px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">Gérer mon abonnement (factures, carte, résiliation)</button>
                )}
                {!billing.stripe_configured && <span className="text-xs text-slate-400">Paiement en ligne non activé sur ce serveur.</span>}
                {billingMsg && <span className="text-sm text-slate-600">{billingMsg}</span>}
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-500">Budget manuel de cet espace ($ par mois, vide = règle du forfait)</span>
                  <input className="w-28 border border-slate-200 rounded-lg px-2 py-1 text-sm" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="ex. 100" />
                  <button onClick={saveBudget} disabled={billingBusy} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Enregistrer</button>
                </div>
              )}
            </div>
          ) : billingMsg ? <div className="text-sm text-slate-400">{billingMsg}</div> : <div aria-busy="true"><Skeleton className="h-4 w-1/2 mb-3" /><Skeleton className="h-2 w-full mb-4" /><SkeletonGrid cards={3} media={false} className="grid sm:grid-cols-3 gap-2" /></div>}
        </Section>

        {/* Admin : utilisateurs */}
        {isAdmin && (
          <Section title="Utilisateurs" subtitle="Les membres de la plateforme.">
            {adminErr && <div className="text-sm text-red-600 mb-3">Erreur : {adminErr}</div>}
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm min-w-[540px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-3 font-semibold">Membre</th>
                    <th className="py-2 pr-3 font-semibold">Rôle</th>
                    <th className="py-2 pr-3 font-semibold">Statut</th>
                    <th className="py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const self = u.id === user?.id;
                    const busy = rowBusy === u.id;
                    return (
                      <tr key={u.id} className="border-b border-slate-50">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-ink">{u.name || "—"}{self && <span className="text-xs text-slate-400"> (toi)</span>}</div>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-accent/10 text-accent" : "bg-slate-100 text-slate-500"}`}>{u.role}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {u.banned
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-600">banni</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">actif</span>}
                        </td>
                        <td className="py-2.5 text-right">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin inline text-slate-400" /> : !self && (
                            <div className="inline-flex gap-1">
                              <button title={u.role === "admin" ? "Rétrograder en membre" : "Promouvoir admin"} onClick={() => patchUser(u, { role: u.role === "admin" ? "user" : "admin" })}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-accent hover:bg-accent/5">
                                {u.role === "admin" ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                              </button>
                              <button title={u.banned ? "Réactiver" : "Bannir"} onClick={() => patchUser(u, { banned: !u.banned })}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50">
                                {u.banned ? <Check className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                              </button>
                              <button title="Supprimer" onClick={() => setConfirmDel(u)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Admin : intégrations */}
        {isAdmin && setup && (
          <Section title="Intégrations" subtitle="État des services IA (clés côté serveur, jamais exposées).">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {integ.map((i) => (
                <div key={i.label} className="rounded-xl border border-slate-200 p-3 flex items-center gap-2">
                  {i.ok ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" /> : <XCircle className="w-4 h-4 text-slate-300 shrink-0" />}
                  <span className="text-sm text-slate-600 truncate">{i.label}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Suppression du compte + liens légaux */}
        <Section title="Supprimer mon compte" subtitle="Définitif : les espaces dont tu es le seul propriétaire sont supprimés avec leurs contenus.">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${field} max-w-xs`} type="password" placeholder="Ton mot de passe" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" aria-label="Mot de passe" />
            <button onClick={() => setConfirmAct({ title: "Supprimer définitivement ton compte ?", message: "Cette action ne peut pas être annulée.", danger: true, run: () => void deleteAccount() })} disabled={delPw.length < 8}
              className="text-sm px-3.5 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40">Supprimer mon compte</button>
            {delMsg && <span className="text-sm text-rose-600">{delMsg}</span>}
          </div>
          <p className="text-xs text-slate-400 mt-3"><a href="/cgu" className="underline hover:text-ink">Conditions d'utilisation</a> · <a href="/confidentialite" className="underline hover:text-ink">Politique de confidentialité</a></p>
        </Section>

        {/* Déconnexion */}
        <div className="flex justify-end">
          <button onClick={logout} className="text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition">
            Se déconnecter
          </button>
        </div>
      </div>

      <ConfirmModal open={!!confirmAct} title={confirmAct?.title ?? ""} message={confirmAct?.message ?? ""} danger={confirmAct?.danger} onConfirm={() => { const c = confirmAct; setConfirmAct(null); c?.run(); }} onClose={() => setConfirmAct(null)} />
      <ConfirmModal
        open={!!confirmDel}
        title={`Supprimer ${confirmDel?.name || confirmDel?.email} ?`}
        message="Le compte sera définitivement supprimé. Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        onConfirm={doDelete}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  );
}
