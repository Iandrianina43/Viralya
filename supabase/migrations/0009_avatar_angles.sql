-- VIRALYA — pack multi-angles du visage (cohérence de l'identité).
-- Plusieurs portraits du même avatar (face, 3/4, profil, plan taille) injectés
-- comme références multiples dans la composition des scènes.

alter table avatars
  add column if not exists ref_angles jsonb not null default '[]'::jsonb;
