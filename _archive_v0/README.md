# VIRALYA — MVP

Plateforme d'influenceurs IA (business & affiliation). Monorepo MVP avec **1 avatar** (Coach Business)
pour valider la chaîne complète : génération de contenu (dont **vidéo talking-head HeyGen**) →
funnel de capture → vente directe Stripe → dashboard.

> Décisions structurantes : **pas de n8n** (orchestration = Supabase Cron + queue maison),
> **vidéo via HeyGen** (interface `VideoProvider` swappable), **API Node/Express + front React**,
> conformité (avatars ouvertement IA, RGPD) **dès J1**, publication compliant (revue humaine + Buffer/Publer).

## Structure

```
apps/
  api/     Node.js + Express + TS — REST, worker de jobs, providers IA, funnel
  web/     React + Vite + Tailwind + Recharts — console interne (dashboard, avatars, revue)
packages/
  shared/  types + schémas Zod + moteur ratio 70/20/10 (partagés)
supabase/
  migrations/  schéma SQL + claim_jobs + pg_cron + seed Coach Business
```

## Orchestration sans n8n

`pg_cron` insère un job `plan_day` par avatar actif → la table `jobs` sert de queue durable →
le **worker** (`apps/api`) claime les jobs (`claim_jobs` / `FOR UPDATE SKIP LOCKED`), exécute une
étape du pipeline, puis **enfile l'étape suivante**. Retries avec backoff exponentiel. La vidéo
(rendu async HeyGen) est suivie par un job `poll_video` qui se ré-enfile jusqu'à `ready`.

Pipeline par type de contenu (voir `apps/api/src/pipeline/pipelines.ts`) :

```
video    : generate_text → generate_voice → generate_video → poll_video → assemble → [revue] → schedule
hook     : generate_text → assemble → [revue] → schedule
carousel : generate_text → generate_image → assemble → [revue] → schedule
```

## Écosystème vivant (l'avatar comme personne réelle)

Chaque avatar génère du contenu **daté, contextuel et continu** — pas des posts isolés :

- **Mémoire narrative** (`avatar_memory`) — faits durables, **histoires en cours**, événements de vie,
  et journal de ce qui a déjà été publié. Injectée à chaque génération → l'avatar **ne se répète pas**,
  **fait avancer ses histoires**, et écrit lui-même sa `memory_note` après chaque post (`memory/memory.ts`).
- **Conscience du contexte** (`context/`) — assemblé à la volée dans chaque script :
  - **Météo temps réel** via Open-Meteo (gratuit, **aucune clé**) selon la ville de l'avatar
  - **Date / saison / événements** (rentrée, Black Friday, fêtes…)
  - **Routine de vie** (matin = motivation, soir = bilan) selon l'heure locale
  - **Tendances / actus** de la niche (optionnel, `NEWS_API_KEY` — sinon ignoré)
- **Console → Journal de vie** — voir et enrichir la mémoire (ajouter un fait, une histoire, un événement).

> Tout est non bloquant : si un signal échoue (météo, actus), la génération continue sans lui.

## Prérequis

- Node ≥ 20, `pnpm` (`corepack enable`)
- Un projet **Supabase** (région EU)

## Setup

```bash
pnpm install
cp .env.example .env            # renseigner SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (obligatoire)
cp apps/web/.env.example apps/web/.env
```

Appliquer les migrations (dans l'ordre) via le SQL editor Supabase ou la CLI :

```bash
# CLI Supabase (si installée) :
supabase db push
# — ou — coller manuellement supabase/migrations/0001..0004 dans le SQL editor.
```

> `0003_cron.sql` nécessite l'extension `pg_cron` (activer via Dashboard > Database > Extensions
> si le `create extension` échoue). En local sans pg_cron, utiliser l'endpoint admin (voir plus bas).

## Lancer

```bash
pnpm dev        # API (:4000, worker inline) + Web (:5173) en parallèle
# ou séparément :
pnpm dev:api
pnpm dev:web
pnpm worker     # worker en process séparé (si RUN_WORKER_INLINE=false)
```

> **Mode démo sans clés IA** : si aucune clé LLM/ElevenLabs/HeyGen n'est configurée, les providers
> basculent en **stub** et le pipeline tourne quand même de bout en bout (assets placeholder).
> Idéal pour valider l'orchestration avant de brancher les vraies API.

## Vérification bout-en-bout

1. **Seed** appliqué → l'avatar « Lucas Martin » (Coach Business, `active`) et les produits
   Loomy CRM / Talk Flow existent.
2. Ouvrir la console (http://localhost:5173) → **Avatars** → « Générer le contenu du jour »
   (ou `POST /admin/plan-day { "avatar_id": "111...111" }` avec header `x-admin-key`).
3. Le worker traite la queue : suivre `GET /admin/jobs` — les jobs passent `pending → done`.
4. **Revue contenu** : ~1 min plus tard, 4 contenus apparaissent en `needs_review`
   (1 vidéo + 2 hooks + 1 carrousel), la vidéo a une `video_url`.
5. « Approuver & planifier » → enfile un job `schedule` → statut `scheduled`
   (le garde-fou 70/20/10 bloque toute sur-vente en `needs_review`).
6. **Funnel** : `POST /leads` (email + `consent:true`) → lead `pending_optin` + `confirmUrl` ;
   ouvrir le lien → lead `confirmed`.
7. **Vente** : `POST /stripe/checkout { "slug": "loomy-crm", "email": "..." }` (clé Stripe test)
   → URL Checkout ; webhook `checkout.session.completed` → commande `paid` → **Dashboard** mis à jour.

## Endpoints clés

| Méthode | Route | Rôle |
|---|---|---|
| GET/POST/PUT | `/avatars` | CRUD fiche avatar (génère le system_prompt) |
| GET | `/content` | contenus (filtre `avatar_id`, `status`) |
| POST | `/content/:id/approve` | approbation humaine → planification |
| POST | `/leads` · `/leads/form` · GET `/leads/confirm` | capture (JSON + formulaire SSR) + double opt-in RGPD via Brevo |
| POST | `/stripe/checkout` · `/stripe/checkout-form` · `/stripe/webhook` | vente directe (JSON + formulaire no-JS) |
| POST | `/admin/plan-day` · `/admin/enqueue-daily` | déclenche la génération (header `x-admin-key`) |
| GET | `/admin/stats` · `/admin/jobs` | KPIs & monitoring queue |
| GET | `/admin/voices` · `/admin/heygen-avatars` | voix ElevenLabs & avatars HeyGen dispo (assignation console) |

## Pages funnel (SSR Express)

| Page | Rôle |
|---|---|
| `/capture/:avatarId` | landing lead magnet — formulaire email + consentement + UTM, pixels Meta/Google si configurés |
| `/offre/:slug` | page de vente produit → bouton Stripe Checkout (ex. `/offre/loomy-crm`) |
| `/optin-envoye` | « vérifie ta boîte mail » (après soumission du formulaire) |
| `/merci` | confirmation post-paiement Stripe |
| `/confidentialite` | politique RGPD + transparence IA |

**Flux Brevo :** `POST /leads` → email de confirmation double opt-in (Brevo transactionnel) →
clic sur le lien → lead `confirmed` + ajout à la liste `BREVO_WELCOME_LIST_ID` (l'automation
« séquence welcome » se configure côté Brevo, déclenchée par l'ajout à la liste).

**Vidéos HeyGen :** les URLs HeyGen étant temporaires, `poll_video` rapatrie automatiquement la
vidéo dans le Storage Supabase (URL pérenne), avec fallback sur l'URL provider.

**HeyGen v3 :** vidéo via `POST /v3/videos` (`type:"avatar"`, `avatar_id`, `audio_url` ElevenLabs
ou `script`+`voice_id`, `aspect_ratio:"9:16"`, `caption` SRT, `engine:avatar_iv`) → poll
`GET /v3/videos/{id}`. Le LLM structure le script en scènes (hook→valeur→CTA) pour la qualité ;
la voix = **1 audio ElevenLabs**, la vidéo = **1 rendu HeyGen + sous-titres SRT**. (v2 multi-scène
est déprécié le 31/10/2026.) B-roll & cuts multi-fonds = Phase 2.
Le bucket Storage `avatar-assets` doit être **public** (HeyGen doit pouvoir lire l'`audio_url`).

## Hors périmètre MVP (Phase 2)

DM automation (M6) · tracking affiliation multi-réseaux (M4) · multi-avatar (M9) ·
B-roll Runway/Veo · A/B testing hooks · envoi réel Buffer/Publer (provider stub, branchement `TODO`).
