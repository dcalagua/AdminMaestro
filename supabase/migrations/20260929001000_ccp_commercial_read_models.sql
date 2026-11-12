-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · read models comerciales (MA-19)
-- ----------------------------------------------------------------------------
-- Spec §14.1 ("leer entitlements de un tenant": vistas SECURITY INVOKER + RLS),
-- §14.2.3. Plan §4 fila 12. Test: supabase/tests/34_ccp_eight_products.test.sql.
--
-- Todas son security_invoker: la fila la decide la RLS de las tablas base (y de
-- compute_entitlements, que también es INVOKER). Ninguna es legible por anon.
--   · v_tenant_entitlements        entitlement efectivo + appActive + estado deseado
--   · v_catalog_item_current_prices tarifas de add-on con vigente/programada
--   · v_tenant_addon_history        ciclo de vida de add-ons por tenant
--   · v_commercial_audit_log        bitácora de las acciones comerciales del programa
-- ============================================================================

create or replace view platform.v_tenant_entitlements
with (security_invoker = true) as
select
  t.id                 as tenant_id,
  t.slug               as tenant_slug,
  t.saas_product_id,
  p.code               as product_code,
  platform.is_tenant_app_active(t.id, t.saas_product_id) as app_active,
  e.capability_id,
  e.capability_code,
  e.kind,
  e.scope_level,
  e.enabled,
  e.value,
  e.enforcement,
  e.included,
  e.period,
  e.unit,
  e.meter_code,
  e.sources,
  e.company_ids,
  coalesce(d.desired_revision, 0) as desired_revision,
  coalesce(d.desired_dirty, false) as desired_dirty,
  d.last_change_at
from platform.tenants t
join platform.saas_products p on p.id = t.saas_product_id
cross join lateral platform.compute_entitlements(t.id, t.saas_product_id, now()) e
left join platform.entitlement_desired_state d
  on d.tenant_id = t.id and d.saas_product_id = t.saas_product_id;

comment on view platform.v_tenant_entitlements is
  'Entitlement efectivo por tenant (compute_entitlements a now()) con appActive y estado deseado. '
  'security_invoker: cada quien ve solo sus tenants.';

create or replace view platform.v_catalog_item_current_prices
with (security_invoker = true) as
select
  cp.id               as price_id,
  cp.catalog_item_id,
  ci.code             as catalog_item_code,
  ci.name             as catalog_item_name,
  ci.saas_product_id,
  ci.lifecycle_status,
  ci.billing_model,
  cp.market_id,
  m.code              as market_code,
  m.name              as market_name,
  cp.charge_kind,
  cp.billing_interval,
  cp.amount,
  cp.currency,
  cp.valid_from,
  cp.valid_to,
  (cp.valid_from <= current_date and (cp.valid_to is null or cp.valid_to >= current_date)) as is_current,
  (cp.valid_from > current_date) as is_scheduled
from platform.catalog_item_prices cp
join platform.catalog_items ci on ci.id = cp.catalog_item_id
join platform.markets m on m.id = cp.market_id;

comment on view platform.v_catalog_item_current_prices is
  'Tarifas de add-on por mercado con vigente/programada (espejo de v_plan_price_catalog).';

create or replace view platform.v_tenant_addon_history
with (security_invoker = true) as
select
  a.id,
  a.tenant_id,
  t.slug              as tenant_slug,
  t.saas_product_id,
  a.addon_code,
  ci.name             as addon_name,
  ci.billing_model,
  ci.lifecycle_status as catalog_lifecycle_status,
  a.company_id,
  co.name             as company_name,
  a.status,
  a.active,
  a.request_source,
  a.requested_by,
  a.requested_at,
  a.approved_by,
  a.approved_at,
  a.effective_from,
  a.effective_to,
  a.status_reason,
  a.subscription_item_id,
  si.unit_amount,
  si.currency,
  si.valid_to         as billing_valid_to
from platform.tenant_addons a
join platform.tenants t on t.id = a.tenant_id
join platform.catalog_items ci on ci.code = a.addon_code
left join platform.companies co on co.id = a.company_id
left join platform.subscription_items si on si.id = a.subscription_item_id;

comment on view platform.v_tenant_addon_history is
  'Historia del ciclo de vida de add-ons por tenant; importe visible solo si la RLS de '
  'subscription_items lo permite.';

create or replace view platform.v_commercial_audit_log
with (security_invoker = true) as
select l.id, l.occurred_at, l.actor_user_id, l.actor_email, l.action, l.entity_type, l.entity_id,
       l.organization_id, l.tenant_id, l.metadata
  from platform.audit_logs l
 where l.action in ('CAPABILITY_MANIFEST_IMPORTED', 'CAPABILITY_ALIAS_REGISTERED', 'CATALOG_ITEM_LIFECYCLE_SET',
                    'ADDON_PRICE_VERSIONED', 'ENTITLEMENT_GRANT_CREATED', 'ENTITLEMENT_GRANT_CLOSED',
                    'ENTITLEMENT_OVERRIDE_CREATED', 'ENTITLEMENT_OVERRIDE_REVOKED', 'TENANT_FEATURE_SET')
    or l.action like 'TENANT\_ADDON\_%';

comment on view platform.v_commercial_audit_log is
  'Bitácora de acciones comerciales (registro, catálogo, precios de add-on, grants, overrides, '
  'ciclo de vida de add-ons). La fila la filtra audit_logs_select.';

revoke all on platform.v_tenant_entitlements, platform.v_catalog_item_current_prices,
              platform.v_tenant_addon_history, platform.v_commercial_audit_log from public, anon;
grant select on platform.v_tenant_entitlements, platform.v_catalog_item_current_prices,
                platform.v_tenant_addon_history, platform.v_commercial_audit_log to authenticated, service_role;
