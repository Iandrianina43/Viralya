# Runbook — première vidéo de Lucas Martin

De « j'ai les clés » à « la vidéo est dans la Revue contenu ». ~30-40 min.

## 0. Sécurité (déjà fait)
- La clé HeyGen a été déplacée de `.env.example` → `.env` (privé, ignoré par git). ✅

## 1. Remplir `.env` (à la racine du projet)
Ouvre `D:\Travail\Jerome\Viralya\.env` et renseigne (ne mets JAMAIS ces valeurs dans `.env.example`) :

```
SUPABASE_URL=https://TON-PROJET.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # Supabase → Project Settings → API → service_role
ELEVENLABS_API_KEY=...                       # déjà obtenue
HEYGEN_API_KEY=sk_V2_...                      # déjà en place
VIDEO_PROVIDER=heygen
LLM_PROVIDER=anthropic                        # ou openai
ANTHROPIC_API_KEY=sk-ant-...                  # pour des scripts réels (sinon stub)
ADMIN_API_KEY=choisis-une-longue-chaine
```

Puis côté front : copie `apps/web/.env.example` → `apps/web/.env` (uniquement `VITE_API_BASE_URL` ; la clé admin ne doit JAMAIS être dans le front).

## 2. Appliquer les migrations Supabase
Dans Supabase → **SQL Editor**, colle et exécute dans l'ordre le contenu de :
`supabase/migrations/0001` → `0002` → `0003` → `0004` → `0005`.
(0003 = pg_cron : si erreur de droits, active l'extension via Database → Extensions, sinon on
déclenche à la main via l'endpoint admin — pas bloquant.)

Ça crée le schéma + **seed Lucas Martin** (déjà à Dubaï, avec sa mémoire de départ).

## 3. Créer le bucket de stockage (PUBLIC)
Supabase → **Storage** → New bucket → nom **`avatar-assets`** → cocher **Public**.
> Important : HeyGen doit pouvoir lire l'`audio_url` (voix ElevenLabs) → le bucket doit être public.

## 4. Créer le VISAGE de Lucas dans HeyGen (Photo Avatar)
1. Générer d'abord **le portrait de référence** (voir `creation-influenceur-lucas-martin.md`, prompt fourni) :
   un homme ~32 ans, col roulé noir, style entrepreneur Dubaï, photo portrait nette, face caméra.
2. HeyGen → **Avatars → Create → Photo Avatar** → uploader le portrait.
   (Photo nette, de face, bien éclairée, sans lunettes/accessoires masquants.)
3. Une fois créé, ouvrir l'avatar → **copier son `avatar_id`** (dans l'URL ou les détails).

> Alternative rapide pour un 1er test : utiliser un avatar « stock » HeyGen (identité provisoire).

## 5. Choisir la voix ElevenLabs
ElevenLabs → **Voice Library** → une voix **homme, français, 30-35 ans, énergique posée** →
« Add to My Voices » → copier le **`voice_id`**.

## 6. Lancer et générer 🎬
```
pnpm install     # si pas déjà fait
pnpm dev         # API :4000 (worker inline) + console :5173
```
1. Console → **Dashboard** : vérifier que « Voix » et « Vidéo » sont **verts**.
2. **Avatars → Éditer Lucas Martin** :
   - Ville : `Dubaï`, Fuseau : `Asia/Dubai` (déjà seedé)
   - Section « Intégrations média » : sélectionner la **voix ElevenLabs** + coller l'**avatar_id HeyGen**
   - Enregistrer
3. **Avatars → « Générer le contenu du jour »**.
4. **Revue contenu** : après quelques minutes (rendu HeyGen), la vidéo de Lucas apparaît en
   `needs_review`, avec sous-titres, sa voix, son visage — et un script daté (météo Dubaï, contexte).
5. Approuver → planifier.

## Si ça coince
- **Dashboard « Vidéo » gris** → clé HeyGen absente du `.env` ou API pas relancée.
- **Job `generate_video` en échec** → voir `GET /admin/jobs?status=failed` : le message d'erreur
  HeyGen exact s'y trouve (payload/avatar_id/quota). On ajuste le provider (`providers/video.ts`).
- **HeyGen n'accède pas à l'audio** → le bucket `avatar-assets` n'est pas public.
- **api.heygen.com injoignable** → dépend du réseau ; ça marche depuis une connexion normale
  (l'environnement de dev de l'assistant, lui, bloque ce host).
