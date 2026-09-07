-- 0019 — Publication réelle via Zernio (7 sept. 2026) : un profil Zernio par influenceur, un compte
-- connecté par réseau, journal d'idempotence des webhooks. À appliquer dans l'éditeur SQL Supabase.

-- Profil Zernio de l'influenceur (créé au premier « Connecter »). Un profil Zernio n'accepte qu'un
-- compte par réseau : c'est exactement « un influenceur = un compte Instagram + un TikTok + … ».
alter table avatars add column if not exists publisher_profile_id text;
create index if not exists idx_avatars_publisher_profile on avatars (publisher_profile_id) where publisher_profile_id is not null;

-- Connexions : le fournisseur Zernio remplace Ayrshare (jamais activé) ; l'ancienne valeur reste
-- acceptée pour d'éventuelles lignes existantes.
alter table social_connections drop constraint if exists social_connections_provider_check;
alter table social_connections add constraint social_connections_provider_check check (provider in ('zernio','ayrshare','simulated'));
alter table social_connections add column if not exists external_account_id text;         -- id du compte chez Zernio
alter table social_connections add column if not exists handle              text;         -- @nom sur le réseau
alter table social_connections add column if not exists profile_url         text;
alter table social_connections add column if not exists picture_url         text;
alter table social_connections add column if not exists followers           integer;      -- abonnés réels (analytics Zernio)
alter table social_connections add column if not exists last_synced_at      timestamptz;
alter table social_connections add column if not exists consent             jsonb not null default '{}'::jsonb; -- {ai_label, at}
create unique index if not exists uq_social_connections_external on social_connections (provider, external_account_id);
create index if not exists idx_social_connections_avatar on social_connections (avatar_id, status);

-- Événements de webhook déjà traités (Zernio livre « au moins une fois »).
create table if not exists integration_events (
  id          text primary key,                 -- '<fournisseur>:<id d'événement>'
  provider    text not null,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table integration_events enable row level security;
