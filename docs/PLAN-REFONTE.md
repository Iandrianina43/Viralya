# Viralya — Plan de refonte (audit, décisions, architecture, phases)

> Rédigé le 3 septembre 2026 en réponse à `docs/BRIEF.md`. Méthode imposée par le brief : audit → recherche → comparaison → architecture → implémentation. Rien ici n'est encore codé ; ce document est la base à valider avant la première ligne.

---

## 1. Audit de l'existant (code lu ligne à ligne, ~8 200 lignes TS, 11 migrations)

### 1.1 Ce qui fonctionne bout en bout (front → route → job → provider → base)

| Domaine | Ce qui existe | Fichiers |
|---|---|---|
| Authentification | Supabase Auth email/mot de passe, sessions Bearer, rôles admin/user, rate-limit anti brute-force, bootstrap admin depuis `.env`, gestion des utilisateurs | `apps/api/src/auth/auth.ts`, `routes/auth.ts`, `apps/web/src/auth.tsx` |
| Création d'influenceur | Chat IA en streaming qui remplit la fiche, fiche portrait structurée (20 champs) pré-remplie par l'IA, portrait GPT Image, choix de voix ElevenLabs avec écoute, finalisation → planche 8 vues + échantillons de timbre en tâche de fond | `domain/avatarChat.ts`, `domain/faceGen.ts`, `routes/avatars.ts`, `routes/avatarDrafts.ts`, `pages/CreateAvatar.tsx` |
| Univers (début de World Bible) | 5-6 lieux générés par Claude avec description canonique EN figée + image de référence sans personnage ; lieux permanents vs de passage | `domain/locations.ts`, migrations 0007/0008, `components/Universe.tsx` |
| Mémoire narrative | Faits, histoires en cours, événements, références de contenu, injectés dans chaque génération | `memory/memory.ts`, `pages/Journal.tsx` |
| Contexte vivant | Météo Open-Meteo, saison, moment de la journée, actualités de niche | `context/*` |
| File de jobs | Table `jobs`, claim atomique `claim_jobs_v2` (SKIP LOCKED), retry exponentiel 30 s → 1 h, 5 tentatives, worker inline ou séparé | `queue/*`, migrations 0001/0002/0011 |
| Pipeline vidéo Seedance | Histoire → scènes → segments chaînés (« Extend the video @video1 »), références portrait + planche + décor + voix, poll, concaténation FFmpeg | `domain/director.ts`, `handlers/generateVideo.ts`, `handlers/pollVideo.ts`, `providers/piapi.ts`, `lib/ffmpeg.ts` |
| Studio | Assistant de vlog (estimation de coût, aperçu des prompts, décors obligatoires), salle de production, clip rapide | `components/VlogWizard.tsx`, `components/ProductionRoom.tsx`, `pages/Studio.tsx` |
| Revue | Approuver → planifier (garde-fou vente ≤ 10 %), rejeter, relancer, annuler | `routes/content.ts`, `pages/ContentReview.tsx` |
| Dashboard | KPI, crédits PiAPI, historique d'usage et coûts | `pages/Dashboard.tsx`, `routes/admin.ts` |
| Génération quotidienne | `plan_day` à 06:00 via pg_cron : 1 vidéo + 2 hooks + 1 carrousel | `handlers/planDay.ts`, migration 0003 |

### 1.2 Ce qui est partiel ou de façade

- **Calendrier éditorial** : la table `content_calendar` ne contient que 7 thèmes par jour de semaine (seed). Aucune génération de calendrier, aucune interface calendrier, aucun arc narratif.
- **Publication** : `publish` change un statut, `schedule` pose une date. Aucun réseau connecté, aucune simulation visible.
- **Photos de l'influenceur** : `generate_image` (carrousels, stories) produit un « visuel business » générique sans le personnage ni ses références. Il n'existe donc aujourd'hui **aucune photo de l'influenceur** hors portrait.
- **Deux formats de scènes incompatibles** : `generate_text` produit des scènes `{text, role, background}` (héritage HeyGen) alors que `generate_video` attend `payload.production.scenes` du réalisateur (`director.ts`). Le chemin quotidien `plan_day → generate_text → generate_video` retombe donc sur un chemin dégradé ; seul le Studio produit des vidéos correctes.
- **Régénération ciblée** : « Régénérer » relance tout depuis le texte. Pas de régénération d'un seul plan.
- **Task Center** : `/api/admin/jobs` existe côté API mais aucune page ne l'affiche. La salle de production ne couvre que la vidéo en cours.
- **Versioning, contrôle qualité, onboarding, compte social simulé, campagnes UGC/Ads, analytics** : absents. Il n'y a pas de structure Ads dans le code aujourd'hui.

### 1.3 Risques et dettes

- **Pas de multi-tenant.** Aucune colonne `owner_id` ou `org_id`. Tout utilisateur connecté voit et modifie tous les influenceurs. La RLS est activée mais l'API passe par la clé service (bypass). Bloquant pour un SaaS.
- **Routes admin ouvertes à tout utilisateur connecté** : `adminAuth` accepte n'importe quelle session, pas seulement le rôle admin (`middleware/adminAuth.ts`).
- **Jobs orphelins** : un job `running` dont le worker meurt n'est jamais repris (aucun « reaper » sur `locked_at`).
- **Progression invisible** : les jobs n'ont ni `progress`, ni `logs`, ni annulation coopérative (l'annulation marque le contenu `failed`).
- **Colonnes mortes** : `avatars.video_avatar_id`, `voice_id`, `ref_angles` (migration 0009, jamais lu), table `assets` (jamais utilisée). Types `hook`/`tweet` et réseau `x` orientés « coach business » V1.
- **Docs obsolètes** : `README.md` et `docs/v1-scope.md` décrivent encore HeyGen/Argil.
- **Bucket public** : tous les assets (dont brouillons de visage) sont accessibles par URL.
- **Design** : Tailwind + Inter + orange `#f0562b`, deux classes utilitaires (`.card`, `.btn-primary`), pas de tokens, peu d'états vides/erreur, navigation à 4 entrées. Fonctionnel mais générique.

**Conclusion de l'audit** : le socle (auth, file de jobs, création d'influenceur, univers, pipeline Seedance) est solide et à conserver. Ce qui manque n'est pas une amélioration de pages : c'est la couche produit (bibles, calendrier, photos, versions, QC, tâches) et la couche SaaS (tenants, sécurité des routes).

---

## 2. Recherche et décisions techniques (sources vérifiées le 3 septembre 2026)

### 2.1 Cohérence d'identité en images (Character Bible)

Prix officiels relevés sur les pages des fournisseurs :

| Modèle | Accès | Réfs max | Prix / image | Notes |
|---|---|---|---|---|
| Gemini 2.5 Flash Image (« Nano Banana ») | Gemini API | quelques | **0,039 $** | prix officiel Google |
| Gemini 3.1 Flash Image (« Nano Banana 2 ») | Gemini API | à vérifier | **0,067 $** (1K) / 0,101 $ (2K) | prix officiel Google, modèle le plus récent |
| Gemini 3 Pro Image (« Nano Banana Pro ») | Gemini API | jusqu'à 14 (source secondaire) | **0,134 $** (1K/2K) / 0,24 $ (4K) | prix officiel ; réputé le meilleur sur la fidélité des visages (sources secondaires) |
| FLUX.2 [pro] edit | fal.ai | 9 | 0,03 $ + 0,015 $/MP supplémentaire (≈ 0,075 $ pour une 9:16 2 MP avec 2 réfs) | prix officiel fal |
| Seedream 4.5 | OpenRouter / fal | 14 | **0,04 $** | prix officiel, 1K à 4K |
| GPT Image 2 (24 juin 2026) | OpenAI (actuel dans Viralya) | 16 | facturation par tokens, ≈ 0,03–0,08 $ selon résolution ; **×2-3 avec références** (sources secondaires) | |
| LoRA visage (Flux) | fal.ai trainer | — | **2,40 $ par entraînement** (0,0024 $/pas, 1 000 pas min) + ≈ 0,03–0,05 $/image en inférence | consensus des guides : 85-95 % de cohérence, mais sources marketing |

Ce que disent les guides spécialisés (sources secondaires, à confirmer par test) : le LoRA reste la référence pour des **centaines** d'images d'un même personnage ; les modèles multi-référence suffisent pour des dizaines et n'exigent aucun entraînement. Une seule photo de face ne suffit jamais : il faut une planche (face, trois-quarts, profil, plan taille, plein pied).

**Décision proposée**
1. **Character Bible = pack de références validées**, pas un prompt : portrait neutre, trois-quarts, profil, plan taille, plein pied, 3 expressions, plus une **garde-robe** de 3 à 5 tenues canoniques avec image. Chaque référence est validée par l'humain et scorée automatiquement (ArcFace, voir 2.4).
2. **Génération des photos par modèle multi-référence** (plan A) avec la règle d'or : on ne réutilise jamais une sortie comme référence (dérive « photocopie de photocopie »).
3. **Le modèle exact se choisit par un banc d'essai, pas par un article** : mêmes 5 scènes × 4 modèles (Nano Banana Pro, Nano Banana 2, Seedream 5 Lite/Pro, GPT Image 2 en témoin), score ArcFace + jugement humain. Coût du banc : environ 2 à 3 $. **Aucune nouvelle clé nécessaire** : PiAPI (déjà intégré) expose Nano Banana 2 (0,06–0,12 $/img, jusqu'à 5 références de personnage), Nano Banana Pro (0,105–0,18 $/img), Seedream 5 Lite (0,052 $/img, 10 références) et Seedream 5 Pro (dès 0,068 $/img) — prix relevés sur les pages PiAPI le 3 septembre 2026. fal.ai ne servirait que pour FLUX.2 [pro] et l'entraînement de LoRA (plan B).
4. **LoRA en plan B / premium** (phase 3) pour les influenceurs qui dépassent ~100 images par mois : 2,40 $ l'entraînement à partir du pack de références validé.

Coût cible d'une photo : **0,04 à 0,13 $**. Trente photos par mois par influenceur : **1,2 à 4 $**.

**Résultat du banc d'essai (3 septembre 2026, 44 images, ≈ 3,25 $ PiAPI)** — score SFace (cosinus, seuil 0,363) contre le portrait de référence, deux influenceurs, cinq scènes :

| Modèle | Score moyen | Score min | Prix / img | Temps | Constat |
|---|---|---|---|---|---|
| GPT Image 2 (témoin) | 0,76 | 0,69 | ≈ 0,08 $ (×2-3 avec réfs) | 67 s | Meilleure fidélité brute, copie la tenue de référence, **compte OpenAI sans crédits** |
| **Seedream 5 Pro** | 0,72 (0,69 avec tenue imposée) | 0,65 | 0,071 $ | 64-82 s | **Retenu par défaut.** Suit une tenue décrite. Un artefact miroir observé → QC obligatoire |
| Seedream 5 Lite | 0,65 | 0,42 | 0,052 $ | 120 s | Irrégulier |
| Nano Banana Pro | 0,57 | 0,46 | 0,105 $ | 58 s | Rien de plus que Nano Banana 2 |
| **Nano Banana 2** | 0,56 | 0,41 | 0,06 $ | 50 s | **Second choix** : scènes les plus naturelles (rue, téléphone), visage un peu moins fidèle |

Règles retenues : décrire toujours la tenue (garde-robe) dans le prompt ; scorer chaque image (≥ 0,55 acceptée, 0,40-0,55 à revoir, < 0,40 régénérée) ; validation humaine finale. Outil : `tools/qc/face_score.py` (OpenCV YuNet + SFace, local, gratuit). Galerie : artifact « Banc d'essai photo Viralya ».

### 2.2 Vidéo : avatar qui parle, plans de coupe, lip-sync

| Besoin | Modèle | Accès | Prix vérifié | Remarque |
|---|---|---|---|---|
| Avatar parlant (image + mp3) | Kling Avatar standard | PiAPI (déjà intégré) | 0,052 $/s | vérifié lors de la session précédente |
| Avatar parlant | InfiniteTalk | WaveSpeed | **0,03 $/s** (480p) / **0,06 $/s** (720p) | jusqu'à 10 min, page officielle |
| Avatar parlant | Wan 2.2 S2V | WaveSpeed | 0,03 $/s (480p) / 0,06 $/s (720p) | page officielle |
| Avatar parlant haut de gamme | OmniHuman 1.5 | fal.ai | **0,16 $/s** | page officielle, « film-grade » |
| Lip-sync sur une vidéo existante | Sync Labs lipsync-2 | sync.so / fal | 0,04–0,05 $/s | permet de synchroniser un clip Seedance/Hailuo sur l'audio ElevenLabs |
| Plans de coupe sans visage | Hailuo 2.3 fast | PiAPI | ≈ 0,027 $/s | vérifié lors de la session précédente |
| Cinématique premium | Seedance 2.0 mini 720p | PiAPI (déjà intégré) | 0,092 $/s | reste le pilier « vlog » hebdomadaire |
| Voix | ElevenLabs multilingual v2 / v3 | déjà intégré | ≈ 0,10 $ / 1 000 caractères (sources secondaires) | 15 s de parole ≈ 0,03 $ |

**Décision proposée**
- **La voix vient toujours d'ElevenLabs en premier** (fichier mp3 exact), la vidéo est synchronisée dessus. Fin des « échantillons de timbre » passés à Seedance, qui ne clone pas la voix.
- **Format par défaut = hybride** : avatar parlant en plan poitrine caméra fixe (Kling Avatar ou InfiniteTalk) + plans de coupe (Hailuo) + sous-titres incrustés. Coût d'une vidéo de 15 s : **≈ 0,55 $** contre 1,38 $ en Seedance intégral, avec un meilleur engagement d'après la recherche précédente (format présentateur + b-roll).
- **Seedance 2.0 reste pour le vlog cinématique** hebdomadaire, en génération unique multi-plans de 15 s maximum.
- **Régénération au plan** : chaque plan est une génération indépendante versionnée ; on ne refait jamais la vidéo entière.
- Sous-titres mot à mot par Whisper local (gratuit) ou timestamps ElevenLabs, incrustés par FFmpeg.

### 2.3 Calendrier éditorial et storytelling

Étude Metricool 2026 (24,3 millions de posts, 375 000 comptes, page officielle) :
- les Reels génèrent **plus de 4× les interactions** d'une image seule ; les carrousels **9× plus d'enregistrements** ;
- les images seules perdent **−46 % d'engagement** sur un an ;
- les posts avec une question font **+36,7 % de commentaires** ; les hashtags font **−31,7 % de vues** ;
- seuls **21 % des comptes de moins de 10 000 abonnés** progressent en 2026.

Cadence recommandée par les guides 2026 (sources secondaires convergentes) : 3-4 Reels + 2-3 carrousels par semaine, images seules quasi abandonnées ; TikTok 2-5 posts/semaine.

**Décision proposée : le calendrier est une structure, pas une liste.**
- **Piliers** (3-4 par influenceur, définis à la création) × **séries récurrentes** (ex. « Lundi routine », « Jeudi vérité ») × **arcs de 2-4 semaines** (voyage, projet, déménagement) qui traversent les posts.
- Mix mensuel type par influenceur : 12 Reels hybrides + 8 carrousels photo + 4 stories + 1 vlog cinématique + campagnes UGC à la demande. Coût de génération estimé : **≈ 12 à 18 $ par mois**.
- Chaque post porte une question ; pas de hashtags en masse ; label « contenu généré par IA » systématique (AI Act art. 50 applicable depuis le 2 août 2026, labels natifs Instagram/TikTok/YouTube).
- Le générateur prend en entrée : bible, univers, mémoire, arcs ouverts, contenu déjà publié, événements/saison, objectifs, campagnes.

### 2.4 Contrôle qualité automatique

| Contrôle | Méthode | Coût |
|---|---|---|
| Identité (photo ou frame vidéo vs portrait de référence) | InsightFace/ArcFace auto-hébergé (CPU suffit) ou AWS Rekognition CompareFaces | gratuit / **0,001 $ par image** (prix officiel AWS, 1 000 gratuites par mois) |
| Seuil « même personne » | similarité cosinus ≈ 0,5-0,6 (littérature ArcFace) ; à calibrer sur nos visages synthétiques | — |
| Artefacts (mains, texte, membres) | grille de notation par modèle vision (Claude) | ≈ 0,01 $ par image |
| Vidéo | extraction de frames FFmpeg → score identité par frame → détection de dérive ; durée, ratio, loudness EBU R128 | gratuit |
| UGC | produit visible (vision), hook/CTA présents (LLM), durée/format | ≈ 0,01 $ |

**Décision** : QC en deux niveaux. Niveau 1 automatique (bloque en dessous du seuil et propose la régénération), niveau 2 humain (file de revue avec score affiché). Le score n'est jamais une vérité absolue : il trie, l'humain tranche.

### 2.5 Publication (rappel de la recherche précédente)

Réseaux en veille : **publication simulée** (statut « programmé », aperçu dans le calendrier et sur le compte simulé). Quand on branchera : upload-post (≈ 24 $/mois) pour démarrer, Ayrshare pour le multi-client, API officielles ensuite (TikTok non audité = 5 utilisateurs, Instagram 100 posts/24 h).

### 2.6 Ce qui n'a pas pu être vérifié

- Fidélité réelle des visages de chaque modèle image : uniquement des sources secondaires → **banc d'essai obligatoire**.
- Nombre de références acceptées par Nano Banana 2 (Gemini 3.1 Flash Image).
- Tarif ElevenLabs par caractère (sources secondaires ; cohérent avec les plans connus).
- Qualité du lip-sync **en français** d'InfiniteTalk et Wan S2V : à tester sur 5 s (≈ 0,30 $).

---

## 3. Architecture cible

### 3.1 Modèle de données (ajouts, sans casser l'existant)

```
organizations (id, name, plan)                      ← tenant
memberships (org_id, user_id, role)
avatars  + org_id, handle, bio, pillars[], status   ← l'influenceur
avatar_references (avatar_id, kind, url, validated, face_score, version)   ← Character Bible
avatar_wardrobe (avatar_id, name, description_en, ref_url, is_default)
avatar_locations (existant) + time_variants jsonb                            ← World Bible
avatar_keyframes (avatar_id, location_id, framing, outfit_id, url, validated) ← cache
social_accounts (avatar_id, platform, handle, bio, followers, stats jsonb, simulated)
content_arcs (avatar_id, title, starts_on, ends_on, beats jsonb, status)
content_plans (avatar_id, month, strategy jsonb, generated_by)
content_items + planned_for, format, pillar, arc_id, plan_id, current_version
content_versions (content_item_id, version_no, payload, assets, prompts, created_by, note)
productions (content_item_id, script, shot_list jsonb)
shots (production_id, idx, role, prompt, refs jsonb, provider, task_id, clip_url, qc jsonb, version_no)
campaigns (org_id, avatar_id, brand, product, objective, angle, hooks[], cta, brief jsonb)
qc_reports (target_type, target_id, checks jsonb, score, passed, reviewed_by)
jobs + kind, progress, logs jsonb, cancel_requested, heartbeat_at
```

Statuts de jobs exposés à l'utilisateur : PENDING / PROCESSING / COMPLETED / FAILED / CANCELLED (mapping sur `pending/running/done/failed/canceled` existants).

### 3.2 Pipeline de production (par vidéo)

```
concept → brief → script (ElevenLabs mp3 d'abord) → shot list (rôle par plan : talk | broll | product)
  → références par plan (portrait/planche/tenue/décor/keyframe) → génération par plan (provider selon rôle)
  → QC automatique par plan → régénération ciblée → sélection → montage FFmpeg + sous-titres → export → revue humaine
```

Providers par rôle : `talk` → Kling Avatar / InfiniteTalk ; `broll` → Hailuo ; `cinematic` → Seedance 2.0 ; `photo` → modèle image multi-réf ; `voice` → ElevenLabs.

### 3.3 Application

- **Navigation par influenceur** : Dashboard org → Influenceur (Profil simulé · Bible · Univers · Calendrier · Contenus · Campagnes · Tâches).
- **Task Center** global et par influenceur : en cours (progression, logs), à venir (planifiés), terminées, échouées avec relance.
- **Revue** : lecteur intégré, score QC, régénérer ce plan, modifier le script/prompt, historique des versions.
- **Onboarding** : parcours guidé en 6 étapes calé sur le parcours du brief, avec état d'avancement persistant.
- **Design** : système de tokens (couleurs, type, espacements, états) partagé avec le brief déjà livré (papier clair, encre, un accent, typographies Archivo / Newsreader / IBM Plex Mono), composants de base (table, card, calendar, modal, toast, empty/loading/error).

---

## 4. Phases proposées

| Phase | Contenu | Durée estimée | Coût IA |
|---|---|---|---|
| **0 — Fondations SaaS** ✅ fait le 3 sept. | organisations + `org_id` partout, middleware de scoping, routes admin réservées au rôle admin, jobs robustes (reaper, heartbeat, progress, logs, annulation), Task Center, table de versions, tokens de design + composants de base, README/docs à jour — migration 0012 appliquée, vérifié en réel | 1 jour | 0 $ |
| **1 — Character Bible & photos** ✅ fait le 3 sept. (soir) | banc d'essai (Seedream 5 Pro retenu), images basculées sur PiAPI (`providers/piapiImage.ts`), QC visage local (`tools/qc`, `lib/qc.ts`), pack de références + garde-robe (`domain/characterBible.ts`), pipeline photo `generate_photo` avec QC et régénération auto, **cache de keyframes** (`domain/keyframes.ts` : trio décor + tenue + cadrage généré une fois, validé auto si visage ≥ 0,55, réutilisé comme référence des photos du même décor, 0 $ au second appel — vérifié en réel), **feed photo** par influenceur, page Bible complète. Règle QC ajoutée : sous 12 % de hauteur d'image le score SFace n'est pas fiable → « à vérifier » sans régénération payante (photo plan large du 3 sept. : 0,30 pour un visage pourtant fidèle). Migrations 0012→0014 appliquées | fait | ≈ 4,5 $ dépensés |
| **2 — Vidéo v2** 🔧 v2.4 du 4 sept. (17 h) : **prise unique Seedance 2.5** (un rendu de ≤ 30 s, monologue naturel de 50-65 mots, sous-titres off) testée en 480p : tenue constante, récit continu, 3,70 $ — verdict utilisateur attendu ; 720p dès recharge PiAPI. v2.3 : **Seedance 2.5 par défaut** (plans parlés à voix native + plans de coupe narrés, 720p 0,385 $/s, 1080p 0,88 $/s), sous-titres par transcription Scribe recalée sur le script, limite PiAPI de 2 tâches simultanées gérée. Test « Callos » 32 s ≈ 13 $ validé visuellement (docs/RECHERCHE-VIDEO-V2.md § 8-9). Historique : v2.1 testée en réel le 4 sept. (contenu « Test v2 — Le grelot de Santa Cruz », Voahangy) : 5 plans (3 OmniHuman + 2 Seedance), 19,7 s, 2 inserts, sous-titres karaoké, musique, tenue identique partout, **≈ 2,5 $ réels** (OmniHuman 1,56 + Seedance 0,74 + keyframes 0,15 + musique 0,06). Visages 0,48-0,56 sur balcon de nuit (« à vérifier », éclairage). Verdict utilisateur : lip-sync OK, mais qualité vidéo « pas top », inserts hors sujet, histoire incohérente → v2.2 le même jour (voir docs/RECHERCHE-VIDEO-V2.md § 7) : monologue autonome et contexte réel non forcé, inserts « illustration » de ce dont elle parle, keyframe parlé 9:16 2K, grain retiré, Lanczos ; limite établie : OmniHuman sur PiAPI plafonne ≈ 1,2 Mpx (1080p natif = fal.ai). Reste : A/B modèles image, b-roll moins cher, clé fal.ai si le piqué ne suffit pas | **Retour utilisateur du 4 sept. (01 h) : « tenue qui change, avatar raide, lip-sync pas crédible, montage plat, ça fait IA, sous-titres moches, texte creux ».** Recherche web (docs/RECHERCHE-VIDEO-V2.md) → corrections : (1) bug de continuité de tenue (le b-roll cherchait un keyframe sans tenue) ; (2) **OmniHuman 1.5 par défaut** — Kling AI Avatar ne liste officiellement que EN/JA/KO/ZH et PiAPI décrit lui-même son mode std comme « stiff, fixed hands » ; (3) réalisateur : règles hybride (accroche ≤ 8 mots, plans parlés 3-7 s, plans de coupe 2-5 s, alternance, inserts ancrés sur les mots) + interdits d'écriture ; (4) inserts photo Ken Burns pendant la parole (keyframes en cache) ; (5) sous-titres karaoké Poppins ExtraBold dans la zone sûre ; (6) musique Eleven Music instrumentale (0,15 $/min, droits commerciaux plan Creator, testé) ; (7) grain léger + plafond 8 Mbit/s ; (8) prompts « photo de téléphone ». Montage validé hors ligne le 4 sept. (36 s, 0 $). **Test E2E réel du premier pipeline (Voahangy, « Test hybride — ruelle de Santa Cruz », 2 plans)** : voix ElevenLabs v3 6,1 s + 5,6 s ; keyframe réutilisé (0 $) ; plan parlé Kling Avatar std prêt en ≈ 7 min, visage 0,66 (pass), 0,36 $ ; b-roll Seedance refusé 3× en variante standard (« Content moderation violation. », références = personne réaliste) → **repli automatique en `-less-restriction`** ajouté puis vérifié par régénération du plan : rendu en 14 min (bien plus long que les 2-8 min usuels), 0,64 $ ; remontage `video-v2.mp4` 14,2 s 1080×1920 sous-titré, versions figées (« Avant régénération du plan 2 »). Coût réel de la vidéo : **1,00 $** pour 14 s (estimation 1,23 $). Pipeline hybride livré : `generate_voice` (ElevenLabs v3 + mots horodatés) → `generate_shots` (keyframe + Kling Avatar / OmniHuman en lip-sync ; b-roll Seedance muet) → `poll_shots` (parallèle, QC visage, 3 essais, montage ffmpeg avec voix off mixée et sous-titres ASS) → `assemble`. Plans dans `assets.shots`, régénération d'un plan (texte modifiable) avec version figée. Assistant : choix du format et du moteur, estimation ; salle de production : plans, voix, score visage, régénérer. **Constat du 3 sept. (utilisateur) : le français parlé des vidéos Seedance est mauvais. Cause vérifiée (doc PiAPI) : Seedance 2.0 synthétise lui-même la parole ; les audios de référence ne guident que le rythme, la voix ElevenLabs n'est jamais reproduite.** Décision : ElevenLabs v3 génère la voix française → vidéo pilotée par cet audio (Kling AI Avatar std 0,052 $/s via PiAPI, champ `local_dubbing_url` ; OmniHuman 1.5 0,13 $/s) à partir d'un keyframe ; Seedance réservé aux plans b-roll muets et au vlog ; montage FFmpeg + sous-titres. Banc `apps/api/scripts/bench-talking.ts` du 3 sept. (Voahangy, keyframe Séville, phrase FR ElevenLabs v3 de 9 s) : **Kling Avatar std** 1232×1648 30 fps, 352 s, 0,47 $, identité 0,58–0,67 sur images ; **OmniHuman 1.5** 960×1280, 308 s, 1,17 $, identité 0,54–0,62, plus démonstratif (rire, gestes amples). Les deux gardent décor et tenue du keyframe et embarquent la piste ElevenLabs telle quelle. Jugement du français et du lip-sync : à l'oreille par l'utilisateur (fichiers dans Storage `bench/talking/`) | 1-2 semaines | ≈ 10 $ de tests |
| **3 — Calendrier, compte simulé, UGC, onboarding** ✅ codée et smoke-testée le 6 sept. 2026 (migration 0016 appliquée ; calendrier d'octobre de Voahangy : 24 entrées et 2 arcs ; campagne Terra Café : 2 scripts ; publication simulée) — reste : validation utilisateur dans l'interface | Migration `0016_phase3_calendar_social_ugc.sql`. **Calendrier** : `domain/calendar.ts` (stratège LLM : piliers, séries, arcs, planning jour par jour, mix et 70/20/10, lieux de l'univers, mois précédent non répété), job `generate_plan`, routes `/api/calendar`, page `/avatars/:id/calendar` (grille, stratégie, édition, ajout, ignorer, produire — vidéo = histoire + prise unique Seedance 2.5, photo/carrousel/story = pipelines existants ; statut synchronisé par `assemble`, `schedule`, `publish`). **Compte social** : `domain/social.ts` (profil par réseau avec bio LLM et audience de départ, statistiques finales déterministes par contenu + courbe de progression 72 h, feed, publication simulée), routes `/api/social`, page `/avatars/:id/social`, « Publier maintenant » dans la revue ; `schedule` enfile désormais `publish` à l'heure prévue. **UGC** : `domain/ugc.ts` (structure 7 temps, budgets de secondes par durée, 10 mécanismes d'accroche, nommage lisible, scripts LLM par influenceur × durée, `scenesFromScript` → prise unique ≤ 30 s ou 2 prises, produit = image de référence Seedance, mentions légales incrustées `labels.ass`), routes `/api/ugc`, page `/ugc`. **Onboarding** : `components/Onboarding.tsx` (8 étapes auto-cochées). `domain/production.ts` factorise le lancement (assistant, calendrier, UGC). Recherche : docs/RECHERCHE-UGC.md | fait en 1 jour | ≈ 0,15 $ par calendrier ou campagne scriptée |
| **4 — Publication réelle & analytics** 🔧 socle codé le 6 sept. 2026 (à activer avec une clé) | Recherche docs/RECHERCHE-PUBLICATION.md (API officielles, agrégateurs, obligations). `providers/publisher.ts` : interface + `AyrsharePublisher` (POST /post avec `Profile-Key`, labels IA TikTok/Instagram, `/analytics/post`), `social_connections` (un profil par influenceur), `publish` réel avec identifiants externes et échec explicite, job `sync_stats` (+1 h, +6 h, +24 h, +72 h, +7 j), UI de connexion dans le compte social. Non fait : OAuth direct Meta/TikTok/YouTube (audits), C2PA dans les fichiers, label « profil IA » Instagram (manuel) | activation : clé Ayrshare (149-599 $/mois) ou Zernio (1-6 $/compte) | abonnement |

---

## 5. Décisions à valider avant de coder

1. **Multi-tenant par organisation dès la phase 0** (recommandé : plus on attend, plus c'est cher) ou plus tard.
2. **Banc d'essai image sur PiAPI** (clé déjà en place, budget ≈ 3 $). fal.ai seulement si l'on veut ajouter FLUX.2 [pro] ou entraîner des LoRA plus tard.
3. **Format hybride par défaut** (avatar parlant + b-roll) et Seedance réservé au vlog hebdomadaire.
4. **Direction de design** : reprendre l'identité du brief (papier / encre / un accent, sans dégradés ni cartes arrondies partout) pour l'application.
5. **Ordre des phases** : 0 → 1 → 2 → 3, ou 0 → 2 → 1 → 3 si la vidéo doit être montrée en premier.

Sources principales : pages tarifaires officielles Google Gemini API, fal.ai (FLUX.2 pro, OmniHuman 1.5, Flux LoRA trainer), OpenRouter (GPT Image 2, Seedream 4.5), WaveSpeed (InfiniteTalk, Wan 2.2 S2V), AWS Rekognition, communiqué Metricool 2026 ; guides secondaires pour les cadences et le LoRA (signalés comme tels).
