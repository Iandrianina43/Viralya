// Stockage du jeton de session et de l'organisation active (localStorage),
// + signal global de déconnexion.
const KEY = "viralya_token";
const REFRESH_KEY = "viralya_refresh";
const ORG_KEY = "viralya_org";

export function getRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}
export function setRefreshToken(token: string | null): void {
  try { if (token) localStorage.setItem(REFRESH_KEY, token); else localStorage.removeItem(REFRESH_KEY); } catch { /* rien */ }
}

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* stockage indisponible */ }
}
export function clearToken(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(REFRESH_KEY); localStorage.removeItem(ORG_KEY); } catch { /* rien */ }
}

export function getOrgId(): string | null {
  try { return localStorage.getItem(ORG_KEY); } catch { return null; }
}
export function setOrgId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch { /* rien */ }
}

/** En-têtes à joindre à chaque appel API (session + organisation active). */
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  const org = getOrgId();
  if (org) h["x-org-id"] = org;
  return h;
}

/** Émis quand l'API répond 401 → l'app repasse à l'écran de connexion. */
export const UNAUTHORIZED_EVENT = "viralya:unauthorized";
export function signalUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
