import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthUser, type Org } from "./api";
import { clearToken, getOrgId, getToken, setOrgId, setRefreshToken, setToken, UNAUTHORIZED_EVENT } from "./lib/authToken";

// ─────────────────────────────────────────────────────────────
// Session côté front : jeton en localStorage, profil + organisations via
// /auth/me, organisation active mémorisée, déconnexion automatique sur 401.
// ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  orgs: Org[];
  org: Org | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, terms?: boolean) => Promise<{ confirm_required?: boolean }>;
  logout: () => void;
  setUser: (u: AuthUser) => void;
  switchOrg: (id: string) => void;
  refreshOrgs: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth hors AuthProvider");
  return ctx;
}

function pickActive(orgs: Org[]): Org | null {
  if (!orgs.length) return null;
  const wanted = getOrgId();
  const found = wanted ? orgs.find((o) => o.id === wanted) : undefined;
  const active = found ?? orgs[0]!;
  setOrgId(active.id);
  return active;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const r = await api.me();
    setUser(r.user);
    setOrgs(r.orgs);
    setOrg(pickActive(r.orgs));
  }, []);

  // Restaure la session au chargement.
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    loadSession()
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, [loadSession]);

  // 401 quelque part → session expirée → retour à l'écran de connexion.
  useEffect(() => {
    const onUnauthorized = () => { clearToken(); setUser(null); setOrgs([]); setOrg(null); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    setToken(r.token);
    setRefreshToken(r.refresh_token ?? null);
    await loadSession();
  }, [loadSession]);

  const signup = useCallback(async (name: string, email: string, password: string, terms = true) => {
    const r = await api.signup(name, email, password, terms);
    if ("confirm_required" in r && r.confirm_required) return { confirm_required: true };
    const s = r as { token: string; refresh_token?: string | null };
    setToken(s.token);
    setRefreshToken(s.refresh_token ?? null);
    await loadSession();
    return {};
  }, [loadSession]);

  const logout = useCallback(() => {
    api.logout().catch(() => {}); // révocation côté serveur, sans bloquer
    clearToken();
    setUser(null);
    setOrgs([]);
    setOrg(null);
  }, []);

  // Changer d'organisation recharge l'application : toutes les pages sont scoppées.
  const switchOrg = useCallback((id: string) => {
    setOrgId(id);
    window.location.assign("/dashboard");
  }, []);

  const refreshOrgs = useCallback(async () => {
    const r = await api.listOrgs();
    setOrgs(r.orgs);
    setOrg(pickActive(r.orgs));
  }, []);

  return (
    <AuthContext.Provider value={{ user, orgs, org, loading, login, signup, logout, setUser, switchOrg, refreshOrgs }}>
      {children}
    </AuthContext.Provider>
  );
}
