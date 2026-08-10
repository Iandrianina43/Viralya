# VIRALYA — V1 (moteur d'influenceurs IA vivants)

Rebuild propre, focalisé sur le **cœur A + B + C** : créer des influenceurs IA crédibles qui
produisent seuls du contenu vivant (dont vidéo talking-head), avec validation humaine.
Périmètre complet : [docs/v1-scope.md](docs/v1-scope.md).

## Stack
Monorepo pnpm — `apps/api` (Node/Express + TS), `apps/web` (React + Vite + Tailwind),
`packages/shared`, `supabase/`. **Pas de n8n** (queue maison Supabase).

- **A — Avatars** : CRUD multi + fiche + prompt système auto + identité média + mémoire narrative
- **B — Contenu vivant** : pipeline quotidien/manuel, vidéo multi-scènes + hooks + carrousels,
  **contexte réel** (météo Open-Meteo, date, routine) + **mémoire** (continuité), 70/20/10, queue robuste
- **C — Validation** : revue (approuver / rejeter / régénérer), conformité auto, planification

## Moteur vidéo (swappable, par avatar)
Interface `VideoProvider` avec **HeyGen** (v3, mono-scène + SRT) et **Argil** (multi-moments) +
stub. Choix **par avatar** (`video_provider`). Voix auto-résolue vers un id valide du moteur.

## Prérequis
- Node ≥ 20, `pnpm` (`corepack enable`)
- Un projet Supabase (région EU) + bucket public **`avatar-assets`**

## Setup
```bash
pnpm install
cp .env.example .env         # renseigner SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ clés IA/vidéo)
cp apps/web/.env.example apps/web/.env   # VITE_ADMIN_API_KEY doit == ADMIN_API_KEY du .env racine
```

### Migrations (Supabase → SQL Editor, dans l'ordre)
`supabase/migrations/0001 → 0004`.
> ⚠️ `0001_init.sql` **repart d'une base propre** : il DROP les tables v0 puis recrée le schéma V1.
> (Ou : nouveau projet Supabase.) `0003_cron.sql` nécessite l'extension `pg_cron`.

## Lancer
```bash
pnpm dev        # API (:4000, worker inline) + Web (:5173)
# ou : pnpm dev:api / pnpm dev:web / pnpm worker
```
> **Sans clés IA** : les providers basculent en stub → le pipeline tourne quand même (assets placeholder).

## Vérification bout-en-bout
1. Migrations appliquées → l'avatar « Lucas Martin » (Dubaï, `active`) existe.
2. Console (http://localhost:5173) → **Avatars → Éditer Lucas** → moteur vidéo + voix + avatar_id → Enregistrer.
3. **Avatars → « Générer le contenu du jour »**.
4. **Revue contenu** (~1 min) : hooks + carrousel + vidéo. Le script parle de **Dubaï / météo / son défi 30 jours** (contexte + mémoire).
5. **Journal de vie** : l'avatar note ce qu'il publie (mémoire vivante).
6. Approuver → `scheduled`. (Programmation Buffer/Publer = Phase 2.)

## Endpoints clés
| Méthode | Route | Rôle |
|---|---|---|
| GET/POST/PUT/DELETE | `/avatars` | CRUD fiche (génère system_prompt) |
| GET/POST/DELETE | `/avatars/:id/memory` | mémoire narrative |
| GET | `/content` · POST `/content/:id/{approve,reject,retry}` | revue & actions |
| POST | `/admin/plan-day` · `/admin/enqueue-daily` | déclenche la génération (`x-admin-key`) |
| GET | `/admin/{setup,jobs,stats}` · `/admin/{voices,avatars}?provider=heygen\|argil` | pilotage & média |

## Hors V1 (Phase 2)
Funnel/leads · vente Stripe · dashboard analytics avancé · DM automation · auto-post réseaux ·
affiliation multi-réseaux · effet réseau · A/B testing · B-roll (Kling/Veo).

*(L'ancien code v0 est archivé dans `_archive_v0/` — référence uniquement.)*
