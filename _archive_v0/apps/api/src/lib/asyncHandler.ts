import type { RequestHandler } from "express";

// Enrobe un handler async pour propager les erreurs vers le middleware d'erreur.
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
