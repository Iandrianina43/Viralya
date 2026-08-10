import { useEffect, useState } from "react";
import { api, type ContentItem } from "../api";

const RATIO_COLOR: Record<string, string> = {
  value: "bg-green-100 text-green-700",
  proof: "bg-amber-100 text-amber-700",
  sale: "bg-rose-100 text-rose-700",
};

export function ContentReview() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .listContent()
      .then((r) => setItems(r.content))
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn(id);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-6">Revue de contenu</h1>
      {err && <div className="text-red-600 mb-4 text-sm">Erreur : {err}</div>}

      <div className="space-y-3">
        {items.map((it) => {
          const caption = String((it.payload as { caption?: string }).caption ?? "");
          const script = String((it.payload as { script?: string }).script ?? "");
          const videoUrl = (it.assets as { video_url?: string }).video_url;
          const canReview = ["needs_review", "ready"].includes(it.status);
          return (
            <div key={it.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase text-slate-500">{it.type}</span>
                <span className="text-xs text-slate-400">· {it.network}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${RATIO_COLOR[it.ratio_class]}`}>
                  {it.ratio_class}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {it.status}
                </span>
              </div>
              {caption && <div className="text-sm font-medium text-ink">{caption}</div>}
              {script && <div className="text-sm text-slate-600 mt-1 line-clamp-3">{script}</div>}
              {videoUrl && (
                <a href={videoUrl} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
                  vidéo →
                </a>
              )}
              {it.error && <div className="text-xs text-rose-600 mt-1">{it.error}</div>}
              <div className="flex gap-2 mt-3">
                {canReview && (
                  <button
                    disabled={busy === it.id}
                    onClick={() => act(it.id, api.approveContent)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-50"
                  >
                    Approuver & planifier
                  </button>
                )}
                {canReview && (
                  <button
                    disabled={busy === it.id}
                    onClick={() => act(it.id, api.rejectContent)}
                    className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600"
                  >
                    Rejeter
                  </button>
                )}
                <button
                  disabled={busy === it.id}
                  onClick={() => act(it.id, api.retryContent)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-50"
                  title="Relancer la génération depuis le début"
                >
                  ↻ Régénérer
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !err && (
          <div className="text-slate-400 text-sm">
            Aucun contenu. Va dans « Avatars » → « Générer le contenu du jour ».
          </div>
        )}
      </div>
    </div>
  );
}
