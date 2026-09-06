import type { RequestHandler } from "express";
import { userFromToken } from "../auth/auth";
import { config } from "../config";

// Accès aux endpoints /api/admin (administration de la plateforme) :
//  - la clé interne x-admin-key — scripts/cron côté serveur uniquement ;
//  - OU une session dont le rôle est "admin".
// Les fonctions de studio (production, coûts) vivent sous /api/studio, ouvertes
// à tout utilisateur connecté dans le périmètre de son organisation.
export const adminAuth: RequestHandler = async (req, res, next) => {
  if (config.ADMIN_API_KEY && req.header("x-admin-key") === config.ADMIN_API_KEY) {
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    const user = await userFromToken(token);
    if (user?.role === "admin") {
      req.user = user;
      next();
      return;
    }
    if (user) {
      res.status(403).json({ error: "admin_only" });
      return;
    }
  }
  res.status(401).json({ error: "unauthorized" });
};
