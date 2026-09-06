import { Building2, ChevronDown, ClipboardCheck, Compass, LayoutDashboard, ListChecks, LogOut, Megaphone, Menu, Plus, Settings as SettingsIcon, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { MediaViewerProvider } from "./components/MediaViewer";
import { ToastProvider, TopLoader } from "./components/ui";
import { AvatarEditor } from "./pages/AvatarEditor";
import { Avatars } from "./pages/Avatars";
import { Bible } from "./pages/Bible";
import { Calendar } from "./pages/Calendar";
import { ContentReview } from "./pages/ContentReview";
import { Social } from "./pages/Social";
import { Ugc } from "./pages/Ugc";
import { CreateAvatar } from "./pages/CreateAvatar";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { Legal } from "./pages/Legal";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Studio } from "./pages/Studio";
import { Tasks } from "./pages/Tasks";
import { Welcome } from "./pages/Welcome";
import { welcomeSeen } from "./lib/journey";

const NAV = [
  { to: "/bienvenue", label: "Guide", icon: Compass },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/avatars", label: "Influenceurs", icon: Users },
  { to: "/content", label: "Contenus", icon: ClipboardCheck },
  { to: "/ugc", label: "Campagnes UGC", icon: Megaphone },
  { to: "/tasks", label: "Tâches", icon: ListChecks },
  { to: "/settings", label: "Paramètres", icon: SettingsIcon },
];

const ROLE_LABEL: Record<string, string> = { owner: "Propriétaire", admin: "Admin", member: "Membre" };

function Brand() {
  return (
    <div className="flex items-baseline gap-2 px-2">
      <span className="font-sans font-bold text-[19px] tracking-tight text-ink">Viralya</span>
      <span className="font-mono text-[11px] text-muted uppercase tracking-wider">studio</span>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { org } = useAuth();
  return (
    <aside className="w-[232px] h-full bg-white border-r border-rule-soft flex flex-col py-5 px-3">
      <div className="mb-6"><Brand /></div>

      <NavLink to="/avatars/create" onClick={onNavigate} className="btn-primary mb-6">
        <Plus className="w-4 h-4" /> Nouvel influenceur
      </NavLink>

      <nav className="space-y-0.5" aria-label="Navigation principale">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 h-10 rounded font-sans text-sm font-medium transition-colors ${
                isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
              }`
            }
          >
            <Icon className="w-[17px] h-[17px]" strokeWidth={2.1} /> {label}
          </NavLink>
        ))}
      </nav>

      {org && (
        <div className="mt-auto pt-4 border-t border-rule-soft px-2">
          <div className="eyebrow mb-1">Organisation</div>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-muted shrink-0" />
            <div className="min-w-0">
              <div className="font-sans text-sm font-semibold text-ink truncate">{org.name}</div>
              <div className="text-[12px] text-muted">{ROLE_LABEL[org.role] ?? org.role}</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, org, orgs, logout, switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="h-14 shrink-0 bg-white border-b border-rule-soft flex items-center gap-3 px-4 sm:px-6">
      <button onClick={onMenu} className="lg:hidden p-2 -ml-1 rounded text-ink-2 hover:bg-paper-2" aria-label="Menu">
        <Menu className="w-5 h-5" />
      </button>
      <div className="lg:hidden"><Brand /></div>

      {orgs.length > 1 && org && (
        <label className="flex items-center gap-2 ml-1">
          <span className="eyebrow hidden sm:inline">Organisation</span>
          <select
            value={org.id}
            onChange={(e) => switchOrg(e.target.value)}
            className="h-9 rounded border border-rule bg-white px-2.5 font-sans text-sm text-ink focus:outline-none focus:border-accent"
            aria-label="Changer d'organisation"
          >
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}

      <div className="ml-auto relative" ref={menuRef}>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded p-1 pr-2 hover:bg-paper-2 transition-colors" aria-haspopup="menu" aria-expanded={open}>
          <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center font-sans font-semibold text-[13px]">{initial}</div>
          <span className="hidden sm:block font-sans text-sm font-medium text-ink max-w-[140px] truncate">{user?.name || user?.email}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted" />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-60 card p-1.5 z-50" role="menu" style={{ animation: "modalIn .12s ease-out" }}>
            <div className="px-3 py-2.5 border-b border-rule-soft mb-1">
              <div className="font-sans text-sm font-semibold text-ink truncate">{user?.name || "—"}</div>
              <div className="text-xs text-muted truncate">{user?.email}</div>
              {user?.role === "admin" && <span className="inline-block mt-1.5 rounded-sm bg-accent-soft text-accent px-1.5 py-0.5 font-sans text-[10.5px] font-semibold uppercase tracking-wider">Admin plateforme</span>}
            </div>
            <NavLink to="/settings" onClick={() => setOpen(false)} role="menuitem" className="flex items-center gap-2.5 px-3 h-9 rounded text-sm text-ink-2 hover:bg-paper-2">
              <SettingsIcon className="w-4 h-4" /> Paramètres
            </NavLink>
            <button onClick={logout} role="menuitem" className="w-full flex items-center gap-2.5 px-3 h-9 rounded text-sm text-ink-2 hover:bg-warn-soft hover:text-warn">
              <LogOut className="w-4 h-4" /> Se déconnecter
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function NotFound() {
  return (
    <div className="card p-8 text-center max-w-md mx-auto mt-10">
      <div className="text-4xl font-bold text-ink mb-2">404</div>
      <p className="text-sm text-slate-500 mb-4">Cette page n'existe pas ou plus (influenceur supprimé, lien périmé).</p>
      <NavLink to="/dashboard" className="btn-primary inline-block">Retour au tableau de bord</NavLink>
    </div>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="animate-pulse"><Brand /></div>
      </div>
    );
  }

  // Nouveau mot de passe (lien reçu par e-mail) : page publique même si une session existe.
  if (location.pathname === "/reset") return <Login />;
  // Pages légales : publiques (liens depuis l'inscription et le pied de page).
  if (location.pathname === "/cgu" || location.pathname === "/confidentialite") return <Legal page={location.pathname === "/cgu" ? "cgu" : "privacy"} />;
  if (!user) return <Login />;
  // Première connexion : le guide de démarrage s'ouvre une fois, puis reste dans le menu.
  if (!welcomeSeen() && location.pathname !== "/bienvenue") return <Navigate to="/bienvenue" replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block shrink-0"><Sidebar /></div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0" style={{ animation: "modalIn .15s ease-out" }}>
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button onClick={() => setDrawer(false)} className="absolute top-4 -right-11 w-9 h-9 rounded bg-white flex items-center justify-center text-ink-2" aria-label="Fermer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopLoader />
        <Topbar onMenu={() => setDrawer(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
          <div className="max-w-6xl mx-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/bienvenue" element={<Welcome />} />
              <Route path="/avatars" element={<Avatars />} />
              <Route path="/avatars/create" element={<CreateAvatar />} />
              <Route path="/avatars/create/:draftId" element={<CreateAvatar />} />
              <Route path="/avatars/new" element={<AvatarEditor />} />
              <Route path="/avatars/:id" element={<AvatarEditor />} />
              <Route path="/avatars/:id/studio" element={<Studio />} />
              <Route path="/avatars/:id/bible" element={<Bible />} />
              <Route path="/avatars/:id/journal" element={<Journal />} />
              <Route path="/avatars/:id/calendar" element={<Calendar />} />
              <Route path="/avatars/:id/social" element={<Social />} />
              <Route path="/ugc" element={<Ugc />} />
              <Route path="/ugc/:id" element={<Ugc />} />
              <Route path="/content" element={<ContentReview />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <MediaViewerProvider>
          <Shell />
        </MediaViewerProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
