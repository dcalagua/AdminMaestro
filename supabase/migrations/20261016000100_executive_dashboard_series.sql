-- ============================================================================
-- MasterAdmin · Series del Resumen Ejecutivo — facturado/cobrado/vencida por mes,
-- puente de MRR por mes y mix de MRR por partner
-- ----------------------------------------------------------------------------
-- V4 visual para Gerencia, fase 09. Diccionario: docs/finance/EXECUTIVE_KPI_DICTIONARY.md (S06–S08)
--
-- Qué hace (sólo lectura, aditivo sobre 20261015000100_executive_series):
--   · executive_billing_series: por mes, facturado (facturas computables por
--     fecha de emisión), cobrado (pagos CONFIRMED con la fórmula de
--     v_collected_payments, la misma de collections_by_month y K02) y cartera
--     vencida al cierre del mes (bandas D1_30…D90_MAS de
--     executive_receivables_aging), en moneda de reporte.
--   · executive_mrr_movements_series: el puente de MRR (executive_mrr_movements)
--     de cada mes de un rango, en una sola llamada (NRR y churn del tablero).
--   · executive_mrr_mix acepta además la dimensión PARTNER (canal que gestiona
--     el tenant; «Venta directa» si no hay partner), con la misma regla de
--     cuadre: Σ mrr del mix = punto de la serie del mes.
--
-- Qué NO hace:
--   · No redefine vistas ni read models existentes; executive_mrr_mix conserva
--     su firma, columnas y comportamiento para PRODUCT/MARKET.
--   · No duplica lógica FX: cada (mes, moneda) se convierte con
--     to_reporting_amount a la tasa del cierre del mes (o de hoy en el mes en
--     curso). MISSING_FX → NULL, nunca 0.
--   · SECURITY INVOKER, sin GRANT a anon: cada rol suma sólo lo que RLS le muestra.
--
-- Rollback (sólo objetos de lectura, sin datos):
--   drop function if exists platform.executive_billing_series(date, date, char);
--   drop function if exists platform.executive_mrr_movements_series(date, date, char);
--   -- executive_mrr_mix: volver a aplicar la definición de 20261015000100 (§5).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Facturado, cobrado y vencida por mes, en moneda de reporte.
--
-- Un punto por mes calendario entre p_from y p_to (por defecto los últimos 12
-- meses incluido el actual; máximo 120). El mes en curso se mide a HOY
-- (is_partial). No hay meses futuros.
--   invoiced   Σ total de facturas ISSUED/PARTIALLY_PAID/PAID emitidas en el mes
--              (coalesce(issue_date, created_at)). Las anuladas y borradores no.
--   collected  Σ collected_amount de v_collected_payments con collected_on en el
--              mes (= collections_by_month).
--   collection_rate  collected / invoiced del mismo mes (razón 0–n; NULL si no
--              hubo facturación o falta una tasa). Es razón de caja del mes, no
--              cohorte: un mes puede superar 1 si se cobró atraso.
--   overdue    saldo vencido (D1_30 + D31_60 + D61_90 + D90_MAS) al cierre del mes
--              según executive_receivables_aging(as_of). SIN_FECHA no cuenta.
-- Cada importe es NULL si alguna de sus monedas no tiene tasa (complete=false y
-- missing_currencies la nombra); los *_native conservan los importes exactos.
-- ---------------------------------------------------------------------------
create or replace function platform.executive_billing_series(
  p_from               date default null,
  p_to                 date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month                 date,
  as_of                 date,
  is_partial            boolean,
  reporting_currency    char(3),
  invoiced              numeric,
  collected             numeric,
  collection_rate       numeric,
  overdue               numeric,
  invoice_count         integer,
  payment_count         integer,
  overdue_invoice_count integer,
  invoiced_native       jsonb,
  collected_native      jsonb,
  complete              boolean,
  missing_currencies    text[],
  fx_is_demo            boolean
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
  inv as (
    select date_trunc('month', coalesce(i.issue_date, i.created_at::date))::date as m,
           i.currency::char(3) as currency, sum(i.total) as amount, count(*)::int as n
      from platform.invoices i
     where i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
       and coalesce(i.issue_date, i.created_at::date) between v_from and current_date
     group by 1, 2
  ),
  col as (
    select c.collected_month as m, c.currency::char(3) as currency,
           sum(c.collected_amount) as amount, count(*)::int as n
      from platform.v_collected_payments c
     where c.collected_on between v_from and current_date
     group by 1, 2
  ),
  facts as (
    select 'INV'::text as kind, inv.m, inv.currency, inv.amount, inv.n from inv
    union all
    select 'COL', col.m, col.currency, col.amount, col.n from col
  ),
  conv as (
    select f.*, r.reporting_amount, r.conversion_status, r.fx_is_demo
      from facts f
      join months mo on mo.m = f.m
      cross join lateral platform.to_reporting_amount(f.amount, f.currency, mo.at, v_rc, v_age) r
  ),
  agg as (
    select cv.m, cv.kind,
           bool_and(cv.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(cv.reporting_amount) as amount,
           sum(cv.n)::int as n,
           jsonb_object_agg(cv.currency, cv.amount order by cv.currency) as native,
           array_agg(cv.currency::text order by cv.currency::text)
             filter (where cv.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')) as missing,
           bool_or(coalesce(cv.fx_is_demo, false)) as demo
      from conv cv
     group by cv.m, cv.kind
  ),
  od as (
    select mo.m,
           bool_and(a.complete) as ok,
           sum(a.balance) as amount,
           sum(a.invoice_count)::int as n,
           array_agg(distinct x.c order by x.c) filter (where x.c is not null) as missing,
           bool_or(a.fx_is_demo) as demo
      from months mo
      cross join lateral platform.executive_receivables_aging(mo.at, v_rc) a
      left join lateral unnest(a.missing_currencies) as x(c) on true
     where a.aging_bucket in ('D1_30', 'D31_60', 'D61_90', 'D90_MAS')
     group by mo.m
  )
  select
    mo.m,
    mo.at,
    mo.at < mo.eom,
    v_rc,
    case when coalesce(ai.ok, true) then coalesce(ai.amount, 0) end,
    case when coalesce(ac.ok, true) then coalesce(ac.amount, 0) end,
    case when coalesce(ai.ok, true) and coalesce(ac.ok, true) and coalesce(ai.amount, 0) <> 0
         then round(coalesce(ac.amount, 0) / ai.amount, 4) end,
    case when coalesce(od.ok, true) then coalesce(od.amount, 0) end,
    coalesce(ai.n, 0),
    coalesce(ac.n, 0),
    coalesce(od.n, 0),
    coalesce(ai.native, '{}'::jsonb),
    coalesce(ac.native, '{}'::jsonb),
    coalesce(ai.ok, true) and coalesce(ac.ok, true) and coalesce(od.ok, true),
    coalesce(
      (select array_agg(distinct u.c order by u.c)
         from unnest(coalesce(ai.missing, '{}') || coalesce(ac.missing, '{}') || coalesce(od.missing, '{}')) as u(c)),
      '{}'::text[]),
    coalesce(ai.demo, false) or coalesce(ac.demo, false) or coalesce(od.demo, false)
  from months mo
  left join agg ai on ai.m = mo.m and ai.kind = 'INV'
  left join agg ac on ac.m = mo.m and ac.kind = 'COL'
  left join od on od.m = mo.m
  order by mo.m;
end;
$$;

comment on function platform.executive_billing_series(date, date, char) is
  'Serie mensual en moneda de reporte: facturado (facturas computables por emisión), cobrado (pagos CONFIRMED, '
  'fórmula de v_collected_payments = collections_by_month), razón de cobro del mes y cartera vencida al cierre '
  '(executive_receivables_aging, D1_30…D90_MAS). Mes en curso a hoy (is_partial). NULL si falta una tasa. '
  'Por defecto 12 meses; máximo 120. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 2. Puente de MRR de cada mes de un rango (una fila por mes).
--
-- Mismas columnas y reglas que executive_mrr_movements; por defecto los últimos
-- 12 meses incluido el actual; máximo 36 (cada mes reconstruye dos fotos).
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_movements_series(
  p_from               date default null,
  p_to                 date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month                 date,
  as_of                 date,
  reporting_currency    char(3),
  opening_mrr           numeric,
  new_mrr               numeric,
  expansion_mrr         numeric,
  contraction_mrr       numeric,
  churn_mrr             numeric,
  closing_mrr           numeric,
  prior_closing_mrr     numeric,
  fx_revaluation        numeric,
  new_customers         integer,
  expansion_customers   integer,
  contraction_customers integer,
  churned_customers     integer,
  complete              boolean
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
begin
  if v_from > v_to then
    raise exception 'RANGO_INVALIDO: el inicio (%) es posterior al fin (%) o está en el futuro', v_from, v_to
      using errcode = '22023';
  end if;
  if v_from < (v_to - interval '35 months')::date then
    raise exception 'RANGO_INVALIDO: el puente mensual admite como máximo 36 meses'
      using errcode = '22023';
  end if;
  select c.reporting_currency into v_rc from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  select mv.*
    from generate_series(v_from, v_to, interval '1 month') g
    cross join lateral platform.executive_mrr_movements(g::date, v_rc) mv
   order by mv.month;
end;
$$;

comment on function platform.executive_mrr_movements_series(date, date, char) is
  'executive_mrr_movements de cada mes entre p_from y p_to (por defecto 12 meses; máximo 36): base de NRR '
  '((opening + expansion − contraction − churn) / opening) y churn del Resumen Ejecutivo. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 3. Mix de MRR: se agrega la dimensión PARTNER.
--
-- PARTNER = organización que gestiona el tenant (tenants.managing_organization_id,
-- la misma atribución de finance_consolidated PARTNER); sin tenant o sin partner
-- → DIRECTO «Venta directa». PRODUCT y MARKET no cambian.
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_mix(
  p_month              date default null,
  p_dimension          text default 'PRODUCT',
  p_reporting_currency char(3) default null
)
returns table (
  month                date,
  as_of                date,
  dimension            text,
  group_key            text,
  group_label          text,
  reporting_currency   char(3),
  mrr                  numeric,
  share                numeric,
  active_customers     integer,
  active_subscriptions integer,
  mrr_native           jsonb,
  complete             boolean,
  missing_currencies   text[]
)
language plpgsql
stable
security invoker
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_dim   text := upper(trim(coalesce(p_dimension, 'PRODUCT')));
  v_at    date;
  v_rc    char(3);
begin
  if v_dim not in ('PRODUCT', 'MARKET', 'PARTNER') then
    raise exception 'DIMENSION_INVALIDA: "%" — use PRODUCT, MARKET o PARTNER', p_dimension using errcode = '22023';
  end if;
  if v_month > date_trunc('month', current_date)::date then
    raise exception 'MES_FUTURO: el mix de MRR sólo existe para meses cerrados o el mes en curso'
      using errcode = '22023';
  end if;
  v_at := least((v_month + interval '1 month - 1 day')::date, current_date);
  select c.reporting_currency into v_rc from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with src as (
    select e.*,
           case v_dim
             when 'PRODUCT' then e.saas_product_id::text
             when 'MARKET'  then coalesce(m.code, 'SIN_MERCADO')
             else coalesce(t.managing_organization_id::text, 'DIRECTO')
           end as gkey,
           case v_dim
             when 'PRODUCT' then coalesce(sp.short_name, sp.name, 'Sin producto')
             when 'MARKET'  then coalesce(m.name, 'Sin mercado')
             else coalesce(po.display_name, 'Venta directa')
           end as glabel
      from platform.executive_mrr_at(v_at, v_rc, v_at) e
      left join platform.saas_products sp on sp.id = e.saas_product_id
      left join platform.markets m on m.id = e.market_id
      left join platform.tenants t on t.id = e.tenant_id
      left join platform.organizations po on po.id = t.managing_organization_id
  ),
  native as (
    select n.gkey, jsonb_object_agg(n.native_currency, n.amount order by n.native_currency) as j
      from (select r.gkey, r.native_currency, sum(r.native_mrr) as amount
              from src r group by r.gkey, r.native_currency) n
     group by n.gkey
  ),
  g as (
    select r.gkey, min(r.glabel) as glabel,
           bool_and(r.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(r.reporting_mrr) as amount,
           count(distinct r.billed_organization_id)::int as customers,
           count(distinct r.subscription_id)::int as subs,
           coalesce(array_agg(distinct r.native_currency::text order by r.native_currency::text)
             filter (where r.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')), '{}'::text[]) as missing
      from src r
     group by r.gkey
  ),
  tot as (
    select bool_and(g.ok) as ok, sum(g.amount) as amount from g
  )
  select
    v_month, v_at, v_dim, g.gkey, g.glabel, v_rc,
    case when g.ok then g.amount end,
    case when tot.ok and tot.amount <> 0 then round(g.amount / tot.amount, 4) end,
    g.customers, g.subs,
    n.j,
    g.ok,
    g.missing
  from g
  cross join tot
  join native n on n.gkey = g.gkey
  order by case when g.ok then g.amount end desc nulls last, g.glabel;
end;
$$;

comment on function platform.executive_mrr_mix(date, text, char) is
  'Mix del MRR contratado al cierre del mes por PRODUCT, MARKET o PARTNER (canal que gestiona el tenant; '
  'DIRECTO = venta directa), en moneda de reporte, con share del total (sólo si el mes está completo). '
  'Σ mrr = executive_mrr_series del mismo mes. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 4. GRANTS: authenticated/service_role ejecutan; anon y PUBLIC no.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('executive_billing_series', 'executive_mrr_movements_series', 'executive_mrr_mix')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
