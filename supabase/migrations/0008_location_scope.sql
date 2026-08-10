-- VIRALYA — distinction lieux de vie (permanents) / lieux de passage (une seule vidéo).
-- 'permanent' → appartient à l'univers de l'avatar, réutilisé à vie.
-- 'oneoff'    → décor de référence d'UNE vidéo (ex. toilettes d'un McDo), hors univers.

alter table avatar_locations
  add column if not exists scope text not null default 'permanent';

alter table avatar_locations drop constraint if exists avatar_locations_scope_check;
alter table avatar_locations add constraint avatar_locations_scope_check
  check (scope in ('permanent','oneoff'));
