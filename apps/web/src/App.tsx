import { ClipboardCheck, LayoutDashboard, LogOut, Menu, Play, Search, Settings as SettingsIcon, Sparkles, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AvatarEditor } from "./pages/AvatarEditor";
import { Avatars } from "./pages/Avatars";
import { ContentReview } from "./pages/ContentReview";
import { CreateAvatar } from "./pages/CreateAvatar";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Studio } from "./pages/Studio";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/avatars", label: "Avatars", icon: Users },
  { to: "/content", label: "Revue contenu", icon: ClipboardCheck },
  { to: "/settings", label: "Paramètres", icon: SettingsIcon },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="w-60 h-full bg-white border-r border-slate-200 flex flex-col p-4">
      <div className="flex items-center gap-2.5 px-2 mb-7">
        <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shadow-sm">
          <Play className="w-4 h-4 text-white fill-white" />
        </div>
        <span className="font-bold text-ink text-lg tracking-tight">VIRALYA</span>
      </div>

      <NavLink to="/avatars/create" onClick={onNavigate} className="btn-primary flex items-center justify-center gap-2 mb-7">
        <Sparkles className="w-4 h-4" /> Créer un avatar
      </NavLink>

      <nav className="space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                isActive ? "bg-accent text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`
            }
          >
            <Icon className="w-[18px] h-[18px]" strokeWidth={2.2} /> {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl bg-gradient-to-br from-accent to-orange-400 p-4 text-white">
        <div className="text-sm font-semibold">Viralya V1</div>
        <div className="text-xs opacity-90 mt-1 leading-snug">Moteur d'influenceurs IA vivants — crée, génère, publie.</div>
      </div>
    </aside>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Ferme le menu au clic extérieur.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6">
      <button onClick={onMenu} className="lg:hidden p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Menu">
        <Menu className="w-5 h-5" />
      </button>
      <div className="hidden sm:flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2 w-full max-w-sm">
        <Search className="w-4 h-4 text-slate-400" />
        <input placeholder="Rechercher…" className="bg-transparent outline-none text-sm w-full placeholder:text-slate-400" />
      </div>

      <div className="ml-auto relative" ref={menuRef}>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-slate-100 transition">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-orange-400 text-white flex items-center justify-center font-semibold text-sm">
            {initial}
          </div>
          <span className="hidden sm:block text-sm font-medium text-slate-700 max-w-[120px] truncate">{user?.name || user?.email}</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-56 card p-1.5 z-50" style={{ animation: "modalIn .12s ease-out" }}>
            <div className="px-3 py-2.5 border-b border-slate-100 mb-1">
              <div className="text-sm font-semibold text-ink truncate">{user?.name || "—"}</div>
              <div className="text-xs text-slate-400 truncate">{user?.email}</div>
              {user?.role === "admin" && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">Administrateur</span>}
            </div>
            <NavLink to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
              <SettingsIcon className="w-4 h-4" /> Paramètres
            </NavLink>
            <button onClick={logout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-rose-50 hover:text-rose-600">
              <LogOut className="w-4 h-4" /> Se déconnecter
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  // Referme le tiroir mobile à chaque navigation.
  useEffect(() => { setDrawer(false); }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] flex items-center justify-center">
        <div className="flex items-center gap-2.5 animate-pulse">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center"><Play className="w-4 h-4 text-white fill-white" /></div>
          <span className="font-bold text-ink text-lg">VIRALYA</span>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar desktop */}
      <div className="hidden lg:block shrink-0"><Sidebar /></div>

      {/* Tiroir mobile */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0" style={{ animation: "modalIn .15s ease-out" }}>
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button onClick={() => setDrawer(false)} className="absolute top-4 -right-11 w-9 h-9 rounded-xl bg-white/90 flex items-center justify-center text-slate-600" aria-label="Fermer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar onMenu={() => setDrawer(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
          <div className="max-w-6xl mx-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/avatars" element={<Avatars />} />
              <Route path="/avatars/create" element={<CreateAvatar />} />
              <Route path="/avatars/create/:draftId" element={<CreateAvatar />} />
              <Route path="/avatars/new" element={<AvatarEditor />} />
              <Route path="/avatars/:id" element={<AvatarEditor />} />
              <Route path="/avatars/:id/studio" element={<Studio />} />
              <Route path="/avatars/:id/journal" element={<Journal />} />
              <Route path="/content" element={<ContentReview />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
      <Shell />
    </AuthProvider>
  );
}
