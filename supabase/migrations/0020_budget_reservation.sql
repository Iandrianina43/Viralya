-- 0020 — Réservation ATOMIQUE du budget mensuel (14 sept. 2026, audit P1).
-- Avant : vérification puis insertion séparées → deux lancements simultanés passaient le même plafond.
-- Maintenant : une fonction SQL verrouille la ligne de l'organisation, somme le mois, refuse ou inscrit.
-- À appliquer dans l'éditeur SQL Supabase (après 0017). Sans elle, le code retombe sur l'ancien chemin.

create or replace function reserve_usage(
  p_org       uuid,
  p_avatar    uuid,
  p_item      uuid,
  p_kind      text,
  p_estimated numeric,
  p_budget    numeric          -- null = illimité
)
returns table (ledger_id uuid, spent numeric, allowed boolean)
language plpgsql
as $$
declare
  v_spent numeric := 0;
  v_id    uuid;
  v_month timestamptz := (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
begin
  -- Sérialise les réservations d'une même organisation (les autres organisations ne s'attendent pas).
  perform 1 from organizations where id = p_org for update;

  select coalesce(sum(coalesce(u.actual_usd, u.estimated_usd)), 0)
    into v_spent
    from usage_ledger u
   where u.org_id = p_org and u.created_at >= v_month;

  if p_budget is not null and v_spent + coalesce(p_estimated, 0) > p_budget + 0.001 then
    return query select null::uuid, v_spent, false;
    return;
  end if;

  insert into usage_ledger (org_id, avatar_id, content_item_id, kind, estimated_usd)
  values (p_org, p_avatar, p_item, p_kind, greatest(0, coalesce(p_estimated, 0)))
  returning usage_ledger.id into v_id;

  return query select v_id, v_spent + greatest(0, coalesce(p_estimated, 0)), true;
end
$$;

revoke all on function reserve_usage(uuid, uuid, uuid, text, numeric, numeric) from public;
grant execute on function reserve_usage(uuid, uuid, uuid, text, numeric, numeric) to service_role;
