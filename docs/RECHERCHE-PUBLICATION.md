# Recherche publication réelle & analytics — 6 septembre 2026

Phase 4 du plan (BRIEF § 21). Recherche web du 6 septembre 2026 sur les API officielles et les
agrégateurs. **V** = lu sur la doc officielle, **T** = source tierce 2026, **NF** = non trouvé.

## 1. API officielles — l'essentiel pour Viralya

| Réseau | API | Compte requis | Validation | Programmation native | Label IA | Statistiques |
|---|---|---|---|---|---|---|
| Instagram | Content Publishing (`/media` → `/media_publish`), login Instagram sans page Facebook possible | professionnel (Business/Creator) | Advanced Access + vérification entreprise ; Meta annonce 2-3 jours (V), praticiens 2-6 semaines (T) | non (conteneur valable 24 h) | `is_ai_generated=true` (V) ; depuis le **31 août 2026** un profil mettant en scène une personne IA doit activer le label « profil généré par IA » sinon perte de portée (T, TechCrunch) | `/{media}/insights` : views, reach, likes, comments, shares, saved, temps de visionnage Reels ; **retard jusqu'à 48 h** (V) |
| TikTok | Content Posting API, Direct Post (`video.publish`) | tout compte | audit obligatoire, sinon posts privés et 5 utilisateurs/24 h (V) ; 1-4 semaines (T) | non | `post_info.is_aigc=true` (V, irréversible) | `video.list` : vues, likes, commentaires, partages (V), pas de temps de visionnage |
| Facebook Pages | `/videos`, `/video_reels` | Page | même review que Meta | **oui** (`scheduled_publish_time`, Reels ≤ 29 j) (V) | NF | `/video_insights` (V) |
| LinkedIn | Posts API + Videos API | profil (Share on LinkedIn) ou Page (Community Management, vérifié) | pas de review pour un membre ; refresh tokens réservés aux partenaires (V) | non | NF (C2PA affiché automatiquement, T) | analytics membre partenaires seulement |
| YouTube Shorts | Data API `videos.insert` | toute chaîne | **audit de conformité obligatoire sinon vidéos forcées en privé** (V) | **oui** (`publishAt`) (V) | `status.containsSyntheticMedia` (V) | Analytics API, quelques jours de retard (V) |

Limites à respecter : Instagram 100 publications API / 24 h par compte, Facebook 30 Reels / 24 h,
YouTube 100 uploads / jour par projet (depuis le 1er juin 2026), TikTok 6 init/min par utilisateur.

## 2. Agrégateurs (éviter 3 audits séparés)

| Service | Tarif sept. 2026 | Profils utilisateurs finaux (multi-tenant) | Label IA |
|---|---|---|---|
| **Ayrshare** | Premium 149 $/mois (1 profil), Launch 299 $ (10), Business 599 $ (30) puis 8,99 $/profil (T) | oui : User Profiles + `Profile-Key` + page de liaison en marque blanche | `tikTokOptions.isAIGenerated`, `instagramOptions.isAIGenerated` (T) |
| **Zernio** (ex-Late) | à l'usage : 1-2 comptes gratuits, 3-10 → 6 $/compte, 11-100 → 3 $, 101+ → 1 $ (V) | oui, OAuth hébergé, marque blanche | `video_made_with_ai`, `isAiGenerated` |
| **upload-post** | Basic 24 $ (5 profils) … Business 525 $ (225) (T, incohérences entre sources) | oui dès Professional | `is_aigc` |
| Post Bridge | 29-99 $ + API 5 $ | NF | `is_aigc` (T) |
| Publer / Buffer / SocialBu / Zapier | 5-200 $ | **non** (clé personnelle, pas d'OAuth tiers) ; Zapier ne publie pas sur TikTok | NF |

Tous exigent un compte Instagram professionnel et héritent des plafonds des plateformes.

## 3. Architecture retenue

- **Interface `Publisher`** (`providers/publisher.ts`) : publication simulée (compte social interne, défaut)
  et **Zernio** (retenu le 7 septembre 2026, voir § 5 ; Ayrshare, jamais activé, a été retiré du code).
  Coût plateforme pour 50 influenceurs × 4 réseaux : Zernio ≈ 8 × 6 + 90 × 3 + 100 × 1 = 418 $/mois,
  Ayrshare ≈ 780 $/mois.
- **Machine d'états** (existante, enrichie) : `needs_review → scheduled` (job `schedule`) →
  `publish` à l'heure prévue (file maison) → `published` avec `publish_provider`, `external_post_id`,
  `external_url` ; échec réel = contenu maintenu en `scheduled` avec l'erreur, jamais de faux « publié ».
- **Statistiques** : job `sync_stats` à +1 h, +6 h, +24 h, +72 h, +7 j après une publication réelle
  (Instagram compte jusqu'à 48 h de retard) ; stockées dans `content_items.stats.real`, la simulation
  dans `stats.simulated` (courbe logarithmique sur 72 h, déterministe).
- **Labels IA** : toujours envoyés (persona synthétique). Côté produit : rappel d'activer le label
  « profil généré par IA » Instagram et la mention en bio TikTok à la connexion d'un compte.
- Direct Meta plus tard (login Instagram sans page Facebook, insights plus riches, pas de frais par
  profil) une fois l'Advanced Access obtenu.

## 4. Obligations (voir aussi docs/RECHERCHE-UGC.md § 4)

- Loi n° 2023-451 (influence commerciale) : « Publicité » / « Collaboration commerciale » lisible
  pendant toute la durée ; **« Images virtuelles »** pour un visage ou une silhouette générés par IA.
- AI Act art. 50 applicable depuis le 2 août 2026 : un influenceur IA réaliste est un deepfake à
  signaler (lignes directrices de la Commission, juillet 2026) ; fiche ARPP août 2026 : « Contenu
  généré par IA », « Voix générée par IA ».
- TikTok : mise à jour des règles communautaires annoncée pour le **24 septembre 2026** (section IA à relire).
- YouTube : règle « contenu inauthentique » (juillet 2025) démonétise les chaînes IA répétitives.

## Non vérifié / à confirmer avant mise en production

Tarifs officiels Ayrshare et upload-post (pages bloquées), champs `isAIGenerated` d'Ayrshare (relevés
par des tiers), délais d'audit TikTok et YouTube, paramètre de label IA côté Facebook Pages et LinkedIn.

## 5. Zernio — mise en œuvre (7 septembre 2026)

Source : spec OpenAPI officielle 1.0.4 (`https://zernio.com/openapi.yaml`, 2,5 Mo, lue en entier pour les
parties utiles) et `https://zernio.com/llms.txt`. Tout ce qui suit est **V** (lu sur la doc officielle).

**Modèle.** Base `https://zernio.com/api/v1`, `Authorization: Bearer <clé>`. Un **profil** (`POST /profiles`,
noms uniques, `Idempotency-Key` accepté) n'accepte **qu'un compte par réseau** : un profil par influenceur,
c'est exactement « un influenceur = un Instagram + un TikTok + un YouTube + un Facebook ». Les comptes se
connectent par OAuth hébergé : `GET /connect/{platform}?profileId=&redirect_url=` renvoie `authUrl` ; au
retour, Zernio ajoute `connected=…&accountId=…&username=…` ou `error=…` (valeurs non exhaustives :
`oauth_denied`, `account_limit_exceeded`, `payment_required`, `no_facebook_pages`…). `GET /accounts?profileId=`
liste les comptes (`_id`, `platform`, `username`, `profileUrl`, `profilePicture`, `isActive`,
`needsReconnection`, `followersCount`) ; `DELETE /accounts/{id}` déconnecte (facturation au prorata).
Instagram : `loginMethod=instagram_login` par défaut (compte professionnel, **sans page Facebook**).

**Publication.** `POST /posts` `{content, mediaItems[{type, url}], platforms[{platform, accountId,
platformSpecificData}], publishNow, tags, metadata, tiktokSettings}`. Les médias doivent être des URL
**https publiques** (Zernio recompresse au besoin, > 200 Mo non garanti). Les hashtags ne sont PAS ajoutés
automatiquement : ils sont dans `content`. Idempotence : en-tête `x-request-id` (UUID, fenêtre 5 min →
renvoie `existingPost`) + rejet 409 du même contenu sur le même compte dans les 24 h. Réponse : `post.status`
(`scheduled | publishing | published | failed | partial`) et par plateforme `status`, `platformPostId`,
`platformPostUrl`, `errorMessage`. Plafonds anti-abus : 25 publications/h par compte, Instagram 100/jour,
TikTok 50/jour ; débit API 60 req/min (gratuit), 600 (payant). `metadata` est renvoyé tel quel dans les
webhooks (nous y mettons `viralya_content_id`).

**Labels IA et options par réseau.** Instagram `platformSpecificData.isAiGenerated` (Reels/feed/stories/
carrousels), `instagramThumbnail` pour la couverture d'un Reel. TikTok (`tiktokSettings`) :
`videoMadeWithAi`, `privacyLevel` **obligatoirement** parmi ceux de `GET /accounts/{id}/tiktok/creator-info`,
`allowComment/allowDuet/allowStitch`, `commercialContentType` (`none | brand_organic | brand_content`),
`contentPreviewConfirmed` et `expressConsentGiven` (le contenu est prévisualisé et approuvé par un humain
dans Viralya avant l'envoi). YouTube : `containsSyntheticMedia`, `title ≤ 100`, `visibility`,
`madeForKids`, `tags` (≤ 500 caractères) ; vidéos < 3 min détectées comme Shorts. Facebook :
`contentType: "reel"` (vidéo 9:16, 3-60 s) ; **aucun champ de label IA** (NF) → mention dans la légende.
X : 280 caractères, coûts API X refacturés à prix coûtant (non proposé dans l'interface).

**Statistiques.** `GET /analytics?postId=` : `impressions, reach, likes, comments, shares, saves, clicks,
views, engagementRate` ; 202 tant que la synchronisation est en attente, 424 si tout a échoué. Analytics et
abonnés inclus dans le tarif à l'usage (`hasAnalyticsAccess`).

**Webhooks.** `POST /webhooks/settings {name, url, secret, events}` ; signature = HMAC-SHA256 hex du corps
brut dans `X-Zernio-Signature`, identifiant stable dans `payload.id` / `X-Zernio-Event-Id`, livraison « au
moins une fois », 7 tentatives, réponse 2xx attendue en 5 s. Événements utilisés : `post.published`,
`post.failed`, `post.partial`, `post.platform.published`, `post.platform.failed`, `post.tiktok.url_resolved`
(l'URL TikTok arrive après coup), `account.connected`, `account.disconnected` (jeton expiré/révoqué).

**Tarif.** À l'usage, facturé par jour au prorata : comptes 1-2 gratuits, 3-10 → 6 $/compte/mois, 11-100 →
3 $, 101+ → 1 $ ; publications illimitées, analytics et boîte de réception inclus.

**Côté Viralya.** `avatars.publisher_profile_id` (profil Zernio), `social_connections` (une ligne par compte :
`external_account_id`, `handle`, `followers`, `status active|error`), `integration_events` (idempotence des
webhooks) — migration 0019. Le job `publish` envoie avec `publishNow`, puis suit l'état toutes les 45 s
(≤ 18 min) si Zernio répond « en cours » ; le webhook peut trancher avant. Un échec laisse le contenu en
« scheduled » avec l'erreur. Le webhook est enregistré automatiquement au démarrage de l'API
(`ensureZernioWebhook`) quand `ZERNIO_API_KEY` et `ZERNIO_WEBHOOK_SECRET` sont posées et que l'URL publique
n'est pas localhost. Reste manuel : label « profil généré par IA » sur Instagram, mention IA dans la bio TikTok.
