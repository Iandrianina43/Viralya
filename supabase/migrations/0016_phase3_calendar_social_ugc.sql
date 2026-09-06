-- Phase 3 (BRIEF § 3, 9, 10, 11, 12, 14, 21) : calendrier éditorial mensuel avec storytelling,
-- compte social simulé (profil, feed, statistiques), campagnes UGC avec matrice de variations,
-- publication simulée puis réelle (connexions), onboarding (aucune table : dérivé des données).
-- À appliquer dans l'éditeur SQL Supabase (pas d'accès DDL depuis l'API).

-- ── Calendrier éditorial ─────────────────────────────────────
create table if not exists content_plans (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  month       date not null,                       -- 1er jour du mois
  status      text not null default 'draft' check (status in ('draft','active','archived')),
  brief       text,                                -- consigne de l'utilisateur (objectifs, voyages, campagnes)
  strategy    jsonb not null default '{}'::jsonb,  -- piliers, séries, arcs, objectifs, mix
  cost_usd    numeric(8,3) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (avatar_id, month)
);

create table if not exists plan_entries (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references content_plans(id) on delete cascade,
  avatar_id        uuid not null references avatars(id) on delete cascade,
  day              date not null,
  slot             text not null default 'midi' check (slot in ('matin','midi','soir')),
  type             text not null check (type in ('video','photo','carousel','story','ugc')),
  format           text,                           -- video : single_take | hybrid ; photo : selfie | portrait | lifestyle…
  network          text not null default 'instagram' check (network in ('instagram','tiktok','youtube','x','facebook')),
  ratio_class      text not null default 'value' check (ratio_class in ('value','proof','sale')),
  pillar           text,
  series           text,
  arc              text,                           -- fil narratif (ex. « Voyage à Séville »)
  title            text not null,
  brief            text not null,                  -- ce qu'elle vit / montre (FR), consigne du réalisateur
  location_key     text,
  status           text not null default 'planned'
                     check (status in ('planned','generating','ready','scheduled','published','skipped','failed')),
  content_item_id  uuid references content_items(id) on delete set null,
  position         smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists plan_entries_avatar_day on plan_entries(avatar_id, day);

-- ── Compte social simulé ─────────────────────────────────────
create table if not exists social_profiles (
  id              uuid primary key default gen_random_uuid(),
  avatar_id       uuid not null references avatars(id) on delete cascade,
  network         text not null check (network in ('instagram','tiktok','youtube','x','facebook')),
  handle          text not null,
  display_name    text not null,
  bio             text not null default '',
  link            text,
  base_followers  integer not null default 0,      -- audience de départ (simulée)
  following       integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (avatar_id, network)
);

-- Statistiques d'un contenu publié (simulées ou réelles) + traçabilité de publication.
alter table content_items add column if not exists stats            jsonb not null default '{}'::jsonb;
alter table content_items add column if not exists plan_entry_id    uuid references plan_entries(id) on delete set null;
alter table content_items add column if not exists ai_label         boolean not null default true;
alter table content_items add column if not exists publish_provider text;      -- simulated | ayrshare
alter table content_items add column if not exists external_post_id text;      -- id chez le fournisseur de publication
alter table content_items add column if not exists external_url     text;

-- ── Campagnes UGC ────────────────────────────────────────────
create table if not exists ugc_campaigns (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  brand       text not null,
  product     jsonb not null default '{}'::jsonb,  -- {name, description, image_url, url, price, key_benefits[]}
  objective   text not null default 'awareness',   -- awareness | consideration | conversion
  target      text,
  tone        text,
  language    text not null default 'fr',
  matrix      jsonb not null default '{}'::jsonb,  -- {avatar_ids[], angles[], hooks_per_angle, durations[], ctas[]}
  status      text not null default 'draft' check (status in ('draft','scripted','producing','done','archived')),
  cost_usd    numeric(8,3) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists ugc_variants (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references ugc_campaigns(id) on delete cascade,
  avatar_id        uuid not null references avatars(id) on delete cascade,
  label            text not null,                  -- ex. « A1-H2-30s »
  angle            text not null,
  hook             text not null,
  duration_sec     integer not null default 30,
  cta              text,
  script           jsonb not null default '{}'::jsonb,  -- {beats:[{beat, seconds, line, action}], caption, hashtags}
  status           text not null default 'scripted'
                     check (status in ('scripted','generating','ready','failed','archived')),
  content_item_id  uuid references content_items(id) on delete set null,
  est_cost_usd     numeric(8,3) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ugc_variants_campaign on ugc_variants(campaign_id);

-- ── Connexions de publication réelle (phase 4) ───────────────
-- Secrets globaux (clé Ayrshare) dans l'environnement ; ici seulement l'identifiant de profil par influenceur.
create table if not exists social_connections (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  avatar_id     uuid references avatars(id) on delete cascade,
  provider      text not null check (provider in ('ayrshare','simulated')),
  profile_key   text,
  networks      text[] not null default '{}',
  display_name  text,
  status        text not null default 'active' check (status in ('active','disabled','error')),
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Jobs ─────────────────────────────────────────────────────
alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check
  check (type in ('plan_day','generate_text','generate_video','poll_video',
                  'generate_voice','generate_shots','poll_shots',
                  'generate_image','generate_photo','assemble','schedule','publish',
                  'generate_plan','sync_stats'));
