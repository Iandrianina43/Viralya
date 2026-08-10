-- ─────────────────────────────────────────────────────────────
-- VIRALYA V1 — schéma A + B + C
--
-- ⚠️ REBUILD : ce script REPART D'UNE BASE PROPRE. Il supprime les
-- tables de la v0 si elles existent. À exécuter sur le projet Supabase.
-- (Alternative : créer un nouveau projet Supabase et exécuter à partir de "create".)
-- ─────────────────────────────────────────────────────────────
drop table if exists analytics_daily cascade;
drop table if exists orders cascade;
drop table if exists leads cascade;
drop table if exists content_calendar cascade;
drop table if exists content_items cascade;
drop table if exists jobs cascade;
drop table if exists avatar_memory cascade;
drop table if exists products cascade;
drop table if exists assets cascade;
drop table if exists avatars cascade;

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── A : avatars ──────────────────────────────────────────────
create table avatars (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  niche                 text not null,
  sex_age               text default '',
  nationality           text default '',
  city                  text default '',
  timezone              text not null default 'Europe/Paris',
  personality           text[] default '{}',
  tone_of_voice         text default '',
  values                text[] default '{}',
  clothing_style        text default '',
  backstory             text default '',
  business_positioning  text default '',
  target_audience       text default '',
  products              text[] default '{}',
  priority_networks     text[] default '{instagram,tiktok}',
  is_ai_disclosed       boolean not null default true,
  status                text not null default 'draft' check (status in ('draft','active','paused')),
  video_provider        text not null default 'heygen' check (video_provider in ('heygen','argil','stub')),
  video_avatar_id       text,
  voice_id              text,
  ref_image_url         text,
  system_prompt         text default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_avatars_updated before update on avatars
  for each row execute function set_updated_at();

-- ── A : mémoire narrative ────────────────────────────────────
create table avatar_memory (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  kind        text not null check (kind in ('fact','storyline','life_event','content_ref')),
  summary     text not null,
  status      text not null default 'active' check (status in ('active','open','resolved')),
  importance  smallint not null default 3 check (importance between 1 and 5),
  occurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index idx_memory_avatar on avatar_memory (avatar_id, created_at desc);
create index idx_memory_kind on avatar_memory (avatar_id, kind, status);

-- ── B : content_items ────────────────────────────────────────
create table content_items (
  id            uuid primary key default gen_random_uuid(),
  avatar_id     uuid not null references avatars(id) on delete cascade,
  type          text not null check (type in ('video','hook','carousel','story','tweet')),
  network       text not null check (network in ('instagram','tiktok','youtube','x','facebook')),
  ratio_class   text not null default 'value' check (ratio_class in ('value','proof','sale')),
  status        text not null default 'queued'
                  check (status in ('queued','generating','needs_review','scheduled','published','failed')),
  payload       jsonb not null default '{}',
  assets        jsonb not null default '{}',
  scheduled_at  timestamptz,
  published_at  timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_content_avatar_status on content_items (avatar_id, status);
create trigger trg_content_updated before update on content_items
  for each row execute function set_updated_at();

-- ── B : calendrier éditorial ─────────────────────────────────
create table content_calendar (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  week_start  date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  theme       text not null,
  ratio_class text not null default 'value' check (ratio_class in ('value','proof','sale')),
  created_at  timestamptz not null default now()
);
create index idx_calendar_avatar on content_calendar (avatar_id, week_start);

-- ── B : queue maison ─────────────────────────────────────────
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in
                    ('plan_day','generate_text','generate_video','poll_video',
                     'generate_image','assemble','schedule','publish')),
  status          text not null default 'pending'
                    check (status in ('pending','running','done','failed','canceled')),
  payload         jsonb not null default '{}',
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  error           text,
  content_item_id uuid references content_items(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_jobs_ready on jobs (run_after) where status = 'pending';
create trigger trg_jobs_updated before update on jobs
  for each row execute function set_updated_at();

-- ── Assets (références Storage) ──────────────────────────────
create table assets (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid references avatars(id) on delete cascade,
  kind         text not null,
  url          text,
  storage_path text,
  created_at   timestamptz not null default now()
);

-- RLS deny-by-default (l'API utilise la service_role qui bypasse RLS).
alter table avatars          enable row level security;
alter table avatar_memory    enable row level security;
alter table content_items    enable row level security;
alter table content_calendar enable row level security;
alter table jobs             enable row level security;
alter table assets           enable row level security;
