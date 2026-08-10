-- ─────────────────────────────────────────────────────────────
-- VIRALYA — fonctions de la queue maison
-- ─────────────────────────────────────────────────────────────

-- Claim atomique d'un lot de jobs prêts. Utilise FOR UPDATE SKIP LOCKED
-- pour permettre plusieurs workers concurrents sans double-traitement.
create or replace function claim_jobs(p_worker text, p_limit int default 5)
returns setof jobs
language plpgsql
as $$
begin
  return query
  update jobs j
     set status     = 'running',
         locked_at  = now(),
         locked_by  = p_worker,
         attempts   = j.attempts + 1,
         updated_at = now()
   where j.id in (
     select id
       from jobs
      where status = 'pending'
        and run_after <= now()
      order by run_after
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

-- Enfile un job plan_day pour chaque avatar actif (appelé par pg_cron).
create or replace function enqueue_daily_content()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  insert into jobs (type, payload)
  select 'plan_day', jsonb_build_object('avatar_id', a.id)
    from avatars a
   where a.status = 'active';
  get diagnostics n = row_count;
  return n;
end;
$$;
