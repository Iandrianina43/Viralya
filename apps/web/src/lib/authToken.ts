// Stockage du jeton de session (localStorage) + signal global de déconnexion.
const KEY = "viralya_token";

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* stockage indisponible */ }
}
export function clearToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
}

/** En-têtes à joindre à chaque appel API. */
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Émis quand l'API répond 401 → l'app repasse à l'écran de connexion. */
export const UNAUTHORIZED_EVENT = "viralya:unauthorized";
export function signalUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
