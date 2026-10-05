-- ============================================================================
-- MasterAdmin · Series de las pantallas de Finanzas — componentes del margen
-- por mes y cobros por semana
-- ----------------------------------------------------------------------------
-- V4 visual para Gerencia, fase 10. Diccionario: docs/finance/EXECUTIVE_KPI_DICTIONARY.md (S09–S10)
--
-- Qué hace (sólo lectura, aditivo):
--   · finance_monthly_series: por mes, cobrado, costo asignado y comisión
--     (devengada; pagada y por pagar según su estado actual) y el margen
--     gerencial K05 = cobrado − costo − comisión, en moneda de reporte. Los
--     hechos son EXACTAMENTE los de v_finance_facts (la base de
--     finance_consolidated): COLLECTED por fecha de cobro, COST por fin de
--     período, COMMISSION por devengo y sin VOID. Alimenta la franja y el
--     gráfico de Costos y de Comisiones.
--   · collections_by_week: cobrado por semana ISO (lunes a domingo) con la
--     fórmula de v_collected_payments (= collections_by_month y K02).
--     Alimenta el gráfico de Facturación.
--
-- Qué NO hace:
--   · No redefine vistas ni funciones existentes ni cambia ningún cálculo.
--   · No duplica lógica FX: cada (período, métrica, moneda) se convierte con
--     to_reporting_amount a la tasa del cierre del período (o de hoy en el
--     período en curso). MISSING_FX → NULL, nunca 0.
--   · SECURITY INVOKER, sin GRANT a anon: cada rol suma sólo lo que RLS le muestra.
--
-- Rollback (sólo objetos de lectura, sin datos):
--   drop function if exists platform.finance_monthly_series(date, date, char);
--   drop function if exists platform.collections_by_week(integer, char);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Componentes del margen gerencial por mes, en moneda de reporte.
--
-- Un punto por mes calendario entre p_from y p_to (por defecto los últimos 12
-- meses incluido el actual; máximo 120). El mes en curso se mide a HOY
-- (is_partial). No hay meses futuros.
--   collected           Σ COLLECTED del mes (v_collected_revenue por collected_on).
--   cost                Σ COST del mes (cost_allocations × peso, por period_end).
--   commission          Σ COMMISSION devengada en el mes (earned_on), sin VOID.
--   commission_paid     la parte de `commission` que hoy está PAID.
--   commission_pending  la parte que hoy está ELIGIBLE o ACCRUED (lo que se debe).
--                       commission − paid − pending = en espera (PENDING).
--   margin              collected − cost − commission, sólo si las tres están
--                       completas (NULL si falta una tasa).
-- ---------------------------------------------------------------------------
create or replace function platform.finance_monthly_series(
  p_from               date default null,
  p_to                 date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month              date,
  as_of              date,
  is_partial         boolean,
  reporting_currency char(3),
  collected          numeric,
  cost               numeric,
  commission         numeric,
  commission_paid    numeric,
  commission_pending numeric,
  margin             numeric,
  collected_native   jsonb,
  cost_native        jsonb,
  commission_native  jsonb,
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
  facts as (
    select date_trunc('month', f.fact_date)::date as m, x.metric, f.currency::char(3) as currency,
           sum(x.amount) as amount
      from platform.v_finance_facts f
     cross join lateral (values
       ('COLLECTED',          case when f.metric = 'COLLECTED' then f.amount end),
       ('COST',               case when f.metric = 'COST' then f.amount end),
       ('COMMISSION',         case when f.metric = 'COMMISSION' then f.amount end),
       ('COMMISSION_PAID',    case when f.metric = 'COMMISSION' and f.detail = 'PAID' then f.amount end),
       ('COMMISSION_PENDING', case when f.metric = 'COMMISSION' and f.detail in ('ELIGIBLE', 'ACCRUED') then f.amount end)
     ) as x (metric, amount)
     where f.metric in ('COLLECTED', 'COST', 'COMMISSION')
       and f.fact_date between v_from and current_date
       and x.amount is not null
     group by 1, 2, 3
  ),
  conv as (
    select f.*, r.reporting_amount, r.conversion_status, r.fx_is_demo
      from facts f
      join months mo on mo.m = f.m
      cross join lateral platform.to_reporting_amount(f.amount, f.currency, mo.at, v_rc, v_age) r
  ),
  agg as (
    select cv.m, cv.metric,
           bool_and(cv.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(cv.reporting_amount) as amount,
           jsonb_object_agg(cv.currency, cv.amount order by cv.currency) as native,
           array_agg(cv.currency::text order by cv.currency::text)
             filter (where cv.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')) as missing,
           bool_or(coalesce(cv.fx_is_demo, false)) as demo
      from conv cv
     group by cv.m, cv.metric
  ),
  wide as (
    select mo.m, mo.at, mo.eom,
           coalesce(a1.ok, true) as ok_col, coalesce(a1.amount, 0) as col, coalesce(a1.native, '{}'::jsonb) as col_n,
           coalesce(a2.ok, true) as ok_cost, coalesce(a2.amount, 0) as cost, coalesce(a2.native, '{}'::jsonb) as cost_n,
           coalesce(a3.ok, true) as ok_com, coalesce(a3.amount, 0) as com, coalesce(a3.native, '{}'::jsonb) as com_n,
           coalesce(a4.ok, true) as ok_paid, coalesce(a4.amount, 0) as paid,
           coalesce(a5.ok, true) as ok_pend, coalesce(a5.amount, 0) as pend,
           coalesce(a1.missing, '{}') || coalesce(a2.missing, '{}') || coalesce(a3.missing, '{}') as missing,
           coalesce(a1.demo, false) or coalesce(a2.demo, false) or coalesce(a3.demo, false) as demo
      from months mo
      left join agg a1 on a1.m = mo.m and a1.metric = 'COLLECTED'
      left join agg a2 on a2.m = mo.m and a2.metric = 'COST'
      left join agg a3 on a3.m = mo.m and a3.metric = 'COMMISSION'
      left join agg a4 on a4.m = mo.m and a4.metric = 'COMMISSION_PAID'
      left join agg a5 on a5.m = mo.m and a5.metric = 'COMMISSION_PENDING'
  )
  select
    w.m,
    w.at,
    w.at < w.eom,
    v_rc,
    case when w.ok_col then w.col end,
    case when w.ok_cost then w.cost end,
    case when w.ok_com then w.com end,
    case when w.ok_paid then w.paid end,
    case when w.ok_pend then w.pend end,
    case when w.ok_col and w.ok_cost and w.ok_com then w.col - w.cost - w.com end,
    w.col_n,
    w.cost_n,
    w.com_n,
    w.ok_col and w.ok_cost and w.ok_com,
    coalesce((select array_agg(distinct u.c order by u.c) from unnest(w.missing) as u(c)), '{}'::text[]),
    w.demo
  from wide w
  order by w.m;
end;
$$;

comment on function platform.finance_monthly_series(date, date, char) is
  'Serie mensual en moneda de reporte de los componentes del margen gerencial K05 sobre v_finance_facts '
  '(la base de finance_consolidated): cobrado, costo asignado, comisión devengada (y su parte pagada / por '
  'pagar según el estado actual) y margen = cobrado − costo − comisión. Mes en curso a hoy (is_partial). '
  'NULL si falta una tasa. Por defecto 12 meses; máximo 120. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 2. Cobrado por semana, en moneda de reporte.
--
-- Las últimas p_weeks semanas ISO (lunes–domingo) incluida la actual, que se
-- mide a HOY (is_partial). 1–104 semanas. Cobrado = Σ collected_amount de
-- v_collected_payments con collected_on en la semana (la fórmula de
-- collections_by_month / K02), convertido a la tasa del cierre de la semana.
-- ---------------------------------------------------------------------------
create or replace function platform.collections_by_week(
  p_weeks              integer default 12,
  p_reporting_currency char(3) default null
)
returns table (
  week_start         date,
  week_end           date,
  as_of              date,
  is_partial         boolean,
  reporting_currency char(3),
  collected          numeric,
  payment_count      integer,
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
  v_weeks integer := coalesce(p_weeks, 12);
  v_cur   date := date_trunc('week', current_date)::date;
  v_from  date;
  v_rc    char(3);
  v_age   integer;
begin
  if v_weeks < 1 or v_weeks > 104 then
    raise exception 'RANGO_INVALIDO: la serie semanal admite entre 1 y 104 semanas'
      using errcode = '22023';
  end if;
  v_from := v_cur - (v_weeks - 1) * 7;
  select c.reporting_currency, c.fx_max_rate_age_days into v_rc, v_age
    from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with weeks as (
    select g::date as w,
           (g + interval '6 days')::date as we,
           least((g + interval '6 days')::date, current_date) as at
      from generate_series(v_from, v_cur, interval '1 week') g
  ),
  col as (
    select date_trunc('week', c.collected_on)::date as w, c.currency::char(3) as currency,
           sum(c.collected_amount) as amount, count(*)::int as n
      from platform.v_collected_payments c
     where c.collected_on between v_from and current_date
     group by 1, 2
  ),
  conv as (
    select c.*, r.reporting_amount, r.conversion_status, r.fx_is_demo
      from col c
      join weeks wk on wk.w = c.w
      cross join lateral platform.to_reporting_amount(c.amount, c.currency, wk.at, v_rc, v_age) r
  ),
  agg as (
    select cv.w,
           bool_and(cv.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(cv.reporting_amount) as amount,
           sum(cv.n)::int as n,
           jsonb_object_agg(cv.currency, cv.amount order by cv.currency) as native,
           array_agg(cv.currency::text order by cv.currency::text)
             filter (where cv.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')) as missing,
           bool_or(coalesce(cv.fx_is_demo, false)) as demo
      from conv cv
     group by cv.w
  )
  select
    wk.w,
    wk.we,
    wk.at,
    wk.at < wk.we,
    v_rc,
    case when coalesce(a.ok, true) then coalesce(a.amount, 0) end,
    coalesce(a.n, 0),
    coalesce(a.native, '{}'::jsonb),
    coalesce(a.ok, true),
    coalesce(a.missing, '{}'::text[]),
    coalesce(a.demo, false)
  from weeks wk
  left join agg a on a.w = wk.w
  order by wk.w;
end;
$$;

comment on function platform.collections_by_week(integer, char) is
  'Cobrado por semana ISO (lunes–domingo) en moneda de reporte con la fórmula de v_collected_payments '
  '(= collections_by_month / K02). Semana en curso a hoy (is_partial). NULL si falta una tasa. '
  '1–104 semanas (por defecto 12). SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 3. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('finance_monthly_series', 'collections_by_week')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
