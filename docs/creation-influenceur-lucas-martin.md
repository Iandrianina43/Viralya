# Donner vie à Lucas Martin — Guide de création de l'influenceur IA

Objectif : passer de la fiche personnage (déjà en base) à un influenceur **visible et audible** :
un visage cohérent (HeyGen) + une voix (ElevenLabs) + les premières vidéos talking-head.

---

## Étape 1 — Le visage (référence visuelle unique)

**Ne pas** utiliser un avatar « stock » HeyGen comme identité principale : il est partagé avec
des milliers d'autres comptes → zéro crédibilité d'influenceur. Il faut un **visage propriétaire**.

### Option A (recommandée) : générer le portrait par IA puis créer un Photo Avatar HeyGen

Générer UNE image de référence (Midjourney, DALL-E, Ideogram…) avec ce prompt :

```
Portrait photo réaliste d'un homme français de 32 ans, entrepreneur,
cheveux bruns courts bien coiffés, barbe de 3 jours soignée, yeux marron,
sourire confiant et sympathique, col roulé noir premium, montre discrète,
arrière-plan flou bureau moderne lumineux style Dubaï,
lumière naturelle douce type golden hour, photo professionnelle LinkedIn,
appareil plein format, 85mm f/1.8, ultra-détaillé, photoréaliste
--ar 1:1 --style raw
```

Règles pour la cohérence long terme :
- **Garder LA même image de référence** pour tout (HeyGen, photo de profil réseaux, visuels).
- Générer 3-4 variantes d'angle/tenue **à partir de la même seed / même référence**
  (Midjourney : `--cref <url_image>` ; DALL-E : édition de l'image de référence).
- Archiver l'image maîtresse dans `assets/lucas-martin/reference.png` (source de vérité).

### Option B (plus rapide, moins unique) : générateur d'avatar IA intégré de HeyGen
HeyGen peut générer un visage inédit directement ("AI Avatar"). Correct pour tester,
moins de contrôle sur la cohérence multi-supports.

---

## Étape 2 — Créer l'avatar HeyGen

1. Créer un compte sur heygen.com (plan Creator ~29$/mois pour démarrer + accès API).
2. Menu **Avatars → Photo Avatar** (ou "Avatar IV") → uploader l'image de référence.
3. HeyGen génère l'avatar animable (tête, regard, lèvres synchronisées).
4. Récupérer la clé API : **Settings → API** → `HEYGEN_API_KEY` dans le `.env`.
5. L'`avatar_id` apparaîtra automatiquement dans la console VIRALYA
   (Avatars → Éditer → "Avatar HeyGen" → menu déroulant).

## Étape 3 — Créer la voix ElevenLabs

1. Compte elevenlabs.io (plan Starter ~5$/mois suffit pour démarrer).
2. **Voices → Voice Library** → chercher une voix **homme, français, 30-35 ans,
   énergique mais posée** (pas besoin de cloner une vraie voix pour un personnage fictif —
   c'est même préférable légalement). L'ajouter à "My Voices".
3. Critères pour Lucas : débit naturel un peu rapide, chaleureux, articulation nette
   (le ton "cash, simple, pédagogue" vient du script, la voix doit juste être crédible).
4. Récupérer la clé API : profil → **API Keys** → `ELEVENLABS_API_KEY` dans le `.env`.
5. La voix apparaîtra dans la console (Avatars → Éditer → "Voix ElevenLabs").

## Étape 4 — Activer dans VIRALYA

1. `.env` : renseigner `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY` (+ `VIDEO_PROVIDER=heygen`).
2. Relancer l'API (`pnpm dev:api`).
3. Console → **Avatars → Éditer Lucas Martin** → section "Intégrations média" →
   sélectionner la voix + l'avatar HeyGen → Enregistrer.
4. **Avatars → "Générer le contenu du jour"**.
5. ~2-5 min plus tard : **Revue contenu** → la première vidéo talking-head de Lucas est là
   (script GPT → voix ElevenLabs → lèvres synchronisées HeyGen → MP4 stocké dans Supabase).
6. Approuver → planifier.

---

## Comptes réseaux sociaux (une fois les 3 premières vidéos validées)

- Créer les comptes **Instagram + TikTok** de Lucas Martin (email dédié par avatar).
- Bio : positionnement + **mention IA assumée** (ex. "Créateur IA 🤖 · Business & IA · 100% transparent")
  + lien vers `/capture/<avatar_id>` (la landing est déjà en ligne côté API).
- Photo de profil = l'image de référence (la même que l'avatar HeyGen).
- Publication : manuelle assistée au début (coller depuis la Revue contenu), Buffer/Publer ensuite.

## Budget de départ estimé

| Poste | Coût |
|---|---|
| HeyGen Creator | ~29 $/mois |
| ElevenLabs Starter | ~5 $/mois |
| Génération image référence | ~10 $ one-shot (ou inclus Midjourney) |
| LLM (scripts, via API) | ~5-15 $/mois au volume MVP |
| **Total démarrage** | **~40-60 $/mois** |

À 2 vidéos/jour le coût HeyGen peut monter (crédits API) — à surveiller le 1er mois réel.
