-- 0022 — Tarification en crédits (14 sept. 2026, docs/TARIFICATION-CREDITS.md).
--   1 crédit = 0,10 $ de coût fournisseur. Deux soldes par organisation : crédits mensuels du forfait
--   (remis à zéro à chaque période) et crédits achetés (top-up, persistants). Consommation : mensuel
--   d'abord, top-up ensuite. Réservation atomique (verrou sur le portefeuille), mouvements journalisés.
--   Les prix vivent dans `pricing_config` (versionné : un client garde le tarif souscrit).

-- Tarifs versionnés (le code embarque la version 1 en repli).
create table if not exists pricing_config (
  version     integer primary key,
  config      jsonb not null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table pricing_config enable row level security;

-- Portefeuille de crédits (une ligne par organisation, créée à la première réservation).
create table if not exists credit_wallets (
  org_id           uuid primary key references organizations(id) on delete cascade,
  monthly_credits  integer not null default 0,   -- reste du mois
  monthly_granted  integer not null default 0,   -- alloué pour la période (forfait ou budget manuel)
  period_start     timestamptz,
  period_end       timestamptz,                  -- remise à zéro passée cette date (lazy) ou sur facture Stripe payée
  topup_credits    integer not null default 0,   -- achetés, jamais expirés
  updated_at       timestamptz not null default now()
);
alter table credit_wallets enable row level security;

-- Mouvements : débit (réservation), remboursement (rendu / coût réel plus bas), top-up, allocation, ajustement.
create table if not exists credit_transactions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  kind             text not null check (kind in ('debit','refund','settle','topup','grant','adjust')),
  credits          integer not null,             -- signé : négatif = consommé
  monthly_part     integer not null default 0,   -- part signée prise sur / rendue au solde mensuel
  topup_part       integer not null default 0,
  usage_ledger_id  uuid references usage_ledger(id) on delete set null,
  stripe_ref       text,                         -- id de session / facture Stripe (idempotence)
  note             text,
  created_at       timestamptz not null default now()
);
create unique index if not exists uq_credit_tx_stripe on credit_transactions (stripe_ref) where stripe_ref is not null;
create index if not exists idx_credit_tx_org on credit_transactions (org_id, created_at desc);
create index if not exists idx_credit_tx_ledger on credit_transactions (usage_ledger_id);
alter table credit_transactions enable row level security;

-- Le registre des coûts garde les dollars ; on y ajoute les crédits réservés.
alter table usage_ledger add column if not exists credits integer;

-- Organisation : budget manuel en crédits (remplace monthly_budget_usd, converti ×10), version tarifaire souscrite.
alter table organizations add column if not exists manual_monthly_credits integer;
alter table organizations add column if not exists pricing_version integer;
alter table organizations add column if not exists plan_setup_paid boolean not null default false;
update organizations set manual_monthly_credits = round(monthly_budget_usd * 10)
  where monthly_budget_usd is not null and manual_monthly_credits is null;

-- Réservation atomique : mensuel d'abord, top-up ensuite ; refus sans écriture si insuffisant.
create or replace function reserve_credits(p_org uuid, p_credits integer, p_ledger uuid, p_kind text)
returns table (allowed boolean, tx_id uuid, monthly_part integer, topup_part integer, monthly_left integer, topup_left integer)
language plpgsql as $$
declare
  w credit_wallets%rowtype;
  v_m integer := 0;
  v_t integer := 0;
  v_id uuid;
begin
  select * into w from credit_wallets where org_id = p_org for update;
  if not found then
    return query select false, null::uuid, 0, 0, 0, 0; return;
  end if;
  if coalesce(p_credits, 0) <= 0 then
    return query select true, null::uuid, 0, 0, w.monthly_credits, w.topup_credits; return;
  end if;
  if w.monthly_credits + w.topup_credits < p_credits then
    return query select false, null::uuid, 0, 0, w.monthly_credits, w.topup_credits; return;
  end if;
  v_m := least(w.monthly_credits, p_credits);
  v_t := p_credits - v_m;
  update credit_wallets set monthly_credits = monthly_credits - v_m, topup_credits = topup_credits - v_t, updated_at = now() where org_id = p_org;
  insert into credit_transactions (org_id, kind, credits, monthly_part, topup_part, usage_ledger_id, note)
    values (p_org, 'debit', -p_credits, -v_m, -v_t, p_ledger, p_kind) returning id into v_id;
  return query select true, v_id, -v_m, -v_t, w.monthly_credits - v_m, w.topup_credits - v_t;
end $$;

-- Ajustement signé (remboursement, top-up, ajustement admin) ; le mensuel ne dépasse jamais l'alloué,
-- aucun solde ne passe sous zéro. `p_stripe_ref` unique → un même paiement n'est crédité qu'une fois.
create or replace function adjust_credits(p_org uuid, p_monthly integer, p_topup integer, p_kind text, p_ledger uuid, p_stripe_ref text, p_note text)
returns table (applied boolean, monthly_left integer, topup_left integer)
language plpgsql as $$
declare
  w credit_wallets%rowtype;
  v_m integer;
  v_t integer;
begin
  insert into credit_wallets (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into w from credit_wallets where org_id = p_org for update;
  if p_stripe_ref is not null and exists (select 1 from credit_transactions where stripe_ref = p_stripe_ref) then
    return query select false, w.monthly_credits, w.topup_credits; return;
  end if;
  v_m := greatest(0, least(w.monthly_granted, w.monthly_credits + coalesce(p_monthly, 0)));
  v_t := greatest(0, w.topup_credits + coalesce(p_topup, 0));
  update credit_wallets set monthly_credits = v_m, topup_credits = v_t, updated_at = now() where org_id = p_org;
  insert into credit_transactions (org_id, kind, credits, monthly_part, topup_part, usage_ledger_id, stripe_ref, note)
    values (p_org, p_kind, (v_m - w.monthly_credits) + (v_t - w.topup_credits), v_m - w.monthly_credits, v_t - w.topup_credits, p_ledger, p_stripe_ref, p_note);
  return query select true, v_m, v_t;
end $$;

-- Allocation de période : remet le mensuel à `p_credits` (valeur absolue, pas un ajout) et fixe la période.
create or replace function grant_credits(p_org uuid, p_credits integer, p_period_start timestamptz, p_period_end timestamptz, p_stripe_ref text, p_note text)
returns table (applied boolean, monthly_left integer, topup_left integer)
language plpgsql as $$
declare
  w credit_wallets%rowtype;
begin
  insert into credit_wallets (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into w from credit_wallets where org_id = p_org for update;
  if p_stripe_ref is not null and exists (select 1 from credit_transactions where stripe_ref = p_stripe_ref) then
    return query select false, w.monthly_credits, w.topup_credits; return;
  end if;
  update credit_wallets set monthly_credits = greatest(0, p_credits), monthly_granted = greatest(0, p_credits),
    period_start = p_period_start, period_end = p_period_end, updated_at = now() where org_id = p_org;
  insert into credit_transactions (org_id, kind, credits, monthly_part, topup_part, stripe_ref, note)
    values (p_org, 'grant', greatest(0, p_credits) - w.monthly_credits, greatest(0, p_credits) - w.monthly_credits, 0, p_stripe_ref, p_note);
  return query select true, greatest(0, p_credits), w.topup_credits;
end $$;

revoke all on function reserve_credits(uuid, integer, uuid, text) from public;
revoke all on function adjust_credits(uuid, integer, integer, text, uuid, text, text) from public;
revoke all on function grant_credits(uuid, integer, timestamptz, timestamptz, text, text) from public;
grant execute on function reserve_credits(uuid, integer, uuid, text) to service_role;
grant execute on function adjust_credits(uuid, integer, integer, text, uuid, text, text) to service_role;
grant execute on function grant_credits(uuid, integer, timestamptz, timestamptz, text, text) to service_role;
