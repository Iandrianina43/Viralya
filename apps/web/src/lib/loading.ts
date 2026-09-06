// Compteur global des appels API en vol → barre de chargement fine en haut de l'écran (TopLoader).
export const LOADING_EVENT = "viralya:loading";
let inflight = 0;

function emit(): void {
  try { window.dispatchEvent(new CustomEvent(LOADING_EVENT, { detail: inflight })); } catch { /* SSR / tests */ }
}
export function beginRequest(): void { inflight++; emit(); }
export function endRequest(): void { inflight = Math.max(0, inflight - 1); emit(); }
export function inflightCount(): number { return inflight; }
