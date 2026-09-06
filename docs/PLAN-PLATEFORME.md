# Phase 5 — plateforme complète, prête pour des clients (7 septembre 2026)

Demande de Jérôme : « Intègre Stripe et tout ce qu'il faut pour que ce soit ultra complet ». Ce
document liste ce qui est fait, ce qui demande une clé ou une décision, et ce qui reste.

## 1. Facturation et budget (fait, à activer avec les clés Stripe)

- **Forfaits** (catalogue `apps/api/src/domain/billing.ts`, tarifs indicatifs à valider) :

| Forfait | Prix | Budget IA / mois | Influenceurs | Repère |
|---|---|---|---|---|
| Starter | 79 € | 40 $ | 1 | ≈ 3 vidéos 30 s en 720p ou 40 photos |
| Pro | 249 € | 150 $ | 3 | ≈ 13 vidéos, pilote automatique |
| Studio | 599 € | 400 $ | 10 | ≈ 36 vidéos |

  Le budget est ce que la plateforme dépense en IA pour le client (Seedance ≈ 0,385 $/s en 720p,
  image ≈ 0,07 $, voix ≈ 0,0025 $/s, musique ≈ 0,06 $). Marge ≈ prix − budget × 0,92 − frais Stripe.
- **Stripe** : Checkout en mode abonnement (prix défini dans le code, codes promo autorisés),
  portail client (carte, factures, résiliation), webhooks signés et idempotents
  (`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`).
  Variables : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, endpoint `https://<site>/api/billing/webhook`.
- **Budget** : chaque lancement est estimé, refusé (HTTP 402) s'il dépasse le budget du mois, inscrit
  dans `usage_ledger`, puis corrigé au coût réel à la fin de la production. Alertes e-mail à 80 % et
  100 %. Règle : budget manuel (admin) > forfait actif > ancien abonné sans forfait = 0 >
  `DEFAULT_MONTHLY_BUDGET_USD` (vide = illimité, comportement historique des espaces internes).
- **Interface** : Paramètres › Abonnement et budget (jauge du mois, forfaits, portail), budget manuel
  pour l'admin plateforme.

## 2. Notifications (fait, à activer avec une clé Resend)

Contenu prêt à valider, génération échouée, budget à 80 % / 100 % → e-mail aux membres de
l'organisation. `RESEND_API_KEY`, `EMAIL_FROM` (domaine vérifié chez Resend). Sans clé : silencieux.

## 3. Pilote automatique du calendrier (fait)

`content_plans.auto_produce` : les entrées « planifiées » partent seules J − 1 (`auto_lead_days`),
au plus 3 par passage du worker (toutes les 30 min, verrou `system_status` partagé prod/local), et
s'arrêtent au premier refus de budget. Le résultat attend toujours la validation humaine.

## 4. Supervision (fait)

Battement de cœur du worker dans `system_status` ; `/api/health` renvoie 503 si le worker s'est tu
depuis 3 min. À brancher sur un moniteur externe (UptimeRobot, gratuit) pour être alerté.

## 5. Cadre légal (fait, modèle)

Pages `/cgu` et `/confidentialite` (modèles à faire relire par un juriste, mentions éditeur à
compléter), case d'acceptation à l'inscription (`terms_accepted_at`), rappel des droits sur les
vidéos sources (clone), label IA déjà transmis aux réseaux.

## 6. Sécurité (fait)

En-têtes HTTP (nosniff, frame deny, referrer, HSTS en prod), limitation de débit sur l'auth
(existant), clés IA côté serveur, cloisonnement par organisation (existant), webhook Stripe signé.

## 7. Décisions et actions qui t'appartiennent

1. Créer le compte Stripe, poser les clés, enregistrer le webhook, valider les tarifs.
2. Créer le compte Resend, vérifier le domaine d'envoi.
3. Choisir Ayrshare ou Zernio pour la publication réelle.
4. Appliquer la migration 0017 dans Supabase.
5. Poser `DEFAULT_MONTHLY_BUDGET_USD=0` en prod le jour de l'ouverture (forfait obligatoire pour les
   nouveaux espaces) — ton espace admin garde un budget manuel illimité (`monthly_budget_usd` vide,
   ou fixé).
6. Faire relire les pages légales.

## 8. Reste à faire (audit du 7 sept., voir docs/AUDIT-PROD.md)

Voir l'audit complet : UX/UI, gestion des organisations, robustesse, données, coûts.
