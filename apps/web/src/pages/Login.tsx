import { Loader2, Lock, Mail, Play, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { errMsg } from "../lib/errMsg";

// ─────────────────────────────────────────────────────────────
// Connexion / inscription / mot de passe oublié / nouveau mot de passe (lien e-mail → /reset).
// Une invitation (?invite=…&email=…) ouvre l'inscription pré-remplie ; ?confirmed=1 = e-mail confirmé.
// ─────────────────────────────────────────────────────────────

type Mode = "login" | "signup" | "forgot" | "reset";

export function Login() {
  const { login, signup } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const isReset = window.location.pathname === "/reset";
  const recoveryToken = hash.get("access_token");

  const [mode, setMode] = useState<Mode>(isReset ? "reset" : params.get("invite") ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    params.get("confirmed") ? "Adresse confirmée ✓ — connecte-toi." : params.get("invite") ? "Tu as été invité·e : crée ton compte avec cette adresse pour rejoindre l'espace." : null,
  );
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<{ signup_open: boolean; email_configured: boolean } | null>(null);

  useEffect(() => {
    api.publicConfig().then((c) => setCfg(c)).catch(() => setCfg({ signup_open: true, email_configured: false }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else if (mode === "signup") {
        if (password !== confirm) { setErr("Les mots de passe ne correspondent pas."); return; }
        if (!terms) { setErr("Accepte les conditions d'utilisation pour continuer."); return; }
        const r = await signup(name.trim(), email.trim(), password, terms);
        if (r.confirm_required) {
          setMode("login");
          setPassword(""); setConfirm("");
          setInfo(`Compte créé : ouvre l'e-mail envoyé à ${email.trim()} pour confirmer ton adresse, puis connecte-toi.`);
        }
      } else if (mode === "forgot") {
        await api.forgotPassword(email.trim());
        setMode("login");
        setInfo("Si un compte existe avec cette adresse, un e-mail de réinitialisation vient de partir.");
      } else if (mode === "reset") {
        if (!recoveryToken) { setErr("Lien invalide ou expiré : refais une demande de mot de passe oublié."); return; }
        if (password !== confirm) { setErr("Les mots de passe ne correspondent pas."); return; }
        await api.resetPassword(recoveryToken, password);
        window.history.replaceState(null, "", "/");
        setMode("login");
        setPassword(""); setConfirm("");
        setInfo("Mot de passe changé ✓ — connecte-toi.");
      }
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent transition bg-white";
  const titles: Record<Mode, [string, string]> = {
    login: ["Bon retour", "Connecte-toi pour retrouver tes influenceurs."],
    signup: ["Créer un compte", "Rejoins la plateforme d'influenceurs IA."],
    forgot: ["Mot de passe oublié", "On t'envoie un lien pour en choisir un nouveau."],
    reset: ["Nouveau mot de passe", "Choisis ton nouveau mot de passe."],
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-11 h-11 rounded-2xl bg-accent flex items-center justify-center shadow-sm">
            <Play className="w-5 h-5 text-white fill-white" />
          </div>
          <span className="font-bold text-ink text-2xl tracking-tight">VIRALYA</span>
        </div>

        <div className="card p-6">
          <h1 className="font-bold text-ink text-lg mb-1">{titles[mode][0]}</h1>
          <p className="text-sm text-slate-500 mb-5">{titles[mode][1]}</p>

          {info && <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl p-3 mb-4">{info}</div>}
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">{err}</div>}
          {mode === "signup" && cfg && !cfg.signup_open && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">Les inscriptions sont fermées pour le moment : demande une invitation.</div>
          )}

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input className={field} placeholder="Ton nom" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
              </div>
            )}
            {mode !== "reset" && (
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input className={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
            )}
            {mode !== "forgot" && (
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input className={field} type="password" placeholder={mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
              </div>
            )}
            {(mode === "signup" || mode === "reset") && (
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input className={field} type="password" placeholder="Confirme le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} />
              </div>
            )}
            {mode === "signup" && (
              <label className="flex items-start gap-2 text-xs text-slate-500 pt-1">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5" />
                <span>J'accepte les <a href="/cgu" target="_blank" rel="noreferrer" className="underline hover:text-ink">conditions d'utilisation</a> et la <a href="/confidentialite" target="_blank" rel="noreferrer" className="underline hover:text-ink">politique de confidentialité</a>.</span>
              </label>
            )}

            <button type="submit" disabled={busy || (mode === "signup" && cfg?.signup_open === false)} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 !mt-5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "login" ? "Se connecter" : mode === "signup" ? "Créer mon compte" : mode === "forgot" ? "Envoyer le lien" : "Enregistrer le mot de passe"}
            </button>
          </form>

          <div className="text-center text-sm text-slate-500 mt-5 space-y-1.5">
            {mode === "login" && (
              <>
                <div>Pas de compte ? <button onClick={() => { setMode("signup"); setErr(null); }} className="text-accent font-medium hover:underline">S'inscrire</button></div>
                {cfg?.email_configured !== false && <div><button onClick={() => { setMode("forgot"); setErr(null); }} className="text-slate-500 hover:underline">Mot de passe oublié ?</button></div>}
              </>
            )}
            {mode !== "login" && (
              <div>Déjà un compte ? <button onClick={() => { setMode("login"); setErr(null); }} className="text-accent font-medium hover:underline">Se connecter</button></div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Moteur d'influenceurs IA vivants — crée, génère, publie. <a href="/cgu" className="underline">CGU</a> · <a href="/confidentialite" className="underline">Confidentialité</a>
        </p>
      </div>
    </div>
  );
}
