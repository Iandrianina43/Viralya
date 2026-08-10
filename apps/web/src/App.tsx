import { ClipboardCheck, LayoutDashboard, Play, Search, Sparkles, User, Users } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AvatarEditor } from "./pages/AvatarEditor";
import { Avatars } from "./pages/Avatars";
import { ContentReview } from "./pages/ContentReview";
import { CreateAvatar } from "./pages/CreateAvatar";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { Studio } from "./pages/Studio";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/avatars", label: "Avatars", icon: Users },
  { to: "/content", label: "Revue contenu", icon: ClipboardCheck },
];

function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col p-4">
      <div className="flex items-center gap-2.5 px-2 mb-7">
        <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shadow-sm">
          <Play className="w-4 h-4 text-white fill-white" />
        </div>
        <span className="font-bold text-ink text-lg tracking-tight">VIRALYA</span>
      </div>

      <NavLink to="/avatars/create" className="btn-primary flex items-center justify-center gap-2 mb-7">
        <Sparkles className="w-4 h-4" /> Créer un avatar
      </NavLink>

      <nav className="space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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

function Topbar() {
  return (
    <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-4 px-6">
      <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2 w-full max-w-sm">
        <Search className="w-4 h-4 text-slate-400" />
        <input placeholder="Rechercher…" className="bg-transparent outline-none text-sm w-full placeholder:text-slate-400" />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-orange-400 text-white flex items-center justify-center">
          <User className="w-4 h-4" />
        </div>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-8 py-7">
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
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
