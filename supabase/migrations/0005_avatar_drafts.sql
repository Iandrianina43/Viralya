-- VIRALYA V1 — brouillons de création d'avatar (Chat Ultime).
-- Sauvegarde la conversation + la fiche en cours, côté serveur (auto-save).

create table if not exists avatar_drafts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Brouillon',
  messages   jsonb not null default '[]',   -- [{role, content}]
  fiche      jsonb not null default '{}',    -- persona en cours
  ready      boolean not null default false, -- fiche assez complète ?
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_avatar_drafts_updated on avatar_drafts (updated_at desc);
create trigger trg_avatar_drafts_updated before update on avatar_drafts
  for each row execute function set_updated_at();
alter table avatar_drafts enable row level security;
