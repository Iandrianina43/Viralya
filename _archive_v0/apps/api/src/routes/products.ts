import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { supabase } from "../supabase";

export const productsRouter = Router();

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let q = supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (req.query.avatar_id) q = q.eq("avatar_id", String(req.query.avatar_id));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ products: data });
  }),
);

productsRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("landing_slug", req.params.slug)
      .single();
    if (error || !data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ product: data });
  }),
);
