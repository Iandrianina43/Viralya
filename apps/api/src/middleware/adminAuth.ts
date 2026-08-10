import type { RequestHandler } from "express";
import { config } from "../config";

export const adminAuth: RequestHandler = (req, res, next) => {
  if (req.header("x-admin-key") !== config.ADMIN_API_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};
