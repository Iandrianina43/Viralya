import { Router } from "express";
import { config } from "../config";
import { asyncHandler } from "../lib/asyncHandler";
import { supabase } from "../supabase";
import { escapeHtml, page } from "../web/layout";

// ─────────────────────────────────────────────────────────────
// M7/M5 — pages funnel SSR (Express, pas de SPA) :
//   GET /capture/:avatarId   landing lead magnet (double opt-in)
//   GET /offre/:slug         page de vente produit → Stripe Checkout
//   GET /optin-envoye        "vérifie ta boîte mail"
//   GET /merci               confirmation post-paiement
//   GET /confidentialite     politique RGPD
// ─────────────────────────────────────────────────────────────

export const pagesRouter = Router();

pagesRouter.get(
  "/capture/:avatarId",
  asyncHandler(async (req, res) => {
    const { data: avatar } = await supabase
      .from("avatars")
      .select("id, name, niche, business_positioning, is_ai_disclosed")
      .eq("id", req.params.avatarId)
      .single();
    if (!avatar) {
      res.status(404).send(page("Introuvable", `<h1>Page introuvable</h1>`));
      return;
    }

    // UTM propagés depuis la bio/le post → champs cachés du formulaire.
    const utmFields = ["utm_source", "utm_medium", "utm_campaign"]
      .filter((k) => req.query[k])
      .map(
        (k) =>
          `<input type="hidden" name="${k}" value="${escapeHtml(String(req.query[k]))}"/>`,
      )
      .join("");

    res.send(
      page(
        `${avatar.name} — Guide gratuit`,
        `
        ${avatar.is_ai_disclosed ? `<span class="badge">Créateur généré par IA — 100% transparent</span>` : ""}
        <h1>Reçois le guide gratuit de ${escapeHtml(avatar.name)}</h1>
        <p>${escapeHtml(avatar.business_positioning || avatar.niche)}. Laisse ton email et reçois le guide + les meilleurs conseils, direct dans ta boîte.</p>
        <div class="card">
          <form method="post" action="/leads/form">
            <input type="hidden" name="avatar_id" value="${avatar.id}"/>
            ${utmFields}
            <input type="email" name="email" placeholder="ton@email.com" required/>
            <label class="consent">
              <input type="checkbox" name="consent" required/>
              <span>J'accepte de recevoir des emails de ${escapeHtml(avatar.name)} et je confirme avoir lu la
              <a href="/confidentialite">politique de confidentialité</a>. Désinscription en 1 clic à tout moment.</span>
            </label>
            <button class="btn" type="submit">Recevoir le guide gratuit</button>
          </form>
          <p class="muted" style="margin-top:12px">Double opt-in : tu recevras un email de confirmation (RGPD).</p>
        </div>`,
        { description: `Guide gratuit par ${avatar.name} — ${avatar.niche}` },
      ),
    );
  }),
);

pagesRouter.get(
  "/offre/:slug",
  asyncHandler(async (req, res) => {
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("landing_slug", req.params.slug)
      .eq("active", true)
      .single();
    if (!product) {
      res.status(404).send(page("Introuvable", `<h1>Offre introuvable</h1>`));
      return;
    }
    const price = (product.price_cents / 100).toFixed(product.price_cents % 100 === 0 ? 0 : 2);
    const isSub = product.pricing_model === "subscription";

    res.send(
      page(
        product.name,
        `
        <h1>${escapeHtml(product.name)}</h1>
        <p>${escapeHtml(product.description)}</p>
        <div class="card">
          <div class="price">${price} € ${isSub ? '<span class="muted" style="font-size:1rem">/ mois</span>' : ""}</div>
          <form method="post" action="/stripe/checkout-form">
            <input type="hidden" name="slug" value="${escapeHtml(product.landing_slug ?? "")}"/>
            <input type="email" name="email" placeholder="ton@email.com (pour la facture)"/>
            <button class="btn" type="submit">${isSub ? "S'abonner" : "Acheter"} — paiement sécurisé Stripe</button>
          </form>
          <p class="muted" style="margin-top:12px">Paiement sécurisé via Stripe. ${isSub ? "Sans engagement, résiliable à tout moment." : ""}</p>
        </div>`,
        { description: product.description },
      ),
    );
  }),
);

pagesRouter.get("/optin-envoye", (_req, res) => {
  res.send(
    page(
      "Vérifie ta boîte mail",
      `<h1>Encore une étape 📬</h1>
       <div class="card">
         <p>On vient de t'envoyer un email de confirmation. Clique sur le lien à l'intérieur pour valider ton inscription.</p>
         <p class="muted">Pense à vérifier tes spams / l'onglet Promotions.</p>
       </div>`,
    ),
  );
});

pagesRouter.get("/merci", (_req, res) => {
  res.send(
    page(
      "Merci !",
      `<h1>Paiement confirmé ✅</h1>
       <div class="card">
         <p>Merci pour ta confiance ! Tu vas recevoir un email avec tous les détails d'accès.</p>
         <p class="muted">Un souci ? Écris-nous : ${escapeHtml(config.CONTACT_EMAIL)}</p>
       </div>`,
    ),
  );
});

pagesRouter.get("/confidentialite", (_req, res) => {
  res.send(
    page(
      "Politique de confidentialité",
      `<h1>Confidentialité &amp; RGPD</h1>
       <div class="card">
         <h2>Données collectées</h2>
         <p>Adresse email (via formulaire volontaire), données de navigation anonymisées (pixels publicitaires si activés).</p>
         <h2>Finalité &amp; base légale</h2>
         <p>Envoi de contenus et d'offres par email. Base légale : consentement explicite (double opt-in). Aucune vente de données à des tiers.</p>
         <h2>Hébergement</h2>
         <p>Données stockées dans l'Union Européenne (Supabase, région EU).</p>
         <h2>Tes droits</h2>
         <p>Accès, rectification, suppression (droit à l'oubli), portabilité. Chaque email contient un lien de désinscription en 1 clic.
         Pour toute demande : <strong>${escapeHtml(config.CONTACT_EMAIL)}</strong>.</p>
         <h2>Transparence IA</h2>
         <p>Les créateurs présentés sur ce site sont des personnages générés par intelligence artificielle. Cette transparence est volontaire et permanente.</p>
       </div>`,
    ),
  );
});
