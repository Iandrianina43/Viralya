import { Loader2, Lock, Mail, Play, User } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth";

// Écran de connexion / inscription — plein écran, avant d'entrer dans l'app.
export function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === "signup" && password !== confirm) { setErr("Les mots de passe ne correspondent pas."); return; }
    if (mode === "signup" && !terms) { setErr("Accepte les conditions d'utilisation pour continuer."); return; }
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await signup(name.trim(), email.trim(), password, terms);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent transition bg-white";

  return (
    <div className="min-h-screen bg-[#f6f7f9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Marque */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-11 h-11 rounded-2xl bg-accent flex items-center justify-center shadow-sm">
            <Play className="w-5 h-5 text-white fill-white" />
          </div>
          <span className="font-bold text-ink text-2xl tracking-tight">VIRALYA</span>
        </div>

        <div className="card p-6">
          <h1 className="font-bold text-ink text-lg mb-1">{mode === "login" ? "Bon retour 👋" : "Créer un compte"}</h1>
          <p className="text-sm text-slate-500 mb-5">
            {mode === "login" ? "Connecte-toi pour retrouver tes influenceurs." : "Rejoins la plateforme d'influenceurs IA."}
          </p>

          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">{err}</div>}

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input className={field} placeholder="Ton nom" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input className={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input className={field} type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
            </div>
            {mode === "signup" && (
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

            <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 !mt-5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>

          <div className="text-center text-sm text-slate-500 mt-5">
            {mode === "login" ? (
              <>Pas de compte ? <button onClick={() => { setMode("signup"); setErr(null); }} className="text-accent font-medium hover:underline">S'inscrire</button></>
            ) : (
              <>Déjà un compte ? <button onClick={() => { setMode("login"); setErr(null); }} className="text-accent font-medium hover:underline">Se connecter</button></>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">Moteur d'influenceurs IA vivants — crée, génère, publie.</p>
      </div>
    </div>
  );
}
