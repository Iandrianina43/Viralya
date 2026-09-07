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
- Vérification de l'adresse e-mail à l'inscription (dès que Resend est configuré) ; connexion refusée
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

### P1 — avant d'ouvrir à des clients payants
- **Bucket de stockage privé + URLs signées** : aujourd'hui toutes les vidéos, photos produit et
  sources de clone sont lisibles par quiconque a l'URL. Chantier transversal (toutes les URL en base).
- **Nettoyage du stockage** : rien n'est jamais supprimé (versions, keyframes, sources ≤ 200 Mo).
  Suppression du préfixe à la suppression d'un avatar/contenu + purge des sources après 7 jours.
- **Réservation atomique du budget** (deux lancements simultanés passent le même plafond) : RPC SQL
  `sum(coalesce(actual, estimated))` + insertion conditionnelle.
- **Annulation côté fournisseur** : annuler un contenu n'arrête pas les rendus PiAPI déjà soumis.
- **`DEFAULT_MONTHLY_BUDGET_USD=0`** en production le jour de l'ouverture (forfait obligatoire).
- **Sauvegardes** : vérifier le plan Supabase (PITR) et documenter la restauration.

### P2 — important
- Fusion des relances : un rendu qui dépasse le délai de suivi (25 min) est marqué en échec alors
  que les clips peuvent encore arriver → re-vérifier les tâches avant d'échouer.
- Coûts réels pour les photos / carrousels (aujourd'hui estimation fixe non réconciliée).
- Barre d'onglets par influenceur (Studio · Bible · Calendrier · Compte · Journal) et entrée
  « Calendrier » dans le menu ; `GET /calendar/upcoming` et `GET /billing/usage` non exposés.
- Reste de budget affiché au moment de dépenser (puce dans la barre du haut).
- États de chargement (tableau de bord, influenceurs, campagnes, journal) et accessibilité des
  modales (rôle dialog, Échap, focus).
- Grille du calendrier et panneau latéral sur mobile ; zone d'actions des cartes influenceur.
- Journalisation des requêtes (identifiant de requête, coût par job) ; `max_attempts` par type de job.
- `Content-Security-Policy` ; jeton en cookie httpOnly plutôt qu'en localStorage.
- Recherche d'utilisateur par e-mail sans parcourir tout l'annuaire (au-delà de 1 000 comptes).
- Vocabulaire unifié (« influenceur » partout, plus « avatar ») et noms de fournisseurs hors des
  écrans clients.

### P3 — amélioration
- Fuseau horaire en liste déroulante ; pause des rafraîchissements quand l'onglet est caché ;
  pagination des contenus ; téléchargement des médias via l'API ; brouillons de l'assistant ;
  migration `schema_migrations` avec refus de démarrer si une migration manque.

## 3. Décisions et actions qui t'appartiennent
1. Appliquer les migrations **0017** puis **0018** dans Supabase.
2. Poser `LEGAL_EDITOR` (raison sociale, adresse, contact) et faire relire les pages légales.
3. Créer les comptes Stripe et Resend, poser les clés, vérifier le domaine d'envoi.
4. Publication réelle : **Zernio retenu et codé le 7 septembre** (voir docs/RECHERCHE-PUBLICATION.md § 5). À faire :
   créer le compte Zernio, poser `ZERNIO_API_KEY` et `ZERNIO_WEBHOOK_SECRET`, appliquer la migration **0019**.
5. Décider des tarifs des forfaits (indicatifs dans `domain/billing.ts`).
6. Brancher un moniteur externe sur `/health` et `/health/worker`.
