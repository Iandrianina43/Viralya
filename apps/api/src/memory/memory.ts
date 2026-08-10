import type { MemoryKind } from "@viralya/shared";
import { supabase } from "../supabase";

interface MemoryRow {
  kind: MemoryKind;
  summary: string;
  status: string;
  importance: number;
  created_at: string;
}

// Ce que l'avatar "sait de sa propre vie" → injecté dans chaque génération.
export async function getMemoryBrief(avatarId: string): Promise<string> {
  const { data } = await supabase
    .from("avatar_memory")
    .select("kind, summary, status, importance, created_at")
    .eq("avatar_id", avatarId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as MemoryRow[];
  if (rows.length === 0) return "";

  const facts = rows.filter((r) => r.kind === "fact").slice(0, 5);
  const storylines = rows.filter((r) => r.kind === "storyline" && r.status === "open").slice(0, 5);
  const events = rows.filter((r) => r.kind === "life_event").slice(0, 5);
  const refs = [...rows.filter((r) => r.kind === "content_ref")]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 8);

  const p: string[] = [];
  if (facts.length) p.push("Ce qui te définit :\n" + facts.map((f) => `• ${f.summary}`).join("\n"));
  if (storylines.length) p.push("Histoires en cours (fais-les avancer) :\n" + storylines.map((s) => `• ${s.summary}`).join("\n"));
  if (events.length) p.push("Événements récents de ta vie :\n" + events.map((e) => `• ${e.summary}`).join("\n"));
  if (refs.length) p.push("Déjà publié récemment (ne te répète pas, tu peux y faire référence) :\n" + refs.map((r) => `• ${r.summary}`).join("\n"));
  return p.join("\n\n");
}

export async function recordContentMemory(avatarId: string, summary: string): Promise<void> {
  const clean = summary.trim().slice(0, 300);
  if (!clean) return;
  await supabase.from("avatar_memory").insert({ avatar_id: avatarId, kind: "content_ref", summary: clean, importance: 2 });
}

export interface RecordMemoryInput {
  kind: MemoryKind;
  summary: string;
  status?: "active" | "open" | "resolved";
  importance?: number;
}
export async function recordMemory(avatarId: string, i: RecordMemoryInput): Promise<void> {
  await supabase.from("avatar_memory").insert({
    avatar_id: avatarId,
    kind: i.kind,
    summary: i.summary.trim().slice(0, 500),
    status: i.status ?? "active",
    importance: i.importance ?? 3,
  });
}
