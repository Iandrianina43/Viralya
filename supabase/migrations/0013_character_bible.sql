-- ─────────────────────────────────────────────────────────────
-- VIRALYA — Phase 1 : Character Bible, garde-robe, cache de keyframes, QC, photos
-- Idempotent.
-- ─────────────────────────────────────────────────────────────

-- ── Pack de références validées (identité visuelle) ──────────
create table if not exists avatar_references (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  kind        text not null check (kind in
                ('portrait','three_quarter','profile','half_body','full_body','expression','outfit','sheet','other')),
  label       text,
  url         text not null,
  prompt      text,
  model       text,                      -- modèle qui a produit l'image
  face_score  real,                      -- similarité au portrait principal (SFace, cosinus)
  validated   boolean not null default false,
  is_primary  boolean not null default false,
  version     integer not null default 1,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_refs_avatar on avatar_references (avatar_id, kind, validated);

-- ── Garde-robe canonique ─────────────────────────────────────
create table if not exists avatar_wardrobe (
  id             uuid primary key default gen_random_uuid(),
  avatar_id      uuid not null references avatars(id) on delete cascade,
  name           text not null,
  description_en text not null,          -- description figée injectée dans les prompts
  ref_url        text,                   -- image de la tenue portée par le personnage
  is_default     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_wardrobe_avatar on avatar_wardrobe (avatar_id);

-- ── Cache de keyframes validés (avatar × lieu × cadrage × tenue) ──
create table if not exists avatar_keyframes (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid not null references avatars(id) on delete cascade,
  location_id  uuid references avatar_locations(id) on delete set null,
  outfit_id    uuid references avatar_wardrobe(id) on delete set null,
  framing      text,                     -- ex. "medium shot", "selfie", "full body"
  url          text not null,
  prompt       text,
  model        text,
  face_score   real,
  validated    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_keyframes_avatar on avatar_keyframes (avatar_id, location_id, validated);

-- ── Rapports de contrôle qualité ─────────────────────────────
create table if not exists qc_reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('image','video','content','reference','keyframe')),
  target_id   uuid not null,
  avatar_id   uuid references avatars(id) on delete cascade,
  checks      jsonb not null default '{}',   -- {face_score, faces, duration_ok, ...}
  score       real,
  passed      boolean,
  reviewed_by uuid,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_qc_target on qc_reports (target_type, target_id);

-- ── Modèle photo retenu par influenceur (résultat du banc d'essai) ──
alter table avatars add column if not exists image_model text;

-- ── Nouveau type de contenu "photo" et job "generate_photo" ──
alter table content_items drop constraint if exists content_items_type_check;
alter table content_items add constraint content_items_type_check
  check (type in ('video','hook','carousel','story','tweet','photo'));

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check
  check (type in ('plan_day','generate_text','generate_video','poll_video',
                  'generate_image','generate_photo','assemble','schedule','publish'));

alter table avatar_references enable row level security;
alter table avatar_wardrobe   enable row level security;
alter table avatar_keyframes  enable row level security;
alter table qc_reports        enable row level security;
