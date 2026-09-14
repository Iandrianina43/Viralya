# Audit de production — 7 septembre 2026

Demande de Jérôme : « vérifie tout pour un SaaS ultra complet prêt pour la prod : UX/UI, gestion des
organisations, les points oubliés ». Trois audits ont été menés sur le code (interface, organisations
et authentification, pipeline et exploitation) : 142 constats au total. Ce document liste ce qui a été
corrigé le jour même, ce qui reste à faire par priorité, et ce qui dépend d'une décision.

## 1. Corrigé le 7 septembre (commits « Audit de production »)

### Sécurité et comptes
- Clé admin : refus de démarrer en production si `ADMIN_API_KEY` est absente ou trop courte ; clés
  des fournisseurs de texte et d'images exigées ; `VITE_ADMIN_API_KEY` retiré du front et du runbook.
- Premier inscrit = admin plateforme **uniquement hors production** (en prod : `ADMIN_EMAIL`).
- Vérification de l'adresse e-mail à l'inscription (dès que l'e-mail est configuré : SMTP ou Resend) ; connexion refusée
  tant que l'adresse n'est pas confirmée.
- Mot de passe oublié (lien par e-mail, page `/reset`) ; l'admin peut aussi définir un mot de passe.
- Sessions : jeton de rafraîchissement stocké et utilisé automatiquement (plus de déconnexion toutes
  les heures) ; déconnexion révoquée côté serveur ; bannissement, suppression, changement de mot de
  passe effectifs immédiatement (cache de jetons purgé) ; les autres appareils sont déconnectés après
  un changement de mot de passe.
- Suppression de son propre compte (mot de passe exigé) avec nettoyage des espaces dont on est le
  seul propriétaire ; consentement CGU conservé lors des mises à jour de profil.
- Erreurs 5xx génériques côté client (le détail reste dans les journaux) ; en-têtes de sécurité
  dédoublonnés ; limiteur global par IP (900 requêtes / 5 min).
- Solde et historique du fournisseur vidéo réservés à l'admin plateforme.

### Organisations (espaces)
- Un admin d'espace ne peut plus rétrograder ni retirer un propriétaire ; transfert de propriété par
  un propriétaire ; quitter un espace ; supprimer un espace (nom retapé) ; quota de 3 espaces par
  compte (`MAX_ORGS_PER_USER`) ; nom borné (2-60 caractères).
- Invitations par e-mail (`org_invites`, acceptées automatiquement à l'inscription ou à la connexion).
- `x-org-id` inconnu → 403 (plus de repli silencieux vers un autre espace) ; impersonation admin
  journalisée ; journal d'audit `audit_log` (membres, rôles, bannissements, budget, suppressions).
- Espace personnel unique par utilisateur (`personal_of`, index unique).
- Interface : section « Espace » dans Paramètres (renommer, membres, rôles, inviter, retirer,
  quitter, supprimer, créer, changer d'espace).
- RLS activée sur les dix tables qui ne l'avaient pas (migration 0018).

### Argent (budget) et pipeline
- Budget vérifié et inscrit sur TOUS les appels payants : chat de création, fiche portrait, portrait,
  planche, échantillons de voix, décors, références, garde-robe, keyframes, scripts de format,
  campagnes UGC, transcription du clone, régénération complète, régénération d'un plan.
- Échec ou annulation → le registre ne garde que ce qui a réellement été rendu (0 si rien).
- Plans persistés après chaque soumission payante (une relance ne re-soumet jamais un plan payé) ;
  `retryJob` refuse un job en cours ; publication réelle sans nouvel essai automatique (doublons) ;
  seul un contenu « prêt à valider » peut être approuvé ; annulation respectée par tous les handlers.
- Délais d'attente sur les appels PiAPI et LLM ; plus de texte ou d'image factices en production ;
  rejets non gérés journalisés au lieu de tuer l'API ; arrêt propre sur SIGTERM ; contenus orphelins
  (sans job depuis 45 min) passés en échec ; `/health` = API, `/health/worker` = worker.
- Webhook Stripe : n'accepte que les paiements réglés et un forfait connu ; refuse de traiter sans
  journal d'idempotence.
- Cron V1 `plan_day` désactivé (remplacé par le pilote automatique du calendrier).

### Interface
- Confirmation avant chaque action payante, publique ou irréversible : clips rapides du Studio,
  contenu du jour, publication, refus, suppression de campagne, de référence, de tenue, de keyframe,
  d'entrée de calendrier, régénération du mois, déconnexion d'un réseau.
- Messages d'erreur lisibles (`errMsg`, plus de « Error: Error: … ») ; statuts en français
  (influenceurs, campagnes, éditeur) ; identifiants techniques et noms de variables serveur retirés
  des textes clients ; création d'influenceur utilisable sur mobile ; page 404 ; pages légales
  reliées depuis Paramètres et l'inscription, éditeur configurable (`LEGAL_EDITOR`).

## 2. À faire (par priorité)

### Fait le 14 septembre
- **Bucket de stockage privé + URLs signées** (`apps/api/src/lib/storage.ts`) : les URLs restent
  canoniques en base ; chaque réponse JSON est réécrite avec des URLs signées (3 h, cache serveur pour
  une URL stable entre deux rafraîchissements) ; les URLs signées renvoyées par le navigateur sont
  ramenées à la forme canonique ; PiAPI, ElevenLabs, contrôle visage et Zernio reçoivent des URLs
  signées longues (12 h / 24 h) ; ffmpeg et le ré-encodage téléchargent par le rôle de service.
  `STORAGE_PRIVATE=true` passe le bucket en privé au démarrage ; `scripts/storage-privacy.ts` pour
  l'état et le retour arrière. ⚠️ Le bucket est partagé entre le poste local et la prod.
- **Nettoyage du stockage** (`apps/api/src/lib/storageCleanup.ts`) : à la suppression d'un influenceur,
  d'un espace ou d'un compte, les fichiers du préfixe et ceux qu'il référençait sont supprimés, SAUF ce
  qu'une autre ligne en base référence encore (les portraits vivent sous `<org_id>/faces/`, la photo
  produit d'une campagne sous l'influenceur qui l'a téléversée) ; balayage quotidien des sources de clone
  de plus de 7 jours sans contenu en cours ; `scripts/storage-cleanup.ts` : rapport des préfixes orphelins
  (rien en base ne les référence) et purge explicite.
- **Réservation atomique du budget** : fonction SQL `reserve_usage` (migration **0020**, verrou sur la
  ligne de l'organisation, somme du mois + insertion dans la même transaction) appelée par `recordUsage`
  AVANT toute création de contenu ; réservation rattachée au contenu ensuite (`attachUsage`), rendue si
  rien n'est lancé (`releaseUsage`). Sans la migration : ancien chemin, journalisé une fois.
- **Annulation côté fournisseur** : annuler un contenu envoie `DELETE /api/v1/task/{id}` à PiAPI pour
  chaque tâche en vol ; PiAPI n'annule que les tâches encore en attente (doc vérifiée le 14 sept.), celles
  déjà en rendu vont au bout et restent facturées — le compte rendu de l'annulation le dit.

### P1 — avant d'ouvrir à des clients payants
- **`DEFAULT_MONTHLY_BUDGET_USD=0`** en production le jour de l'ouverture (forfait obligatoire).
- **Sauvegardes** : vérifier le plan Supabase (PITR) et documenter la restauration.

### P2 — important
- Fusion des relances : un rendu qui dépasse le délai de suivi (25 min) est marqué en échec alors
  que les clips peuvent encore arriver → re-vérifier les tâches avant d'échouer.
- ~~Coûts réels pour les photos, carrousels et stories~~ (fait le 14 sept. : chaque image payée remplace l'estimation ; sans prix connu du fournisseur, 0,05 $ par image marqué `cost_estimated`).
- ~~Barre d'onglets par influenceur, entrée « Calendrier » dans le menu (page `/calendar` sur `GET /calendar/upcoming`), reste de crédits dans la barre du haut et estimations en crédits avant de lancer~~ — fait le 14 sept.
- ~~Accessibilité des modales (rôle dialog, Échap, focus, retour du focus)~~ — fait le 14 sept. États de chargement : faits le 7 sept.
- ~~Grille du calendrier et panneau latéral sur mobile~~ (fait le 14 sept. : liste par jour sous 640 px, panneau en feuille du bas) ; zone d'actions des cartes influenceur.
- Journalisation des requêtes (identifiant de requête, coût par job) ; `max_attempts` par type de job.
- ~~`Content-Security-Policy` ; jeton en cookie httpOnly plutôt qu'en localStorage~~ — fait le 14 sept. (cookies `viralya_session` / `viralya_refresh`, garde d'origine sur les écritures, en-tête Bearer conservé pour les scripts ; CSP dans `routes/index.ts`).
- ~~Recherche d'utilisateur par e-mail au-delà de 1 000 comptes~~ — fait le 14 sept. (pagination Supabase dans `auth/auth.ts` : `findUserByEmail`, `listAllUsers`, `usersByIds` ; recherche `?q=` dans Réglages).
- ~~Vocabulaire unifié (« influenceur » partout, plus « avatar »)~~ — fait le 14 sept. dans les textes visibles (pages, messages d'erreur, journal de production). Reste : noms de fournisseurs hors des écrans clients (ElevenLabs, Seedance, Kling restent affichés dans le Studio).

### P3 — amélioration
- Fuseau horaire en liste déroulante ; pause des rafraîchissements quand l'onglet est caché ;
  pagination des contenus ; téléchargement des médias via l'API ; brouillons de l'assistant ;
  migration `schema_migrations` avec refus de démarrer si une migration manque.

## 3. Décisions et actions qui t'appartiennent
1. Migrations : toutes appliquées (0001 → 0022, vérifié le 14 sept.).
2. Poser `LEGAL_EDITOR` (raison sociale, adresse, contact) et faire relire les pages légales.
3. Poser la clé Stripe et les identifiants SMTP dans le `.env` du VPS.
4. Publication réelle : **Zernio retenu et codé le 7 septembre** (voir docs/RECHERCHE-PUBLICATION.md § 5). À faire :
   créer le compte Zernio, poser `ZERNIO_API_KEY` et `ZERNIO_WEBHOOK_SECRET`, appliquer la migration **0019**.
5. Tarifs : spec de Jérôme corrigée sur les coûts réels le 14 sept. → **docs/TARIFICATION-CREDITS.md** (1 crédit = 0,10 $, quotas de packs à valider).
6. Brancher un moniteur externe sur `/health` et `/health/worker`.
