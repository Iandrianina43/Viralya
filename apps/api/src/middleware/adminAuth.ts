import type { RequestHandler } from "express";
import { userFromToken } from "../auth/auth";
import { config } from "../config";

// Accès aux endpoints /admin :
//  - un utilisateur connecté (session Bearer) — l'interface web ;
//  - OU la clé interne x-admin-key — scripts/cron côté serveur uniquement.
export const adminAuth: RequestHandler = async (req, res, next) => {
  if (req.header("x-admin-key") === config.ADMIN_API_KEY) {
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    const user = await userFromToken(token);
    if (user) {
      req.user = user;
      next();
      return;
    }
  }
  res.status(401).json({ error: "unauthorized" });
};
