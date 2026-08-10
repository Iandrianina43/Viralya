-- ─────────────────────────────────────────────────────────────
-- VIRALYA — Écosystème vivant : lieu de vie + mémoire narrative
-- (histoires qui continuent, faits, événements, journal de contenu).
-- ─────────────────────────────────────────────────────────────

-- Lieu de vie de l'avatar (météo, fuseau, contexte local).
alter table avatars add column if not exists city text default '';
alter table avatars add column if not exists country text default '';
alter table avatars add column if not exists timezone text default 'Europe/Paris';

-- Mémoire narrative persistante par avatar.
--   fact         : trait durable de sa vie/personnalité
--   storyline    : arc narratif en cours (status open/resolved)
--   life_event   : quelque chose qui lui est "arrivé"
--   content_ref  : résumé d'un contenu déjà publié (anti-répétition + continuité)
create table if not exists avatar_memory (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references avatars(id) on delete cascade,
  kind        text not null check (kind in ('fact','storyline','life_event','content_ref')),
  summary     text not null,
  details     jsonb not null default '{}',
  status      text not null default 'active' check (status in ('active','open','resolved')),
  importance  smallint not null default 3 check (importance between 1 and 5),
  occurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_memory_avatar on avatar_memory (avatar_id, created_at desc);
create index if not exists idx_memory_kind on avatar_memory (avatar_id, kind, status);
alter table avatar_memory enable row level security;

-- ── Seed : ancrer Lucas Martin à Dubaï + amorcer sa mémoire ──
update avatars
   set city = 'Dubaï', country = 'AE', timezone = 'Asia/Dubai'
 where id = '11111111-1111-1111-1111-111111111111'
   and (city is null or city = '');

insert into avatar_memory (avatar_id, kind, summary, status, importance) values
  ('11111111-1111-1111-1111-111111111111', 'fact',
   'Lucas a quitté son CDI à 28 ans pour bâtir son business avec l''IA depuis Dubaï.', 'active', 5),
  ('11111111-1111-1111-1111-111111111111', 'fact',
   'Il utilise et recommande Loomy CRM et Talk Flow au quotidien.', 'active', 4),
  ('11111111-1111-1111-1111-111111111111', 'storyline',
   'A lancé un défi public "30 jours pour automatiser ton business avec l''IA" — épisodes en cours.', 'open', 4),
  ('11111111-1111-1111-1111-111111111111', 'life_event',
   'Vient de dépasser un cap de croissance et prépare une nouvelle offre pour sa communauté.', 'active', 3)
on conflict do nothing;
