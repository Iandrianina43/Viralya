import { Download, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

// ─────────────────────────────────────────────────────────────
// LECTEUR INTERNE — vidéos et images s'ouvrent dans Viralya (plein écran léger),
// jamais dans un onglet externe. `useMediaViewer().open({ url, kind, title })`.
// ─────────────────────────────────────────────────────────────

export interface MediaItem { url: string; kind: "video" | "image"; title?: string | null; subtitle?: string | null }

const Ctx = createContext<{ open: (m: MediaItem) => void; close: () => void }>({ open: () => {}, close: () => {} });

export function useMediaViewer() {
  return useContext(Ctx);
}

/** Bouton qui ouvre un média dans le lecteur interne (remplace les liens `target="_blank"`). */
export function MediaButton({ url, kind = "video", title, subtitle, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { url: string; kind?: "video" | "image"; title?: string | null; subtitle?: string | null }) {
  const { open } = useMediaViewer();
  return (
    <button
      type="button"
      {...rest}
      className={className}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open({ url, kind, title, subtitle }); }}
    >
      {children}
    </button>
  );
}

export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const open = useCallback((m: MediaItem) => setItem(m), []);
  const close = useCallback(() => setItem(null), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [item, close]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {item && (
        <div className="fixed inset-0 z-[80] bg-black/85 flex flex-col" onClick={close} role="dialog" aria-modal="true" aria-label={item.title ?? "Lecteur"}>
          <div className="flex items-center gap-3 px-4 py-3 text-white/90" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              {item.title && <div className="text-sm font-semibold truncate">{item.title}</div>}
              {item.subtitle && <div className="text-xs text-white/60 truncate">{item.subtitle}</div>}
            </div>
            <a href={item.url} download target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 text-white/70 hover:text-white" title="Télécharger le fichier"><Download className="w-3.5 h-3.5" /> Télécharger</a>
            <button onClick={close} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Fermer"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            {item.kind === "video" ? (
              <video key={item.url} src={item.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg shadow-2xl bg-black" style={{ maxHeight: "calc(100vh - 80px)" }} />
            ) : (
              <img src={item.url} alt={item.title ?? ""} className="max-h-full max-w-full rounded-lg shadow-2xl object-contain" style={{ maxHeight: "calc(100vh - 80px)" }} />
            )}
          </div>
          <div className="text-center text-[11px] text-white/40 pb-2">Échap ou clic à côté pour fermer</div>
        </div>
      )}
    </Ctx.Provider>
  );
}
