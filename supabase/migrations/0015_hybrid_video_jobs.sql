-- ─────────────────────────────────────────────────────────────
-- VIRALYA — vidéo v2 hybride (phase 2, 4 sept. 2026).
-- Nouveaux types de jobs : generate_voice (ElevenLabs, voix d'abord),
-- generate_shots (plans parlés Kling Avatar / OmniHuman + b-roll Seedance),
-- poll_shots (suivi + montage ffmpeg). Les plans vivent dans content_items.assets.shots
-- (pas de nouvelle table). Idempotent.
-- ─────────────────────────────────────────────────────────────

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check
  check (type in ('plan_day','generate_text','generate_video','poll_video',
                  'generate_voice','generate_shots','poll_shots',
                  'generate_image','generate_photo','assemble','schedule','publish'));
