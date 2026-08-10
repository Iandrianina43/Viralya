import { X } from "lucide-react";
import type { ReactNode } from "react";

// Modal générique premium (overlay flouté + carte centrée).
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-card ${maxWidth} w-full max-h-[90vh] flex flex-col overflow-hidden`} style={{ animation: "modalIn .16s ease-out" }}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="font-semibold text-ink">{title}</div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// Modal de confirmation (annuler / confirmer).
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmer",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">Annuler</button>
        <button onClick={onConfirm} className={`text-sm px-4 py-2 rounded-xl text-white font-medium ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-accent hover:bg-accent-dark"}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
