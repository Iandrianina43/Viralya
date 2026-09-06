# VIRALYA — Brief produit (référence permanente)

> Document de cadrage rédigé le 3 septembre 2026. Il prime sur `v1-scope.md` (périmètre historique) et doit être relu avant toute décision importante d'architecture, de workflow IA ou de méthode de génération.

---

# VIRALYA — Construire un SaaS complet de création et gestion d'influenceurs IA

Je veux transformer **Viralya** en un véritable SaaS complet, moderne, robuste et prêt pour la production.

Il ne s'agit PAS simplement d'améliorer quelques pages existantes.

Je veux que tu analyses le produit dans son ensemble et que tu construises **le système complet permettant de créer des influenceurs virtuels, construire leur univers, planifier leur contenu, générer les assets, contrôler leur cohérence, valider les contenus et produire les vidéos finales prêtes à être publiées.**

---

# ⚠️ RÈGLE ABSOLUE : NE TRAVAILLE PAS À L'AVEUGLE

**C'est l'une des règles les plus importantes de ce projet.**

Tu ne dois pas partir du principe que la première méthode qui te vient à l'esprit est la bonne.

Avant toute décision importante concernant une technologie, une architecture, un workflow IA ou une méthode de génération, demande-toi :

> **Existe-t-il actuellement une meilleure méthode utilisée par les professionnels ou les meilleurs produits du marché ?**

Si oui, **fais des recherches sur Internet avant d'implémenter.**

### Processus obligatoire

Pour les problèmes importants :

**PROBLÈME → RECHERCHE → COMPARAISON → VALIDATION → ARCHITECTURE → IMPLÉMENTATION**

Ne fais pas :

> « Je pense que cette méthode devrait fonctionner, donc je vais la coder. »

Fais plutôt :

> « Voici le problème. Je vais vérifier comment les meilleurs systèmes le résolvent actuellement, comparer les approches et choisir celle qui correspond le mieux à Viralya. »

---

# 🔎 RECHERCHE INTERNET

Utilise activement la recherche Internet lorsque cela peut améliorer le résultat.

En particulier pour :

* cohérence des visages IA ;
* cohérence d'un personnage sur plusieurs images ;
* cohérence d'un personnage sur plusieurs vidéos ;
* Character Bible ;
* références visuelles ;
* références d'environnement ;
* cohérence des vêtements ;
* cohérence des accessoires ;
* génération image IA ;
* génération vidéo IA ;
* image-to-video ;
* reference-to-video ;
* talking head ;
* lip-sync ;
* voix IA ;
* UGC IA ;
* génération de scripts ;
* génération de shot lists ;
* montage vidéo automatique ;
* génération de calendriers éditoriaux ;
* automatisation Instagram ;
* automatisation TikTok ;
* automatisation Facebook ;
* automatisation LinkedIn ;
* systèmes de queues/jobs ;
* background workers ;
* génération asynchrone ;
* stockage des médias ;
* versioning ;
* contrôle qualité ;
* coûts des APIs ;
* choix des modèles ;
* architecture SaaS scalable.

Les technologies IA évoluent très rapidement.

**Vérifie donc les informations actuelles avant de prendre une décision importante.**

Ne suppose pas qu'un modèle possède une capacité particulière : consulte sa documentation ou des sources fiables.

---

# 1. AUDITER L'APPLICATION EXISTANTE

Avant de modifier profondément Viralya :

* comprends l'architecture actuelle ;
* comprends le frontend ;
* comprends le backend ;
* comprends la base de données ;
* comprends les workflows existants ;
* identifie les fonctionnalités déjà fonctionnelles ;
* identifie les fonctionnalités incomplètes ;
* identifie les bugs ;
* identifie les parties qui doivent être refactorisées.

**Ne détruis pas inutilement ce qui fonctionne déjà.**

Construis à partir de l'existant lorsque c'est pertinent.

---

# 2. REFONDRE LE DESIGN

Revois l'ensemble du design de Viralya.

Je veux une interface qui ressemble à un **véritable SaaS premium moderne**.

Améliore notamment :

* navigation ;
* sidebar ;
* dashboard ;
* cards ;
* tableaux ;
* calendrier ;
* formulaires ;
* modales ;
* boutons ;
* feedback utilisateur ;
* loading states ;
* empty states ;
* error states ;
* animations ;
* transitions ;
* responsive ;
* hiérarchie visuelle.

Le produit doit être agréable et évident à utiliser.

Ne cherche pas uniquement à rendre l'interface « jolie ».

**L'UX doit guider naturellement l'utilisateur à travers le workflow.**

---

# 3. ONBOARDING

Créer un véritable onboarding.

Un nouvel utilisateur doit comprendre rapidement :

1. ce qu'est Viralya ;
2. comment créer son premier influenceur ;
3. comment construire son univers ;
4. comment créer son calendrier ;
5. comment générer du contenu ;
6. comment valider les générations ;
7. comment obtenir les vidéos finales ;
8. comment programmer/publier.

L'onboarding doit être interactif et intégré au produit.

---

# 4. PARCOURS UTILISATEUR PRINCIPAL

Le parcours principal que j'imagine est :

**Connexion**
↓
**Création d'un compte/influenceur**
↓
**Configuration de l'influenceur**
↓
**Génération de son écosystème**
↓
**Création de sa stratégie de contenu**
↓
**Génération du calendrier**
↓
**Génération des contenus**
↓
**Validation humaine**
↓
**Modification / régénération si nécessaire**
↓
**Montage final**
↓
**Programmation**
↓
**Publication**

Le système doit être conçu autour de ce parcours.

---

# 5. CRÉATION D'UN INFLUENCEUR

Je veux rendre la création d'un influenceur beaucoup plus fluide.

Exemple :

> Je veux créer une influenceuse lifestyle de 23 ans.

L'utilisateur ne doit pas devoir configurer manuellement 50 paramètres.

Le système doit l'aider à construire automatiquement son identité.

### Informations possibles

#### Identité

* prénom ;
* âge ;
* pays ;
* ville ;
* langue ;
* niche ;
* centres d'intérêt ;
* personnalité ;
* ton ;
* style de communication.

#### Apparence

* visage ;
* cheveux ;
* yeux ;
* teint ;
* morphologie ;
* caractéristiques physiques ;
* style vestimentaire ;
* accessoires.

#### Style

* esthétique ;
* photographie ;
* couleurs ;
* type de caméra ;
* type de lumière ;
* cadrages ;
* ambiance.

---

# 6. CHARACTER BIBLE

Le système doit créer une véritable **Character Bible**.

Elle doit servir de référence permanente à toutes les générations futures.

Elle peut contenir :

* description détaillée du personnage ;
* caractéristiques physiques ;
* références visuelles ;
* portraits de référence ;
* expressions ;
* coiffures ;
* styles vestimentaires ;
* accessoires ;
* personnalité ;
* manière de parler ;
* style de contenu ;
* contraintes de cohérence.

**Ne te contente pas d'un prompt texte.**

Recherche les meilleures méthodes actuellement utilisées pour maintenir un personnage cohérent et détermine l'architecture la plus fiable pour Viralya.

---

# 7. WORLD BIBLE / UNIVERS

Créer également un **World Bible**.

L'influenceur doit posséder un univers réutilisable.

Exemples :

* appartement ;
* chambre ;
* café préféré ;
* restaurant ;
* salle de sport ;
* rue ;
* hôtel ;
* plage ;
* ville ;
* lieux de vacances.

Ces éléments doivent pouvoir être réutilisés dans les générations futures afin de conserver une cohérence.

---

# 8. COHÉRENCE

La cohérence est une priorité absolue.

Le système doit chercher à maintenir :

* même visage ;
* mêmes caractéristiques physiques ;
* même identité ;
* même style ;
* cohérence des vêtements ;
* cohérence des accessoires ;
* cohérence des environnements ;
* cohérence temporelle ;
* cohérence entre photos ;
* cohérence entre vidéos.

**Recherche d'abord les méthodes les plus performantes actuellement.**

Compare les différentes approches disponibles et choisis la meilleure architecture selon :

* qualité ;
* cohérence ;
* coût ;
* vitesse ;
* disponibilité API ;
* facilité d'intégration ;
* scalabilité.

---

# 9. COMPTE SOCIAL SIMULÉ

Chaque influenceur doit posséder son propre compte social dans Viralya.

Exemple :

> Instagram
> @xxxxx

Le compte doit avoir son propre :

* profil ;
* bio ;
* identité ;
* historique ;
* contenu ;
* calendrier ;
* statistiques ;
* stratégie.

Chaque influenceur doit être complètement isolé des autres.

**Aucun mélange de Character Bible, assets, prompts ou historique entre deux influenceurs.**

---

# 10. CALENDRIER ÉDITORIAL

Après création de l'influenceur, l'utilisateur doit pouvoir demander :

> Générer le calendrier du mois prochain.

Viralya doit construire automatiquement une stratégie réaliste.

Le calendrier doit prendre en compte :

* personnalité ;
* niche ;
* objectifs ;
* storytelling ;
* lieux ;
* événements ;
* voyages ;
* contenu déjà publié ;
* fréquence ;
* formats ;
* UGC ;
* campagnes.

---

# 11. STORYTELLING

Le calendrier ne doit pas être une liste de contenus aléatoires.

Il doit raconter une histoire.

Exemple :

### Voyage en Espagne

**Jour 1**

* départ ;
* aéroport ;
* arrivée ;
* hôtel.

**Jour 2**

* café ;
* balade ;
* photo lifestyle.

**Jour 3**

* plage ;
* Reel ;
* stories.

Le compte doit donner l'impression qu'une **même personne vit réellement sa vie**.

---

# 12. TYPES DE CONTENU

Le calendrier doit gérer plusieurs catégories.

### Photos

* selfie ;
* portrait ;
* lifestyle ;
* fashion ;
* voyage ;
* restaurant ;
* café ;
* contenu spontané.

### Vidéos

* TikTok ;
* Reels ;
* Shorts ;
* travel ;
* lifestyle ;
* storytelling ;
* talking videos.

### UGC

Le système doit également permettre de créer des campagnes UGC.

Exemple :

> Cette influenceuse doit présenter ce produit.

Le système doit pouvoir gérer :

* produit ;
* marque ;
* objectif ;
* angle ;
* hook ;
* script ;
* CTA ;
* environnement ;
* scénario ;
* plans ;
* voix ;
* durée.

---

# 13. PIPELINE VIDÉO

Je veux un véritable pipeline de production.

Pas simplement :

> Prompt → vidéo

Mais :

**Concept**
↓
**Brief**
↓
**Script**
↓
**Shot List**
↓
**Références visuelles**
↓
**Génération des plans**
↓
**Contrôle qualité**
↓
**Régénération si nécessaire**
↓
**Sélection des meilleurs plans**
↓
**Voix / Audio**
↓
**Montage**
↓
**Sous-titres si nécessaire**
↓
**Export**
↓
**Vidéo finale prête à publier**

---

# 14. VIDÉO UGC

Pour les UGC, le système doit être particulièrement structuré.

Exemple :

**Produit : X**

Le système construit :

* Hook ;
* problème ;
* présentation du produit ;
* démonstration ;
* bénéfices ;
* preuve ;
* CTA.

Puis transforme cela en :

**Script → Shot List → Génération → Montage**

Recherche les meilleures pratiques actuelles des vidéos UGC performantes avant de définir ce workflow.

---

# 15. TÂCHES BACKGROUND

Les opérations lourdes doivent fonctionner en arrière-plan.

Exemples :

* génération d'image ;
* génération vidéo ;
* génération audio ;
* montage ;
* export ;
* génération de calendrier ;
* génération de plusieurs contenus.

Créer un système de tâches avec :

`PENDING` · `PROCESSING` · `COMPLETED` · `FAILED` · `CANCELLED`

L'utilisateur doit pouvoir voir ce qui se passe.

---

# 16. TASK CENTER

Créer une interface permettant de voir :

### En cours

* génération vidéo ;
* génération photo ;
* montage ;
* génération audio.

### À venir

* contenu du 10 septembre ;
* Reel du 12 septembre ;
* UGC du 15 septembre.

### Terminées

* photo terminée ;
* vidéo terminée ;
* UGC validé.

Chaque tâche doit afficher son état et, lorsque pertinent :

* progression ;
* durée ;
* erreur ;
* logs utiles ;
* retry.

---

# 17. VALIDATION HUMAINE

L'utilisateur doit rester dans la boucle.

Pour chaque contenu généré, il doit pouvoir :

* regarder ;
* écouter ;
* valider ;
* refuser ;
* demander une modification ;
* régénérer ;
* modifier le prompt ;
* modifier le script ;
* modifier un plan spécifique.

Exemple :

> « Le visage du plan 3 n'est pas suffisamment cohérent. »

Le système doit idéalement permettre de :

> Régénérer uniquement le plan 3.

**Ne régénère pas inutilement toute une vidéo lorsqu'un seul élément doit être corrigé.**

---

# 18. VERSIONING

Prévoir un système de versions.

Exemple :

`Video V1` → `Video V2` → `Video V3`

L'utilisateur doit pouvoir revenir à une version précédente.

Même principe pour :

* images ;
* prompts ;
* scripts ;
* shot lists ;
* vidéos.

---

# 19. DASHBOARD

Le dashboard d'un influenceur doit permettre de voir immédiatement :

* contenus publiés ;
* contenus programmés ;
* contenus en génération ;
* contenus à valider ;
* contenus échoués ;
* photos ;
* vidéos ;
* UGC ;
* calendrier.

Exemple :

> 18 publications ce mois
> 10 photos
> 5 vidéos
> 3 UGC
> 4 générations en cours
> 2 contenus à valider

---

# 20. ARCHITECTURE MULTI-INFLUENCEURS

Viralya doit être conçu pour pouvoir gérer plusieurs influenceurs.

Chaque influenceur possède son propre :

* Character Bible ;
* World Bible ;
* profil ;
* historique ;
* calendrier ;
* assets ;
* prompts ;
* campagnes ;
* tâches ;
* contenus ;
* versions.

Architecture pensée pour évoluer vers un véritable SaaS multi-tenant.

---

# 21. AUTOMATISATION DES RÉSEAUX SOCIAUX

Préparer l'architecture pour permettre ensuite :

* Instagram ;
* TikTok ;
* Facebook ;
* LinkedIn ;
* YouTube.

Objectif final :

**Création → Génération → Validation → Programmation → Publication**

Le système doit être conçu de manière à pouvoir intégrer les APIs officielles ou les solutions adaptées.

**Recherche les méthodes et APIs actuellement disponibles avant de décider de l'architecture.**

---

# 22. CONTRÔLE QUALITÉ

Ajouter une véritable étape de Quality Control.

Avant de considérer un contenu comme terminé, vérifier autant que possible :

### Image

* visage ;
* mains ;
* artefacts ;
* cohérence ;
* environnement ;
* vêtements.

### Vidéo

* identité ;
* mouvements ;
* artefacts ;
* continuité ;
* qualité ;
* synchronisation ;
* audio ;
* montage.

### UGC

* produit correctement visible ;
* script respecté ;
* hook présent ;
* CTA présent ;
* durée correcte ;
* format correct.

---

# 23. GESTION DES COÛTS

Le système doit être pensé avec les coûts IA en tête.

Avant d'intégrer plusieurs APIs coûteuses :

* compare les fournisseurs ;
* compare les modèles ;
* compare les coûts ;
* compare les performances ;
* identifie les tâches pouvant être réalisées avec des modèles moins coûteux ;
* évite les générations inutiles ;
* mets en cache les éléments réutilisables.

Une architecture techniquement excellente mais économiquement impossible à scaler n'est pas une bonne architecture SaaS.

---

# 24. ERREURS ET ROBUSTESSE

Prévoir :

* retry automatique lorsque pertinent ;
* gestion des erreurs API ;
* timeout ;
* tâches bloquées ;
* génération échouée ;
* rate limits ;
* stockage indisponible ;
* webhooks manquants ;
* reprise d'une tâche interrompue.

Une génération qui échoue ne doit pas casser tout le workflow.

---

# 25. RÈGLE DE DÉCISION TECHNIQUE

Pour toute décision importante :

1. Comprendre le problème
2. Rechercher les solutions actuelles
3. Comparer les alternatives
4. Vérifier les documentations
5. Vérifier les limitations
6. Vérifier les coûts
7. Choisir
8. Implémenter
9. Tester
10. Vérifier le résultat réel

**Ne présente jamais une hypothèse comme un fait.**

Si quelque chose doit être testé, teste-le.

Si quelque chose est incertain, signale-le.

---

# 26. PRINCIPE FINAL

Je ne veux pas que tu construises simplement une interface qui donne l'impression que Viralya fonctionne.

Je veux que **Viralya fonctionne réellement.**

Le résultat final doit être :

* fonctionnel ;
* cohérent ;
* moderne ;
* robuste ;
* scalable ;
* maintenable ;
* pensé pour la production ;
* agréable à utiliser.

Et surtout :

> **NE CODE PAS À L'AVEUGLE.**

Lorsqu'un problème nécessite une expertise ou une connaissance actuelle, **RECHERCHE D'ABORD.**

Lorsqu'une technologie évolue rapidement, **VÉRIFIE LES INFORMATIONS ACTUELLES.**

Lorsqu'il existe plusieurs méthodes, **COMPARE-LES.**

Lorsqu'une meilleure méthode existe, **UTILISE-LA.**

Lorsqu'une de mes idées est techniquement mauvaise, **ne l'implémente pas aveuglément : propose une meilleure approche.**

Je veux que tu agisses comme :

**Product Manager + UX Designer + Software Architect + AI Engineer + Automation Engineer.**

Ton objectif n'est pas seulement de faire fonctionner Viralya.

Ton objectif est de construire **la meilleure architecture possible pour transformer Viralya en une véritable plateforme SaaS de production d'influenceurs et de contenu IA.**

---

# OBJECTIF FINAL

L'utilisateur doit pouvoir faire :

**Créer un influenceur**
→ **Créer son identité**
→ **Créer son Character Bible**
→ **Créer son World Bible**
→ **Construire son univers**
→ **Définir sa stratégie**
→ **Générer son calendrier**
→ **Générer ses photos**
→ **Générer ses vidéos**
→ **Créer ses UGC**
→ **Voir les tâches en arrière-plan**
→ **Contrôler les générations**
→ **Demander des modifications**
→ **Régénérer uniquement ce qui est nécessaire**
→ **Monter automatiquement les vidéos**
→ **Valider**
→ **Programmer**
→ **Publier**
→ **Analyser les résultats**

**Chaque détail compte.**
