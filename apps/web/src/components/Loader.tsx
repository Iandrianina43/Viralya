import { Loader2 } from "lucide-react";

// Petit loader réutilisable (spinner accent + label optionnel).
export function Loader({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-slate-500 ${className}`}>
      <Loader2 className="w-4 h-4 animate-spin text-accent" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

// Version "pleine tuile" (ex : pendant la génération d'un visage).
export function LoaderTile({ label }: { label?: string }) {
  return (
    <div className="aspect-[2/3] rounded-lg bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-2 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin text-accent" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
