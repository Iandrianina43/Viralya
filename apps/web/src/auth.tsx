import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthUser } from "./api";
import { clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from "./lib/authToken";

// ─────────────────────────────────────────────────────────────
// Session côté front : jeton en localStorage, profil via /auth/me,
// déconnexion automatique quand l'API répond 401.
// ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (u: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth hors AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaure la session au chargement.
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // 401 quelque part → session expirée → retour à l'écran de connexion.
  useEffect(() => {
    const onUnauthorized = () => { clearToken(); setUser(null); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const r = await api.signup(name, email, password);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
