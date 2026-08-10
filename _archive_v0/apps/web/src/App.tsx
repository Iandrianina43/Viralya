import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AvatarEditor } from "./pages/AvatarEditor";
import { Avatars } from "./pages/Avatars";
import { ContentReview } from "./pages/ContentReview";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";

function Nav() {
  const link = "block px-4 py-2 rounded-lg text-sm font-medium";
  const active = ({ isActive }: { isActive: boolean }) =>
    `${link} ${isActive ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-200"}`;
  return (
    <aside className="w-56 shrink-0 bg-white border-r border-slate-200 p-4 space-y-1">
      <div className="text-xl font-bold text-ink px-2 mb-4">
        VIRALYA<span className="text-accent">.</span>
      </div>
      <NavLink to="/dashboard" className={active}>
        Dashboard
      </NavLink>
      <NavLink to="/avatars" className={active}>
        Avatars
      </NavLink>
      <NavLink to="/journal" className={active}>
        Journal de vie
      </NavLink>
      <NavLink to="/content" className={active}>
        Revue contenu
      </NavLink>
    </aside>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 max-w-6xl">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/avatars" element={<Avatars />} />
          <Route path="/avatars/new" element={<AvatarEditor />} />
          <Route path="/avatars/:id" element={<AvatarEditor />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/content" element={<ContentReview />} />
        </Routes>
      </main>
    </div>
  );
}
