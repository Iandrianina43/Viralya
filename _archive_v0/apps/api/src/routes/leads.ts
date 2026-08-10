import { LeadInputSchema } from "@viralya/shared";
import express, { Router } from "express";
import { confirmLead, registerLead } from "../domain/leads";
import { asyncHandler } from "../lib/asyncHandler";
import { page } from "../web/layout";
import { supabase } from "../supabase";

export const leadsRouter = Router();

// M7 — capture JSON (API) : crée un lead "pending_optin" + envoie l'email Brevo.
leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = LeadInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const { email, avatar_id, source, utm } = parsed.data;
    const result = await registerLead({ email, avatar_id, source, utm });
    res.status(201).json({ ok: true, ...result });
  }),
);

// M7 — capture depuis le formulaire SSR (application/x-www-form-urlencoded).
leadsRouter.post(
  "/form",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    const avatar_id = String(req.body?.avatar_id ?? "");
    const consent = req.body?.consent === "on" || req.body?.consent === "true";
    if (!email || !avatar_id || !consent) {
      res
        .status(400)
        .send(
          page(
            "Formulaire incomplet",
            `<h1>Oups</h1><div class="card"><p>Email et consentement sont requis.</p>
             <p><a class="btn" href="javascript:history.back()">Revenir</a></p></div>`,
          ),
        );
      return;
    }
    // UTM passés en champs cachés par la landing.
    const utm: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
      if (req.body?.[k]) utm[k] = String(req.body[k]);
    }
    await registerLead({ email, avatar_id, source: "landing", utm });
    res.redirect(303, "/optin-envoye");
  }),
);

// Confirmation double opt-in — lien cliqué depuis l'email → page HTML.
leadsRouter.get(
  "/confirm",
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? "");
    const confirmed = token ? await confirmLead(token) : null;
    if (!confirmed) {
      res
        .status(404)
        .send(
          page(
            "Lien invalide",
            `<h1>Lien invalide ou déjà utilisé</h1>
             <div class="card"><p>Ce lien de confirmation n'est plus valide.
             Si tu penses que c'est une erreur, réinscris-toi depuis la page d'origine.</p></div>`,
          ),
        );
      return;
    }
    res.send(
      page(
        "Inscription confirmée",
        `<h1>C'est confirmé ✅</h1>
         <div class="card">
           <p>Ton inscription est validée. Tu vas recevoir ton premier email très vite.</p>
           <p class="muted">Tu peux te désinscrire à tout moment via le lien présent dans chaque email.</p>
         </div>`,
      ),
    );
  }),
);

leadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let q = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (req.query.avatar_id) q = q.eq("avatar_id", String(req.query.avatar_id));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ leads: data });
  }),
);
