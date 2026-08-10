import { config } from "../config";
import { supabase } from "../supabase";

// Upload d'octets (audio/vidéo/image générés) vers Supabase Storage → URL publique.
export async function uploadBytes(
  path: string,
  bytes: ArrayBuffer | Buffer,
  contentType: string,
): Promise<string> {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  const { error } = await supabase.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Utilitaire : extrait un objet JSON d'une réponse LLM éventuellement "fencée".
export function extractJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
