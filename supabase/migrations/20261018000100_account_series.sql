-- ============================================================================
-- MasterAdmin · Serie mensual de UNA cuenta (organización o tenant) para las
-- fichas 360
-- ----------------------------------------------------------------------------
-- V4 visual para Gerencia, fase 11. Diccionario: docs/finance/EXECUTIVE_KPI_DICTIONARY.md (S11)
--
-- Qué hace (sólo lectura, aditivo):
--   · executive_account_series: por mes, el MRR contratado (S01 acotado), lo
--     facturado y lo cobrado (S06 acotado) de UNA organización facturada o de
--     UN tenant, en moneda de reporte. Alimenta los mini-gráficos «MRR 12
--     meses» y «facturado vs cobrado» de la ficha 360 de organización y del
--     Tenant 360.
--       MRR        executive_mrr_at al cierre de cada mes (mes en curso a hoy)
--                  filtrado por billed_organization_id / tenant_id: la MISMA
--                  definición que la serie del tablero (S01).
--       invoiced   facturas ISSUED/PARTIALLY_PAID/PAID por fecha de emisión
--                  (fórmula de executive_billing_series) de la organización
--                  (customer_organization_id) o de las suscripciones del tenant.
--       collected  v_collected_payments por collected_on (= K02) con el mismo
--                  alcance.
--
-- Qué NO hace:
--   · No redefine vistas ni funciones existentes ni cambia ningún cálculo.
--   · No duplica lógica FX: cada (mes, moneda) se convierte con
--     to_reporting_amount a la tasa del cierre del mes (o de hoy en el mes en
--     curso); el MRR se convierte por suscripción (executive_mrr_at).
--     MISSING_FX → NULL, nunca 0.
--   · SECURITY INVOKER, sin GRANT a anon: el filtro es de ALCANCE, RLS decide
--     qué filas suma cada rol (un partner no ve cuentas ajenas).
--
-- Rollback (sólo objeto de lectura, sin datos):
--   drop function if exists platform.executive_account_series(uuid, uuid, date, date, char);
-- ============================================================================

create or replace function platform.executive_account_series(
  p_organization_id    uuid default null,
  p_tenant_id          uuid default null,
  p_from               date default null,
  p_to                 date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month              date,
  as_of              date,
  is_partial         boolean,
  reporting_currency char(3),
  mrr                numeric,
  invoiced           numeric,
  collected          numeric,
  mrr_native         jsonb,
  invoiced_native    jsonb,
  collected_native   jsonb,
  complete           boolean,
  missing_currencies text[],
  fx_is_demo         boolean
)
language plpgsql
stable
security invoker
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  v_cur  date := date_trunc('month', current_date)::date;
  v_to   date := least(date_trunc('month', coalesce(p_to, current_date))::date, v_cur);
  v_from date := date_trunc('month', coalesce(p_from, (v_to - interval '11 months')::date))::date;
  v_rc   char(3);
  v_age  integer;
begin
  if (p_organization_id is null) = (p_tenant_id is null) then
    raise exception 'CUENTA_INVALIDA: indica una organización o un tenant (uno solo)'
      using errcode = '22023';
  end if;
  if v_from > v_to then
    raise exception 'RANGO_INVALIDO: el inicio (%) es posterior al fin (%) o está en el futuro', v_from, v_to
      using errcode = '22023';
  end if;
  if v_from < (v_to - interval '119 months')::date then
    raise exception 'RANGO_INVALIDO: la serie admite como máximo 120 meses'
      using errcode = '22023';
  end if;
  select c.reporting_currency, c.fx_max_rate_age_days into v_rc, v_age
    from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with months as (
    select g::date as m,
           least((g + interval '1 month - 1 day')::date, current_date) as at,
           (g + interval '1 month - 1 day')::date as eom
      from generate_series(v_from, v_to, interval '1 month') g
  ),
  -- Suscripciones del tenant (alcance de facturas y cobros en modo tenant).
  tsubs as (
    select s.id from platform.subscriptions s where s.tenant_id = p_tenant_id
  ),
  mrr_src as (
    select mo.m, e.native_currency as currency, e.native_mrr as amount,
           e.reporting_mrr as reporting_amount, e.conversion_status, e.fx_is_demo
      from months mo
      cross join lateral platform.executive_mrr_at(mo.at, v_rc, mo.at) e
     where (p_organization_id is not null and e.billed_organization_id = p_organization_id)
        or (p_tenant_id is not null and e.tenant_id = p_tenant_id)
  ),
  inv as (
    select date_trunc('month', coalesce(i.issue_date, i.created_at::date))::date as m,
           i.currency::char(3) as currency, sum(i.total) as amount
      from platform.invoices i
     where i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
       and coalesce(i.issue_date, i.created_at::date) between v_from and current_date
       and ((p_organization_id is not null and i.customer_organization_id = p_organization_id)
         or (p_tenant_id is not null and i.subscription_id in (select id from tsubs)))
     group by 1, 2
  ),
  col as (
    select c.collected_month as m, c.currency::char(3) as currency, sum(c.collected_amount) as amount
      from platform.v_collected_payments c
     where c.collected_on between v_from and current_date
       and ((p_organization_id is not null and c.customer_organization_id = p_organization_id)
         or (p_tenant_id is not null and c.subscription_id in (select id from tsubs)))
     group by 1, 2
  ),
  facts as (
    select 'MRR'::text as kind, x.m, x.currency, x.amount, x.reporting_amount, x.conversion_status, x.fx_is_demo
      from mrr_src x
    union all
    select f.kind, f.m, f.currency, f.amount, r.reporting_amount, r.conversion_status, r.fx_is_demo
      from (select 'INV'::text as kind, inv.m, inv.currency, inv.amount from inv
            union all
            select 'COL', col.m, col.currency, col.amount from col) f
      join months mo on mo.m = f.m
      cross join lateral platform.to_reporting_amount(f.amount, f.currency, mo.at, v_rc, v_age) r
  ),
  agg as (
    select f.m, f.kind,
           bool_and(f.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(f.reporting_amount) as amount,
           bool_or(coalesce(f.fx_is_demo, false)) as demo
      from facts f
     group by f.m, f.kind
  ),
  native as (
    select n.m, n.kind, jsonb_object_agg(n.currency, n.amount order by n.currency) as j
      from (select f.m, f.kind, f.currency, sum(f.amount) as amount
              from facts f group by f.m, f.kind, f.currency) n
     group by n.m, n.kind
  ),
  missing as (
    select f.m, array_agg(distinct f.currency::text order by f.currency::text) as cur
      from facts f
     where f.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')
     group by f.m
  )
  select
    mo.m,
    mo.at,
    mo.at < mo.eom,
    v_rc,
    case when coalesce(am.ok, true) then coalesce(am.amount, 0) end,
    case when coalesce(ai.ok, true) then coalesce(ai.amount, 0) end,
    case when coalesce(ac.ok, true) then coalesce(ac.amount, 0) end,
    coalesce(nm.j, '{}'::jsonb),
    coalesce(ni.j, '{}'::jsonb),
    coalesce(nc.j, '{}'::jsonb),
    coalesce(am.ok, true) and coalesce(ai.ok, true) and coalesce(ac.ok, true),
    coalesce(ms.cur, '{}'::text[]),
    coalesce(am.demo, false) or coalesce(ai.demo, false) or coalesce(ac.demo, false)
  from months mo
  left join agg am on am.m = mo.m and am.kind = 'MRR'
  left join agg ai on ai.m = mo.m and ai.kind = 'INV'
  left join agg ac on ac.m = mo.m and ac.kind = 'COL'
  left join native nm on nm.m = mo.m and nm.kind = 'MRR'
  left join native ni on ni.m = mo.m and ni.kind = 'INV'
  left join native nc on nc.m = mo.m and nc.kind = 'COL'
  left join missing ms on ms.m = mo.m
  order by mo.m;
end;
$$;

comment on function platform.executive_account_series(uuid, uuid, date, date, char) is
  'Serie mensual de UNA cuenta (organización facturada o tenant) en moneda de reporte: MRR contratado '
  '(executive_mrr_at al cierre, = S01 acotado), facturado por emisión y cobrado (v_collected_payments, = S06 '
  'acotado). Mes en curso a hoy (is_partial). NULL si falta una tasa. Exactamente uno de p_organization_id / '
  'p_tenant_id. Por defecto 12 meses; máximo 120. SECURITY INVOKER.';

revoke all on function platform.executive_account_series(uuid, uuid, date, date, char) from public, anon;
grant execute on function platform.executive_account_series(uuid, uuid, date, date, char) to authenticated, service_role;
