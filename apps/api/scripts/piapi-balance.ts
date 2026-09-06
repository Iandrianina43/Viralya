/** Solde PiAPI + données utiles pour lancer des tests (avatars, produit UGC, clips existants). */
import { piapiAccountInfo } from "../src/providers/piapi";
import { supabase } from "../src/supabase";

console.log("PiAPI :", JSON.stringify(await piapiAccountInfo()));
const { data: avatars } = await supabase.from("avatars").select("id, name, sex_age, city, eleven_voice_id, ref_image_url, character_sheet_url").order("created_at");
for (const a of avatars ?? []) console.log(`avatar ${a.id} ${a.name} (${a.sex_age}) ${a.city} voix=${a.eleven_voice_id ? "oui" : "NON"} portrait=${a.ref_image_url ? "oui" : "NON"} planche=${a.character_sheet_url ? "oui" : "non"}`);
const { data: camps } = await supabase.from("ugc_campaigns").select("id, brand, product").limit(3);
for (const c of camps ?? []) console.log(`ugc ${c.id} ${c.brand} produit=${JSON.stringify(c.product).slice(0, 220)}`);
const { data: item } = await supabase.from("content_items").select("id, title, assets").eq("id", "b87d0eb0-87bf-4e7e-8fb5-2c6a5be2c160").single();
const shots = ((item?.assets as Record<string, unknown>)?.shots as Array<Record<string, unknown>>) ?? [];
console.log(`source candidate « ${item?.title} » : ${shots.map((s) => `${s.idx}:${s.duration}s ${s.clip_url}`).join(" | ")}`);
process.exit(0);
