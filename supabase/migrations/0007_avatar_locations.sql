-- VIRALYA — Univers de lieux persistants par avatar (chambre, café, rue…)
-- Chaque lieu = description canonique (EN, injectée dans les prompts) + image de référence.

create table if not exists avatar_locations (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid not null references avatars(id) on delete cascade,
  key          text not null,             -- identifiant stable (ex: "bedroom", "cafe")
  name         text not null,             -- nom lisible FR (ex: "Sa chambre")
  description  text not null,             -- description canonique EN ultra-précise (cohérence)
  ref_image_url text,                     -- image de référence du lieu (sans personnage)
  created_at   timestamptz not null default now(),
  unique (avatar_id, key)
);
create index if not exists idx_locations_avatar on avatar_locations (avatar_id);
