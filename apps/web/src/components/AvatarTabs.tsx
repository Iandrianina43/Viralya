import { BookOpen, CalendarDays, Clapperboard, Rocket, Smartphone, UserSquare2 } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

// ─────────────────────────────────────────────────────────────
// Barre d'onglets d'un influenceur (audit P2) : la même sur toutes ses pages, pour passer du Studio à la
// Bible, au Calendrier, au Compte, au Lancement ou au Journal sans repasser par la liste.
// ─────────────────────────────────────────────────────────────

const TABS = [
  { to: "studio", label: "Studio", icon: Clapperboard },
  { to: "bible", label: "Bible", icon: UserSquare2 },
  { to: "calendar", label: "Calendrier", icon: CalendarDays },
  { to: "social", label: "Compte", icon: Smartphone },
  { to: "launch", label: "Lancement", icon: Rocket },
  { to: "journal", label: "Journal", icon: BookOpen },
] as const;

export function AvatarTabs({ id, name }: { id: string; name?: string | null }) {
  return (
    <div className="mb-5">
      <div className="text-xs text-slate-400 mb-2"><Link to="/avatars" className="hover:underline">Influenceurs</Link> / <Link to={`/avatars/${id}`} className="hover:underline" title="Fiche de l'influenceur">{name ?? "…"}</Link></div>
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-rule-soft" aria-label="Pages de l'influenceur">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`/avatars/${id}/${to}`}
            className={({ isActive }) => `flex items-center gap-1.5 px-3 h-9 rounded-t text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${isActive ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink hover:bg-paper-2"}`}
          >
            <Icon className="w-4 h-4" strokeWidth={2.1} /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
