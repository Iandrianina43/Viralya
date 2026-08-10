-- ─────────────────────────────────────────────────────────────
-- VIRALYA — planification via pg_cron (remplace le cron de n8n)
--
-- NB Supabase : si "create extension pg_cron" échoue faute de droits,
-- activer l'extension via Dashboard > Database > Extensions (schema `extensions`),
-- puis rejouer uniquement la partie cron.schedule ci-dessous.
-- En local sans pg_cron : déclencher manuellement via l'endpoint
-- POST /admin/enqueue-daily (voir apps/api).
-- ─────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

-- Tous les jours à 06:00 (H-6 avant la fenêtre de publication) :
-- planifier le contenu du jour pour chaque avatar actif.
select cron.schedule(
  'viralya-daily-content',
  '0 6 * * *',
  $$ select enqueue_daily_content(); $$
);
