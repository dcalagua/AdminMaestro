-- ============================================================================
-- EBIM Control Plane — 11 · Vistas y RPC de métricas gerenciales
-- ----------------------------------------------------------------------------
-- Fórmulas documentadas en docs/finance/COST_MARGIN_MODEL.md.
--
-- SEGURIDAD DE VISTAS: todas se crean con `security_invoker = true`. Sin eso,
-- una vista corre con los permisos de su OWNER y se convierte en un bypass de
-- RLS: cualquier `authenticated` leería filas que su política le niega.
--
-- No hay conversión FX: los agregados van SIEMPRE agrupados por moneda. Convertir
-- con un tipo de cambio implícito produce un número que nadie puede auditar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- v_subscription_mrr — MRR normalizado a mes por suscripción ACTIVA.
-- Sólo ítems recurrentes: un implementation fee no es recurrente.
-- ---------------------------------------------------------------------------
create view platform.v_subscription_mrr
with (security_invoker = true) as
select
  s.id                        as subscription_id,
  s.saas_product_id,
  s.tenant_id,
  s.billed_organization_id,
  s.currency,
  t.deployment_mode,
  t.tenant_type,
  t.managing_organization_id,
  sum(
    round(
      si.amount * case si.billing_interval
        when 'MONTHLY'   then 1.0
        when 'QUARTERLY' then 1.0 / 3
        when 'YEARLY'    then 1.0 / 12
        else 0.0  -- ONE_TIME nunca entra en MRR
      end, 2)
  ) as mrr
from platform.subscriptions s
join platform.subscription_items si on si.subscription_id = s.id
left join platform.tenants t on t.id = s.tenant_id
where s.status = 'ACTIVE'
  and si.billing_interval <> 'ONE_TIME'
  and si.charge_kind <> 'DISCOUNT'
  and si.valid_from <= current_date
  and (si.valid_to is null or si.valid_to >= current_date)
  -- Regla §2.2: un tenant DEMO nunca aporta MRR.
  and (t.id is null or t.tenant_type <> 'DEMO')
group by s.id, s.saas_product_id, s.tenant_id, s.billed_organization_id, s.currency,
         t.deployment_mode, t.tenant_type, t.managing_organization_id;

comment on view platform.v_subscription_mrr is
  'MRR por suscripción activa, normalizado a mes. Excluye ONE_TIME, DISCOUNT y '
  'tenants DEMO. Sin conversión FX: agrupar siempre por currency.';

-- ---------------------------------------------------------------------------
-- v_collected_revenue — ingreso EFECTIVAMENTE COBRADO.
-- Un pago se reparte entre las líneas de su factura en proporción al monto de
-- cada línea; así se puede separar licencia cobrada de fee de implementación
-- cobrado incluso con pagos parciales.
-- ---------------------------------------------------------------------------
create view platform.v_collected_revenue
with (security_invoker = true) as
select
  i.id                     as invoice_id,
  i.customer_organization_id,
  l.saas_product_id,
  l.tenant_id,
  l.charge_kind,
  l.is_recurring,
  i.currency,
  i.period_start,
  i.period_end,
  p.paid_at::date          as collected_on,
  round(l.amount * (p.amount / nullif(i.total, 0)), 2) as collected_amount
from platform.invoices i
join platform.invoice_lines l on l.invoice_id = i.id
join platform.payments p on p.invoice_id = i.id
where p.status = 'CONFIRMED'
  -- DRAFT y VOID nunca cuentan como ingreso (prompt fase 7).
  and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
  and coalesce(i.total, 0) > 0;

comment on view platform.v_collected_revenue is
  'Ingreso cobrado, repartido por línea en proporción al pago. Excluye facturas '
  'DRAFT/VOID. is_recurring separa licencia de implementation fee.';

-- ---------------------------------------------------------------------------
-- v_tenant_costs — costo directo imputado a cada tenant.
-- Incluye la imputación DIRECTA (scope TENANT) y la parte que le toca de un
-- target dedicado (scope DEPLOYMENT_TARGET, repartida entre sus tenants activos).
-- ---------------------------------------------------------------------------
create view platform.v_tenant_costs
with (security_invoker = true) as
-- Costos imputados directamente al tenant.
select
  a.tenant_id,
  ce.currency,
  ce.period_start,
  ce.period_end,
  ce.category,
  round(ce.amount * a.weight, 2) as cost_amount,
  'DIRECT'::text                 as allocation_path
from platform.cost_allocations a
join platform.cost_entries ce on ce.id = a.cost_entry_id
where a.scope = 'TENANT' and a.tenant_id is not null

union all

-- Costos de un deployment target, repartidos entre sus tenants activos.
select
  td.tenant_id,
  ce.currency,
  ce.period_start,
  ce.period_end,
  ce.category,
  round(
    (ce.amount * a.weight) / nullif(count(*) over (partition by a.id), 0), 2
  ) as cost_amount,
  'VIA_TARGET'::text as allocation_path
from platform.cost_allocations a
join platform.cost_entries ce on ce.id = a.cost_entry_id
join platform.tenant_deployments td
  on td.deployment_target_id = a.deployment_target_id and td.status = 'ACTIVE'
where a.scope = 'DEPLOYMENT_TARGET' and a.deployment_target_id is not null;

comment on view platform.v_tenant_costs is
  'Costo directo por tenant. Un costo de infraestructura dedicada se reparte entre '
  'los tenants activos de ese target — regla explícita, no prorrateo implícito.';

-- ---------------------------------------------------------------------------
-- v_tenant_overview — la fila que consume la UI de Tenants.
-- ---------------------------------------------------------------------------
create view platform.v_tenant_overview
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
  coalesce(mrr.currency, 'USD') as currency,
  sub.id                  as subscription_id,
  pl.name                 as plan_name
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
  select s.id, s.plan_id from platform.subscriptions s
   where s.tenant_id = t.id and s.status = 'ACTIVE' limit 1
) sub on true
left join platform.plans pl on pl.id = sub.plan_id;

-- ---------------------------------------------------------------------------
-- v_product_margin — margen por producto SaaS.
--
--   ingreso_cobrado  = suma de v_collected_revenue
--   costo_directo    = costos con scope PRODUCT + los que llegan vía tenant
--   comision         = commission_events no VOID
--   margen_bruto     = ingreso_cobrado - costo_directo - comision
-- ---------------------------------------------------------------------------
create view platform.v_product_margin
with (security_invoker = true) as
with revenue as (
  select r.saas_product_id, r.currency,
         sum(r.collected_amount)                                     as collected_total,
         sum(r.collected_amount) filter (where r.is_recurring)        as collected_recurring,
         sum(r.collected_amount) filter (where not r.is_recurring)    as collected_one_time
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
         sum(e.amount)                                        as commission_total,
         sum(e.amount) filter (where e.status = 'PAID')        as commission_paid,
         sum(e.amount) filter (where e.status <> 'PAID')       as commission_pending
    from platform.commission_events e
   where e.status <> 'VOID'
   group by e.saas_product_id, e.currency
),
mrr as (
  select v.saas_product_id, v.currency, sum(v.mrr) as mrr_total
    from platform.v_subscription_mrr v
   group by v.saas_product_id, v.currency
)
select
  sp.id   as saas_product_id,
  sp.code as product_code,
  sp.short_name,
  coalesce(r.currency, pc.currency, tc.currency, cm.currency, m.currency, 'USD') as currency,
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
left join revenue r on r.saas_product_id = sp.id
left join product_costs pc on pc.saas_product_id = sp.id and pc.currency = r.currency
left join tenant_costs tc on tc.saas_product_id = sp.id and tc.currency = r.currency
left join commissions cm on cm.saas_product_id = sp.id and cm.currency = r.currency
left join mrr m on m.saas_product_id = sp.id and m.currency = coalesce(r.currency, 'USD');

comment on view platform.v_product_margin is
  'Margen por producto. margen_bruto = ingreso_cobrado - costo_directo - comision. '
  'Ingreso COBRADO (no facturado): un facturado impago no es margen.';

-- ---------------------------------------------------------------------------
-- v_partner_margin — margen por partner/canal.
-- ---------------------------------------------------------------------------
create view platform.v_partner_margin
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
)
select
  o.id   as organization_id,
  o.display_name,
  coalesce(r.currency, c.currency, cm.currency, m.currency, 'USD') as currency,
  (select count(*) from partner_tenants pt where pt.organization_id = o.id) as managed_tenants,
  coalesce(m.mrr_total, 0)         as mrr,
  coalesce(r.collected_total, 0)   as collected_revenue,
  coalesce(c.cost_total, 0)        as direct_cost,
  coalesce(cm.commission_total, 0) as commission_total,
  round(coalesce(r.collected_total, 0) - coalesce(c.cost_total, 0) - coalesce(cm.commission_total, 0), 2) as gross_margin
from platform.organizations o
left join revenue r on r.organization_id = o.id
left join costs c on c.organization_id = o.id and c.currency = r.currency
left join commissions cm on cm.organization_id = o.id and cm.currency = r.currency
left join mrr m on m.organization_id = o.id and m.currency = coalesce(r.currency, 'USD')
where exists (
  select 1 from platform.organization_capabilities oc
   where oc.organization_id = o.id and oc.capability in ('PARTNER', 'RESELLER', 'CONSULTING')
);

-- ---------------------------------------------------------------------------
-- v_tenant_margin — margen por tenant.
-- ---------------------------------------------------------------------------
create view platform.v_tenant_margin
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
)
select
  t.id as tenant_id,
  t.name,
  t.slug,
  t.deployment_mode,
  t.tenant_type,
  sp.code as product_code,
  coalesce(r.currency, c.currency, cm.currency, 'USD') as currency,
  coalesce(mv.mrr, 0)              as mrr,
  coalesce(r.collected_total, 0)   as collected_revenue,
  coalesce(c.cost_total, 0)        as direct_cost,
  coalesce(cm.commission_total, 0) as commission_total,
  round(coalesce(r.collected_total, 0) - coalesce(c.cost_total, 0) - coalesce(cm.commission_total, 0), 2) as gross_margin
from platform.tenants t
join platform.saas_products sp on sp.id = t.saas_product_id
left join revenue r on r.tenant_id = t.id
left join costs c on c.tenant_id = t.id and c.currency = r.currency
left join commissions cm on cm.tenant_id = t.id and cm.currency = r.currency
left join platform.v_subscription_mrr mv on mv.tenant_id = t.id;

-- ---------------------------------------------------------------------------
-- RPC de dashboard. STABLE + security invoker implícito: cada rol ve lo que
-- sus políticas le permiten, no hay bypass.
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
    'commission_pending',    (select coalesce(sum(amount), 0) from platform.commission_events
                               where status in ('ELIGIBLE', 'ACCRUED')),
    'commission_paid',       (select coalesce(sum(amount), 0) from platform.commission_events
                               where status = 'PAID'),
    'provisioning_by_status',(select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                               from (select status, count(*) as n from platform.provisioning_requests
                                      group by status) x),
    'provisioning_failures', (select count(*) from platform.provisioning_requests where status = 'FAILED')
  );
$$;

comment on function platform.dashboard_summary() is
  'Resumen del dashboard. STABLE y sin SECURITY DEFINER a propósito: los conteos '
  'salen filtrados por las políticas RLS del usuario que llama.';

revoke all on function platform.dashboard_summary() from public, anon;
grant execute on function platform.dashboard_summary() to authenticated, service_role;

-- Las vistas heredan la seguridad de sus tablas (security_invoker), pero igual
-- necesitan GRANT explícito. `anon` queda fuera.
grant select on platform.v_subscription_mrr, platform.v_collected_revenue,
                platform.v_tenant_costs, platform.v_tenant_overview,
                platform.v_product_margin, platform.v_partner_margin,
                platform.v_tenant_margin
  to authenticated, service_role;

revoke all on platform.v_subscription_mrr, platform.v_collected_revenue,
               platform.v_tenant_costs, platform.v_tenant_overview,
               platform.v_product_margin, platform.v_partner_margin,
               platform.v_tenant_margin
  from anon, public;
