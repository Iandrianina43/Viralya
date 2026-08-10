-- ─────────────────────────────────────────────────────────────
-- VIRALYA — schéma initial (MVP)
-- ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- Trigger utilitaire : maj automatique de updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── M1 : avatars (fiche personnage) ──────────────────────────
create table if not exists avatars (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  niche                 text not null,
  sex_age               text default '',
  nationality           text default '',
  personality           text[] default '{}',
  tone_of_voice         text default '',
  values                text[] default '{}',
  clothing_style        text default '',
  backstory             text default '',
  business_positioning  text default '',
  target_audience       text default '',
  affiliate_products    text[] default '{}',
  priority_networks     text[] default '{instagram,tiktok,email}',
  is_ai_disclosed       boolean not null default true,
  status                text not null default 'draft'
                          check (status in ('draft','active','paused')),
  voice_id              text,               -- ElevenLabs
  heygen_avatar_id      text,               -- HeyGen
  ref_image_url         text,
  system_prompt         text default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_avatars_updated before update on avatars
  for each row execute function set_updated_at();

-- ── M5 : produits maison ─────────────────────────────────────
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  avatar_id      uuid references avatars(id) on delete set null,
  name           text not null,
  description    text default '',
  price_cents    integer not null default 0,
  currency       char(3) not null default 'EUR',
  pricing_model  text not null
                   check (pricing_model in ('one_shot','subscription','per_lead','commission')),
  stripe_price_id text,
  landing_slug   text unique,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- ── M2/M3 : content_items ────────────────────────────────────
create table if not exists content_items (
  id            uuid primary key default gen_random_uuid(),
  avatar_id     uuid not null references avatars(id) on delete cascade,
  type          text not null
                  check (type in ('hook','carousel','story','video','tweet','email')),
  network       text not null
                  check (network in ('instagram','tiktok','youtube','x','facebook','email')),
  ratio_class   text not null default 'value'
                  check (ratio_class in ('value','proof','sale')),
  status        text not null default 'queued'
                  check (status in ('queued','generating','ready','needs_review','scheduled','published','failed')),
  payload       jsonb not null default '{}',
  assets        jsonb not null default '{}',
  scheduled_at  timestamptz,
  published_at  timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_content_avatar_status on content_items (avatar_id, status);
create trigger trg_content_updated before update on content_items
  for each row execute function set_updated_at();

-- ── M3 : calendrier éditorial ────────────────────────────────
create table if not exists content_calendar (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  week_start  date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  theme       text not null,
  ratio_class text not null default 'value'
                check (ratio_class in ('value','proof','sale')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_calendar_avatar_week on content_calendar (avatar_id, week_start);

-- ── M2 orchestration : jobs (queue maison, remplace n8n) ─────
create table if not exists jobs (
  id              uuid primary key default gen_random_uuid(),
  type            text not null
                    check (type in ('plan_day','generate_text','generate_voice','generate_video',
                                    'poll_video','generate_image','assemble','schedule','publish')),
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
-- Index clé pour le polling du worker (pending prêts à tourner)
create index if not exists idx_jobs_ready on jobs (run_after) where status = 'pending';
create trigger trg_jobs_updated before update on jobs
  for each row execute function set_updated_at();

-- ── M7 : leads (double opt-in RGPD) ──────────────────────────
create table if not exists leads (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  avatar_id    uuid not null references avatars(id) on delete cascade,
  source       text not null default 'landing',
  utm          jsonb not null default '{}',
  status       text not null default 'pending_optin'
                 check (status in ('pending_optin','confirmed','unsubscribed')),
  optin_token  text,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (email, avatar_id)
);

-- ── M5 : orders (Stripe) ─────────────────────────────────────
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete restrict,
  avatar_id         uuid references avatars(id) on delete set null,
  email             text,
  amount_cents      integer not null default 0,
  currency          char(3) not null default 'EUR',
  status            text not null default 'pending'
                      check (status in ('pending','paid','refunded','failed')),
  stripe_session_id text unique,
  created_at        timestamptz not null default now()
);

-- ── M8 : analytics quotidien ─────────────────────────────────
create table if not exists analytics_daily (
  avatar_id         uuid not null references avatars(id) on delete cascade,
  day               date not null,
  views             integer not null default 0,
  engagement_rate   numeric not null default 0,
  leads             integer not null default 0,
  revenue_cents     integer not null default 0,
  content_published integer not null default 0,
  primary key (avatar_id, day)
);

-- ── Assets (références Storage) ──────────────────────────────
create table if not exists assets (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid references avatars(id) on delete cascade,
  kind         text not null,        -- audio | video | image
  url          text,
  storage_path text,
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- ── RLS : deny-by-default. L'API utilise la service_role key
--     (qui bypasse RLS). Le front passe TOUJOURS par l'API.
alter table avatars          enable row level security;
alter table products         enable row level security;
alter table content_items    enable row level security;
alter table content_calendar enable row level security;
alter table jobs             enable row level security;
alter table leads            enable row level security;
alter table orders           enable row level security;
alter table analytics_daily  enable row level security;
alter table assets           enable row level security;
