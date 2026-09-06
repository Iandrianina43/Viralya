-- ─────────────────────────────────────────────────────────────
-- VIRALYA — garde-fou du contenu quotidien.
-- Incident du 3 sept. 2026 : 5 jobs plan_day accumulés par pg_cron pendant que le
-- worker était arrêté ont tourné EN PARALLÈLE au redémarrage ; le contrôle
-- « déjà planifié aujourd'hui » n'était pas atomique → 5 vidéos Seedance facturées.
--  1) verrou (avatar, jour) : un seul plan_day par influenceur et par jour ;
--  2) enqueue_daily_content n'empile plus de plan_day si un est déjà en attente.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────

create table if not exists daily_plans (
  avatar_id  uuid not null references avatars(id) on delete cascade,
  day        date not null,
  job_id     uuid,
  created_at timestamptz not null default now(),
  primary key (avatar_id, day)
);
alter table daily_plans enable row level security;

create or replace function enqueue_daily_content()
returns integer language plpgsql as $$
declare n integer;
begin
  insert into jobs (type, payload, avatar_id, label)
  select 'plan_day', jsonb_build_object('avatar_id', a.id), a.id, 'Contenu du jour'
    from avatars a
   where a.status = 'active'
     and not exists (
       select 1 from jobs j
        where j.type = 'plan_day' and j.status in ('pending','running')
          and (j.payload->>'avatar_id')::uuid = a.id
     );
  get diagnostics n = row_count;
  return n;
end; $$;
