-- VIRALYA V1 — voix ElevenLabs choisie à la création (identité de l'avatar).
alter table avatars add column if not exists eleven_voice_id text;
alter table avatars add column if not exists eleven_voice_name text;
