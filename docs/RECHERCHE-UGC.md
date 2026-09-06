# Recherche vidéos UGC — 6 septembre 2026

BRIEF § 12 et 14 (« recherche les meilleures pratiques actuelles des vidéos UGC performantes avant de
définir ce workflow »). **V** = source officielle ou primaire lue, **T** = source tierce, **I** = déduction.

## 1. Structure et minutage

Squelette unanime en 2025-2026 : **accroche → problème → produit → démonstration → bénéfices → preuve →
appel à l'action**. TikTok for Business : « 90 % de la mémorisation dans les 6 premières secondes »,
produit à l'écran = +65 % d'affinité, carte CTA = +45 % de mémorisation (V). Grille 20 s de Spark UGC
(juin 2026, V) : accroche 0-3 s, problème 3-6, solution 6-10, valeur 10-13, preuve 13-16, CTA 16-20 ;
l'accroche doit tomber avant 1 s (Meta), 1,5 s (TikTok), 2 s (Shorts).

Débit du français parlé : 2,3 mots/s (calme, laisse respirer) → 20 s ≈ 46 mots, 30 s ≈ 69, 45 s ≈ 103.
Grille implémentée dans `domain/ugc.ts` (`beatBudget`) : 20 s = 2,5/2,5/3/4/3/2/3 ; 30 s = 3/4/3/6/5/4/5 ;
45 s = 3/5/4/10/6/7/10 (le CTA long de 45 s contient une objection/offre et un CTA intermédiaire,
présent dans 6 des 10 meilleures pubs Billo).

## 2. Accroches

Taxonomie croisée (Hustler, Zeely, Arcads, Takema — V/T) : pattern interrupt (« Non, attends. »),
douleur, question, affirmation forte, résultat d'abord (« J'en ai commandé un deuxième. C'est tout
dire. »), POV, histoire (« Il y a six mois… »), mythe cassé (« Arrête de … Fais ça à la place. »),
réponse à un commentaire, recommandation d'amie. Règles : ≤ 8 mots, un mécanisme différent par
variante, accroche visuelle avant la verbale (mouvement dès la première image), produit ou résultat
visible avant 1,5 s. Indicateur : hook rate (vues ≥ 3 s / impressions) 25-30 % correct, < 20 % à
remplacer (T, vendeurs).

## 3. Réalisation

Produit visible ≥ 5 s, au moins un plan « produit en main » et un gros plan pendant la démo ;
lumière de fenêtre, cadre selfie, imperfections assumées ; un changement de plan toutes les 2-3 s ;
sous-titres et CTA à l'écran dans la zone sûre ; son + musique basse (88 % des utilisateurs TikTok
jugent le son essentiel, V). CTA : offre concrète (code avec vraie date) > urgence vague ; « commente
[mot] » 4-6× le lien en bio selon des vendeurs d'automatisation (T, intéressés).

## 4. Matrices de variations (Arcads, Creatify, MakeUGC…)

Dimensions variées : accroche × angle × acteur × décor × durée × CTA ; 5-10 accroches par script,
12-24 variantes par campagne, 15-25 variantes actives surperforment (T). Méthode : isoler une variable
par test, ≥ 10 000 impressions avant de juger. Nommage lisible (Bestever/Motion) :
`marque_produit_H1-question_A2_AV-nom_30s_C1`. Implémenté : `ugc_campaigns.matrix`
(influenceurs × angles × accroches par angle × durées × CTA), `ugc_variants.label`.

## 5. Conformité (France / UE) — intégrée au pipeline

- **Loi n° 2023-451 du 9 juin 2023, art. 5** (V) : « Publicité » ou « Collaboration commerciale »
  explicite, lisible, **pendant toute la durée** ; « Images virtuelles » pour un visage ou une
  silhouette générés par IA. Contrat écrit obligatoire ≥ 1 000 € HT depuis le 1er janvier 2026.
- **ARPP** (V) : mention instantanée, contrastée, pas après « voir plus » ; fiche août 2026 :
  « Contenu généré par IA », « Voix générée par IA ».
- **AI Act art. 50** applicable depuis le 2 août 2026 (V) : un personnage synthétique réaliste est un
  deepfake à signaler, sans exemption publicitaire ; icône persistante + avertissement d'ouverture.
- **Plateformes** (V) : TikTok `is_aigc` + bascule « contenu commercial » (sinon exclusion du For You) ;
  Meta « AI info », label de profil IA obligatoire depuis le 31 août 2026 ; YouTube
  `containsSyntheticMedia`.

Implémentation : chaque vidéo UGC incruste dès la première image et jusqu'à la fin
« Collaboration commerciale avec <marque> » (haut) et « Images virtuelles · Contenu généré par IA »
(bas), dans les zones sûres (`payload.labels`, `assembleHybrid` → `labels.ass`) ; légende avec la mention ;
`content_items.ai_label = true` ; labels IA envoyés au fournisseur de publication.

À trancher juridiquement : statut fournisseur/déployeur de Viralya sous l'AI Act ; autorité française
de contrôle non encore désignée (ARPP, août 2026).
