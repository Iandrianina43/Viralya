# Recherche vidéo v2 — 4 septembre 2026

Réponse à la critique de la première vidéo hybride (« tenue qui change, avatar raide, lip-sync pas
crédible, montage plat, ça fait IA, sous-titres moches, texte creux »). Deux recherches web menées
le 4 septembre 2026 ; chaque affirmation ci-dessous vient d'une page officielle ou d'un test daté de
2026. Ce qui n'a pas été vérifié est marqué **non vérifié**.

## 1. Avatar parlant en français : ce que disent les docs officielles

| Fait | Source |
|---|---|
| **Kling AI Avatar 2 ne liste que EN / JA / KO / ZH** pour l'audio importé et le TTS. Le français n'est pas supporté officiellement. | Guide Kling AI Avatar 2 (kling.ai/quickstart, 5 déc. 2025) ; page PiAPI kling-ai-avatar |
| PiAPI décrit lui-même le mode **Standard** de Kling Avatar comme « more static… fixed hands… stiff… robotic », et le mode Pro comme « natural upper-body motion and hand gestures ». | piapi.ai/blogs/kling-ai-avatar-guide-standard-vs-pro (7 avr. 2026) |
| **OmniHuman 1.5** : aucune restriction de langue documentée ; corps entier, gestes « sémantiques » liés au sens de la parole ; 60 s max en 720p, 30 s en 1080p ; 0,13 $/s sur PiAPI (0,12 $ BytePlus, 0,16 $ fal). ElevenLabs le vend comme son moteur vidéo « 30+ langues ». | fal.ai/models/fal-ai/bytedance/omnihuman/v1.5, piapi.ai/omnihuman-1-5, elevenlabs.io/video/omnihuman-15 |
| **Aucun modèle n'a de mesure publiée du lip-sync français.** Tout « supporte le français » est une liste de langues ou du marketing. | constat de la recherche |
| Alternatives non intégrées : InfiniteTalk (WaveSpeed 0,03-0,06 $/s, jugé le plus naturel par WaveSpeed, « liaison et plosives » imparfaites), VEED Fabric 1.0 (fal 0,08-0,15 $/s), Hedra Character-3 (0,025-0,0625 $/s, gamme en cours de retrait), HeyGen Avatar IV (≈ 0,05-0,067 $/s). | pages produit respectives |
| **Sync lipsync-2-pro** peut re-synchroniser les lèvres d'un clip existant (« any kind of video… even AI-generated », toute langue), 0,067-0,083 $/s ; visage de face requis, ne corrige ni la raideur ni les mains. | sync.so/lipsync-2-pro, docs sync.so |
| Modèles à audio natif : **MiniMax H3** (31 juil. 2026) liste le français et accepte une piste audio + 9 images de référence (0,13 $/s, 15 s max, pas sur PiAPI/fal) ; **Veo 3.1** : Google écrit que les langues autres que l'anglais « n'ont pas été évaluées » ; **Kling 3.0** : audio natif CN/EN/JA/KO/ES seulement ; **Sora 2** : API fermée le 24 sept. 2026, refuse les visages en référence. | ai.google.dev/gemini-api/docs/veo, kling.ai/quickstart, atlascloud (H3) |

**Décision** : OmniHuman 1.5 devient le moteur par défaut (`DEFAULT_TALK_PROVIDER`), Kling Avatar reste
disponible mais signalé « EN/JA/KO/ZH ». Un banc InfiniteTalk / VEED Fabric demanderait des clés
WaveSpeed / fal (non ouvertes). Le jugement du français reste à l'oreille de l'humain.

## 2. Ce que font les outils UGC en 2026

Arcads, Creatify, Captions (modèle Mirage), Argil n'utilisent pas d'image → avatar générique pour
le contenu principal : acteurs réels clonés ou modèle propriétaire, puis **segments parlés courts
(≤ 10-15 s) entrecoupés de b-roll du même personnage**, ce qui masque aussi la répétition des gestes.
Les pipelines indépendants d'influenceurs IA (astorie.ai, mai 2026) : Kling Avatar / Hedra pour la
tête parlante, ElevenLabs pour la voix, Seedance / Kling / Runway pour le b-roll muet, Submagic /
Captions pour les sous-titres. Conseils convergents : audio expressif d'abord, générations < 30 s,
peu de rotations de tête, pas de gestes complexes, tester dans la langue cible.

## 3. Réalisme (« ça fait IA »)

- Modèles image jugés les plus « photo de téléphone » : **Nano Banana 2** (pores visibles, moins de
  lissage — getimg.ai 27 fév. 2026, Arena) et **FLUX.2 Pro** (« skin texture still leads »). PiAPI écrit
  lui-même que Seedream 5 « feels closer to a 3D render » face à Nano Banana 2 ; ZenCreator (1 juil. 2026)
  trouve Seedream 5.0 « more visible AI look » que 4.5. **À trancher par un A/B en aveugle** (Nano Banana 2
  est déjà sur PiAPI, 0,06 $/img).
- Techniques de prompt qui font consensus : contrat caméra unique (« candid handheld smartphone photo »),
  peau non retouchée avec pores et asymétrie, UNE source de lumière imparfaite, regard hors caméra ou
  « caught mid-sentence », cadrage décentré, grain léger ; **supprimer** « 8K, masterpiece, flawless,
  photorealistic, hyper-realistic ».
- Post-traitement vidéo (grain temporel `noise=alls=…:allf=t`, contraste +3 %, saturation −3 %, LUT
  < 50 %) : recommandé par les praticiens, **effet non mesuré** (aucune étude contrôlée) ; TikTok et
  Instagram ré-encodent et lissent une partie du grain. Coût réel constaté : le grain fait exploser le
  débit (34 Mbit/s en CRF 22) → plafonner à 8 Mbit/s.

## 4. Montage court (conventions 2026)

| Règle | Chiffre | Source |
|---|---|---|
| Visage à l'image dès la frame 0, message clé avant 3 s | 63 % des pubs à meilleur CTR ; 90 % de la mémorisation dans les 6 premières s | TikTok Creative Tips (PDF officiel, non daté) |
| Durée moyenne réellement regardée d'un Reel | **8,5 s** | Metricool Instagram Study, 16 juin 2026 (24,3 M posts) |
| B-roll | 3-5 s max ; ouvrir sur un visage = +28 % de rétention précoce ; 6 % des clips seulement utilisent du b-roll | OpusClip research, 13 avr. 2026 (13,5 M clips) |
| Cadence de coupe | TikTok 1,5-3 s, Reels 2,5-4 s | Shortzly (8 août 2026, non sourcé) |
| Sous-titres | mot à mot surligné, police grasse 700-900, blanc + contour noir, 6-9 % de la hauteur, éviter 25 % bas et 15 % haut | OpusClip (6 mai 2026), Blitzcut, CaptionPlug |
| Zones sûres 1080×1920 | Meta : 14 % haut, 20-35 % bas, 6 % côtés ; TikTok : ~150 px haut, 440 px bas, 180 px droite | billo, behaviour.digital, AdManage (page Meta officielle derrière connexion : **non vérifiée à la source**) |
| Musique | 15-20 dB sous la voix ; master −14 LUFS / −1 dBTP | Protunes, TrackGleam |

Les pourcentages de rétention avancés par les vendeurs de sous-titres (+12-40 %) n'ont pas de
méthodologie publiée.

## 5. Musique de fond par API

| Option | Prix | Droits | Verdict |
|---|---|---|---|
| **Eleven Music** (`POST /v1/music`) | 0,15 $/min | commercial dès le plan Starter (compte = Creator) | **retenu**, testé le 4 sept. (15 s → mp3 en ≈ 20 s) |
| Google Lyria 3.5 Clip | 0,04 $/clip de 30 s | conditions commerciales non trouvées | plan B |
| Mubert API | 199 $/mois (5 000 pistes) | sous-licence aux utilisateurs incluse | à volume (> 1 500 vidéos/mois) |
| Suno / Udio via revendeurs | 0,014-0,11 $ | marché gris, pas d'API officielle | **à éviter** |
| Pixabay | gratuit | pas d'endpoint musique, téléchargement de masse interdit | bibliothèque manuelle seulement |

## 6. Ce qui a été implémenté le 4 septembre

1. Continuité de tenue : tenue de la vidéo résolue une fois, keyframe du décor partagé entre plans
   parlés et b-roll, photo + description de la tenue dans le prompt Seedance.
2. OmniHuman 1.5 par défaut ; Kling signalé comme non francophone.
3. Réalisateur : règles du format hybride (accroche ≤ 8 mots, talk 3-7 s, plan de coupe 2-5 s,
   alternance, inserts photo ancrés sur des mots), règles d'écriture (interdits, détail concret, question
   finale).
4. Inserts photo (keyframes en cache dans d'autres cadrages, ou le décor seul) incrustés en Ken Burns
   pendant la parole : jamais avant 2 s, 1,5-3 s, espacés de 1,5 s.
5. Sous-titres karaoké ASS (Poppins ExtraBold, jaune sur blanc, contour noir, bas du texte à 1 220 px,
   marge droite 190 px).
6. Musique Eleven Music instrumentale ≈ −17 dB avec fondu, prompt écrit par le LLM depuis l'histoire.
7. Grain temporel léger + contraste, encodage plafonné à 8 Mbit/s.
8. Prompts image/vidéo « photo de téléphone » (pores, une source de lumière, pas de « 4K / flawless »).

Non fait, à décider : A/B Nano Banana 2 vs Seedream 5 pour les keyframes ; Hailuo ou photos animées
pour un b-roll moins cher que Seedance ; banc InfiniteTalk / VEED (clés manquantes) ; Sync
lipsync-2-pro en rattrapage de lèvres ; J-cuts (aucune preuve d'efficacité trouvée pour ce type de contenu).

## 7. Deuxième retour utilisateur (4 septembre, après-midi) et mesures

Retour sur la vidéo v2.1 : « lip-sync OK, qualité vidéo pas top, inserts sans rapport avec ce qui est
dit, l'histoire n'a aucun sens ».

| Constat vérifié | Mesure |
|---|---|
| L'histoire mélangeait Séville (brief) et « minuit à Tana, 12 °C » (contexte réel injecté) : souvenir raconté depuis le balcon, texte en fragments. | Règles réalisateur : monologue autonome (le spectateur n'a pas lu l'histoire), un lieu / un moment, contexte réel de sa ville ignoré si l'histoire se passe ailleurs. Vérifié en dry-run : « Je m'arrête net, en plein Santa Cruz… Un petit pot de basilic, coincé entre deux volets bleus… » |
| Inserts = gros plans de son visage pendant qu'elle parle d'un grelot. | Insert « illustration » par défaut : image générée de ce dont elle parle (sans identité, 9:16, ≈ 0,07 $) ; son visage seulement si elle parle d'elle. Vérifié : capsules de Coca sur un portail pendant « des capsules de Coca à son portail ». |
| Keyframe 3:4 en 1K (864×1152) → OmniHuman 960×1280 → agrandi ×1,5 et recadré + grain = image molle. | Cadrage `talk` 9:16 en 2K (1440×2560), Lanczos, grain désactivé, CRF 21 / 12 Mbit/s. Résultat nettement plus net à l'œil. |
| **OmniHuman 1.5 sur PiAPI n'a aucun paramètre de résolution** (doc officielle : image_url, audio_url, prompt, fast_mode, seed ; audio < 35 s) et plafonne ≈ 1,2 Mpx : 832×1472 pour une entrée 1440×2560. | Le 1080p natif n'existe que chez fal.ai (`resolution: "1080p"`, 0,16 $/s) — pas de clé. |
| PiAPI Video Upscale (`Qubico/video-toolkit` / `upscale`) : 2× seulement, entrée ≤ 1280×720 et ≤ 10 Mo, 10-240 images, 0,0003 $/image. Refuse 832×1472. Testé sur le clip réduit à 720×1280 : 2 min, 0,034 $. | Gain marginal (un peu de détail sur les textures, peau lissée) → non intégré. |
| Première soumission OmniHuman parfois « Invalid input » puis succès identique au 2e essai. | Les 3 essais automatiques suffisent ; à surveiller. |

Décision utilisateur (4 sept.) : **rester sur PiAPI**, pas d'autre fournisseur.

## 8. Test Seedance 2.5 (4 septembre, sur demande de l'utilisateur)

Clip de 5 s, `seedance-2.5-less-restriction`, 1080p, 9:16, références : portrait, planche, décor Santa Cruz,
keyframe (tenue), voix ElevenLabs en @audio1 ; phrase française dans le prompt.

| Mesure | Résultat |
|---|---|
| Temps | 4 min 40 |
| Coût réel | **4,40 $** (0,88 $/s) ; 720p aurait coûté 1,93 $ ; OmniHuman 0,65 $ |
| Sortie | 1080×1920, HEVC 10 bits, 24 fps, 22 Mbit/s |
| Image | nette (pores visibles), mouvement très naturel (elle entre dans le cadre, se tourne, gestes), tenue et décor du keyframe respectés |
| Français | voix synthétisée par Seedance (le mp3 ElevenLabs ne sert que de timbre) : **à juger à l'oreille** |

Fichier : Storage `avatar-assets/bench/seedance25/voahangy-santa-cruz-1080p.mp4`.

**Verdict utilisateur : « trop top ».** Seedance 2.5 devient le modèle par défaut (plans parlés et plans
de coupe), 720p par défaut, 1080p en option.

## 9. Pipeline v2.3 (Seedance 2.5, voix native) et test de 30 s

- Plans parlés : `seedance-2.5-less-restriction`, prompt avec la réplique (« she speaks FRENCH and says
  exactly… »), mp3 ElevenLabs de la réplique en `@audio1` (timbre), keyframe 9:16 2K en référence.
- Plans de coupe : même modèle, narration dite par Seedance (« a French voice-over narrates… »), donc
  une seule voix dans toute la vidéo ; plus aucun mix ElevenLabs au montage.
- Sous-titres : transcription du clip par ElevenLabs Scribe (`scribe_v2`, ≈ 4 s, `source_url`),
  orthographe recalée sur le script, score « texte reconnu » par plan (contrôle de ce qui est dit).
- **Limite PiAPI : 2 tâches Seedance 2.5 simultanées** (HTTP 429 au-delà). Géré comme une file
  d'attente, pas comme un échec. Conséquence : ≈ 35 min pour une vidéo de 30 s.

Test « Callos et malentendus à Séville » (4 sept., 720p) : 7 plans, 32 s, ≈ 13 $, texte reconnu
86-100 %, visages 0,62-0,74. Contenu `d2371e3f-5dd6-48de-bf89-19924c66a44b`.
**Verdict utilisateur : 5/10** — tenue qui change sur un plan (chapeau perdu, chignon, vêtements
marron), sous-titres jugés moches, histoire hachée, « scripts pas naturels ».

## 10. Prise unique (v2.4) — réponse au 5/10

Un plan monté en 7 rendus séparés = 7 occasions pour le modèle de réinventer un détail. Seedance 2.5
accepte 30 s d'un coup : le réalisateur écrit désormais UNE prise (`singleTake`) — un monologue de
50 à 65 mots en parlé naturel (phrase d'installation explicite, connecteurs oraux, style télégraphique
interdit), une timeline de 4 à 6 temps, 0 à 2 inserts. Sous-titres désactivés par défaut.

Test 480p (solde PiAPI insuffisant pour 720p) : contenu `b87d0eb0-87bf-4e7e-8fb5-2c6a5be2c160`,
22 s, un seul rendu de 9 min 30, 3,70 $, texte reconnu 97 %, visage 0,71, **même tenue du début à la
fin**, la carte, l'assiette qui arrive, elle goûte. Prononciations à corriger dans le script :
« tapas » → « tapis », « Voahangy » → « Vo Henki ».

Contraintes PiAPI apprises : « Insufficient credits » (code 10002) si le clip dépasse le solde, la
recharge automatique ne se déclenche ni sur refus ni sur petite tâche ; seul le titulaire du compte
peut recharger.
