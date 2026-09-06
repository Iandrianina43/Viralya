-- ─────────────────────────────────────────────────────────────
-- VIRALYA — Phase 0 : fondations SaaS (3 septembre 2026)
--  1) Organisations (tenants) + membres ; rattachement des données existantes
--  2) Jobs robustes : progression, journal, annulation, heartbeat, reprise des orphelins
--  3) Versions de contenu
--  4) Statut "canceled" pour les contenus
-- Idempotent : peut être rejoué sans dommage.
-- ─────────────────────────────────────────────────────────────

-- ── 1) Organisations ─────────────────────────────────────────
create table if not exists organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  plan       text not null default 'free',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_orgs_updated on organizations;
create trigger trg_orgs_updated before update on organizations
  for each row execute function set_updated_at();

create table if not exists memberships (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists idx_memberships_user on memberships (user_id);

alter table avatars       add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table avatar_drafts add column if not exists org_id uuid references organizations(id) on delete cascade;
create index if not exists idx_avatars_org on avatars (org_id, created_at desc);
create index if not exists idx_drafts_org  on avatar_drafts (org_id, updated_at desc);

-- Données existantes → organisation "Viralya" ; tous les comptes existants en deviennent membres
-- (les admins de la plateforme en sont propriétaires).
do $$
declare v_org uuid;
begin
  if exists (select 1 from avatars where org_id is null)
     or exists (select 1 from avatar_drafts where org_id is null) then
    insert into organizations (name, slug, plan) values ('Viralya', 'viralya', 'internal')
      on conflict (slug) do nothing;
    select id into v_org from organizations where slug = 'viralya';
    update avatars       set org_id = v_org where org_id is null;
    update avatar_drafts set org_id = v_org where org_id is null;
    insert into memberships (org_id, user_id, role)
    select v_org, u.id,
           case when u.raw_user_meta_data->>'role' = 'admin' then 'owner' else 'member' end
      from auth.users u
    on conflict do nothing;
  end if;
end $$;

-- ── 2) Jobs robustes ─────────────────────────────────────────
alter table jobs
  add column if not exists avatar_id        uuid references avatars(id) on delete cascade,
  add column if not exists label            text,
  add column if not exists progress         smallint not null default 0,
  add column if not exists logs             jsonb not null default '[]'::jsonb,
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists heartbeat_at     timestamptz;
create index if not exists idx_jobs_avatar on jobs (avatar_id, created_at desc);
create index if not exists idx_jobs_item   on jobs (content_item_id, created_at desc);

-- Reprise des jobs orphelins : un job "running" sans battement de cœur depuis
-- p_stale_seconds est remis en file (ou passé en échec s'il a épuisé ses essais).
create or replace function reap_stale_jobs(p_stale_seconds int default 300)
returns integer language plpgsql as $$
declare n integer;
begin
  update jobs
     set status     = case when attempts < max_attempts then 'pending' else 'failed' end,
         locked_at  = null,
         locked_by  = null,
         error      = 'worker interrompu — reprise automatique',
         run_after  = now(),
         updated_at = now()
   where status = 'running'
     and coalesce(heartbeat_at, locked_at, updated_at) < now() - make_interval(secs => p_stale_seconds);
  get diagnostics n = row_count;

  -- Les jobs définitivement perdus entraînent leur contenu en échec.
  update content_items c
     set status = 'failed', error = 'Production interrompue (worker perdu)'
   where c.status in ('queued','generating')
     and exists (select 1 from jobs j where j.content_item_id = c.id
                   and j.status = 'failed' and j.error like 'worker interrompu%');
  return n;
end $$;

-- ── 3) Versions de contenu ───────────────────────────────────
create table if not exists content_versions (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  version_no      integer not null,
  status          text,
  payload         jsonb not null default '{}',
  assets          jsonb not null default '{}',
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (content_item_id, version_no)
);
create index if not exists idx_versions_item on content_versions (content_item_id, version_no desc);
alter table content_items add column if not exists current_version integer not null default 0;
alter table content_items add column if not exists title text;

-- ── 4) Statut "canceled" ─────────────────────────────────────
alter table content_items drop constraint if exists content_items_status_check;
alter table content_items add constraint content_items_status_check
  check (status in ('queued','generating','needs_review','scheduled','published','failed','canceled'));

-- ── RLS deny-by-default sur les nouvelles tables (l'API passe par service_role) ──
alter table organizations    enable row level security;
alter table memberships      enable row level security;
alter table content_versions enable row level security;
