import { AlertTriangle, Check, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

// ─────────────────────────────────────────────────────────────
// Composants de base du système de design Viralya (phase 0).
// Tokens : voir index.css (--paper, --ink, --accent, --cost, --ok, --warn).
// ─────────────────────────────────────────────────────────────

// ── Bouton ───────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-dark border-transparent",
  secondary: "bg-white text-ink border-rule hover:bg-paper-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-paper-2",
  danger: "bg-white text-warn border-warn/40 hover:bg-warn-soft",
};
const SIZE: Record<Size, string> = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm" };

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded border font-sans font-semibold tracking-tight transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ── Pastille d'état ──────────────────────────────────────────
export type Tone = "neutral" | "accent" | "ok" | "warn" | "cost" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-paper-2 text-ink-2 border-rule-soft",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  cost: "bg-cost-soft text-cost border-transparent",
  info: "bg-accent-soft text-accent border-transparent",
};
export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wider ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

// ── En-tête de page ──────────────────────────────────────────
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5 mb-6 border-b border-ink">
      <div className="min-w-0">
        {eyebrow && <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-1.5">{eyebrow}</div>}
        <h1 className="font-sans text-[26px] leading-tight font-bold tracking-tight text-ink" style={{ textWrap: "balance" } as never}>{title}</h1>
        {description && <p className="text-[15px] text-ink-2 mt-1.5 max-w-[65ch]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── États vides / erreur ─────────────────────────────────────
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-rule rounded bg-paper-2/60">
      <div className="w-10 h-10 rounded-full bg-white border border-rule-soft flex items-center justify-center text-muted mb-3">{icon ?? <Inbox className="w-5 h-5" />}</div>
      <div className="font-sans font-semibold text-ink">{title}</div>
      {hint && <p className="text-sm text-muted mt-1 max-w-[46ch]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-sans font-semibold">Une erreur est survenue</div>
        <div className="break-words">{message}</div>
      </div>
      {retry && (
        <button onClick={retry} className="inline-flex items-center gap-1 font-sans text-[13px] font-semibold underline underline-offset-2">
          <RefreshCw className="w-3.5 h-3.5" /> Réessayer
        </button>
      )}
    </div>
  );
}

// ── Progression ──────────────────────────────────────────────
export function ProgressBar({ value, tone = "accent", label }: { value: number; tone?: "accent" | "ok" | "warn"; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-rule-soft overflow-hidden" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${v}%` }} />
      </div>
      <span className="font-mono text-[12px] text-muted tabular-nums w-9 text-right">{label ?? `${v}%`}</span>
    </div>
  );
}

// ── Squelette de chargement ──────────────────────────────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-rule-soft ${className}`} aria-hidden="true" />;
}

// ── Toasts ───────────────────────────────────────────────────
interface Toast { id: number; tone: "ok" | "warn" | "info"; text: string }
const ToastCtx = createContext<{ push: (tone: Toast["tone"], text: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast hors ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, tone, text }]);
  }, []);
  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((l) => l.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [items]);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,360px)]" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`flex items-start gap-2.5 rounded border px-3.5 py-3 text-sm shadow-card bg-white ${t.tone === "ok" ? "border-ok/40" : t.tone === "warn" ? "border-warn/40" : "border-rule"}`}>
            {t.tone === "ok" ? <Check className="w-4 h-4 text-ok mt-0.5" /> : t.tone === "warn" ? <AlertTriangle className="w-4 h-4 text-warn mt-0.5" /> : <Loader2 className="w-4 h-4 text-accent mt-0.5" />}
            <div className="flex-1 text-ink">{t.text}</div>
            <button onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))} className="text-muted hover:text-ink" aria-label="Fermer">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
