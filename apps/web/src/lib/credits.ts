import { useEffect, useState } from "react";
import { api, type BillingStatus } from "../api";

// ─────────────────────────────────────────────────────────────
// Crédits côté client : un seul appel /billing partagé (cache 60 s), rafraîchi après chaque lancement
// payant (`refreshCredits`). `creditsFor(usd)` reproduit la règle serveur : 1 crédit = credit_usd de
// coût fournisseur, arrondi au plus proche (sous 0,05 $ : offert).
// ─────────────────────────────────────────────────────────────

let cached: { at: number; status: BillingStatus } | null = null;
let inflight: Promise<BillingStatus> | null = null;
const listeners = new Set<(s: BillingStatus | null) => void>();
const TTL_MS = 60_000;
export const DEFAULT_CREDIT_USD = 0.1;

export function creditsFor(usd: number, creditUsd = cached?.status.credit_usd ?? DEFAULT_CREDIT_USD): number {
  return Math.max(0, Math.round(Math.max(0, usd) / creditUsd));
}

/** « ≈ 12 crédits » (ou « offert » sous le seuil). */
export function fmtCredits(usd: number): string {
  const c = creditsFor(usd);
  return c === 0 ? "offert" : `≈ ${c} crédit${c > 1 ? "s" : ""}`;
}

export async function loadCredits(force = false): Promise<BillingStatus | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.status;
  if (!inflight) {
    inflight = api.billing().then((status) => {
      cached = { at: Date.now(), status };
      for (const l of listeners) l(status);
      return status;
    }).finally(() => { inflight = null; });
  }
  try { return await inflight; } catch { return cached?.status ?? null; }
}

/** À appeler après un lancement payant : le solde affiché se met à jour. */
export function refreshCredits(): void {
  cached = null;
  void loadCredits(true);
}

export function useBilling(): BillingStatus | null {
  const [status, setStatus] = useState<BillingStatus | null>(cached?.status ?? null);
  useEffect(() => {
    listeners.add(setStatus);
    void loadCredits().then((s) => { if (s) setStatus(s); });
    return () => { listeners.delete(setStatus); };
  }, []);
  return status;
}
