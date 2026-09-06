-- 0017 — Plateforme complète (7 sept. 2026) : abonnements Stripe, budget de génération par
-- organisation, registre des dépenses IA, pilote automatique du calendrier, état du système.
-- À appliquer dans l'éditeur SQL Supabase (comme 0010 → 0016).

-- Organisation : abonnement et budget mensuel de génération (ce que la plateforme dépense en IA pour le client).
alter table organizations add column if not exists monthly_budget_usd     numeric(8,2);   -- fixé à la main (admin) ; null = règle du forfait
alter table organizations add column if not exists plan_code              text;           -- starter | pro | studio (catalogue dans domain/billing.ts)
alter table organizations add column if not exists subscription_status    text;           -- active | trialing | past_due | canceled | incomplete | unpaid
alter table organizations add column if not exists stripe_customer_id     text;
alter table organizations add column if not exists stripe_subscription_id text;
alter table organizations add column if not exists current_period_end     timestamptz;
alter table organizations add column if not exists billing_email          text;
create index if not exists idx_orgs_stripe_customer on organizations (stripe_customer_id);

-- Registre des dépenses IA : une ligne par génération lancée (estimation), complétée par le coût réel à la fin.
create table if not exists usage_ledger (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  avatar_id        uuid references avatars(id) on delete set null,
  content_item_id  uuid references content_items(id) on delete set null,
  kind             text not null,                        -- video | ad_product | explainer | clone | photo | carousel | story | clip | daily
  estimated_usd    numeric(8,3) not null default 0,
  actual_usd       numeric(8,3),                         -- renseigné par assemble quand le coût réel est connu
  created_at       timestamptz not null default now()
);
create index if not exists idx_usage_org_month on usage_ledger (org_id, created_at desc);
create index if not exists idx_usage_item      on usage_ledger (content_item_id);

-- Événements Stripe déjà traités (idempotence des webhooks).
create table if not exists billing_events (
  id          text primary key,                          -- id de l'événement Stripe
  type        text not null,
  received_at timestamptz not null default now()
);

-- Calendrier : pilote automatique (les entrées planifiées partent seules, dans la limite du budget).
alter table content_plans add column if not exists auto_produce   boolean not null default false;
alter table content_plans add column if not exists auto_lead_days int     not null default 1;   -- produire J-1 (les vidéos prennent ≈ 15 min)

-- État du système (battement de cœur du worker, dernier passage du pilote automatique…).
create table if not exists system_status (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
