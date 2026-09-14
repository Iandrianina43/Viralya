# Tarification en crédits — corrigée sur les coûts réels (14 septembre 2026)

Réponse à la spec « Tarification & Facturation v1.0 » de Jérôme. Sa logique est conservée (crédits,
deux soldes, packs, top-up, setups, plancher ×1,2). Ses chiffres d'infra sont remplacés par ce que la
plateforme dépense vraiment, mesuré sur les productions en base et les tarifs fournisseurs codés.

## 1. Ce qui ne collait pas dans la spec

1. **Un crédit n'y a pas la même valeur selon la page** : 0,10 € d'infra dans la table des générations
   (vidéo 15 s = 0,50 € = 5 crédits), 0,50 € dans les top-up (Micro = 50 crédits ≈ 25 €). Avec la
   convention 0,50 €, les packs Agency et Marque Blanche sont vendus à perte (10 000 crédits = 5 000 €
   d'infra pour 3 497 CHF). **Retenu : 1 crédit = 0,10 $ de coût fournisseur** (tous nos fournisseurs
   facturent en dollars ; le franc n'intervient qu'au prix de vente).
2. **Les coûts d'infra étaient faux d'un facteur 2 à 10.** « Vidéo 30 s = 1 € » ; mesuré : 8,9 $ pour
   23 s en 720p (Seedance 2.5), 11,6 $ pour 30 s. Une table fixe par durée ferait vendre à perte.
   **Retenu : les crédits débités sont calculés sur le coût réel estimé du lancement** (durée, modèle,
   résolution), arrondis au supérieur, affichés avant confirmation — exactement ce que fait déjà
   `recordUsage` en dollars.
3. **Les trois quarts des types de génération n'existent pas dans Viralya** (DM/commentaires
   automatiques, prospection, analyse de niche, TikTok Live IA, webinaires IA, boutique e-commerce,
   création de marque, rapport ROAS, accès API, marque blanche avec sous-comptes). Ils sortent du
   catalogue tant qu'ils ne sont pas au périmètre.

## 2. Constantes

| Constante | Valeur | Source |
|---|---|---|
| `CREDIT_INFRA_USD` | 0,10 $ | décision ci-dessus |
| `USD_TO_CHF` | 0,81 | taux du 14 sept. 2026, à réviser mensuellement (config en base) |
| Coût d'infra d'un crédit | ≈ 0,081 CHF | dérivé |
| `RATIO_MIN` (plancher) | ×1,2 → **0,097 CHF / crédit minimum** | spec |
| Frais Stripe | ≈ 2,9 % + 0,30 CHF par paiement | à vérifier sur le contrat Stripe CH |
| Publication réelle (Zernio) | 2 comptes offerts, puis 6 $/compte/mois (3–10), 3 $ (11–100), 1 $ (101+) | page tarifs Zernio, 7 sept. |

## 3. Coûts réels par génération (mesurés) et crédits

Mesures : 4 vidéos produites les 6 sept. (coûts fournisseur réels en base), historique PiAPI (images à
0,07 $), tarifs par seconde codés dans `providers/piapi.ts`, `talkingAvatar.ts`, `piapiImage.ts`,
`elevenlabs.ts`. Texte : Claude Sonnet 5 à 2 $/M jetons entrée, 10 $/M sortie.

| Génération | Coût réel | Crédits | Note |
|---|---|---|---|
| Photo (1 image Seedream 5 Pro 1K + légende) | 0,07–0,08 $ | **1** | mesuré (historique PiAPI) |
| Carrousel 3–5 images, story | 0,25–0,35 $ | **3** | estimation code |
| Bannière du kit de lancement (par proposition) | 0,07–0,14 $ | **1–2** | 1K / 2K |
| Calendrier du mois (24 entrées, LLM) | ≈ 0,15 $ | **2** | estimation jetons |
| Script UGC, fiche, bio, texte | 0,01–0,03 $ | **inclus** | |
| Voix (ElevenLabs) 30 s ; musique 30 s | 0,075 $ ; 0,075 $ | **inclus** | 0,0025 $/s ; 0,15 $/min |
| Explicative 40 s — Standard (480p, 1 plan parlé + illustrations + musique) | **2,4 $ mesuré** | **25** | contenu 597cf2e0 |
| Explicative 40 s — Premium (720p) | ≈ 5 $ | **50** | estimation |
| Pub / influenceur parlant 15 s — Standard 480p | **2,25 $ mesuré** | **25** | contenu d03f3ed4 |
| Pub 30 s — Standard 480p (0,165 $/s) | 5,0 $ | **50** | |
| Pub 15 s — Premium 720p (0,385 $/s) | 5,8 $ | **60** | |
| Pub 23 s — Premium 720p | **8,9 $ mesuré** | **90** | contenus e9890351, 82f5a47c |
| Pub 30 s — Premium 720p | 11,6 $ | **120** | |
| Pub 30 s — Cinéma 1080p (0,88 $/s) | 26,4 $ | **265** | 5 s mesurés à 4,40 $ |
| Clone UGC 15 s / 30 s (720p) | 6,3 $ / 12,1 $ | **65 / 125** | formule `ugc.ts` |
| Création d'un influenceur (portrait, planche, références, garde-robe, décors, voix) | 2,2–3 $ | **offert à l'activation** | couvert par le plan ou `SETUP_EXTRA_AVATAR` |

Règle d'affichage : avant tout lancement, l'interface montre « ≈ N crédits » calculé par l'estimateur ;
le débit final est le coût réel (un rendu échoué rend ses crédits).

## 4. Packs — prix de Jérôme conservés, quotas corrigés

Avec 1 crédit = 0,10 $, ses quotas mettaient l'infra à 8 % du prix Starter : un Starter à 197 CHF
n'aurait eu droit qu'à **une** pub premium de 30 s par mois. Les quotas ci-dessous visent une infra
à 16–23 % du prix (marge nette ≥ 70 % après Stripe et Zernio), avec une capacité lisible pour le client.

| Plan | Prix / mois | Crédits (spec) | **Crédits retenus** | Infra max | % du prix | Ce que ça permet par mois |
|---|---|---|---|---|---|---|
| Starter | 197 CHF | 200 | **400** | 40 $ ≈ 32 CHF | 16 % | ≈ 3 pubs premium 30 s, ou 8 standard, ou 16 explicatives, ou 400 photos |
| Growth | 497 CHF | 600 | **1 200** | 120 $ ≈ 97 CHF | 20 % | ≈ 10 pubs premium 30 s |
| Brand | 797 CHF | 1 500 | **2 000** | 200 $ ≈ 162 CHF | 20 % | ≈ 16 pubs premium 30 s |
| Agency | 2 197 CHF | 5 000 | **6 000** | 600 $ ≈ 486 CHF (+ ≈ 107 CHF Zernio pour 10 influenceurs × 4 réseaux) | 27 % | ≈ 50 pubs premium 30 s |
| Marque Blanche | 3 497 CHF | 10 000 | **10 000** | 1 000 $ ≈ 810 CHF | 23 % | ≈ 83 pubs premium 30 s |

Prix par crédit inclus : Starter 0,49 CHF · Growth 0,41 · Brand 0,40 · Agency 0,37 · Marque Blanche
0,35. Tous ≥ 3,6 × le plancher. Les « ratios » ×2,0 / ×1,5 / ×1,2 de la spec ne décrivent pas ces
packs (ils sont à ×4–6 de l'infra) ; on les remplace par le prix par crédit, plus lisible.

## 5. Top-up — prix de Jérôme conservés, une correction

| Top-up | Crédits | Prix | Prix / crédit | Infra | Marge brute |
|---|---|---|---|---|---|
| Micro | 50 | 49 CHF | 0,98 CHF | 4 CHF | 92 % |
| Starter+ | 150 | ~~162~~ **129 CHF** | 0,86 CHF | 12 CHF | 91 % |
| Boost | 400 | 299 CHF | 0,75 CHF | 32 CHF | 89 % |
| Pro | 900 | 599 CHF | 0,67 CHF | 73 CHF | 88 % |
| Studio | 2 000 | 1 199 CHF | 0,60 CHF | 162 CHF | 86 % |

Correction : Starter+ était plus cher au crédit (1,08) que Micro (0,98) ; 129 CHF rétablit la
dégressivité. Règle vérifiée : chaque top-up reste plus cher au crédit que n'importe quel pack, donc un
client a toujours intérêt à monter de plan plutôt qu'à empiler des top-up.

## 6. Setups, upsells, AppSumo

- **Setups** (297 → 4 997 CHF) : prestations humaines, aucune infra significative ; inchangés.
  `SETUP_EXTRA_AVATAR` 197 CHF couvre les ≈ 3 $ de création de l'influenceur.
- **Upsells** Live, webinaire, boutique, ROAS, avatar supplémentaire mensuel : hors produit actuel
  (voir § 1.3) sauf « Avatar IA supplémentaire / mois 97 CHF », qui existe (limite d'influenceurs par
  plan) et reste.
- **AppSumo** : la spec donne 80 à 1 200 crédits/mois **à vie** pour 97 à 891 $ une fois. À 0,10 $ le
  crédit, Tier 1 = 8 $/mois d'infra pour 97 $ encaissés une fois — et AppSumo garde ≈ 70 % de la vente.
  Équilibre atteint en 3 à 4 mois, perte ensuite. Retenu : **T1 30 · T2 60 · T3 120 · Stack 360
  crédits/mois**, plafond dur, top-up au tarif Micro. À traiter comme du marketing, pas du revenu.

## 7. Ce que ça change dans le code (fait le 14 sept. 2026)

Migration 0022 : portefeuille (solde mensuel expirant + solde top-up persistant + quotas de sessions),
mouvements de crédits, table `pricing_config` versionnée (constantes, packs, top-up, historique),
`plan_features`. `recordUsage` réserve en crédits (même verrou que la 0020), ordre mensuel puis top-up,
remise à zéro du mensuel sur `invoice.paid` (date anniversaire Stripe). Checkout en CHF, setup en ligne
séparée sur la première facture, top-up en paiement unique, codes AppSumo. Détail dans
docs/PLAN-PLATEFORME.md § 9 quand Jérôme aura validé les quotas.

Sources : historique PiAPI (2 images à 0,07 $), `content_items.assets.shots[].cost_usd` des contenus
e9890351, 597cf2e0, d03f3ed4, 82f5a47c ; tarifs codés le 4 sept. ; taux USD/CHF 0,81 du 14 sept. 2026
(Investing.com) ; tarifs Claude Sonnet 5 (platform.claude.com).
