# Viralya

SaaS de création et de gestion d'influenceurs IA : personnage (Character Bible), univers de lieux
(World Bible), calendrier éditorial, génération photo / vidéo / UGC, validation humaine, versions,
Task Center, publication (simulée puis réelle).

- **Cadrage produit** : [docs/BRIEF.md](docs/BRIEF.md)
- **Audit, décisions techniques sourcées, architecture, phases** : [docs/PLAN-REFONTE.md](docs/PLAN-REFONTE.md)
- **Règle de travail** : [CLAUDE.md](CLAUDE.md) (recherche avant implémentation, jamais d'hypothèse présentée comme un fait)

## Stack

Monorepo pnpm.

| Paquet | Rôle |
|---|---|
| `apps/api` | Node 20 / Express / TypeScript. API sous `/api`, worker de jobs maison (table `jobs` Supabase), sert le build du front en production. |
| `apps/web` | React 18 / Vite / Tailwind. Tokens de design : papier clair, encre, un accent ; Archivo (interface), Newsreader (textes longs), IBM Plex Mono (données). |
| `packages/shared` | Enums et schémas zod partagés. |
| `supabase/migrations` | Schéma Postgres, fonctions SQL, pg_cron. |

Fournisseurs IA : PiAPI (Seedance 2.0, vidéo), OpenAI GPT Image (images), ElevenLabs (voix),
Anthropic Claude (texte). Contexte vivant : Open-Meteo (météo), NewsAPI (optionnel).

## Prérequis

- Node ≥ 20 et pnpm (`corepack enable`)
- Un projet Supabase avec le bucket public `avatar-assets` (créé automatiquement au démarrage si absent)
- Les clés dans `.env` (voir `.env.example`)

## Installation

```bash
pnpm install
cp .env.example .env                      # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, clés IA
cp apps/web/.env.example apps/web/.env    # VITE_API_BASE_URL (http://localhost:4000/api en dev)
```

### Migrations

À exécuter dans l'ordre dans le SQL Editor de Supabase : `supabase/migrations/0001` → `0012`.

- `0001_init.sql` repart d'une base propre (supprime les tables v0).
- `0003_cron.sql` demande l'extension `pg_cron`.
- `0011_fence_old_worker.sql` neutralise `claim_jobs` (ancien worker VPS partageant la base) ; le code passe par `claim_jobs_v2`.
- `0012_phase0_saas.sql` **obligatoire pour la version courante** : organisations et membres, `org_id` sur les influenceurs, jobs robustes (progression, journal, heartbeat, reprise des orphelins), versions de contenu, statut `canceled`. Les données existantes sont rattachées à l'organisation « Viralya » et tous les comptes existants en deviennent membres.
- `0013_character_bible.sql` **obligatoire pour la Character Bible** : références d'identité, garde-robe, cache de keyframes, rapports QC, type de contenu `photo` et job `generate_photo`.
- `0014_daily_plan_guard.sql` : verrou (influenceur, jour) du contenu quotidien et fin de l'empilement des `plan_day` (incident du 3 sept. 2026).
- `0015_hybrid_video_jobs.sql` **obligatoire pour la vidéo hybride** : jobs `generate_voice`, `generate_shots`, `poll_shots`.
- `0016_phase3_calendar_social_ugc.sql` **obligatoire pour la phase 3** : calendrier éditorial (`content_plans`, `plan_entries`), compte social simulé (`social_profiles`, colonnes `stats`, `ai_label`, `publish_provider`…), campagnes UGC (`ugc_campaigns`, `ugc_variants`), connexions de publication (`social_connections`), jobs `generate_plan` et `sync_stats`.

### Contrôle qualité des visages (optionnel mais recommandé)

`tools/qc/face_score.py` compare chaque image générée au portrait de référence (OpenCV YuNet + SFace, local,
gratuit). Installer `pip install opencv-python numpy` et télécharger les deux modèles (voir `tools/qc/README.md`).
Sans Python, la production continue et le score est simplement « non contrôlé ».
Seuils : ≥ 0,55 conforme, 0,40–0,55 à vérifier, < 0,40 régénéré une fois. Exception : quand le visage retenu fait
moins de 12 % de la hauteur de l'image (plan large, profil), le score n'est pas fiable et l'image passe simplement
« à vérifier », sans régénération payante.

### Images

`IMAGE_PROVIDER=piapi` (défaut) utilise Seedream 5 Pro via PiAPI, retenu par le banc d'essai du 3 septembre 2026
(`docs/PLAN-REFONTE.md`, §2.1) ; `IMAGE_MODEL` permet de choisir `nano-banana-2`. OpenAI GPT Image reste disponible
avec `IMAGE_PROVIDER=openai`.

## Lancer

```bash
pnpm dev          # API :4000 (worker inline) + Web :5173
pnpm dev:api      # API seule
pnpm dev:web      # Web seul
pnpm worker       # worker seul (RUN_WORKER_INLINE=false côté API)
pnpm typecheck    # vérification des types sur les trois paquets
```

Le premier compte créé devient administrateur de la plateforme. Chaque nouveau compte reçoit
son organisation personnelle ; un propriétaire peut ajouter des membres par email.

## Organisation de l'API

| Préfixe | Accès | Contenu |
|---|---|---|
| `/api/auth` | public / session | inscription, connexion, profil, gestion des comptes (admin) |
| `/api/orgs` | session | organisations de l'utilisateur, membres |
| `/api/avatars` | session + organisation | influenceurs, portrait, planche, voix, univers de lieux (`?scope=permanent|oneoff|all`), mémoire, Character Bible (`references`, `wardrobe`, `keyframes` : cache décor + tenue + cadrage, réutilisé à 0 $) |
| `/api/avatar-drafts` | session + organisation | brouillons de création (chat IA) |
| `/api/content` | session + organisation | contenus, revue (approuver, refuser, relancer, annuler), versions |
| `/api/studio` | session + organisation | réalisateur IA, production Seedance, estimation des coûts, solde et historique PiAPI, Task Center ; formats (`/formats/script`, `/formats/estimate`, `/formats/produce`), clone (`/clone/upload`, `/clone/link`, `/clone/transcribe`), `/upload-image` |
| `/api/calendar` | session + organisation | calendrier éditorial mensuel : génération par le stratège (job `generate_plan`), entrées éditables, production d'une entrée (vidéo en prise unique, photo, carrousel, story) |
| `/api/social` | session + organisation | compte social par influenceur et par réseau (profil, feed, statistiques simulées ou réelles), « publier maintenant », connexions Ayrshare, remontée des stats |
| `/api/ugc` | session + organisation | campagnes UGC : produit + matrice (influenceurs × angles × accroches × durées × CTA) → scripts en 7 temps, production vidéo par variante avec mentions légales incrustées |
| `/api/admin` | rôle admin ou `x-admin-key` | jobs globaux, reprise manuelle, déclenchement du quotidien |

L'organisation active est lue dans l'en-tête `x-org-id` (sinon la première de l'utilisateur).
Toute lecture d'un influenceur ou d'un contenu vérifie l'appartenance à cette organisation.

## Pipeline de production (état actuel)

Vidéo hybride (défaut, `payload.format = "hybrid"`) :

```
studio → réalisateur (règles « hybride » : accroche ≤ 8 mots, plans parlés 3-7 s, plans de coupe 2-5 s,
                      inserts photo ancrés sur des mots, interdits d'écriture) → content_item (generating)
       → generate_voice  (ElevenLabs v3 : une piste par plan, mots horodatés ; musique Eleven Music instrumentale)
       → generate_shots  (talk → keyframe du décor (tenue de la vidéo) + OmniHuman 1.5 par défaut / Kling Avatar ;
                          inserts → keyframes d'autres cadrages (cache) ; broll → Seedance muet, même keyframe + tenue)
       → poll_shots      (suivi parallèle, QC visage, 3 essais, repli less-restriction)
                         → montage FFmpeg : inserts Ken Burns pendant la parole, voix off sur le b-roll,
                           sous-titres karaoké (Poppins, `apps/api/assets/fonts`), musique −17 dB, grain léger, 8 Mbit/s max
       → assemble → needs_review (+ version) → approve → schedule
```

Chaque plan se régénère seul (`POST /api/content/:id/shots/:idx/regenerate`, texte modifiable) ; la vidéo est remontée.
Choix documentés dans [docs/RECHERCHE-VIDEO-V2.md](docs/RECHERCHE-VIDEO-V2.md) (Kling Avatar = EN/JA/KO/ZH officiellement,
OmniHuman sans restriction de langue, conventions de montage 2026, zones sûres, musique).
Tests : `scripts/test-montage.ts` (montage hors ligne, 0 $) et `scripts/test-hybrid-e2e.ts` (réel).

Plan-séquence Seedance (`payload.format = "seedance"`, voix synthétisée par Seedance) :

```
studio → content_item (generating) → generate_video (segment 1, Seedance)
       → poll_video (chaîne : extension du segment précédent, décor en @image)
       → concat FFmpeg → assemble → needs_review (+ version) → approve → schedule
```

Les jobs portent une progression, un journal, un battement de cœur ; un job dont le worker
meurt est remis en file automatiquement (`reap_stale_jobs`). L'annulation est coopérative.

## Phase 3 — calendrier, compte social, UGC, onboarding (6 sept. 2026)

- **Calendrier** (`/avatars/:id/calendar`) : « Générer le mois » → le stratège écrit piliers, séries, arcs
  narratifs et un planning jour par jour (mix 40 % vidéos / 35 % photos / 15 % carrousels / 10 % stories,
  règle 70/20/10, lieux de l'univers). Chaque entrée se modifie, s'ignore ou se **produit** : vidéo = le
  réalisateur écrit l'histoire depuis le brief puis une prise unique Seedance 2.5 ; photo / carrousel /
  story = pipelines existants. Statut synchronisé avec le contenu.
- **Compte social** (`/avatars/:id/social`) : profil par réseau (handle, bio générée, audience de départ),
  feed des contenus publiés, statistiques déterministes qui progressent sur 72 h, contenus programmés,
  « Publier maintenant ». Réel dès qu'une connexion Ayrshare existe pour l'influenceur.
- **Campagnes UGC** (`/ugc`) : produit (photo de référence pour Seedance), objectif, cible, ton, angles,
  accroches par angle (10 mécanismes), durées 20/30/45 s, CTA → scripts en 7 temps (docs/RECHERCHE-UGC.md),
  estimation, production par variante ; mentions « Collaboration commerciale » et « Images virtuelles ·
  Contenu généré par IA » incrustées pendant toute la vidéo.
- **Onboarding** : panneau « Premiers pas » du dashboard, 8 étapes cochées d'après les données.
- **Publication réelle** (phase 4, socle) : `providers/publisher.ts` (simulé / Ayrshare), `social_connections`,
  labels IA envoyés, job `sync_stats` (+1 h, +6 h, +24 h, +72 h, +7 j). Recherche : docs/RECHERCHE-PUBLICATION.md.
- Smoke test après migration 0016 : `pnpm --filter @viralya/api exec tsx scripts/test-phase3.ts <avatar_id> [content_id]`.

## Formats vidéo et prompts Seedance (6-7 sept. 2026)

Le Studio (« Assistant de réalisation ») commence par le choix du format — recherche dans
docs/RECHERCHE-FORMATS.md, règles de prompt dans docs/RECHERCHE-VIDEO-V2.md §11 :

- **Vlog** : prise unique Seedance 2.5 (3-5 plans dans un seul rendu, une phrase par plan, coupes calées
  sur la voix ElevenLabs). **B-roll** (inserts photo, plans de coupe) désactivé par défaut, case pour le
  réactiver (`payload.inserts`).
- **Pub produit** (sans visage) : une prise de 30 s en 4 plans (accroche, preuve, résultat, image finale
  propre), produit verrouillé par ses photos (`product_image_url[s]`), voix off optionnelle avec sa voix.
- **Pub avec l'influenceur** : la prise unique avec un brief publicitaire et le produit en référence.
- **Explicative** (sans visage) : 4-6 scènes de voix off, au plus 2 clips Seedance 2.5 (première image
  générée, voix native) et des images Seedream animées au montage (rôle de plan `still`).
- **Clone de vidéo** : vidéo source déposée (≤ 200 Mo, coupée à 30 s) ou téléchargée par lien (yt-dlp
  requis sur le serveur), transcrite (Scribe), redite avec sa voix ; Seedance 2.5 reçoit `@video1` (source),
  `@image1` (identité) et `@audio1` (sa voix). Musique désactivée.
- Les prompts suivent le sexe de l'influenceur (`sex_age`) et sont en une seule langue (traduction de
  secours des champs de direction écrits en français).
- Tests à sec (LLM seulement) : `scripts/test-formats.ts <avatar_id> [explainer|ad_product|clone|all]`,
  `SINGLE_TAKE=1 DRY_RUN=1 scripts/test-hybrid-e2e.ts <avatar_id> 30 "<brief>"` ; remontage sans inserts
  d'une vidéo existante : `scripts/reassemble.ts <content_id> --no-inserts`.

## Feuille de route

Voir la section « Phases » de [docs/PLAN-REFONTE.md](docs/PLAN-REFONTE.md) :
0 fondations SaaS (fait) → 1 Character Bible et photos (fait) → 2 vidéo v2 (fait, Seedance 2.5) → 3 calendrier,
compte simulé, UGC, onboarding (codé, à tester après la migration 0016) → 4 publication réelle et analytics
(socle codé : Ayrshare, à activer avec une clé).

Phase 2, point de départ : le français parlé des vidéos Seedance est mauvais parce que Seedance synthétise
lui-même la voix (les audios de référence ne guident que le rythme). La voix sera générée par ElevenLabs v3 puis
la vidéo pilotée par cet audio (Kling AI Avatar / OmniHuman 1.5 via PiAPI) depuis un keyframe ; banc d'essai :
`apps/api/scripts/bench-talking.ts`.

*(Le code v0 est archivé dans `_archive_v0/`, référence uniquement.)*
