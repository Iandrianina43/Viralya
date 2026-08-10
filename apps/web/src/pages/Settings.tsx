import { Ban, Check, CheckCircle2, Loader2, Shield, ShieldOff, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ManagedUser, type Setup } from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/Modal";

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
  const { user, setUser, logout } = useAuth();
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

  const loadAdmin = () => {
    if (!isAdmin) return;
    api.listUsers().then((r) => setUsers(r.users)).catch((e) => setAdminErr(String(e.message ?? e)));
    api.setup().then(setSetup).catch(() => {});
  };
  useEffect(() => { loadAdmin(); /* eslint-disable-next-line */ }, [isAdmin]);

  const saveProfile = async () => {
    setProfileBusy(true); setProfileMsg(null);
    try {
      const r = await api.updateProfile(name.trim());
      setUser(r.user);
      setProfileMsg("Profil mis à jour ✓");
    } catch (e) { setProfileMsg(e instanceof Error ? e.message : String(e)); }
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
    } catch (e) { setPwMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setPwBusy(false); }
  };

  const patchUser = async (u: ManagedUser, patch: { role?: "admin" | "user"; banned?: boolean }) => {
    setRowBusy(u.id); setAdminErr(null);
    try { await api.updateUser(u.id, patch); loadAdmin(); }
    catch (e) { setAdminErr(e instanceof Error ? e.message : String(e)); }
    finally { setRowBusy(null); }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    const id = confirmDel.id; setConfirmDel(null); setRowBusy(id);
    try { await api.deleteUser(id); loadAdmin(); }
    catch (e) { setAdminErr(e instanceof Error ? e.message : String(e)); }
    finally { setRowBusy(null); }
  };

  const integ: Array<{ label: string; ok: boolean }> = setup
    ? [
        { label: `Texte (${setup.llm.provider})`, ok: setup.llm.configured },
        { label: "Images (OpenAI)", ok: setup.image.configured },
        { label: "HeyGen", ok: setup.heygen.configured },
        { label: "Argil", ok: setup.argil.configured },
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

        {/* Déconnexion */}
        <div className="flex justify-end">
          <button onClick={logout} className="text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition">
            Se déconnecter
          </button>
        </div>
      </div>

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
