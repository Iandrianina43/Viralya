import type { MemoryKind } from "@viralya/shared";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// Mémoire narrative de l'avatar (écosystème vivant).
// getMemoryBrief() = ce que l'avatar "sait de sa propre vie", injecté
// dans chaque génération → continuité + anti-répétition.
// recordContentMemory() = l'avatar écrit son propre journal après publication.
// ─────────────────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  summary: string;
  status: string;
  importance: number;
  created_at: string;
}

export async function getMemoryBrief(avatarId: string): Promise<string> {
  const { data } = await supabase
    .from("avatar_memory")
    .select("id, kind, summary, status, importance, created_at")
    .eq("avatar_id", avatarId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as MemoryRow[];
  if (rows.length === 0) return "";

  const facts = rows.filter((r) => r.kind === "fact").slice(0, 5);
  const storylines = rows
    .filter((r) => r.kind === "storyline" && r.status === "open")
    .slice(0, 5);
  const events = rows.filter((r) => r.kind === "life_event").slice(0, 5);
  // content_ref : les plus récents (par date), pour la continuité immédiate.
  const refs = [...rows.filter((r) => r.kind === "content_ref")]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 8);

  const parts: string[] = [];
  if (facts.length)
    parts.push("Ce qui te définit :\n" + facts.map((f) => `• ${f.summary}`).join("\n"));
  if (storylines.length)
    parts.push(
      "Histoires en cours (fais-les avancer naturellement) :\n" +
        storylines.map((s) => `• ${s.summary}`).join("\n"),
    );
  if (events.length)
    parts.push(
      "Événements récents de ta vie :\n" + events.map((e) => `• ${e.summary}`).join("\n"),
    );
  if (refs.length)
    parts.push(
      "Ce que tu as déjà publié récemment (ne te répète pas ; tu peux y faire référence) :\n" +
        refs.map((r) => `• ${r.summary}`).join("\n"),
    );

  return parts.join("\n\n");
}

/** L'avatar consigne ce qu'il vient de publier (continuité future). */
export async function recordContentMemory(avatarId: string, summary: string): Promise<void> {
  const clean = summary.trim().slice(0, 300);
  if (!clean) return;
  await supabase
    .from("avatar_memory")
    .insert({ avatar_id: avatarId, kind: "content_ref", summary: clean, importance: 2 });
}

export interface RecordMemoryInput {
  kind: MemoryKind;
  summary: string;
  status?: "active" | "open" | "resolved";
  importance?: number;
}

/** Ajout manuel d'une entrée de mémoire (console : fait, storyline, événement). */
export async function recordMemory(avatarId: string, input: RecordMemoryInput): Promise<void> {
  await supabase.from("avatar_memory").insert({
    avatar_id: avatarId,
    kind: input.kind,
    summary: input.summary.trim().slice(0, 500),
    status: input.status ?? "active",
    importance: input.importance ?? 3,
  });
}
