# Viralya — instructions projet

Viralya est un SaaS de creation et de gestion d'influenceurs IA (avatars, univers, calendrier
editorial, generation photo/video/UGC, validation humaine, publication).

## Document de reference

**Lire `docs/BRIEF.md` avant toute decision importante.** C'est le cadrage produit complet
(3 septembre 2026) : parcours utilisateur, Character Bible, World Bible, calendrier avec
storytelling, pipeline video, UGC, task center, versioning, QC, couts, robustesse.
Il prime sur `docs/v1-scope.md` (perimetre historique, en partie obsolete : HeyGen/Argil retires).

## Regle absolue : ne jamais coder a l'aveugle

Pour toute decision importante (modele IA, architecture, workflow de generation, API reseaux
sociaux) : PROBLEME -> RECHERCHE INTERNET -> COMPARAISON -> VALIDATION -> ARCHITECTURE -> IMPLEMENTATION.
- Verifier la documentation actuelle ; ne jamais supposer qu'un modele a une capacite.
- Ne jamais presenter une hypothese comme un fait. Tester ce qui doit etre teste. Signaler l'incertain.
- Si une idee du client est techniquement mauvaise, proposer une meilleure approche au lieu de l'implementer.
- Ne jamais inventer de l'avancement dans les comptes rendus.

## Methode de travail

- Auditer l'existant avant de modifier en profondeur ; ne pas detruire ce qui fonctionne.
- Construire a partir de l'existant quand c'est pertinent.
- Couts IA toujours en tete : comparer fournisseurs et modeles, cacher le reutilisable, zero generation inutile.
- Rester strictement dans ce depot (ne pas lire d'autres dossiers du disque).

## Stack (etat au 3 septembre 2026)

- Monorepo pnpm : `apps/api` (Node/Express/TS, worker de jobs maison sur Supabase),
  `apps/web` (React/Vite/Tailwind), `packages/shared` (enums + schemas zod), `supabase/migrations`.
- Video : PiAPI (Seedance 2.0, variantes less-restriction par defaut). Images : OpenAI GPT Image.
  Voix : ElevenLabs. Texte : Anthropic (claude-sonnet-5, filtrer les blocs "thinking").
- La base Supabase est partagee avec un ancien worker sur le VPS : le claim passe par `claim_jobs_v2`
  (migration 0011). Ne pas reactiver `claim_jobs`.
- Windows : `setDefaultResultOrder("ipv4first")` requis pour joindre api.piapi.ai.
