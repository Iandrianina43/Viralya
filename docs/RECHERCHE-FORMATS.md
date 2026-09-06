# Recherche formats vidéo — 6 septembre 2026

Demande : en plus du vlog (prise unique), produire des **pubs** (ads style), des **UGC**, des
**vidéos explicatives sans visage** et des **clones de vidéo** (on fournit une vidéo de référence,
on obtient la même vidéo avec l'influenceuse à la place de la personne). Le B-roll (inserts photo
et plans de coupe) est désactivé par défaut, avec une case pour le réactiver.

Décisions de l'utilisateur (questions du 6 sept.) : clone = sa voix sur le même texte ; source =
upload de fichier ou lien ; pub = produit seul OU avec l'influenceuse ; explicatives = mélange de
clips générés et d'images animées ; on garde plusieurs influenceurs par compte ; 720p par défaut ;
tout dans le Studio avec le choix du format en première étape.

## 1. Comment font les outils UGC / pubs en 2026

Sources : Krea (« How to make AI ads and UGC ads for free in 2026 »), comparatifs Arcads / Creatify /
MakeUGC (AdsTurbo, Wireflow, HyperFX), tutoriel imastudio « Seedance 2.5 : a 30-second UGC ad »,
Oakgen « Seedance 2.5 product ad prompts » et « 30-second ads framework ».

- Arcads : un acteur IA + un script parlé de 30-60 mots + une émotion (« excited », « calm
  recommendation ») + 9:16 ; on génère deux acteurs par script et on garde le meilleur. Modèles
  vidéo sous le capot : Seedance 2.5, Sora 2 Pro, Kling. Creatify : lien produit → assets →
  script → vidéo, variantes en lot. Le flux « image d'abord » (verrouiller la photo produit, puis
  seulement dépenser en vidéo) est la méthode économique recommandée.
- Pub avec créatrice (UGC) sur Seedance 2.5 : six segments de 5 s (accroche/problème, révélation
  produit, détail, démonstration, résultat/réaction, CTA avec produit et visage), rôles de
  références explicites (@image1 = produit : « preserve the exact bottle geometry, material, pump
  design, color, logo, label text » ; @image2 = créatrice ; @image3 = décor sans personne ni
  produit), constantes verrouillées (identité, produit, tenue, pièce, lumière) contre variables
  (expressions, taille de plan, mouvement, dialogue), UN mouvement de caméra motivé par segment,
  voix « conversationnelle, pas promotionnelle », négatifs précis (déformation du produit, étiquette
  qui change, doublon de flacon, mains en trop, texte à l'écran).
- Pub produit seul (Oakgen) : quatre temps — accroche 0-5 s (contraste ou geste surprenant),
  preuve 5-20 s d'UN SEUL bénéfice montré par l'action, résultat 20-27 s, **image finale 27-30 s**
  (produit de face, étiquette dégagée, espace vide pour le texte ajouté en post-production).
  « Product lock » en tête de prompt : forme, matière, couleur, position de l'étiquette. Prix, mentions
  légales, notes, promos et CTA texte sont ajoutés au montage, jamais générés. Grille de notation :
  accroche 20 %, fidélité produit 25 %, preuve 20 %, continuité 15 %, audio 10 %, image finale 10 %.
  Six prompts complets relevés : la structure est toujours « Create a N-second … ad for <produit>.
  Preserve the exact … Open on … Cut to … Track/… End on … <style>. No <négatifs>. No audio /
  ambient only ».

## 2. Vidéos explicatives sans visage

Sources : Stratboost (script 30 s), Flarecut (« script writing for faceless videos »), Pexo,
guides de rétention short-form (OpusClip, Teleprompter Pro), guides « faceless tech stack 2026 »
(Medium, Fluxnote, Storyshort).

- Structure 30 s : accroche 0-3 s (erreur, résultat ou affirmation forte), contexte 3-8 s, 2-3
  points 8-22 s, chute 22-27 s, un seul CTA léger 27-30 s. 70-110 mots à 150 mots/min en anglais ;
  en français avec notre voix ElevenLabs (≈ 2,3 mots/s) : 55-70 mots pour 30 s.
- Sans visage, le script porte tout : indications visuelles très concrètes, un visuel neuf à chaque
  changement d'idée (nouvel angle, gros plan, objet, B-roll), premier changement visuel avant 3 s.
- Pile technique courante : voix off IA + B-roll de stock ou images IA animées (Ken Burns) + quelques
  clips IA pour les moments forts, sous-titres automatiques. Le tout-clips-IA est jugé lent et cher ;
  les comptes à gros volume mélangent stock/images et quelques clips générés. Coût observé : 4-8 $ de
  crédits par vidéo finie.
- Notre choix (validé) : mélange — 1 ou 2 clips Seedance 2.5 (voix off native, sans personne) pour
  l'accroche et le moment clé, images Seedream animées (≈ 0,07 $ chacune) pour le reste, voix
  ElevenLabs mixée au montage, musique de fond.

## 3. Clone de vidéo (même vidéo, autre personnage)

Sources : blog officiel Seed/ByteDance « One-take creation, flexible referencing » (2.5 : 10 clips
vidéo de référence, « motion, camera work, character consistency »), Artflo (prompts d'édition
2.5), Morphic (edit / extend / reference), seedanceai.cc (remplacement de personnage), guide
dexhunter (« Video1's female singer replaced by @image1 male vocalist; motion mimics original, no
cuts »), doc PiAPI Seedance 2 (`video_urls`, mp4/mov, 2.0 : 3 vidéos ≤ 15 s).

- Deux notions : la vidéo **source** (celle qu'on garde presque intacte, on ne change qu'un
  élément) et la vidéo de **référence** (on lui emprunte le mouvement, la caméra). Un clone = la
  source est @video1, le personnage vient de @image1 : « Replace the person in @video1 with the
  woman from @image1; keep the framing, camera motion, cuts, timing, gestures, background and
  lighting of @video1 shot for shot ». Une seule modification par passe ; interactions physiques
  entre deux personnages = échecs fréquents.
- Ce qui est conservé par défaut : mouvement, cadrage, rythme, fond, lumière, audio. Pour un clone
  avec SA voix : on transcrit la source (ElevenLabs Scribe), on synthétise le texte avec sa voix
  ElevenLabs, et @audio1 remplace la parole d'origine (même méthode que la prise unique : le
  4 sept. le timbre de @audio1 a bien été repris).
- Limites 2.5 côté modèle : clips de 2-30 s, 30 s au total par génération, 200 Mo. Côté PiAPI la
  page 2.5 indique « video reference input billed at half of that rate » (une source de 30 s en 720p
  ≈ 5,8 $ en plus du rendu ≈ 11,5 $) — la durée maximale d'une vidéo d'entrée sur PiAPI en 2.5 n'est
  pas documentée : à vérifier au premier rendu réel (coupé à 30 s côté Viralya).
- Droits : cloner la vidéo de quelqu'un d'autre reprend sa mise en scène ; à réserver aux vidéos
  dont on a les droits (ses propres tournages, banques libres) ou à l'inspiration. Le produit affiche
  un rappel, il ne bloque pas.

## 4. Ce qui est implémenté (6 sept.)

- Studio : choix du format en première étape — Vlog, Pub (produit seul / avec elle), Explicative
  (sans visage), Clone (upload ou lien).
- Pub produit seul : une scène `faceless` de 30 s rendue en une prise, 4 plans horodatés
  (accroche, preuve, résultat, image finale propre), product lock en tête de prompt, voix off
  optionnelle avec sa voix (@audio1), musique au montage.
- Pub avec elle : la prise unique existante avec le produit en référence (`product_image_url`)
  et un brief « pub » (accroche, bénéfice, preuve, appel à l'action).
- Explicative : 4-6 scènes voix off sans personne, `visual: "clip" | "still"` ; les stills sont des
  images Seedream animées (Ken Burns) au montage avec la voix ElevenLabs ; les clips sont des
  rendus Seedance 2.5 démarrant sur une image générée (première image) avec la voix native.
- Clone : `POST /studio/clone/upload` (fichier brut, ≤ 200 Mo, coupé à 30 s) ou
  `/clone/link` (yt-dlp si installé sur le serveur), `/clone/transcribe` (Scribe), puis une scène
  parlée avec `source_video_url` → prompt `buildClonePrompt` (@video1 source, @image1 identité,
  @audio1 sa voix). Musique et inserts désactivés pour ce format.
- B-roll : inserts et plans de coupe coupés par défaut ; case « B-roll » dans l'assistant.
- Pronoms : les prompts Seedance suivent le sexe de l'influenceur (`sex_age`) — le test à sec du
  6 sept. sur Alexandre disait « the young woman ».

Non vérifié (solde PiAPI ≈ 0-4 $) : aucun rendu payant de ces formats n'a encore été lancé. Ordre
de test conseillé : explicative (la moins chère, ≈ 3-4 $ en 720p avec un clip), pub produit, clone.

Test à sec du 7 sept. (Alexandre, LLM seulement, `scripts/test-formats.ts`) : explicative « Ton café est
amer, voici pourquoi » — 6 scènes, 65 mots, 2 clips + 4 images, ≈ 5 $ en 720p ; pub produit « Gourde Terra »
— 4 plans horodatés, product lock, 31 mots de voix off, image finale avec espace pour le texte, ≈ 11,7 $ ;
clone 13 s ≈ 8 $ (rendu + vidéo d'entrée à moitié). Pronoms corrigés (« French male voice-over »).

Premier rendu réel avec le nouveau prompt de prise unique (6 sept., 21 h 20, Alexandre, 720p) :
contenu `e9890351`, « Le prix caché du latte », 23 s, 8,86 $, texte reconnu à 94 %, visage 0,65 (pass),
4 plans horodatés sur la voix, aucun insert. Explicative « Ton café est amer » (480p, 2,9 $ estimés) :
6 plans rendus (2 clips + 4 images) ; le montage a révélé un blocage ffmpeg (`apad` + `-shortest`
sans fin sur les plans image + voix), corrigé par une durée bornée `-t` (commit 53223bd).

