/** Contenus en cours (non terminés) et jobs actifs — pour savoir d'où vient chaque génération. */
import { supabase } from "../src/supabase";

const { data: items } = await supabase
  .from("content_items")
  .select("id, avatar_id, type, title, status, created_at, payload")
  .in("status", ["queued", "generating"])
  .order("created_at", { ascending: false })
  .limit(20);
for (const it of items ?? []) {
  const p = (it.payload ?? {}) as Record<string, unknown>;
  console.log(`${it.created_at} ${it.status} ${it.type} « ${it.title} » ${it.id}\n    kind=${p.kind ?? "-"} format=${p.format ?? "-"} preset=${p.preset ?? "-"} res=${p.resolution ?? "-"} plan_entry=${p.plan_entry_id ?? "-"} theme=${String(p.theme ?? "").slice(0, 60)}`);
}
const { data: jobs } = await supabase
  .from("jobs")
  .select("id, type, status, content_item_id, label, locked_by, created_at, run_after")
  .in("status", ["queued", "running", "pending"])
  .order("created_at", { ascending: false })
  .limit(20);
console.log("--- jobs actifs");
for (const j of jobs ?? []) console.log(`${j.created_at} ${j.status} ${j.type} item=${j.content_item_id} label=${j.label} worker=${j.locked_by ?? "-"}`);
process.exit(0);
