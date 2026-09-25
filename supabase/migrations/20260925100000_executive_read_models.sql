-- ============================================================================
-- MasterAdmin · Experiencia ejecutiva — modelos de LECTURA (aditivo)
-- ----------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-09-25-masteradmin-executive-experience-design.md
-- §9 (resumen y detalle separados), K02–K06, E02/E03/E16.
--
-- Qué hace:
--   · Resúmenes AGREGADOS en servidor sobre el universo autorizado completo, con
--     los MISMOS filtros que la tabla paginada de cada pantalla (buscador + tab
--     de estado). Sustituyen a las sumas en el navegador sobre un lote de
--     200/300 filas.
--   · Saldo por factura y antigüedad de cartera (foto actual).
--   · Cobros por pago con la fórmula EXISTENTE de v_collected_revenue, para que
--     serie mensual, KPI y detalle concilien al céntimo.
--
-- Qué NO hace:
--   · No redefine ninguna vista, función, política ni GRANT existente.
--   · No cambia fórmulas: cobrado = v_collected_revenue; MRR = v_subscription_mrr;
--     comisión pendiente = ELIGIBLE/ACCRUED (finance_reporting_rows).
--   · No suma monedas: todo sale agrupado por moneda nativa.
--   · Nada es SECURITY DEFINER: vistas security_invoker y funciones SECURITY
--     INVOKER. Cada rol ve exactamente las filas que RLS ya le daba en
--     invoices / payments / cost_entries / commission_events.
--
-- Rollback (sin datos que migrar; sólo objetos de lectura):
--   drop function if exists platform.commission_summary(text, text);
--   drop function if exists platform.cost_summary(text, text);
--   drop function if exists platform.collections_by_month(date, date, uuid);
--   drop function if exists platform.receivables_aging(uuid);
--   drop function if exists platform.invoice_summary(text, text, uuid);
--   drop view if exists platform.v_renewal_pipeline;
--   drop view if exists platform.v_collected_payments;
--   drop view if exists platform.v_invoice_balances;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Saldo por factura (K03/K04).
--
-- confirmed_paid = Σ pagos CONFIRMED (misma regla que sync_invoice_payment_status).
-- balance        = total − confirmed_paid SOLO para facturas computables en
--                  cartera (ISSUED / PARTIALLY_PAID / PAID, mismas que cuentan en
--                  v_collected_revenue). DRAFT, VOID y UNCOLLECTIBLE → NULL: no
--                  son saldo exigible y no se esconden como cero.
-- Un sobrepago da balance NEGATIVO y se conserva (no se recorta a cero).
-- aging_bucket   = clasificación VISUAL a la fecha de hoy; no es una política de
--                  cobro ni reconstruye saldos pasados.
-- ---------------------------------------------------------------------------
create or replace view platform.v_invoice_balances
with (security_invoker = true) as
select
  i.id                          as invoice_id,
  i.number,
  i.customer_organization_id,
  o.display_name                as organization_name,
  i.subscription_id,
  i.status,
  i.currency,
  i.issue_date,
  i.due_date,
  i.period_start,
  i.period_end,
  i.total,
  coalesce(p.confirmed_paid, 0) as confirmed_paid,
  coalesce(p.reversed_amount, 0) as reversed_amount,
  coalesce(p.confirmed_count, 0) as confirmed_payments,
  (i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')) as is_receivable,
  case when i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
       then i.total - coalesce(p.confirmed_paid, 0) end as balance,
  case
    when i.status not in ('ISSUED', 'PARTIALLY_PAID', 'PAID') then 'NO_COMPUTABLE'
    when i.total - coalesce(p.confirmed_paid, 0) = 0 then 'SALDADA'
    when i.due_date is null then 'SIN_FECHA'
    when i.due_date >= current_date then 'VIGENTE'
    when current_date - i.due_date <= 30 then 'D1_30'
    when current_date - i.due_date <= 60 then 'D31_60'
    when current_date - i.due_date <= 90 then 'D61_90'
    else 'D90_MAS'
  end as aging_bucket,
  case when i.due_date is not null and i.due_date < current_date
       then current_date - i.due_date end as days_overdue
from platform.invoices i
left join platform.organizations o on o.id = i.customer_organization_id
left join lateral (
  select
    sum(pp.amount) filter (where pp.status = 'CONFIRMED') as confirmed_paid,
    sum(pp.amount) filter (where pp.status = 'REVERSED')  as reversed_amount,
    count(*)       filter (where pp.status = 'CONFIRMED') as confirmed_count
  from platform.payments pp
  where pp.invoice_id = i.id
) p on true;

comment on view platform.v_invoice_balances is
  'Saldo por factura (foto actual). balance NULL si la factura no es computable en cartera '
  '(DRAFT/VOID/UNCOLLECTIBLE); negativo si hay sobrepago. aging_bucket es clasificación visual a hoy.';

-- ---------------------------------------------------------------------------
-- 2. Cobro por pago (K02, G01).
--
-- Misma fórmula y mismos filtros que v_collected_revenue, agrupada por pago:
-- Σ round(línea × pago/total, 2). Así Σ(v_collected_payments) = Σ(v_collected_revenue)
-- exactamente, y el detalle del gráfico mensual es una lista de PAGOS, no de
-- facturas repetidas por cada pago.
-- ---------------------------------------------------------------------------
create or replace view platform.v_collected_payments
with (security_invoker = true) as
select
  p.id                              as payment_id,
  p.reference,
  p.method,
  i.id                              as invoice_id,
  i.number                          as invoice_number,
  i.customer_organization_id,
  o.display_name                    as organization_name,
  i.subscription_id,
  i.currency,
  (p.paid_at)::date                 as collected_on,
  date_trunc('month', p.paid_at)::date as collected_month,
  p.amount                          as payment_amount,
  sum(round(l.amount * (p.amount / nullif(i.total, 0)), 2)) as collected_amount
from platform.payments p
join platform.invoices i on i.id = p.invoice_id
join platform.invoice_lines l on l.invoice_id = i.id
left join platform.organizations o on o.id = i.customer_organization_id
where p.status = 'CONFIRMED'
  and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
  and coalesce(i.total, 0) > 0
group by p.id, p.reference, p.method, i.id, i.number, i.customer_organization_id,
         o.display_name, i.subscription_id, i.currency, p.paid_at, p.amount;

comment on view platform.v_collected_payments is
  'Cobro confirmado por pago con la fórmula de v_collected_revenue (prorrateo por línea). '
  'Concilia al céntimo con v_collected_revenue.';

-- ---------------------------------------------------------------------------
-- 3. Renovaciones con su recurrente vigente (K06, G06).
-- v_renewal_dashboard + MRR vigente de v_subscription_mrr (0 filas → NULL, no 0).
-- ---------------------------------------------------------------------------
create or replace view platform.v_renewal_pipeline
with (security_invoker = true) as
select
  r.*,
  m.mrr as current_mrr
from platform.v_renewal_dashboard r
left join platform.v_subscription_mrr m on m.subscription_id = r.subscription_id;

comment on view platform.v_renewal_pipeline is
  'v_renewal_dashboard con el MRR vigente de cada suscripción (NULL si no tiene recurrente vigente).';

-- ---------------------------------------------------------------------------
-- 4. Resumen de facturación con los filtros de la tabla (P02).
--
-- p_search : mismo criterio que la tabla (número u organización, ILIKE).
-- p_status : ALL | OPEN (ISSUED, PARTIALLY_PAID) | PAID | EXCLUDED (DRAFT, VOID)
--            | UNCOLLECTIBLE.
-- Devuelve, por moneda: facturado (no DRAFT/VOID), cobrado confirmado, saldo de
-- cartera (sólo computables) y conteos. `row_count` = filas de la tabla con ese
-- filtro, para comprobar que tabla y resumen hablan del mismo universo.
-- ---------------------------------------------------------------------------
create or replace function platform.invoice_summary(
  p_search          text default null,
  p_status          text default 'ALL',
  p_organization_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with base as (
    select b.*
      from platform.v_invoice_balances b
     where (p_organization_id is null or b.customer_organization_id = p_organization_id)
       and (nullif(trim(coalesce(p_search, '')), '') is null
            or b.number ilike '%' || trim(p_search) || '%'
            or b.organization_name ilike '%' || trim(p_search) || '%')
       and case upper(coalesce(p_status, 'ALL'))
             when 'OPEN'          then b.status in ('ISSUED', 'PARTIALLY_PAID')
             when 'PAID'          then b.status = 'PAID'
             when 'EXCLUDED'      then b.status in ('DRAFT', 'VOID')
             when 'UNCOLLECTIBLE' then b.status = 'UNCOLLECTIBLE'
             else true
           end
  ),
  by_currency as (
    select currency,
           sum(total) filter (where status not in ('DRAFT', 'VOID'))   as invoiced,
           sum(confirmed_paid)                                          as collected,
           sum(balance) filter (where is_receivable)                    as receivable,
           sum(balance) filter (where is_receivable and aging_bucket in ('D1_30', 'D31_60', 'D61_90', 'D90_MAS')) as overdue,
           count(*)                                                     as invoices
      from base
     group by currency
  )
  select jsonb_build_object(
    'row_count', (select count(*) from base),
    'status_counts', coalesce((select jsonb_object_agg(status, n)
                                 from (select status, count(*) as n from base group by status) s), '{}'::jsonb),
    'invoiced',   coalesce((select jsonb_object_agg(currency, invoiced)   from by_currency where invoiced   is not null), '{}'::jsonb),
    'collected',  coalesce((select jsonb_object_agg(currency, collected)  from by_currency where collected  <> 0),       '{}'::jsonb),
    'receivable', coalesce((select jsonb_object_agg(currency, receivable) from by_currency where receivable is not null), '{}'::jsonb),
    'overdue',    coalesce((select jsonb_object_agg(currency, overdue)    from by_currency where overdue    is not null), '{}'::jsonb),
    'observed_at', now()
  );
$$;

comment on function platform.invoice_summary(text, text, uuid) is
  'Totales de facturación por moneda sobre el universo autorizado completo con los filtros de la '
  'tabla (buscador + estado). SECURITY INVOKER: RLS de invoices/payments.';

-- ---------------------------------------------------------------------------
-- 5. Antigüedad de cartera (K04, G03). Foto actual, por moneda y banda.
-- ---------------------------------------------------------------------------
create or replace function platform.receivables_aging(p_organization_id uuid default null)
returns table (
  currency      char(3),
  aging_bucket  text,
  invoice_count bigint,
  balance       numeric
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select b.currency, b.aging_bucket, count(*), sum(b.balance)
    from platform.v_invoice_balances b
   where b.is_receivable
     and b.aging_bucket <> 'SALDADA'
     and (p_organization_id is null or b.customer_organization_id = p_organization_id)
   group by b.currency, b.aging_bucket
   order by b.currency, b.aging_bucket;
$$;

comment on function platform.receivables_aging(uuid) is
  'Saldo de cartera por moneda y banda (VIGENTE, D1_30, D31_60, D61_90, D90_MAS, SIN_FECHA). Foto actual.';

-- ---------------------------------------------------------------------------
-- 6. Cobros por mes (K02, G01). Fecha del hecho = paid_at.
-- ---------------------------------------------------------------------------
create or replace function platform.collections_by_month(
  p_from            date default null,
  p_to              date default null,
  p_organization_id uuid default null
)
returns table (
  month         date,
  currency      char(3),
  amount        numeric,
  payment_count bigint
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select c.collected_month, c.currency, sum(c.collected_amount), count(*)
    from platform.v_collected_payments c
   where (p_from is null or c.collected_on >= p_from)
     and (p_to is null or c.collected_on <= p_to)
     and (p_organization_id is null or c.customer_organization_id = p_organization_id)
   group by c.collected_month, c.currency
   order by c.collected_month, c.currency;
$$;

comment on function platform.collections_by_month(date, date, uuid) is
  'Cobro confirmado por mes y moneda (fórmula de v_collected_revenue). Sin conversión FX.';

-- ---------------------------------------------------------------------------
-- 7. Resumen de costos con los filtros de la tabla (P03).
--
-- registered = Σ cost_entries.amount (lo que hoy muestra «Costo registrado»).
-- allocated  = Σ round(amount × weight) de asignaciones NO PLATFORM (llega a un
--              producto/organización/tenant/target).
-- platform   = Σ asignaciones scope PLATFORM (costo de plataforma: no se reparte).
-- unallocated= registered − allocated − platform (peso < 1 o sin asignación).
-- p_scope: ALL | PLATFORM | PRODUCT | ORGANIZATION | TENANT | DEPLOYMENT_TARGET
--          (costos con al menos una asignación de ese ámbito) | UNALLOCATED.
-- ---------------------------------------------------------------------------
create or replace function platform.cost_summary(
  p_search text default null,
  p_scope  text default 'ALL'
)
returns jsonb
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with entries as (
    select ce.*,
           coalesce((select sum(round(ce.amount * a.weight, 2)) from platform.cost_allocations a
                      where a.cost_entry_id = ce.id and a.scope <> 'PLATFORM'), 0) as allocated,
           coalesce((select sum(round(ce.amount * a.weight, 2)) from platform.cost_allocations a
                      where a.cost_entry_id = ce.id and a.scope = 'PLATFORM'), 0) as platform_part
      from platform.cost_entries ce
     where (nullif(trim(coalesce(p_search, '')), '') is null
            or ce.description ilike '%' || trim(p_search) || '%'
            or coalesce(ce.vendor, '') ilike '%' || trim(p_search) || '%'
            or ce.category::text ilike '%' || trim(p_search) || '%')
       and case upper(coalesce(p_scope, 'ALL'))
             when 'ALL' then true
             when 'UNALLOCATED' then not exists (select 1 from platform.cost_allocations a where a.cost_entry_id = ce.id)
             else exists (select 1 from platform.cost_allocations a
                           where a.cost_entry_id = ce.id and a.scope::text = upper(p_scope))
           end
  ),
  by_currency as (
    select currency,
           sum(amount) as registered,
           sum(allocated) as allocated,
           sum(platform_part) as platform_part,
           sum(amount) - sum(allocated) - sum(platform_part) as unallocated
      from entries group by currency
  )
  select jsonb_build_object(
    'row_count',   (select count(*) from entries),
    'registered',  coalesce((select jsonb_object_agg(currency, registered)    from by_currency), '{}'::jsonb),
    'allocated',   coalesce((select jsonb_object_agg(currency, allocated)     from by_currency), '{}'::jsonb),
    'platform',    coalesce((select jsonb_object_agg(currency, platform_part) from by_currency), '{}'::jsonb),
    'unallocated', coalesce((select jsonb_object_agg(currency, unallocated)   from by_currency), '{}'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'currency', currency, 'amount', total)
                                              order by category, currency)
                               from (select category::text, currency, sum(amount) as total
                                       from entries group by category, currency) c), '[]'::jsonb),
    'observed_at', now()
  );
$$;

comment on function platform.cost_summary(text, text) is
  'Totales de costos por moneda (registrado, asignado, plataforma, sin asignar) con los filtros de la '
  'tabla. No reparte costos de plataforma. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 8. Resumen de comisiones con los filtros de la tabla (P14).
-- p_status: ALL | PENDING (ELIGIBLE, ACCRUED) | PAID | WAITING (PENDING) | VOID.
-- Estados por moneda sin mezclar; «pending» usa la definición de
-- finance_reporting_rows (ELIGIBLE/ACCRUED).
-- ---------------------------------------------------------------------------
create or replace function platform.commission_summary(
  p_search text default null,
  p_status text default 'ALL'
)
returns jsonb
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with base as (
    select d.*
      from platform.v_commission_detail d
     where (nullif(trim(coalesce(p_search, '')), '') is null
            or coalesce(d.agent_name, '') ilike '%' || trim(p_search) || '%'
            or coalesce(d.product_short_name, '') ilike '%' || trim(p_search) || '%'
            or coalesce(d.tenant_name, '') ilike '%' || trim(p_search) || '%'
            or coalesce(d.invoice_number, '') ilike '%' || trim(p_search) || '%')
       and case upper(coalesce(p_status, 'ALL'))
             when 'PENDING' then d.status in ('ELIGIBLE', 'ACCRUED')
             when 'PAID'    then d.status = 'PAID'
             when 'WAITING' then d.status = 'PENDING'
             when 'VOID'    then d.status = 'VOID'
             else true
           end
  )
  select jsonb_build_object(
    'row_count', (select count(*) from base),
    'by_status', coalesce((select jsonb_object_agg(status, totals)
                             from (select status::text, jsonb_object_agg(currency, amount) as totals
                                     from (select status, currency, sum(amount) as amount
                                             from base group by status, currency) x
                                    group by status) y), '{}'::jsonb),
    'pending',   coalesce((select jsonb_object_agg(currency, amount)
                             from (select currency, sum(amount) as amount from base
                                    where status in ('ELIGIBLE', 'ACCRUED') group by currency) p), '{}'::jsonb),
    'paid',      coalesce((select jsonb_object_agg(currency, amount)
                             from (select currency, sum(amount) as amount from base
                                    where status = 'PAID' group by currency) p), '{}'::jsonb),
    'observed_at', now()
  );
$$;

comment on function platform.commission_summary(text, text) is
  'Totales de comisiones por estado y moneda con los filtros de la tabla. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 9. GRANTS mínimos: lectura para authenticated/service_role; nada para anon.
-- ---------------------------------------------------------------------------
revoke all on platform.v_invoice_balances, platform.v_collected_payments, platform.v_renewal_pipeline
  from anon, public;
grant select on platform.v_invoice_balances, platform.v_collected_payments, platform.v_renewal_pipeline
  to authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('invoice_summary', 'receivables_aging', 'collections_by_month',
                         'cost_summary', 'commission_summary')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
