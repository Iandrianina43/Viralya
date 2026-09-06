/** Message lisible d'une erreur (jamais « Error: Error: … » à l'écran). */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : String(e);
}
