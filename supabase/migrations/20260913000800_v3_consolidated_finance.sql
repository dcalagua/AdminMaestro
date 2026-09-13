-- ============================================================================
-- EBIM Control Plane V3 — 31 · Finanzas consolidadas
-- ----------------------------------------------------------------------------
-- Fase 10 de `.claude-prompts-v3-multicurrency`. Cierra G-19, G-20, G-21, G-22
-- y G-32.
--
-- DOS CAPAS, NUNCA MEZCLADAS:
--
--   NATIVA      · cada importe en su moneda, sumado solo con importes de la
--                 MISMA moneda. Las vistas del baseline siguen siendo esto, con
--                 las mismas columnas; se corrigen los tres sitios que mezclaban
--                 o perdían monedas.
--   CONSOLIDADA · primero se suma por moneda, LUEGO se convierte cada total a la
--                 moneda de reporte con una tasa explícita, y solo entonces se
--                 suman equivalentes. Si falta una tasa, el total consolidado de
--                 esa métrica es NULL y la respuesta lo cuenta (missing_fx).
--
-- Tasa usada: la de cierre a la fecha `p_as_of` del reporte (tolerancia de la
-- configuración). Es un criterio gerencial, declarado en la respuesta, no una
-- revalorización contable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. G-32 · v_tenant_overview sin «USD 0» inventado.
--    Moneda = la del MRR; si no hay, la del contrato del tenant; si no hay
--    contrato, NULL. Se añade `market_code` AL FINAL (filtro regional).
-- ---------------------------------------------------------------------------
create or replace view platform.v_tenant_overview
with (security_invoker = true) as
select
  t.id                    as tenant_id,
  t.slug,
  t.name,
  t.tenant_type,
  t.status,
  t.deployment_mode,
  t.environment,
  t.admin_email,
  t.admin_activated_at,
  t.created_at,
  t.activated_at,
  sp.id                   as saas_product_id,
  sp.code                 as product_code,
  sp.short_name           as product_short_name,
  sp.lockup_name          as product_lockup,
  co.id                   as customer_organization_id,
  co.display_name         as customer_name,
  mo.id                   as managing_organization_id,
  mo.display_name         as managing_name,
  dt.id                   as deployment_target_id,
  dt.code                 as deployment_target_code,
  dt.provider             as deployment_provider,
  dt.region               as deployment_region,
  coalesce(mrr.mrr, 0)    as mrr,
  coalesce(mrr.currency, sub.currency, anysub.currency)::bpchar as currency,
  sub.id                  as subscription_id,
  pl.name                 as plan_name,
  coalesce(mk.code, anymk.code) as market_code
from platform.tenants t
join platform.saas_products sp on sp.id = t.saas_product_id
join platform.organizations co on co.id = t.customer_organization_id
left join platform.organizations mo on mo.id = t.managing_organization_id
left join platform.tenant_deployments td
  on td.tenant_id = t.id and td.is_primary and td.status = 'ACTIVE'
left join platform.deployment_targets dt on dt.id = td.deployment_target_id
left join lateral (
  select v.mrr, v.currency from platform.v_subscription_mrr v where v.tenant_id = t.id limit 1
) mrr on true
left join lateral (
  select s.id, s.plan_id, s.currency, s.market_id from platform.subscriptions s
   where s.tenant_id = t.id and s.status = 'ACTIVE' limit 1
) sub on true
left join lateral (
  select s.currency, s.market_id from platform.subscriptions s
   where s.tenant_id = t.id order by s.started_on desc limit 1
) anysub on true
left join platform.plans pl on pl.id = sub.plan_id
left join platform.markets mk on mk.id = sub.market_id
left join platform.markets anymk on anymk.id = anysub.market_id;

-- ---------------------------------------------------------------------------
-- 2. G-21 (R-3) · márgenes nativos: una fila por (entidad, moneda).
--
-- Antes, costos y comisiones se unían con `currency = moneda del ingreso`: un
-- costo USD de un producto que solo cobra PEN DESAPARECÍA y el margen salía
-- sobreestimado. Ahora las claves (entidad, moneda) son la unión de todas las
-- fuentes; una entidad sin datos conserva una fila con moneda NULL y ceros.
-- Mismas columnas y tipos que el baseline.
-- ---------------------------------------------------------------------------
create or replace view platform.v_product_margin
with (security_invoker = true) as
with revenue as (
  select r.saas_product_id, r.currency,
         sum(r.collected_amount)                                  as collected_total,
         sum(r.collected_amount) filter (where r.is_recurring)     as collected_recurring,
         sum(r.collected_amount) filter (where not r.is_recurring) as collected_one_time
    from platform.v_collected_revenue r
   where r.saas_product_id is not null
   group by r.saas_product_id, r.currency
),
product_costs as (
  select a.saas_product_id, ce.currency, sum(round(ce.amount * a.weight, 2)) as cost_total
    from platform.cost_allocations a
    join platform.cost_entries ce on ce.id = a.cost_entry_id
   where a.scope = 'PRODUCT' and a.saas_product_id is not null
   group by a.saas_product_id, ce.currency
),
tenant_costs as (
  select t.saas_product_id, c.currency, sum(c.cost_amount) as cost_total
    from platform.v_tenant_costs c
    join platform.tenants t on t.id = c.tenant_id
   group by t.saas_product_id, c.currency
),
commissions as (
  select e.saas_product_id, e.currency,
         sum(e.amount)                                  as commission_total,
         sum(e.amount) filter (where e.status = 'PAID')  as commission_paid,
         sum(e.amount) filter (where e.status <> 'PAID') as commission_pending
    from platform.commission_events e
   where e.status <> 'VOID'
   group by e.saas_product_id, e.currency
),
mrr as (
  select v.saas_product_id, v.currency, sum(v.mrr) as mrr_total
    from platform.v_subscription_mrr v
   group by v.saas_product_id, v.currency
),
keys as (
  select saas_product_id, currency from revenue
  union select saas_product_id, currency from product_costs
  union select saas_product_id, currency from tenant_costs
  union select saas_product_id, currency from commissions
  union select saas_product_id, currency from mrr
)
select
  sp.id   as saas_product_id,
  sp.code as product_code,
  sp.short_name,
  k.currency::bpchar                   as currency,
  coalesce(m.mrr_total, 0)             as mrr,
  round(coalesce(m.mrr_total, 0) * 12, 2) as arr,
  coalesce(r.collected_total, 0)       as collected_revenue,
  coalesce(r.collected_recurring, 0)   as collected_recurring,
  coalesce(r.collected_one_time, 0)    as collected_one_time,
  coalesce(pc.cost_total, 0) + coalesce(tc.cost_total, 0) as direct_cost,
  coalesce(cm.commission_total, 0)     as commission_total,
  coalesce(cm.commission_paid, 0)      as commission_paid,
  coalesce(cm.commission_pending, 0)   as commission_pending,
  round(
    coalesce(r.collected_total, 0)
    - (coalesce(pc.cost_total, 0) + coalesce(tc.cost_total, 0))
    - coalesce(cm.commission_total, 0)
  , 2) as gross_margin
from platform.saas_products sp
left join keys k on k.saas_product_id = sp.id
left join revenue r        on r.saas_product_id = sp.id  and r.currency = k.currency
left join product_costs pc on pc.saas_product_id = sp.id and pc.currency = k.currency
left join tenant_costs tc  on tc.saas_product_id = sp.id and tc.currency = k.currency
left join commissions cm   on cm.saas_product_id = sp.id and cm.currency = k.currency
left join mrr m            on m.saas_product_id = sp.id  and m.currency = k.currency;

comment on view platform.v_product_margin is
  'Margen NATIVO por producto y moneda (una fila por par). margen_bruto = ingreso_cobrado - '
  'costo_directo - comision, todo en la MISMA moneda. Moneda NULL = producto sin actividad.';

create or replace view platform.v_partner_margin
with (security_invoker = true) as
with partner_tenants as (
  select t.managing_organization_id as organization_id, t.id as tenant_id
    from platform.tenants t
   where t.managing_organization_id is not null
),
revenue as (
  select pt.organization_id, r.currency, sum(r.collected_amount) as collected_total
    from platform.v_collected_revenue r
    join partner_tenants pt on pt.tenant_id = r.tenant_id
   group by pt.organization_id, r.currency
),
costs as (
  select pt.organization_id, c.currency, sum(c.cost_amount) as cost_total
    from platform.v_tenant_costs c
    join partner_tenants pt on pt.tenant_id = c.tenant_id
   group by pt.organization_id, c.currency
),
commissions as (
  select a.channel_organization_id as organization_id, e.currency, sum(e.amount) as commission_total
    from platform.commission_events e
    join platform.sales_attributions a on a.id = e.sales_attribution_id
   where e.status <> 'VOID' and a.channel_organization_id is not null
   group by a.channel_organization_id, e.currency
),
mrr as (
  select pt.organization_id, v.currency, sum(v.mrr) as mrr_total
    from platform.v_subscription_mrr v
    join partner_tenants pt on pt.tenant_id = v.tenant_id
   group by pt.organization_id, v.currency
),
keys as (
  select organization_id, currency from revenue
  union select organization_id, currency from costs
  union select organization_id, currency from commissions
  union select organization_id, currency from mrr
)
select
  o.id   as organization_id,
  o.display_name,
  k.currency::bpchar               as currency,
  (select count(*) from partner_tenants pt where pt.organization_id = o.id) as managed_tenants,
  coalesce(m.mrr_total, 0)         as mrr,
  coalesce(r.collected_total, 0)   as collected_revenue,
  coalesce(c.cost_total, 0)        as direct_cost,
  coalesce(cm.commission_total, 0) as commission_total,
  round(coalesce(r.collected_total, 0) - coalesce(c.cost_total, 0) - coalesce(cm.commission_total, 0), 2) as gross_margin
from platform.organizations o
left join keys k         on k.organization_id = o.id
left join revenue r      on r.organization_id = o.id  and r.currency = k.currency
left join costs c        on c.organization_id = o.id  and c.currency = k.currency
left join commissions cm on cm.organization_id = o.id and cm.currency = k.currency
left join mrr m          on m.organization_id = o.id  and m.currency = k.currency
where exists (
  select 1 from platform.organization_capabilities oc
   where oc.organization_id = o.id and oc.capability in ('PARTNER', 'RESELLER', 'CONSULTING')
);

comment on view platform.v_partner_margin is
  'Margen NATIVO por canal y moneda. Una fila por par (organización, moneda).';

create or replace view platform.v_tenant_margin
with (security_invoker = true) as
with revenue as (
  select r.tenant_id, r.currency, sum(r.collected_amount) as collected_total
    from platform.v_collected_revenue r where r.tenant_id is not null
   group by r.tenant_id, r.currency
),
costs as (
  select c.tenant_id, c.currency, sum(c.cost_amount) as cost_total
    from platform.v_tenant_costs c group by c.tenant_id, c.currency
),
commissions as (
  select e.tenant_id, e.currency, sum(e.amount) as commission_total
    from platform.commission_events e
   where e.status <> 'VOID' and e.tenant_id is not null
   group by e.tenant_id, e.currency
),
mrr as (
  select v.tenant_id, v.currency, sum(v.mrr) as mrr_total
    from platform.v_subscription_mrr v where v.tenant_id is not null
   group by v.tenant_id, v.currency
),
keys as (
  select tenant_id, currency from revenue
  union select tenant_id, currency from costs
  union select tenant_id, currency from commissions
  union select tenant_id, currency from mrr
)
select
  t.id as tenant_id,
  t.name,
  t.slug,
  t.deployment_mode,
  t.tenant_type,
  sp.code as product_code,
  k.currency::bpchar               as currency,
  coalesce(mv.mrr_total, 0)        as mrr,
  coalesce(r.collected_total, 0)   as collected_revenue,
  coalesce(c.cost_total, 0)        as direct_cost,
  coalesce(cm.commission_total, 0) as commission_total,
  round(coalesce(r.collected_total, 0) - coalesce(c.cost_total, 0) - coalesce(cm.commission_total, 0), 2) as gross_margin
from platform.tenants t
join platform.saas_products sp on sp.id = t.saas_product_id
left join keys k         on k.tenant_id = t.id
left join revenue r      on r.tenant_id = t.id  and r.currency = k.currency
left join costs c        on c.tenant_id = t.id  and c.currency = k.currency
left join commissions cm on cm.tenant_id = t.id and cm.currency = k.currency
left join mrr mv         on mv.tenant_id = t.id and mv.currency = k.currency;

comment on view platform.v_tenant_margin is
  'Margen NATIVO por tenant y moneda. Una fila por par (tenant, moneda).';

-- ---------------------------------------------------------------------------
-- 3. G-20 (R-2) · channel_mrr sin mezclar monedas.
--    Mismo significado cuando el canal factura en UNA moneda; NULL si hay
--    varias. El detalle por moneda va en una columna nueva AL FINAL.
-- ---------------------------------------------------------------------------
create or replace view platform.v_partner_agreements
with (security_invoker = true) as
select
  a.id                        as agreement_id,
  a.organization_id,
  o.display_name              as organization_name,
  o.slug                      as organization_slug,
  a.saas_product_id,
  p.code                      as product_code,
  p.short_name                as product_short_name,
  a.can_resell,
  a.can_manage_tenants,
  a.margin_rate,
  a.default_deployment_mode,
  a.allowed_deployment_modes,
  a.allowed_tenant_types,
  a.billing_responsibility,
  a.max_tenants,
  a.valid_from,
  a.valid_to,
  a.status,
  a.notes,
  (select count(*) from platform.tenants t
    where t.managing_organization_id = a.organization_id
      and t.saas_product_id = a.saas_product_id
      and t.status in ('PENDING', 'ACTIVE', 'SUSPENDED'))          as managed_tenants,
  (select count(*) from platform.tenants t
    where t.managing_organization_id = a.organization_id
      and t.saas_product_id = a.saas_product_id
      and t.status = 'ACTIVE'
      and t.deployment_mode = 'SHARED')                            as shared_tenants,
  (select case when count(distinct x.currency) <= 1 then coalesce(sum(x.mrr), 0) end
     from (select m.mrr, m.currency from platform.v_subscription_mrr m
             join platform.subscriptions s on s.id = m.subscription_id
             left join platform.tenants t on t.id = s.tenant_id
            where s.saas_product_id = a.saas_product_id
              and (s.billed_organization_id = a.organization_id
                or t.managing_organization_id = a.organization_id)) x) as channel_mrr,
  (select coalesce(jsonb_object_agg(y.currency, y.total), '{}'::jsonb)
     from (select m.currency, sum(m.mrr) as total from platform.v_subscription_mrr m
             join platform.subscriptions s on s.id = m.subscription_id
             left join platform.tenants t on t.id = s.tenant_id
            where s.saas_product_id = a.saas_product_id
              and (s.billed_organization_id = a.organization_id
                or t.managing_organization_id = a.organization_id)
            group by m.currency) y)                                 as channel_mrr_by_currency
from platform.organization_product_agreements a
join platform.organizations o on o.id = a.organization_id
join platform.saas_products  p on p.id = a.saas_product_id;

comment on column platform.v_partner_agreements.channel_mrr is
  'MRR del canal en el producto si factura en UNA moneda; NULL si hay varias (ver channel_mrr_by_currency).';

-- ---------------------------------------------------------------------------
-- 4. G-19 (R-1) · dashboard_summary: comisiones por moneda.
--    `commission_pending` / `commission_paid` conservan su significado con una
--    sola moneda y valen NULL si hay varias: un número mezclado es peor que
--    ningún número. Los mapas por moneda son la fuente correcta.
-- ---------------------------------------------------------------------------
create or replace function platform.dashboard_summary()
returns jsonb
language sql
stable
set search_path = platform, pg_catalog
as $$
  select jsonb_build_object(
    'active_products',       (select count(*) from platform.saas_products where status = 'ACTIVE'),
    'organizations',         (select count(*) from platform.organizations where status = 'ACTIVE'),
    'partners',              (select count(distinct oc.organization_id) from platform.organization_capabilities oc
                               where oc.capability in ('PARTNER', 'RESELLER', 'CONSULTING')),
    'customers',             (select count(distinct oc.organization_id) from platform.organization_capabilities oc
                               where oc.capability = 'CUSTOMER'),
    'production_tenants',    (select count(*) from platform.tenants
                               where tenant_type = 'PRODUCTION' and status = 'ACTIVE'),
    'demo_trial_tenants',    (select count(*) from platform.tenants
                               where tenant_type in ('DEMO', 'TRIAL') and status <> 'ARCHIVED'),
    'tenants_by_mode',       (select coalesce(jsonb_object_agg(deployment_mode, n), '{}'::jsonb)
                               from (select deployment_mode, count(*) as n from platform.tenants
                                      where status = 'ACTIVE' group by deployment_mode) x),
    'mrr_by_currency',       (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                               from (select currency, sum(mrr) as total
                                       from platform.v_subscription_mrr group by currency) x),
    'collected_by_currency', (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                               from (select currency, sum(collected_amount) as total
                                       from platform.v_collected_revenue group by currency) x),
    'cost_by_currency',      (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                               from (select ce.currency, sum(round(ce.amount * a.weight, 2)) as total
                                       from platform.cost_allocations a
                                       join platform.cost_entries ce on ce.id = a.cost_entry_id
                                      group by ce.currency) x),
    'commission_pending_by_currency',
                             (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                               from (select currency, sum(amount) as total from platform.commission_events
                                      where status in ('ELIGIBLE', 'ACCRUED') group by currency) x),
    'commission_paid_by_currency',
                             (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                               from (select currency, sum(amount) as total from platform.commission_events
                                      where status = 'PAID' group by currency) x),
    'commission_pending',    (select case when count(distinct currency) <= 1 then coalesce(sum(amount), 0) end
                                from platform.commission_events where status in ('ELIGIBLE', 'ACCRUED')),
    'commission_paid',       (select case when count(distinct currency) <= 1 then coalesce(sum(amount), 0) end
                                from platform.commission_events where status = 'PAID'),
    'reporting_currency',    (select s.reporting_currency from platform.reporting_settings() s),
    'provisioning_by_status',(select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                               from (select status, count(*) as n from platform.provisioning_requests
                                      group by status) x),
    'provisioning_failures', (select count(*) from platform.provisioning_requests where status = 'FAILED')
  );
$$;

comment on function platform.dashboard_summary() is
  'Resumen NATIVO del dashboard: todo importe va por moneda. commission_pending/paid solo '
  'valen con una moneda (NULL si hay varias). Sin SECURITY DEFINER: RLS del usuario.';

-- ---------------------------------------------------------------------------
-- 5. Hechos financieros con dimensiones regionales.
--
-- Una fila por hecho nativo: métrica, producto, mercado, organización, canal,
-- moneda, importe y fecha. Es la base de los filtros del dashboard regional y
-- del consolidado. security_invoker: cada rol ve los hechos que RLS le permite.
-- ---------------------------------------------------------------------------
create or replace view platform.v_finance_facts
with (security_invoker = true) as
select
  'MRR'::text                     as metric,
  null::text                      as detail,
  v.saas_product_id,
  s.market_id,
  v.billed_organization_id        as organization_id,
  v.managing_organization_id      as partner_organization_id,
  v.currency::bpchar              as currency,
  v.mrr                           as amount,
  current_date                    as fact_date
from platform.v_subscription_mrr v
join platform.subscriptions s on s.id = v.subscription_id

union all

select
  'COLLECTED', r.charge_kind::text, r.saas_product_id, s.market_id,
  r.customer_organization_id, t.managing_organization_id,
  r.currency::bpchar, r.collected_amount, r.collected_on
from platform.v_collected_revenue r
left join platform.invoices i on i.id = r.invoice_id
left join platform.subscriptions s on s.id = i.subscription_id
left join platform.tenants t on t.id = r.tenant_id

union all

select
  'COST', ce.category::text,
  coalesce(a.saas_product_id, t.saas_product_id, dt.saas_product_id),
  ts.market_id,
  coalesce(a.organization_id, t.customer_organization_id, dt.owner_organization_id),
  t.managing_organization_id,
  ce.currency::bpchar, round(ce.amount * a.weight, 2), ce.period_end
from platform.cost_allocations a
join platform.cost_entries ce on ce.id = a.cost_entry_id
left join platform.tenants t on t.id = a.tenant_id
left join platform.deployment_targets dt on dt.id = a.deployment_target_id
left join lateral (
  select s2.market_id from platform.subscriptions s2
   where s2.tenant_id = t.id order by (s2.status = 'ACTIVE') desc, s2.started_on desc limit 1
) ts on true

union all

select
  'COMMISSION', e.status::text, e.saas_product_id, s.market_id,
  i.customer_organization_id, a.channel_organization_id,
  e.currency::bpchar, e.amount, e.earned_on
from platform.commission_events e
join platform.sales_attributions a on a.id = e.sales_attribution_id
left join platform.payments p on p.id = e.payment_id
left join platform.invoices i on i.id = p.invoice_id
left join platform.subscriptions s on s.id = i.subscription_id
where e.status <> 'VOID';

comment on view platform.v_finance_facts is
  'Hechos financieros NATIVOS con dimensiones (producto, mercado, organización, canal, moneda). '
  'MRR es foto a hoy; COLLECTED por fecha de cobro; COST por fin de periodo; COMMISSION por devengo '
  '(detail = estado). Nunca suma monedas.';

grant select on platform.v_finance_facts to authenticated, service_role;
revoke all on platform.v_finance_facts from anon, public;

-- ---------------------------------------------------------------------------
-- 6. finance_reporting_rows — totales por (grupo, métrica, moneda) + conversión.
--
-- Suma SOLO dentro de cada moneda y luego pide a to_reporting_amount el
-- equivalente de cada total. Métricas: MRR, ARR (= MRR × 12), COLLECTED, COST,
-- COMMISSION (todo lo no VOID), COMMISSION_PENDING (ELIGIBLE/ACCRUED),
-- COMMISSION_PAID. El periodo filtra COLLECTED, COST y COMMISSION; MRR es foto.
-- ---------------------------------------------------------------------------
create or replace function platform.finance_reporting_rows(
  p_as_of              date default current_date,
  p_reporting_currency char(3) default null,
  p_group_by           text default 'TOTAL',
  p_market_code        text default null,
  p_currency           char(3) default null,
  p_saas_product_id    uuid default null,
  p_organization_id    uuid default null,
  p_period_start       date default null,
  p_period_end         date default null
)
returns table (
  group_key          text,
  group_label        text,
  metric             text,
  native_currency    char(3),
  native_amount      numeric,
  reporting_currency char(3),
  reporting_amount   numeric,
  conversion_status  text,
  fx_method          text,
  fx_rate            numeric,
  fx_rate_date       date,
  fx_is_demo         boolean
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with f as (
    select ff.*, m.code as market_code
      from platform.v_finance_facts ff
      left join platform.markets m on m.id = ff.market_id
     where (p_market_code is null or m.code = upper(trim(p_market_code)))
       and (p_currency is null or ff.currency = upper(p_currency))
       and (p_saas_product_id is null or ff.saas_product_id = p_saas_product_id)
       and (p_organization_id is null
            or ff.organization_id = p_organization_id
            or ff.partner_organization_id = p_organization_id)
       and (ff.metric = 'MRR'
            or ((p_period_start is null or ff.fact_date >= p_period_start)
                and (p_period_end is null or ff.fact_date <= p_period_end)))
  ),
  grouped as (
    select
      case upper(coalesce(p_group_by, 'TOTAL'))
        when 'MARKET'  then coalesce(f.market_code, 'SIN_MERCADO')
        when 'PRODUCT' then coalesce(f.saas_product_id::text, 'SIN_PRODUCTO')
        when 'PARTNER' then coalesce(f.partner_organization_id::text, 'DIRECTO')
        else 'TOTAL'
      end as gkey,
      x.metric,
      f.currency,
      sum(x.amount) as amount
    from f
    cross join lateral (values
      ('MRR',                case when f.metric = 'MRR' then f.amount end),
      ('ARR',                case when f.metric = 'MRR' then round(f.amount * 12, 2) end),
      ('COLLECTED',          case when f.metric = 'COLLECTED' then f.amount end),
      ('COST',               case when f.metric = 'COST' then f.amount end),
      ('COMMISSION',         case when f.metric = 'COMMISSION' then f.amount end),
      ('COMMISSION_PENDING', case when f.metric = 'COMMISSION' and f.detail in ('ELIGIBLE', 'ACCRUED') then f.amount end),
      ('COMMISSION_PAID',    case when f.metric = 'COMMISSION' and f.detail = 'PAID' then f.amount end)
    ) as x (metric, amount)
    where x.amount is not null
    group by 1, 2, 3
  )
  select
    g.gkey,
    case upper(coalesce(p_group_by, 'TOTAL'))
      when 'MARKET'  then coalesce((select mk.name from platform.markets mk where mk.code = g.gkey), 'Sin mercado')
      when 'PRODUCT' then coalesce((select sp.short_name from platform.saas_products sp where sp.id::text = g.gkey), 'Sin producto')
      when 'PARTNER' then coalesce((select o.display_name from platform.organizations o where o.id::text = g.gkey), 'Venta directa')
      else 'Total'
    end,
    g.metric,
    g.currency::char(3),
    g.amount,
    r.reporting_currency,
    r.reporting_amount,
    r.conversion_status,
    r.fx_method,
    r.fx_rate,
    r.fx_rate_date,
    r.fx_is_demo
  from grouped g
  cross join lateral platform.to_reporting_amount(g.amount, g.currency::char(3), p_as_of, p_reporting_currency) r
  order by 1, 3, 4;
$$;

comment on function platform.finance_reporting_rows is
  'Totales nativos por (grupo, métrica, moneda) con su equivalente de reporte. Suma dentro de cada '
  'moneda ANTES de convertir. group_by: TOTAL | MARKET | PRODUCT | PARTNER.';

-- ---------------------------------------------------------------------------
-- 7. finance_consolidated — la respuesta del modo CONSOLIDADO.
--
-- Por grupo y métrica: `native` {moneda: importe}, `reporting_amount` (NULL si
-- falta alguna conversión), `complete` y `missing_currencies`. Margen
-- consolidado = COLLECTED − COST − COMMISSION solo si las tres están completas.
-- `completeness.missing_fx_count` = monedas sin tasa: el tablero NO puede
-- presentar como completa una cifra con faltantes.
-- ---------------------------------------------------------------------------
create or replace function platform.finance_consolidated(
  p_as_of              date default current_date,
  p_reporting_currency char(3) default null,
  p_group_by           text default 'TOTAL',
  p_market_code        text default null,
  p_currency           char(3) default null,
  p_saas_product_id    uuid default null,
  p_organization_id    uuid default null,
  p_period_start       date default null,
  p_period_end         date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with cfg as (
    select coalesce(upper(p_reporting_currency), s.reporting_currency)::char(3) as rc,
           s.fx_max_rate_age_days as age
      from (select 1) one
      left join platform.reporting_settings() s on true
  ),
  dec as (
    select coalesce((select c.decimals from platform.currencies c, cfg where c.code = cfg.rc), 2) as d
  ),
  rows as materialized (
    select r.*
      from cfg
      cross join lateral platform.finance_reporting_rows(
        p_as_of, cfg.rc, p_group_by, p_market_code, p_currency, p_saas_product_id,
        p_organization_id, p_period_start, p_period_end) r
  ),
  metric_agg as (
    select
      r.group_key, r.metric,
      jsonb_object_agg(r.native_currency, r.native_amount) as native,
      bool_and(r.conversion_status in ('SAME_CURRENCY', 'CONVERTED')) as complete,
      case when bool_and(r.conversion_status in ('SAME_CURRENCY', 'CONVERTED'))
           then sum(r.reporting_amount) end as reporting_amount,
      coalesce(jsonb_agg(distinct r.native_currency)
               filter (where r.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')), '[]'::jsonb) as missing
    from rows r
    group by r.group_key, r.metric
  ),
  groups as (
    select distinct r.group_key, r.group_label from rows r
  ),
  filled as (
    select g.group_key, g.group_label, m.metric,
           coalesce(ma.native, '{}'::jsonb) as native,
           coalesce(ma.complete, true) as complete,
           -- Una métrica sin hechos en el grupo vale 0 y está completa.
           case when ma.metric is null then 0 else ma.reporting_amount end as reporting_amount,
           coalesce(ma.missing, '[]'::jsonb) as missing
      from groups g
      cross join (values ('MRR'), ('ARR'), ('COLLECTED'), ('COST'), ('COMMISSION'),
                         ('COMMISSION_PENDING'), ('COMMISSION_PAID')) as m (metric)
      left join metric_agg ma on ma.group_key = g.group_key and ma.metric = m.metric
  ),
  native_margin as (
    select r.group_key,
           jsonb_object_agg(r.native_currency, r.margin) as margin
      from (select group_key, native_currency,
                   sum(case metric when 'COLLECTED' then native_amount else -native_amount end) as margin
              from rows where metric in ('COLLECTED', 'COST', 'COMMISSION')
             group by group_key, native_currency) r
     group by r.group_key
  ),
  per_group as (
    select
      f.group_key, f.group_label,
      jsonb_object_agg(f.metric, jsonb_build_object(
        'native', f.native,
        'reporting_amount', round(f.reporting_amount, (select d from dec)),
        'complete', f.complete,
        'missing_currencies', f.missing)) as metrics,
      bool_and(f.complete) filter (where f.metric in ('COLLECTED', 'COST', 'COMMISSION')) as margin_complete,
      sum(case f.metric when 'COLLECTED' then f.reporting_amount else -f.reporting_amount end)
        filter (where f.metric in ('COLLECTED', 'COST', 'COMMISSION')) as margin_amount
    from filled f
    group by f.group_key, f.group_label
  ),
  missing as (
    select coalesce(array_agg(distinct r.native_currency::text), array[]::text[]) as currencies
      from rows r
     where r.conversion_status not in ('SAME_CURRENCY', 'CONVERTED')
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'reporting_currency', (select rc from cfg),
    'fx_max_rate_age_days', (select age from cfg),
    'group_by', upper(coalesce(p_group_by, 'TOTAL')),
    'filters', jsonb_build_object('market_code', p_market_code, 'currency', p_currency,
                                  'saas_product_id', p_saas_product_id, 'organization_id', p_organization_id,
                                  'period_start', p_period_start, 'period_end', p_period_end),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', pg.group_key,
               'label', pg.group_label,
               'metrics', pg.metrics,
               'native_margin', coalesce(nm.margin, '{}'::jsonb),
               'margin', jsonb_build_object(
                 'reporting_amount', case when coalesce(pg.margin_complete, true)
                                          then round(coalesce(pg.margin_amount, 0), (select d from dec)) end,
                 'complete', coalesce(pg.margin_complete, true))
             ) order by pg.group_key)
        from per_group pg
        left join native_margin nm on nm.group_key = pg.group_key), '[]'::jsonb),
    'completeness', jsonb_build_object(
      'complete', (select rc from cfg) is not null and cardinality((select currencies from missing)) = 0,
      'missing_fx_count', cardinality((select currencies from missing)),
      'missing_currencies', to_jsonb((select currencies from missing))),
    'rates_used', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'from', r.native_currency, 'to', r.reporting_currency, 'rate', r.fx_rate,
               'method', r.fx_method, 'rate_date', r.fx_rate_date, 'is_demo', r.fx_is_demo))
        from rows r where r.conversion_status = 'CONVERTED'), '[]'::jsonb)
  );
$$;

comment on function platform.finance_consolidated is
  'Consolidado gerencial en la moneda de reporte. Nativo por moneda + equivalente; NULL y '
  'missing_fx_count cuando falta una tasa. Margen consolidado solo con conversiones completas.';

-- ---------------------------------------------------------------------------
-- 8. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('dashboard_summary', 'finance_reporting_rows', 'finance_consolidated')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
