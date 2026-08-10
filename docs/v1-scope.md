# VIRALYA — Périmètre V1 (rebuild from scratch)

## Objectif V1
Prouver le **moteur de contenu vivant** : créer des influenceurs IA crédibles qui
produisent seuls du contenu (dont vidéo talking-head cohérente), avec validation humaine.
Périmètre volontairement réduit à **A + B + C**. Le reste (funnel, vente, dashboard avancé,
DM, multi-réseaux) est **hors V1**.

## Décisions verrouillées
- **Stack** : monorepo pnpm — `apps/api` (Node/Express + TS), `apps/web` (React + Vite + Tailwind), `packages/shared`, `supabase/`. **Pas de n8n** (queue maison Supabase).
- **Vidéo** : interface `VideoProvider` **swappable** avec **2 impls à comparer : HeyGen + Argil** (+ stub). B-roll (Kling/Veo) = Phase 2.
- **IA texte** : Claude/GPT (abstrait). **Images** : `gpt-image-1`. **Voix** : native au moteur vidéo (HeyGen/Argil TTS).
- Providers **tous abstraits** (LLM, vidéo, image) → interchangeables.

## A — Gestion des avatars
- CRUD **multi-avatars** + statut (brouillon / actif / pause)
- Fiche personnage complète : nom, sexe/âge, nationalité, **ville**, personnalité, ton, valeurs, style, backstory, positionnement, audience, niche, réseaux, produits
- **Génération auto du prompt système** depuis la fiche
- Identité média : **visage + voix** (par moteur), + choix du **moteur vidéo par avatar** (heygen/argil)
- **Mémoire narrative** éditable : faits, histoires en cours (storylines), événements, historique de contenu

## B — Génération de contenu vivant
- Déclenchement **quotidien planifié (pg_cron)** + **manuel** (par avatar)
- Formats : **vidéo talking-head multi-scènes**, hooks texte, carrousels, stories, posts
- **Couche vivante** (différenciateur) :
  - **Mémoire** : continuité, histoires qui avancent, anti-répétition
  - **Contexte réel** : météo/ville (Open-Meteo, gratuit), date/saison/événements, heure/routine
- **Règle 70/20/10** auto (valeur/preuve/vente) + détection CTA
- **Calendrier éditorial** par avatar (thèmes)
- **File d'attente robuste** : `jobs` + worker (`SKIP LOCKED`), retries backoff, `poll_video` async, monitoring
- **Stockage** assets organisé par avatar/date

### Pipeline (chaîne de jobs)
```
plan_day
  → generate_text   (prompt avatar + CONTEXTE + MÉMOIRE → scènes/hooks/caption + memory_note)
  → generate_video  (HeyGen|Argil : script + voix native, multi-scènes, sous-titres)  [vidéo]
  → poll_video      (async jusqu'à ready → persist Storage)                            [vidéo]
  → generate_image  (gpt-image-1 → upload)                                        [carrousel/story]
  → assemble        (conformité #ad + garde-fou 10% → needs_review)
```

## C — Validation & publication
- **File de revue** : voir chaque contenu (script, image, **vidéo**)
- **Approuver / Rejeter / Régénérer**
- **Conformité auto** : disclosure #ad sur vente, garde-fou 10% sur fenêtre glissante
- **Planification** + statuts : `queued → generating → needs_review → scheduled → published → failed`
- Publication V1 = **revue humaine + programmation** (export/scheduling). Pas d'auto-post via API non officielles.

## Modèle de données (Supabase)
`avatars`, `avatar_memory`, `content_items`, `content_calendar`, `jobs`, `assets`.
*(products/orders/leads → hors V1.)*

## Console (apps/web)
- Liste + éditeur d'avatars (fiche + identité média + moteur vidéo)
- Bouton « Générer le contenu du jour »
- **Revue de contenu** (approuver/rejeter/régénérer, aperçu vidéo)
- **Journal de vie** (mémoire de l'avatar)
- Panneau **santé des intégrations**

## Hors V1 (Phase 2)
Funnel/leads (D) · vente Stripe (E) · dashboard analytics avancé (F) · DM automation ·
auto-post réseaux · affiliation multi-réseaux · WhatsApp/Telegram · effet réseau · A/B testing · B-roll.

## Acquis à réutiliser (leçons du 1er build)
- HeyGen **v3** (`/v3/videos`, `/v3/voices`), TTS natif, **auto-résolution voix valide**
- Images **gpt-image-1** (dall-e-3 retiré) + upload Storage
- Queue maison + pattern `poll_video`
- Couche vivante (Open-Meteo, mémoire) — validée
