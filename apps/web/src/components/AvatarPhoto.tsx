// Photo d'avatar avec fallback dégradé (initiale) si pas d'image.
export function AvatarPhoto({ src, name, className = "w-14 h-14", rounded = "rounded-xl", position = "object-center" }: { src?: string | null; name: string; className?: string; rounded?: string; position?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  if (src) return <img src={src} alt={name} className={`${className} ${rounded} object-cover ${position} border border-slate-200 bg-slate-100`} />;
  return (
    <div className={`${className} ${rounded} bg-gradient-to-br from-accent to-orange-400 text-white flex items-center justify-center font-bold shrink-0`}>
      {initial}
    </div>
  );
}
