-- 0021 — Kit de lancement d'un influenceur (14 sept. 2026, demande de Jérôme).
-- Tout ce qu'il faut pour créer ses comptes à la main : réseaux recommandés, noms de compte,
-- e-mail, bios par réseau, accroches et bannières générées, checklist des étapes manuelles.
create table if not exists launch_kits (
  avatar_id   uuid primary key references avatars(id) on delete cascade,
  identity    jsonb not null default '{}'::jsonb,  -- réseaux, noms, e-mail, bios, accroches (générés puis édités)
  checklist   jsonb not null default '{}'::jsonb,  -- { réseau: { étape: true } }
  notes       jsonb not null default '{}'::jsonb,  -- { handle, email, phone, email_domain } — ce qui a servi
  banners     jsonb not null default '[]'::jsonb,  -- [{ id, network, url, hook, with_avatar, cost_usd, created_at }]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_launch_kits_updated on launch_kits;
create trigger trg_launch_kits_updated before update on launch_kits
  for each row execute function set_updated_at();
alter table launch_kits enable row level security;
