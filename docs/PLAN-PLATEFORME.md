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

## 2. Notifications (fait, à activer avec le SMTP)

Contenu prêt à valider, génération échouée, budget à 80 % / 100 % → e-mail aux membres de
l'organisation. SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) + `EMAIL_FROM` ; Resend reste un repli (`RESEND_API_KEY`). Sans configuration : silencieux. Vérification : `scripts/email-check.ts`.

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
2. Poser les identifiants SMTP (et un `EMAIL_FROM` sur votre domaine) dans le `.env` du VPS, puis `scripts/email-check.ts`.
3. Publication réelle : Zernio retenu et codé (7 sept.) — compte Zernio, `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, migration 0019.
4. Migrations : toutes appliquées (0001 → 0022) le 14 sept. — désormais appliquées par Claude via le pooler (voir README).
5. Poser `DEFAULT_MONTHLY_BUDGET_USD=0` en prod le jour de l'ouverture (forfait obligatoire pour les
   nouveaux espaces) — ton espace admin garde un budget manuel illimité (`monthly_budget_usd` vide,
   ou fixé).
6. Faire relire les pages légales.

## 8. Kit de lancement d'un influenceur (14 sept., fait — migration 0021)

Réponse aux trois messages de Jérôme (création de compte, nom et réseaux, bannière). Page « Lancement »
par influenceur (`/avatars/:id/launch`, `apps/api/src/domain/launch.ts`, `lib/banner.ts`) :
1. **Identité de compte** générée depuis la fiche : réseaux à ouvrir pour la niche (principal /
   secondaire / plus tard, avec la raison), 6 noms de compte valables sur les cinq réseaux (lettres et
   chiffres, 5-15 : X refuse le point, Facebook le tiret bas) avec un bouton par réseau pour vérifier la
   disponibilité à la main, adresse e-mail sur votre domaine, nom affiché, bio par réseau aux limites
   vérifiées (Instagram 150, TikTok 80, YouTube 1 000, X 160, Facebook 255), accroches, mots-clés.
2. **Bannières** YouTube 2560×1440 (zone sûre 1546×423), Facebook 851×315 livrée en 2×, X 1500×500 :
   fond généré (avec l'influenceur via ses références validées, ou univers seul), accroche composée par
   nous dans la zone sûre, aperçu avec la zone sûre. Instagram et TikTok n'ont pas de bannière.
3. **Checklist** des étapes manuelles par réseau + notes (e-mail, numéro utilisés) ; la ligne « connecté
   à Viralya » se coche seule via Zernio.
Non fait, volontairement : vérification automatique de disponibilité (scraping) et validation par
téléphone (les réseaux refusent les numéros virtuels ; contourner = bannissement). En attente : les
prompts et la procédure téléphone de Jérôme, à intégrer comme aide dans la checklist.

## 9. Tarification en crédits (14 sept.)

Spec « Tarification & Facturation v1.0 » reçue de Jérôme, corrigée sur les coûts réels dans
**docs/TARIFICATION-CREDITS.md** : 1 crédit = 0,10 $ d'infra, crédits débités au coût réel estimé,
quotas de packs relevés (400 / 1 200 / 2 000 / 6 000 / 10 000), AppSumo mis de côté. **Codé le 14 sept.
(migration 0022)** : `domain/pricing.ts` (tarifs versionnés en base, version 1 = le document, plancher ×1,2
vérifié à chaque enregistrement), `domain/billing.ts` (deux soldes, réservation atomique `reserve_credits`
mensuel puis top-up, remboursement si rien n'est lancé, ajustement au coût réel, remise à zéro à chaque
facture Stripe payée ou au mois calendaire), Checkout en CHF avec setup en ligne séparée, top-up en
paiement unique, garde-fous par forfait (influenceurs, réseaux connectés, pilote automatique), écran
Paramètres › Abonnement et crédits. Non testé en réel : le passage en caisse Stripe (clé absente).

## 10. Guide flottant (14 sept., demande de Jérôme)

L'onboarding n'est plus une page : `components/Guide.tsx` flotte en bas à droite de toutes les pages avec un
petit personnage (SVG, charte Viralya) et une bulle « Prochaine étape ». Le panneau détaille l'étape (quoi,
comment, où, coût) à partir de `lib/journey.ts` (huit étapes cochées d'après les données réelles) et suit la
page ouverte (Studio → Génération, Bible → Univers…). « Plus tard » replie, « Ne plus afficher » masque
(navigateur). La page /bienvenue reste accessible par lien mais n'est plus imposée ni dans le menu.

## 11. Sécurité et finitions P2 (14 sept.)

- Session en cookies httpOnly (`viralya_session`, `viralya_refresh`), garde d'origine sur les écritures, CSP.
  Les anciennes sessions stockées dans le navigateur sont migrées au premier appel (`/auth/refresh` accepte
  encore le jeton dans le corps une fois, puis le front l'efface).
- Coût réel des carrousels et stories : `generateImage` renvoie le prix PiAPI, `assemble` le passe au registre.
- Annuaire : `findUserByEmail`, `listAllUsers`, `usersByIds` paginent Supabase ; recherche dans Réglages.
- Vocabulaire « influenceur » dans tous les textes visibles ; noms de fournisseurs hors des écrans clients.
- Rendus : délai par plan / segment depuis la soumission (25 / 20 min), dernière vérification, annulation, resoumission ;
  plafond global 60 min qui monte ce qui est prêt. Essais par type de job (`MAX_ATTEMPTS_BY_TYPE`).
- Journal : `x-request-id` + ligne `http_request` par appel, coût cumulé dans `job_done`.
- Cartes influenceur : menu « Plus » (contenu du jour, fiche, suppression).

## 12. Reste à faire (audit du 7 sept., voir docs/AUDIT-PROD.md)

Voir l'audit complet : UX/UI, gestion des organisations, robustesse, données, coûts. Bloqué par des clés :
Stripe réel, Zernio réel, SMTP.
