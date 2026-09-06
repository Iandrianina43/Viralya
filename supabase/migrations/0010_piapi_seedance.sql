-- V2 — PiAPI/Seedance 2.0 devient le moteur vidéo principal.
-- Nouveaux attributs d'avatar : fiche portrait structurée, character sheet
-- (planche 8 vues, référence d'identité Seedance) et échantillons de timbre
-- (2 mp3 ElevenLabs passés en @audio1/@audio2).

alter table avatars
  add column if not exists portrait_spec       jsonb,
  add column if not exists character_sheet_url text,
  add column if not exists voice_sample_urls   jsonb not null default '[]'::jsonb;

-- Le moteur vidéo n'est plus un choix par avatar : piapi pour tout le monde
-- (stub conservé pour les environnements sans clé).
alter table avatars drop constraint if exists avatars_video_provider_check;
update avatars set video_provider = 'piapi' where video_provider not in ('piapi', 'stub');
alter table avatars alter column video_provider set default 'piapi';
alter table avatars
  add constraint avatars_video_provider_check check (video_provider in ('piapi', 'stub'));
