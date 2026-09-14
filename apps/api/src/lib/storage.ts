import type { RequestHandler, Response } from "express";
import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// STOCKAGE (Supabase Storage) — bucket PRIVÉ + URLs signées (audit du 7 sept. 2026, codé le 14).
//   • En base, les médias restent stockés sous leur forme CANONIQUE (…/object/public/<bucket>/<chemin>) :
//     aucune migration de données, les chemins restent lisibles.
//   • Vers le navigateur : chaque réponse JSON est réécrite (server.ts) avec des URLs signées (3 h,
//     mises en cache côté serveur pour que la même URL revienne d'un rafraîchissement à l'autre :
//     pas de rechargement d'images à chaque sondage).
//   • Depuis le navigateur : les URLs signées renvoyées dans un corps de requête (photo produit, fiche
//     influenceur…) sont ramenées à la forme canonique avant d'être stockées.
//   • Vers les fournisseurs (PiAPI, ElevenLabs, Zernio, contrôle visage) : URLs signées plus longues.
//   • Côté serveur (ffmpeg, ré-encodage) : téléchargement direct par le rôle de service, sans URL.
//   Formats (storage-js 2.112) : public = encodeURI(`${url}/object/public/${bucket}/${path}`),
//   signé = encodeURI(`${url}/object/sign/${bucket}/${path}?token=…`).
// ─────────────────────────────────────────────────────────────

const bucket = () => config.SUPABASE_STORAGE_BUCKET;
const storageBase = () => `${config.SUPABASE_URL.replace(/\/$/, "")}/storage/v1`;
const publicPrefix = () => `${storageBase()}/object/public/${bucket()}/`;
const signedPrefix = () => `${storageBase()}/object/sign/${bucket()}/`;

/** Durées de validité des URLs signées (secondes). */
export const SIGN_TTL = {
  web: 3 * 3600, // navigateur : 3 h (réutilisée tant qu'il reste > 1 h 30)
  provider: 12 * 3600, // PiAPI (files d'attente longues), contrôle visage
  publish: 24 * 3600, // Zernio : « accessible jusqu'à la fin de l'envoi »
} as const;

// Crée le bucket s'il n'existe pas (idempotent) et le passe en privé quand STORAGE_PRIVATE=true.
// Jamais de retour automatique en public : scripts/storage-privacy.ts pour un changement explicite.
export async function ensureBucket(): Promise<void> {
  const name = bucket();
  const wantPrivate = config.STORAGE_PRIVATE;
  const { error } = await supabase.storage.createBucket(name, { public: !wantPrivate });
  if (error && !/exist/i.test(error.message)) {
    logger.warn("ensure_bucket_failed", { bucket: name, err: error.message });
    return;
  }
  if (error && wantPrivate) {
    const { data: info } = await supabase.storage.getBucket(name);
    if (info?.public) {
      const { error: e2 } = await supabase.storage.updateBucket(name, { public: false });
      if (e2) logger.warn("bucket_privacy_failed", { bucket: name, err: e2.message });
      else logger.info("bucket_now_private", { bucket: name });
    }
  }
  logger.info("bucket_ready", { bucket: name, private: wantPrivate });
}

// Upload d'octets vers Supabase Storage → URL canonique (signée à la sortie).
export async function uploadBytes(path: string, bytes: ArrayBuffer | Buffer, contentType: string): Promise<string> {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  const { error } = await supabase.storage.from(bucket()).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket()).getPublicUrl(path);
  return data.publicUrl;
}

/** Chemin dans le bucket si l'URL (canonique ou signée) pointe vers notre stockage, sinon null. */
export function storagePathOf(url: unknown): string | null {
  if (typeof url !== "string" || url.length < 20) return null;
  const pub = publicPrefix();
  if (url.startsWith(pub)) {
    const rest = url.slice(pub.length).split("?")[0] ?? "";
    return rest ? safeDecode(rest) : null;
  }
  const sig = signedPrefix();
  if (url.startsWith(sig)) {
    const rest = url.slice(sig.length).split("?")[0] ?? "";
    return rest ? safeDecode(rest) : null;
  }
  return null;
}
const safeDecode = (s: string): string => { try { return decodeURI(s); } catch { return s; } };

/** Forme canonique (stockée en base) d'un chemin du bucket. */
export function canonicalUrl(path: string): string {
  return supabase.storage.from(bucket()).getPublicUrl(path).data.publicUrl;
}

// ── Signature (avec cache : même URL renvoyée tant qu'il reste plus de la moitié de la validité) ──
const cache = new Map<string, { url: string; exp: number }>();
const CACHE_MAX = 20_000;

export async function signPaths(paths: string[], ttl: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const p of new Set(paths)) {
    const hit = cache.get(`${ttl}:${p}`);
    if (hit && hit.exp - now > (ttl * 1000) / 2) out.set(p, hit.url);
    else missing.push(p);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(bucket()).createSignedUrls(chunk, ttl);
    if (error || !data) {
      logger.warn("sign_urls_failed", { count: chunk.length, err: error?.message?.slice(0, 160) });
      continue;
    }
    if (cache.size > CACHE_MAX) cache.clear();
    for (const d of data) {
      if (!d.signedUrl || d.error || !d.path) continue;
      cache.set(`${ttl}:${d.path}`, { url: d.signedUrl, exp: now + ttl * 1000 });
      out.set(d.path, d.signedUrl);
    }
  }
  return out;
}

/** Signe une URL de notre stockage ; les autres URLs (fournisseurs, externes) sont renvoyées telles quelles. */
export async function signUrl(url: string, ttl: number = SIGN_TTL.provider): Promise<string> {
  const path = storagePathOf(url);
  if (!path) return url;
  return (await signPaths([path], ttl)).get(path) ?? url;
}

export async function signUrls(urls: string[], ttl: number = SIGN_TTL.provider): Promise<string[]> {
  const paths = urls.map(storagePathOf);
  const signed = await signPaths(paths.filter((p): p is string => !!p), ttl);
  return urls.map((u, i) => { const p = paths[i]; return p ? signed.get(p) ?? u : u; });
}

function collectPaths(value: unknown, acc: Set<string>, depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") { const p = storagePathOf(value); if (p) acc.add(p); return; }
  if (Array.isArray(value)) { for (const v of value) collectPaths(v, acc, depth + 1); return; }
  if (typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) collectPaths(v, acc, depth + 1);
}
function replaceDeep(value: unknown, map: (s: string) => string, depth = 0): unknown {
  if (depth > 12 || value == null) return value;
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, map, depth + 1));
  if (typeof value === "object") {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = replaceDeep(v, map, depth + 1);
    return out;
  }
  return value;
}

/** Chemins de notre stockage référencés n'importe où dans une valeur JSON (nettoyage, rapports). */
export function storagePathsIn(value: unknown): Set<string> {
  const paths = new Set<string>();
  collectPaths(value, paths);
  return paths;
}

/** Réécrit toutes les URLs de notre stockage d'une valeur JSON en URLs signées (réponses au navigateur). */
export async function signStorageUrlsDeep<T>(value: T, ttl: number = SIGN_TTL.web): Promise<T> {
  const paths = new Set<string>();
  collectPaths(value, paths);
  if (!paths.size) return value;
  const signed = await signPaths([...paths], ttl);
  if (!signed.size) return value;
  return replaceDeep(value, (s) => { const p = storagePathOf(s); return p ? signed.get(p) ?? s : s; }) as T;
}

/** Middleware Express : toute réponse `res.json` part avec des URLs de stockage signées (échec = réponse telle quelle, journalisée). */
export function signedJsonMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      signStorageUrlsDeep(body).then(
        (signed) => original(signed),
        (err) => { logger.warn("sign_response_failed", { err: String((err as Error)?.message ?? err).slice(0, 160) }); original(body); },
      );
      return res;
    }) as typeof res.json;
    next();
  };
}

/** Flux SSE : chaque événement part signé, dans l'ordre ; `end()` attend la file avant de fermer. */
export function signedSseSender(res: Response): { send: (evt: unknown) => void; end: () => Promise<void> } {
  let chain: Promise<void> = Promise.resolve();
  const send = (evt: unknown) => {
    chain = chain.then(async () => {
      let body = evt;
      try { body = await signStorageUrlsDeep(evt); } catch { /* telle quelle */ }
      res.write(`data: ${JSON.stringify(body)}\n\n`);
    });
  };
  return { send, end: async () => { await chain; res.end(); } };
}

/** Ramène les URLs signées d'une valeur JSON (corps de requête) à la forme canonique stockée en base. */
export function canonicalizeDeep<T>(value: T): T {
  const sig = signedPrefix();
  return replaceDeep(value, (s) => {
    if (!s.startsWith(sig)) return s;
    const p = storagePathOf(s);
    return p ? canonicalUrl(p) : s;
  }) as T;
}

/** Télécharge un média : par le rôle de service si c'est notre stockage (bucket privé), sinon HTTP. */
export async function downloadMedia(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const path = storagePathOf(url);
  if (path) {
    const { data, error } = await supabase.storage.from(bucket()).download(path);
    if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "vide"} (${path.slice(0, 100)})`);
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}: ${url.slice(0, 120)}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
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
