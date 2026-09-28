-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · read models comerciales y los 8
-- productos en un reset limpio (Task MA-19)
-- ----------------------------------------------------------------------------
-- Spec §2 (8 productos), §14.2.3 (vistas SECURITY INVOKER), plan P-03.
-- Todo se revierte (rollback).
-- ============================================================================
begin;
select plan(19);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.alpha() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------
-- Reset limpio: los 8 productos, sin configuración insegura
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(code, ',' order by sort_order) from platform.saas_products),
  'esupplier,ewm,tms,gmao,echange,comerza,eexpense,ecommerce',
  'db reset produce los 8 productos de la suite');
select is(
  (select string_agg(id::text, ',' order by id) from platform.saas_products
    where code in ('comerza', 'eexpense', 'ecommerce')),
  '20000000-0000-4000-a000-000000000006,20000000-0000-4000-a000-000000000007,20000000-0000-4000-a000-000000000008',
  'Los 3 productos nuevos siguen el patrón de ids del seed');
select is(
  (select count(*)::int
     from platform.saas_products p
    where p.code in ('comerza', 'eexpense', 'ecommerce')
      and (exists (select 1 from platform.plans pl where pl.saas_product_id = p.id)
        or exists (select 1 from platform.product_integrations i where i.saas_product_id = p.id)
        or exists (select 1 from platform.credential_profiles c where c.saas_product_id = p.id)
        or exists (select 1 from platform.catalog_items ci where ci.saas_product_id = p.id))),
  0, 'Los productos nuevos no traen planes, precios, integraciones ni credenciales inventadas');
select is(
  (select count(*)::int from platform.credential_profiles
    where secret_ref is not null and not platform.is_secret_reference(secret_ref)),
  0, 'Ninguna credencial del seed guarda un valor: solo referencias');
select is(
  (select count(*)::int from platform.product_capabilities), 0,
  'El seed no inventa capacidades: nacen del manifiesto de cada SaaS');
select is(
  (select count(*)::int from platform.entitlement_grants), 0,
  'El seed no inventa grants ni valores de límites (D-05)');
select is(
  (select count(*)::int from platform.catalog_item_prices), 0,
  'El seed no carga precios de add-on (D-01)');

-- ---------------------------------------------------------------------------
-- Read models: SECURITY INVOKER, sin anon
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(c.relname || ':' || coalesce('security_invoker=true' = any(c.reloptions), false) || ':'
            || has_table_privilege('anon', c.oid, 'select') || ':' || has_table_privilege('authenticated', c.oid, 'select'),
            ',' order by c.relname)
     from pg_class c
    where c.relnamespace = 'platform'::regnamespace and c.relkind = 'v'
      and c.relname in ('v_tenant_entitlements', 'v_catalog_item_current_prices', 'v_tenant_addon_history',
                        'v_commercial_audit_log')),
  'v_catalog_item_current_prices:true:false:true,v_commercial_audit_log:true:false:true,'
  || 'v_tenant_addon_history:true:false:true,v_tenant_entitlements:true:false:true',
  'Vistas comerciales security_invoker, legibles por authenticated y no por anon');

-- Escenario QA mínimo.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [
    {"code": "esupplier.qa.core", "name": "QA núcleo", "kind": "FEATURE", "isBaseline": true, "status": "ACTIVE"},
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.set_catalog_item_price('consolidation', 'PE', 'ADDON', 'MONTHLY', 10.00, 'USD', current_date);
select platform.set_catalog_item_price('consolidation', 'PE', 'ADDON', 'MONTHLY', 12.00, 'USD', current_date + 30);
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation', null, 'QA');

-- v_tenant_entitlements = compute_entitlements.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is(
  (select string_agg(capability_code || ':' || app_active || ':' || array_to_string(sources, '+'), ',' order by capability_code)
     from platform.v_tenant_entitlements where tenant_id = pg_temp.alpha()),
  'esupplier.qa.core:true:BASELINE,esupplier.qa.tenders:true:PLAN',
  'v_tenant_entitlements expone el entitlement efectivo con appActive');
select ok(
  (select bool_and(desired_dirty) from platform.v_tenant_entitlements where tenant_id = pg_temp.alpha()),
  'y el estado deseado (dirty) del tenant');

-- v_catalog_item_current_prices.
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is(
  (select string_agg(amount || ':' || is_current || ':' || is_scheduled || ':' || market_code, ',' order by valid_from)
     from platform.v_catalog_item_current_prices where catalog_item_code = 'consolidation'),
  '10.00:true:false:PE,12.00:false:true:PE', 'Tarifas de add-on con vigente y programada');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is((select count(*)::int from platform.v_catalog_item_current_prices), 0,
  'Un tenant sin el add-on contratado no ve tarifas de EBIM');

-- v_tenant_addon_history.
select is(
  (select string_agg(addon_code || ':' || status || ':' || request_source, ',' order by addon_code, requested_at)
     from platform.v_tenant_addon_history where tenant_id = pg_temp.alpha()),
  'consolidation:REQUESTED:TENANT,licitaciones:ACTIVE:LEGACY_BACKFILL',
  'El tenant ve su historia de add-ons');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.v_tenant_addon_history where tenant_id = pg_temp.alpha()), 0,
  'omega no ve la historia de add-ons de alpha');
select is((select count(*)::int from platform.v_tenant_entitlements where tenant_id = pg_temp.alpha()), 0,
  'omega no ve los entitlements de alpha');

-- v_commercial_audit_log.
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');
select is(
  (select string_agg(distinct action, ',' order by action) from platform.v_commercial_audit_log
    where action in ('CAPABILITY_MANIFEST_IMPORTED', 'ENTITLEMENT_GRANT_CREATED', 'ADDON_PRICE_VERSIONED', 'TENANT_ADDON_REQUESTED')),
  'ADDON_PRICE_VERSIONED,CAPABILITY_MANIFEST_IMPORTED,ENTITLEMENT_GRANT_CREATED,TENANT_ADDON_REQUESTED',
  'La bitácora comercial reúne registro, grants, precios y ciclo de vida');
select ok(
  (select count(*) from platform.v_commercial_audit_log where action not in (
     select unnest(array['CAPABILITY_MANIFEST_IMPORTED', 'CAPABILITY_ALIAS_REGISTERED', 'CATALOG_ITEM_LIFECYCLE_SET',
                         'ADDON_PRICE_VERSIONED', 'ENTITLEMENT_GRANT_CREATED', 'ENTITLEMENT_GRANT_CLOSED',
                         'ENTITLEMENT_OVERRIDE_CREATED', 'ENTITLEMENT_OVERRIDE_REVOKED', 'TENANT_FEATURE_SET'])
     ) and action not like 'TENANT_ADDON_%') = 0,
  'Solo acciones comerciales');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is((select count(*)::int from platform.v_commercial_audit_log), 0,
  'authenticated sin rol no ve la bitácora comercial');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.tenants t
    where not exists (select 1 from platform.saas_products p where p.id = t.saas_product_id)),
  0, 'Integridad: todo tenant del seed pertenece a un producto del catálogo');

select * from finish();
rollback;
