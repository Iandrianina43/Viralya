-- VIRALYA V1 — planification quotidienne via pg_cron (remplace n8n).
-- Si pg_cron indisponible : activer l'extension (Dashboard > Database > Extensions),
-- ou déclencher manuellement via POST /admin/enqueue-daily.
create extension if not exists pg_cron;

-- Tous les jours à 06:00 : planifier le contenu du jour des avatars actifs.
select cron.schedule('viralya-daily-content', '0 6 * * *',
  $$ select enqueue_daily_content(); $$);
