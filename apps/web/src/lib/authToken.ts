// Session côté navigateur (14 sept. 2026, audit P2) : les jetons vivent dans des cookies httpOnly posés par
// l'API (/api/auth/login, /signup, /refresh) — le JavaScript de la page ne les voit jamais. Ici ne restent
// que l'organisation active et le signal global de déconnexion.
const ORG_KEY = "viralya_org";
// Anciennes sessions (avant les cookies) : jetons en localStorage — lus une fois pour migrer, puis effacés.
const LEGACY_TOKEN_KEY = "viralya_token";
const LEGACY_REFRESH_KEY = "viralya_refresh";

/** Jeton de renouvellement d'une session antérieure aux cookies, retiré du stockage au passage. */
export function takeLegacyRefreshToken(): string | null {
  try {
    const rt = localStorage.getItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return rt;
  } catch { return null; }
}

export function clearSession(): void {
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); localStorage.removeItem(LEGACY_REFRESH_KEY); localStorage.removeItem(ORG_KEY); } catch { /* rien */ }
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

/** En-têtes à joindre à chaque appel API (organisation active ; la session voyage dans le cookie). */
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const org = getOrgId();
  if (org) h["x-org-id"] = org;
  return h;
}

/** Émis quand l'API répond 401 → l'app repasse à l'écran de connexion. */
export const UNAUTHORIZED_EVENT = "viralya:unauthorized";
export function signalUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
