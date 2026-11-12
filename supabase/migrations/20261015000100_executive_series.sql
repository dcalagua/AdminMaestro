-- ============================================================================
-- MasterAdmin · Series ejecutivas — MRR histórico, puente, mix y cartera a fecha
-- ----------------------------------------------------------------------------
-- V4 visual para Gerencia, fase 08. Diccionario: docs/finance/EXECUTIVE_KPI_DICTIONARY.md
--
-- Qué hace:
--   · Reconstruye el MRR CONTRATADO a cualquier fecha desde la vigencia de los
--     ítems de suscripción (no hay snapshots: no se inventa historia).
--   · Serie mensual (MRR, ARR, clientes y contratos activos), puente de MRR por
--     cliente (inicio → nuevo → expansión → contracción → churn → cierre), mix
--     por producto / mercado al cierre de mes y antigüedad de cartera a una
--     fecha, todo en moneda de reporte con el motor FX existente
--     (to_reporting_amount → fx_convert → fx_rate_lookup).
--
-- Qué NO hace:
--   · No redefine v_subscription_mrr ni ningún read model existente.
--   · No duplica lógica FX: cada importe se convierte con to_reporting_amount
--     (tasa explícita, MISSING_FX → NULL, nunca 0).
--   · Nada es SECURITY DEFINER: funciones SECURITY INVOKER, como los read
--     models ejecutivos (20260925100000). Cada rol suma sólo las suscripciones,
--     ítems, facturas y pagos que RLS ya le muestra; sin permiso para leer
--     tasas, la conversión queda MISSING_FX. Sin GRANT a anon.
--
-- Unidad de conversión: la SUSCRIPCIÓN. Cada MRR de suscripción se convierte y
-- redondea una vez; serie, puente por cliente y mix suman esos importes, por lo
-- que cuadran entre sí al céntimo.
--
-- Rollback (sólo objetos de lectura, sin datos):
--   drop function if exists platform.executive_mrr_mix(date, text, char);
--   drop function if exists platform.executive_receivables_aging(date, char);
--   drop function if exists platform.executive_mrr_movements(date, char);
--   drop function if exists platform.executive_mrr_movement_customers(date, char);
--   drop function if exists platform.executive_mrr_series(date, date, char);
--   drop function if exists platform.executive_reporting_config(char);
--   drop function if exists platform.executive_mrr_at(date, char, date);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Moneda de reporte resuelta + tolerancia FX (configuración si no se indica).
--    Una moneda pedida que no existe o está inactiva es un error, no un 0.
-- ---------------------------------------------------------------------------
create or replace function platform.executive_reporting_config(p_reporting_currency char(3) default null)
returns table (reporting_currency char(3), fx_max_rate_age_days integer)
language plpgsql
stable
security invoker
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  v_rc  char(3);
  v_age integer;
begin
  select s.reporting_currency, s.fx_max_rate_age_days into v_rc, v_age
    from platform.reporting_settings() s;
  if p_reporting_currency is not null then
    v_rc := upper(trim(p_reporting_currency))::char(3);
    if not platform.is_currency_active(v_rc) then
      raise exception 'MONEDA_INVALIDA: "%" no existe o está inactiva; la moneda de reporte debe ser una moneda activa del catálogo', p_reporting_currency
        using errcode = '22023';
    end if;
  end if;
  return query select v_rc, coalesce(v_age, 0);
end;
$$;

comment on function platform.executive_reporting_config(char) is
  'Moneda de reporte efectiva (parámetro o configuración) y tolerancia FX. Valida que la moneda pedida esté activa.';

-- ---------------------------------------------------------------------------
-- 1. MRR contratado por suscripción a una fecha (base de todas las series).
--
-- Una suscripción aporta en la fecha D si:
--   · status ∈ (ACTIVE, PAST_DUE, CANCELLED) — DRAFT y PAUSED no facturan
--     recurrente; no hay historial de pausas, así que una PAUSED no aporta en
--     ninguna fecha;
--   · started_on ≤ D y (ends_on nulo o ≥ D);
--   · si está CANCELLED: su fin efectivo coalesce(ends_on, cancelled_at::date)
--     es ≥ D (una baja sin ninguna fecha no se puede ubicar y no aporta);
--   · su tenant no es DEMO ni SANDBOX (sin tenant sí aporta).
-- Un ítem aporta si no es ONE_TIME y valid_from ≤ D y (valid_to nulo o ≥ D).
-- Mensualización: MONTHLY ×1, QUARTERLY ÷3, YEARLY ÷12 (redondeo a 2 por ítem,
-- igual que v_subscription_mrr); DISCOUNT recurrente RESTA (signed_line_amount).
-- p_rate_date (por defecto D) es la fecha de la TASA: el puente valúa el mes
-- anterior con la tasa del mes analizado (moneda constante).
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_at(
  p_at                 date,
  p_reporting_currency char(3) default null,
  p_rate_date          date default null
)
returns table (
  subscription_id        uuid,
  billed_organization_id uuid,
  saas_product_id        uuid,
  market_id              uuid,
  tenant_id              uuid,
  native_currency        char(3),
  native_mrr             numeric,
  reporting_currency     char(3),
  reporting_mrr          numeric,
  conversion_status      text,
  fx_rate_date           date,
  fx_is_demo             boolean
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with cfg as (
    select c.reporting_currency as rc, c.fx_max_rate_age_days as age
      from platform.executive_reporting_config(p_reporting_currency) c
  ),
  subs as (
    select
      s.id, s.billed_organization_id, s.saas_product_id, s.market_id, s.tenant_id, s.currency,
      sum(
        round(
          platform.signed_line_amount(si.charge_kind, si.amount) * case si.billing_interval
            when 'MONTHLY'   then 1.0
            when 'QUARTERLY' then 1.0 / 3
            when 'YEARLY'    then 1.0 / 12
            else 0.0
          end, 2)
      ) as mrr
    from platform.subscriptions s
    join platform.subscription_items si on si.subscription_id = s.id
    left join platform.tenants t on t.id = s.tenant_id
    where p_at is not null
      and s.status in ('ACTIVE', 'PAST_DUE', 'CANCELLED')
      and s.started_on <= p_at
      and (s.ends_on is null or s.ends_on >= p_at)
      and (s.status <> 'CANCELLED' or coalesce(s.ends_on, s.cancelled_at::date) >= p_at)
      and si.billing_interval <> 'ONE_TIME'
      and si.valid_from <= p_at
      and (si.valid_to is null or si.valid_to >= p_at)
      and (t.id is null or t.tenant_type not in ('DEMO', 'SANDBOX'))
    group by s.id
  )
  select
    subs.id, subs.billed_organization_id, subs.saas_product_id, subs.market_id, subs.tenant_id,
    subs.currency::char(3), subs.mrr,
    r.reporting_currency, r.reporting_amount, r.conversion_status, r.fx_rate_date, r.fx_is_demo
  from subs
  cross join cfg
  cross join lateral platform.to_reporting_amount(
    subs.mrr, subs.currency::char(3), coalesce(p_rate_date, p_at), cfg.rc, cfg.age) r;
$$;

comment on function platform.executive_mrr_at(date, char, date) is
  'MRR contratado por suscripción a la fecha p_at, reconstruido desde la vigencia de los ítems: '
  'suscripciones ACTIVE/PAST_DUE/CANCELLED vigentes en la fecha (CANCELLED hasta coalesce(ends_on, '
  'cancelled_at)), ítems recurrentes vigentes (valid_from ≤ fecha ≤ valid_to), QUARTERLY/3, YEARLY/12, '
  'ONE_TIME fuera, DISCOUNT resta, tenants DEMO/SANDBOX fuera. Convertido por suscripción con '
  'to_reporting_amount a la tasa de p_rate_date (por defecto p_at). SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 2. Serie mensual de MRR.
--
-- Un punto por mes calendario entre p_from y p_to (por defecto: los últimos 18
-- meses incluido el actual). El mes se mide a su CIERRE; el mes en curso se
-- mide HOY (is_partial = true). No hay meses futuros. ARR = MRR × 12.
-- mrr es NULL si alguna moneda del mes no tiene tasa (complete = false y
-- missing_currencies la nombra); mrr_native conserva los importes nativos.
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_series(
  p_from               date default null,
  p_to                 date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month                date,
  as_of                date,
  is_partial           boolean,
  reporting_currency   char(3),
  mrr                  numeric,
  arr                  numeric,
  active_customers     integer,
  active_subscriptions integer,
  mrr_native           jsonb,
  complete             boolean,
  missing_currencies   text[],
  fx_is_demo           boolean
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
  v_from date := date_trunc('month', coalesce(p_from, (v_to - interval '17 months')::date))::date;
  v_rc   char(3);
begin
  if v_from > v_to then
    raise exception 'RANGO_INVALIDO: el inicio (%) es posterior al fin (%) o está en el futuro', v_from, v_to
      using errcode = '22023';
  end if;
  if v_from < (v_to - interval '119 months')::date then
    raise exception 'RANGO_INVALIDO: la serie admite como máximo 120 meses'
      using errcode = '22023';
  end if;
  select c.reporting_currency into v_rc from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with months as (
    select g::date as m,
           least((g + interval '1 month - 1 day')::date, current_date) as at,
           (g + interval '1 month - 1 day')::date as eom
      from generate_series(v_from, v_to, interval '1 month') g
  ),
  src as (
    select mo.m, e.*
      from months mo
      cross join lateral platform.executive_mrr_at(mo.at, v_rc, mo.at) e
  ),
  native as (
    select n.m, jsonb_object_agg(n.native_currency, n.amount order by n.native_currency) as j
      from (select r.m, r.native_currency, sum(r.native_mrr) as amount
              from src r group by r.m, r.native_currency) n
     group by n.m
  ),
  agg as (
    select r.m,
           bool_and(r.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(r.reporting_mrr) as amount,
           count(distinct r.billed_organization_id)::int as customers,
           count(distinct r.subscription_id)::int as subs,
           array_agg(distinct r.native_currency::text order by r.native_currency::text)
             filter (where r.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')) as missing,
           bool_or(coalesce(r.fx_is_demo, false)) as demo
      from src r
     group by r.m
  )
  select
    mo.m,
    mo.at,
    mo.at < mo.eom,
    v_rc,
    case when coalesce(a.ok, true) then coalesce(a.amount, 0) end,
    case when coalesce(a.ok, true) then coalesce(a.amount, 0) * 12 end,
    coalesce(a.customers, 0),
    coalesce(a.subs, 0),
    coalesce(n.j, '{}'::jsonb),
    coalesce(a.ok, true),
    coalesce(a.missing, '{}'::text[]),
    coalesce(a.demo, false)
  from months mo
  left join agg a on a.m = mo.m
  left join native n on n.m = mo.m
  order by mo.m;
end;
$$;

comment on function platform.executive_mrr_series(date, date, char) is
  'Serie mensual de MRR contratado (executive_mrr_at al cierre de cada mes; el mes en curso a hoy, '
  'is_partial). mrr/arr en moneda de reporte, NULL si falta una tasa (complete=false, '
  'missing_currencies); mrr_native por moneda; clientes = organizaciones facturadas con MRR; '
  'contratos = suscripciones con MRR. Por defecto 18 meses; máximo 120. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 3. Puente de MRR por cliente (organización facturada) de un mes.
--
-- opening = MRR del cliente al cierre del mes ANTERIOR, closing = al cierre del
-- mes (o hoy si es el mes en curso). Ambos valuados con la tasa del mes
-- analizado: el puente mide negocio, no tipo de cambio.
--   NEW         cliente sin MRR al inicio y con MRR al cierre  → closing
--   CHURN       cliente con MRR al inicio y sin MRR al cierre  → opening
--   EXPANSION   closing > opening                              → closing − opening
--   CONTRACTION closing < opening                              → opening − closing
--   FLAT        sin cambio
-- Por construcción opening + new + expansion − contraction − churn = closing.
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_movement_customers(
  p_month              date default null,
  p_reporting_currency char(3) default null
)
returns table (
  month                  date,
  as_of                  date,
  billed_organization_id uuid,
  organization_name      text,
  movement               text,
  opening_mrr            numeric,
  closing_mrr            numeric,
  delta_mrr              numeric,
  reporting_currency     char(3),
  complete               boolean
)
language plpgsql
stable
security invoker
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_at    date;
  v_prev  date;
  v_rc    char(3);
begin
  if v_month > date_trunc('month', current_date)::date then
    raise exception 'MES_FUTURO: el puente de MRR sólo existe para meses cerrados o el mes en curso'
      using errcode = '22023';
  end if;
  v_at   := least((v_month + interval '1 month - 1 day')::date, current_date);
  v_prev := v_month - 1;
  select c.reporting_currency into v_rc from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with cur as (
    select e.billed_organization_id as org,
           sum(e.reporting_mrr) as amount,
           bool_and(e.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok
      from platform.executive_mrr_at(v_at, v_rc, v_at) e
     group by e.billed_organization_id
  ),
  prev as (
    select e.billed_organization_id as org,
           sum(e.reporting_mrr) as amount,
           bool_and(e.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok
      from platform.executive_mrr_at(v_prev, v_rc, v_at) e
     group by e.billed_organization_id
  ),
  c as (
    select coalesce(cur.org, prev.org) as org,
           prev.org is not null as had,
           cur.org is not null as has,
           coalesce(prev.ok, true) and coalesce(cur.ok, true) as ok,
           coalesce(prev.amount, 0) as opening,
           coalesce(cur.amount, 0) as closing
      from cur
      full join prev on prev.org = cur.org
  )
  select
    v_month,
    v_at,
    c.org,
    o.display_name,
    case
      when not c.had then 'NEW'
      when not c.has then 'CHURN'
      when c.closing > c.opening then 'EXPANSION'
      when c.closing < c.opening then 'CONTRACTION'
      else 'FLAT'
    end,
    case when c.ok then c.opening end,
    case when c.ok then c.closing end,
    case when c.ok then c.closing - c.opening end,
    v_rc,
    c.ok
  from c
  left join platform.organizations o on o.id = c.org
  order by abs(c.closing - c.opening) desc, o.display_name;
end;
$$;

comment on function platform.executive_mrr_movement_customers(date, char) is
  'Detalle por cliente del puente de MRR del mes: movement NEW | EXPANSION | CONTRACTION | CHURN | FLAT, '
  'opening (cierre del mes anterior) y closing (cierre del mes), ambos con la tasa del mes. Importes NULL '
  'si a ese cliente le falta una tasa. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 4. Puente de MRR del mes (totales del detalle anterior).
--
-- prior_closing = MRR del mes anterior a SU propia tasa (el punto de la serie);
-- fx_revaluation = opening − prior_closing: lo que cambió sólo por tipo de
-- cambio. Si falta una tasa, todos los importes son NULL (complete = false).
-- ---------------------------------------------------------------------------
create or replace function platform.executive_mrr_movements(
  p_month              date default null,
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
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_rc    char(3);
begin
  select c.reporting_currency into v_rc from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with d as (
    select * from platform.executive_mrr_movement_customers(v_month, v_rc)
  ),
  pr as (
    select s.mrr, s.complete from platform.executive_mrr_series(v_month - 1, v_month - 1, v_rc) s
  ),
  t as (
    select
      coalesce(bool_and(d.complete), true) as ok,
      coalesce(sum(d.opening_mrr), 0) as opening,
      coalesce(sum(d.closing_mrr) filter (where d.movement = 'NEW'), 0) as new_amt,
      coalesce(sum(d.delta_mrr) filter (where d.movement = 'EXPANSION'), 0) as exp_amt,
      coalesce(-sum(d.delta_mrr) filter (where d.movement = 'CONTRACTION'), 0) as con_amt,
      coalesce(sum(d.opening_mrr) filter (where d.movement = 'CHURN'), 0) as churn_amt,
      coalesce(sum(d.closing_mrr), 0) as closing,
      count(*) filter (where d.movement = 'NEW')::int as n_new,
      count(*) filter (where d.movement = 'EXPANSION')::int as n_exp,
      count(*) filter (where d.movement = 'CONTRACTION')::int as n_con,
      count(*) filter (where d.movement = 'CHURN')::int as n_churn
    from d
  )
  select
    v_month,
    least((v_month + interval '1 month - 1 day')::date, current_date),
    v_rc,
    case when t.ok then t.opening end,
    case when t.ok then t.new_amt end,
    case when t.ok then t.exp_amt end,
    case when t.ok then t.con_amt end,
    case when t.ok then t.churn_amt end,
    case when t.ok then t.closing end,
    p.mrr,
    case when t.ok and p.complete then t.opening - p.mrr end,
    t.n_new, t.n_exp, t.n_con, t.n_churn,
    t.ok and coalesce(p.complete, true)
  from t
  cross join pr p;
end;
$$;

comment on function platform.executive_mrr_movements(date, char) is
  'Puente de MRR del mes en moneda de reporte: opening + new + expansion − contraction − churn = closing '
  '(por cliente, a la tasa del mes). prior_closing = punto de la serie del mes anterior; fx_revaluation = '
  'opening − prior_closing. NULL si falta una tasa (complete=false). SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 5. Mix de MRR por producto o mercado al cierre de un mes.
--
-- p_dimension: PRODUCT (saas_products.short_name) | MARKET (subscriptions.market_id,
-- «Sin mercado» si no tiene). Σ mrr del mix = punto de la serie del mismo mes.
-- share = mrr / total (4 decimales) sólo si el mes está completo.
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
  if v_dim not in ('PRODUCT', 'MARKET') then
    raise exception 'DIMENSION_INVALIDA: "%" — use PRODUCT o MARKET', p_dimension using errcode = '22023';
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
           case when v_dim = 'PRODUCT' then e.saas_product_id::text
                else coalesce(m.code, 'SIN_MERCADO') end as gkey,
           case when v_dim = 'PRODUCT' then coalesce(sp.short_name, sp.name, 'Sin producto')
                else coalesce(m.name, 'Sin mercado') end as glabel
      from platform.executive_mrr_at(v_at, v_rc, v_at) e
      left join platform.saas_products sp on sp.id = e.saas_product_id
      left join platform.markets m on m.id = e.market_id
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
  'Mix del MRR contratado al cierre del mes por PRODUCT o MARKET, en moneda de reporte, con share del '
  'total (sólo si el mes está completo). Σ mrr = executive_mrr_series del mismo mes. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 6. Antigüedad de cartera a una fecha, en moneda de reporte.
--
-- receivables_aging (20260925100000) es la foto ACTUAL y nativa; ésta reconstruye
-- el saldo a p_as_of: facturas computables (ISSUED/PARTIALLY_PAID/PAID) emitidas
-- hasta esa fecha, menos pagos CONFIRMED con paid_at ≤ p_as_of. Sólo saldos > 0.
-- Bandas por días de atraso a p_as_of (mismos códigos que v_invoice_balances):
-- VIGENTE (no vencida) · D1_30 · D31_60 · D61_90 · D90_MAS · SIN_FECHA.
-- Siempre devuelve las 6 bandas (0 si están vacías). Se convierte cada
-- (banda, moneda) con la tasa de p_as_of.
-- Límite: el estado de factura es el actual (no hay historial de anulaciones).
-- ---------------------------------------------------------------------------
create or replace function platform.executive_receivables_aging(
  p_as_of              date default null,
  p_reporting_currency char(3) default null
)
returns table (
  as_of              date,
  aging_bucket       text,
  bucket_order       integer,
  invoice_count      integer,
  balance            numeric,
  balance_native     jsonb,
  reporting_currency char(3),
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
  v_as_of date := coalesce(p_as_of, current_date);
  v_rc    char(3);
  v_age   integer;
begin
  if v_as_of > current_date then
    raise exception 'FECHA_FUTURA: la cartera sólo se reconstruye hasta hoy' using errcode = '22023';
  end if;
  select c.reporting_currency, c.fx_max_rate_age_days into v_rc, v_age
    from platform.executive_reporting_config(p_reporting_currency) c;

  return query
  with buckets (code, ord) as (
    values ('VIGENTE', 1), ('D1_30', 2), ('D31_60', 3), ('D61_90', 4), ('D90_MAS', 5), ('SIN_FECHA', 6)
  ),
  inv as (
    select i.id, i.currency, i.due_date,
           i.total - coalesce((select sum(p.amount) from platform.payments p
                                where p.invoice_id = i.id and p.status = 'CONFIRMED'
                                  and p.paid_at::date <= v_as_of), 0) as bal
      from platform.invoices i
     where i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
       and coalesce(i.issue_date, i.created_at::date) <= v_as_of
  ),
  open_inv as (
    select inv.*,
           case
             when inv.due_date is null then 'SIN_FECHA'
             when inv.due_date >= v_as_of then 'VIGENTE'
             when v_as_of - inv.due_date <= 30 then 'D1_30'
             when v_as_of - inv.due_date <= 60 then 'D31_60'
             when v_as_of - inv.due_date <= 90 then 'D61_90'
             else 'D90_MAS'
           end as bucket
      from inv
     where inv.bal > 0
  ),
  per_cur as (
    select o.bucket, o.currency, count(*)::int as n, sum(o.bal) as amount
      from open_inv o group by o.bucket, o.currency
  ),
  conv as (
    select pc.*, r.reporting_amount, r.conversion_status, r.fx_is_demo
      from per_cur pc
      cross join lateral platform.to_reporting_amount(pc.amount, pc.currency::char(3), v_as_of, v_rc, v_age) r
  ),
  agg as (
    select cv.bucket,
           sum(cv.n)::int as n,
           bool_and(cv.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as ok,
           sum(cv.reporting_amount) as amount,
           jsonb_object_agg(cv.currency, cv.amount order by cv.currency) as native,
           array_agg(cv.currency::text order by cv.currency::text)
             filter (where cv.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')) as missing,
           bool_or(coalesce(cv.fx_is_demo, false)) as demo
      from conv cv group by cv.bucket
  )
  select
    v_as_of,
    b.code,
    b.ord,
    coalesce(a.n, 0),
    case when coalesce(a.ok, true) then coalesce(a.amount, 0) end,
    coalesce(a.native, '{}'::jsonb),
    v_rc,
    coalesce(a.ok, true),
    coalesce(a.missing, '{}'::text[]),
    coalesce(a.demo, false)
  from buckets b
  left join agg a on a.bucket = b.code
  order by b.ord;
end;
$$;

comment on function platform.executive_receivables_aging(date, char) is
  'Cartera por antigüedad a p_as_of (por defecto hoy), reconstruida con pagos CONFIRMED hasta esa fecha: '
  '6 bandas fijas (VIGENTE, D1_30, D31_60, D61_90, D90_MAS, SIN_FECHA) con n.º de facturas, saldo en moneda '
  'de reporte (NULL si falta una tasa) y saldo nativo por moneda. A hoy concilia con receivables_aging(). '
  'SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 7. GRANTS: authenticated/service_role ejecutan; anon y PUBLIC no.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('executive_reporting_config', 'executive_mrr_at', 'executive_mrr_series',
                         'executive_mrr_movement_customers', 'executive_mrr_movements',
                         'executive_mrr_mix', 'executive_receivables_aging')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
