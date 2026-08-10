import type { RequestHandler } from "express";
import { config } from "../config";

// Protège les endpoints /admin/* via un header x-admin-key.
export const adminAuth: RequestHandler = (req, res, next) => {
  const key = req.header("x-admin-key");
  if (key !== config.ADMIN_API_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};
