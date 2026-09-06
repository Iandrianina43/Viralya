-- 0018 — Audit de production (7 sept. 2026) : RLS sur les tables des phases 3 et 5, invitations
-- d'équipe par e-mail, journal d'audit. À appliquer dans l'éditeur SQL Supabase après 0017.

-- 1) Row-level security : l'API passe par la clé service (elle contourne RLS) ; la clé anon ne doit
--    rien lire. Aucune politique = tout refusé pour anon/authenticated.
alter table if exists content_plans      enable row level security;
alter table if exists plan_entries       enable row level security;
alter table if exists social_profiles    enable row level security;
alter table if exists ugc_campaigns      enable row level security;
alter table if exists ugc_variants       enable row level security;
alter table if exists social_connections enable row level security;
alter table if exists usage_ledger       enable row level security;
alter table if exists billing_events     enable row level security;
alter table if exists system_status      enable row level security;
alter table if exists avatar_locations   enable row level security;

-- 2) Invitations d'équipe : envoyées par e-mail, acceptées automatiquement à l'inscription (même adresse).
create table if not exists org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('admin','member')),
  token       text not null unique,
  invited_by  uuid,
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_org_invites_email on org_invites (lower(email)) where accepted_at is null;
create index if not exists idx_org_invites_org   on org_invites (org_id, created_at desc);
alter table org_invites enable row level security;

-- 3) Journal d'audit des actions sensibles (membres, rôles, bannissements, budget, impersonation admin).
create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid,
  user_id    uuid,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_org on audit_log (org_id, created_at desc);
alter table audit_log enable row level security;

-- 4) Espaces personnels : un seul espace « personnel » créé automatiquement par utilisateur
--    (protège ensurePersonalOrg contre les doubles créations concurrentes).
alter table organizations add column if not exists personal_of uuid;
create unique index if not exists uq_org_personal_of on organizations (personal_of) where personal_of is not null;

-- 5) Le cron quotidien V1 (plan_day) est remplacé par le pilote automatique du calendrier.
do $$ begin
  perform cron.unschedule('viralya-daily-content');
exception when others then null; end $$;
