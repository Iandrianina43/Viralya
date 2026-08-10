import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";

// Crée le bucket public s'il n'existe pas (idempotent). Appelé au démarrage.
export async function ensureBucket(): Promise<void> {
  const bucket = config.SUPABASE_STORAGE_BUCKET;
  const { error } = await supabase.storage.createBucket(bucket, { public: true });
  if (error && !/exist/i.test(error.message)) {
    logger.warn("ensure_bucket_failed", { bucket, err: error.message });
  } else {
    logger.info("bucket_ready", { bucket });
  }
}

// Upload d'octets vers Supabase Storage → URL publique.
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

// Extrait un objet JSON d'une réponse LLM éventuellement "fencée".
export function extractJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = (fenced?.[1] ?? raw).trim();
  const s = c.indexOf("{");
  const e = c.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    return JSON.parse(c.slice(s, e + 1)) as T;
  } catch {
    return null;
  }
}
