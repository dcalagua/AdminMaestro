-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · cálculo de entitlements efectivos
-- (Task MA-17) y read model tenant_features (Task MA-18)
-- ----------------------------------------------------------------------------
-- Spec §6.1 (baseline ∪ plan ∪ add-ons ⊕ overrides, combine_rule), §10
-- (downgrade/revocación), §14 (aislamiento). Tablas de verdad con capacidades
-- y valores QA; todo se revierte (rollback).
-- ============================================================================
begin;
select plan(34);

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

create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.p1() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000002'::uuid $$;

-- Tabla de verdad: una fila por capacidad QA efectiva.
create or replace function pg_temp.truth(p_tenant uuid, p_at timestamptz default now())
returns text language sql as $$
  select coalesce(string_agg(
           e.capability_code || ':' || e.enabled
           || coalesce(':v=' || e.value, '') || coalesce(':' || e.enforcement, '')
           || coalesce(':i=' || e.included, '')
           || coalesce(':c=' || array_to_string(e.company_ids, '+'), '')
           || ':' || array_to_string(e.sources, '+'),
           ',' order by e.capability_code), '∅')
    from platform.compute_entitlements(p_tenant, pg_temp.esup(), p_at) e
   where e.capability_code like 'esupplier.qa.%'
$$;

-- ---------------------------------------------------------------------------
-- Escenario QA: registro, grants de plan y de add-ons.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [
    {"code": "esupplier.qa.core", "name": "QA núcleo", "kind": "FEATURE", "isBaseline": true, "status": "ACTIVE"},
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "status": "ACTIVE"},
    {"code": "esupplier.qa.scoped", "name": "QA por compañía", "kind": "FEATURE", "scopeLevel": "COMPANY", "status": "ACTIVE"},
    {"code": "esupplier.qa.users.max", "name": "QA usuarios", "kind": "LIMIT", "unit": "user", "combineRule": "MAX", "status": "ACTIVE"},
    {"code": "esupplier.qa.docs", "name": "QA documentos", "kind": "ALLOWANCE", "unit": "document", "combineRule": "SUM", "meterCode": "documents", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE", "meterCode": "ai.credits", "status": "ACTIVE"},
    {"code": "esupplier.qa.beta", "name": "QA borrador", "kind": "FEATURE", "status": "DRAFT"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.users.max', '{"value": 25, "enforcement": "HARD"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.docs', '{"included": 100, "period": "MONTH"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.beta', '{"enabled": true}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.ai.copilot', '{"enabled": true}', current_date + 10, 'QA futuro');
select platform.create_entitlement_grant('CATALOG_ITEM', 'licitaciones', 'esupplier.qa.users.max', '{"value": 10, "enforcement": "SOFT"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('CATALOG_ITEM', 'licitaciones', 'esupplier.qa.docs', '{"included": 50, "period": "MONTH"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('CATALOG_ITEM', 'multi_country', 'esupplier.qa.scoped', '{"enabled": true}', current_date - 30, 'QA');

-- ---------------------------------------------------------------------------
-- MA-17 · forma de la función
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is(
  (select p.provolatile::text || ':' || p.prosecdef || ':' || has_function_privilege('anon', p.oid, 'execute')
     from pg_proc p where p.oid = 'platform.compute_entitlements(uuid, uuid, timestamptz)'::regprocedure),
  's:false:false', 'compute_entitlements es STABLE, SECURITY INVOKER y no la ejecuta anon');

select is(
  (select p.prosecdef::text || ':' || p.provolatile::text from pg_proc p
    where p.oid = 'platform.is_tenant_app_active(uuid, uuid)'::regprocedure),
  'false:s', 'is_tenant_app_active es INVOKER y STABLE');

-- ---------------------------------------------------------------------------
-- MA-17 · tablas de verdad
-- ---------------------------------------------------------------------------
select is(pg_temp.truth(pg_temp.p1()),
  'esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=100:PLAN,esupplier.qa.tenders:true:PLAN,'
  || 'esupplier.qa.users.max:true:v=25:HARD:PLAN',
  'Solo plan: baseline + grants del plan (DRAFT excluida, grant futuro aún no vigente)');
select is(pg_temp.truth(pg_temp.alpha()),
  'esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=150:ADDON+PLAN,esupplier.qa.tenders:true:PLAN,'
  || 'esupplier.qa.users.max:true:v=25:HARD:ADDON+PLAN',
  'Plan ∪ add-on: LIMIT combina por MAX (25 vs 10), ALLOWANCE por SUM (100 + 50), HARD gana a SOFT');
select is(pg_temp.truth(pg_temp.alpha(), now() + interval '11 days'),
  'esupplier.qa.ai.copilot:true:PLAN,esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=150:ADDON+PLAN,'
  || 'esupplier.qa.tenders:true:PLAN,esupplier.qa.users.max:true:v=25:HARD:ADDON+PLAN',
  'Un grant con vigencia futura entra en su fecha');
select is((select count(*)::int from platform.compute_entitlements(pg_temp.alpha(), '20000000-0000-4000-a000-000000000002')),
  0, 'Otro producto: sin entitlements');

-- Baseline solo con la app activa.
update platform.workspace_apps set status = 'suspended'
 where organization_id = '30000000-0000-4000-a000-000000000004' and saas_product_id = pg_temp.esup();
select is(platform.is_tenant_app_active(pg_temp.alpha(), pg_temp.esup()), false, 'App suspendida en el workspace → inactiva');
select ok(pg_temp.truth(pg_temp.alpha()) not like '%qa.core%', 'Sin app activa no hay baseline');
update platform.workspace_apps set status = 'active'
 where organization_id = '30000000-0000-4000-a000-000000000004' and saas_product_id = pg_temp.esup();
select is(platform.is_tenant_app_active(pg_temp.alpha(), pg_temp.esup()), true, 'App activa de nuevo');

-- Alcance por compañía.
insert into platform.tenant_addons (tenant_id, addon_code, company_id, status, request_source, effective_from)
values (pg_temp.alpha(), 'multi_country', '31000000-0000-4000-a000-000000000001', 'ACTIVE', 'CONSOLE', now() - interval '1 day');
select ok(pg_temp.truth(pg_temp.alpha()) like '%esupplier.qa.scoped:true:c=31000000-0000-4000-a000-000000000001:ADDON%',
  'Un add-on por compañía concede la capacidad COMPANY solo a esa compañía');
insert into platform.tenant_addons (tenant_id, addon_code, status, request_source, effective_from)
values (pg_temp.alpha(), 'multi_country', 'ACTIVE', 'CONSOLE', now() - interval '1 day');
select ok(pg_temp.truth(pg_temp.alpha()) like '%esupplier.qa.scoped:true:ADDON%',
  'Si además hay un grant a nivel tenant, aplica a todas las compañías');

-- Downgrade programado: sigue hasta effective_to, desaparece después.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.schedule_cancel_tenant_addon(
  (select id from platform.tenant_addons where tenant_id = pg_temp.alpha() and addon_code = 'licitaciones'),
  'Downgrade QA', now() + interval '5 days');
select ok(pg_temp.truth(pg_temp.alpha()) like '%esupplier.qa.docs:true:i=150:ADDON+PLAN%',
  'CANCEL_SCHEDULED sigue concediendo hasta effective_to');
select ok(pg_temp.truth(pg_temp.alpha(), now() + interval '6 days') like '%esupplier.qa.docs:true:i=100:PLAN,%'
      and pg_temp.truth(pg_temp.alpha(), now() + interval '6 days') like '%esupplier.qa.users.max:true:v=25:HARD:PLAN',
  'Después de effective_to el add-on ya no aporta');

-- Baja inmediata.
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.cancel_tenant_addon(
  (select id from platform.tenant_addons where tenant_id = pg_temp.alpha() and addon_code = 'licitaciones'), 'Baja QA');
select ok(pg_temp.truth(pg_temp.alpha()) not like '%ADDON+PLAN%', 'Un add-on CANCELLED no aparece');

-- Suspensión y reanudación (p1 contrata licitaciones con una tarifa QA).
select pg_temp.act_as_postgres();
insert into platform.catalog_item_prices (catalog_item_id, market_id, charge_kind, billing_interval, amount, currency, valid_from)
select ci.id, m.id, 'ADDON', 'MONTHLY', 1.00, 'USD', current_date
  from platform.catalog_items ci cross join platform.markets m where ci.code = 'licitaciones' and m.code = 'PE';
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select set_config('ccp.p1_lic', platform.request_tenant_addon(pg_temp.p1(), 'licitaciones', null, 'QA')::text, true);
select platform.approve_tenant_addon(current_setting('ccp.p1_lic')::uuid, 'QA');
select ok(pg_temp.truth(pg_temp.p1()) like '%esupplier.qa.docs:true:i=150:ADDON+PLAN%', 'Aprobado: aporta de inmediato');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.suspend_tenant_addon(current_setting('ccp.p1_lic')::uuid, 'Impago QA');
select ok(pg_temp.truth(pg_temp.p1()) like '%esupplier.qa.docs:true:i=100:PLAN,%', 'SUSPENDED no aporta');
select platform.resume_tenant_addon(current_setting('ccp.p1_lic')::uuid, 'Pagó QA');
select ok(pg_temp.truth(pg_temp.p1()) like '%esupplier.qa.docs:true:i=150:ADDON+PLAN%', 'Reanudado vuelve a aportar');

-- Contrato no vigente: el plan deja de aportar; el add-on y el baseline siguen.
select pg_temp.act_as_postgres();
update platform.subscriptions set status = 'CANCELLED', cancelled_at = now() where id = '70000000-0000-4000-a000-000000000002';
select is(pg_temp.truth(pg_temp.p1()),
  'esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=50:ADDON,esupplier.qa.users.max:true:v=10:SOFT:ADDON',
  'Sin contrato activo no hay grants de plan');

-- Overrides: GRANT temporal, DENY, GRANT de límite.
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.ai.copilot', 'GRANT', '{"enabled": true}', now() + interval '3 days', 'Piloto QA');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'DENY', '{}', now() + interval '3 days', 'Bloqueo QA');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.users.max', 'GRANT', '{"value": 100, "enforcement": "HARD"}', now() + interval '3 days', 'Cortesía QA');
select is(pg_temp.truth(pg_temp.alpha()),
  'esupplier.qa.ai.copilot:true:OVERRIDE,esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=100:PLAN,'
  || 'esupplier.qa.scoped:true:ADDON,esupplier.qa.users.max:true:v=100:HARD:OVERRIDE+PLAN',
  'Override GRANT suma una capacidad, DENY la retira y un GRANT de límite se combina por MAX');
select is(pg_temp.truth(pg_temp.alpha(), now() + interval '4 days'),
  'esupplier.qa.core:true:BASELINE,esupplier.qa.docs:true:i=100:PLAN,esupplier.qa.scoped:true:ADDON,'
  || 'esupplier.qa.tenders:true:PLAN,esupplier.qa.users.max:true:v=25:HARD:PLAN',
  'Al vencer, los overrides dejan de aplicar');
select platform.revoke_entitlement_override(
  (select id from platform.tenant_entitlement_overrides where tenant_id = pg_temp.alpha() and override_type = 'DENY'), 'Fin QA');
select ok(pg_temp.truth(pg_temp.alpha()) like '%esupplier.qa.tenders:true:PLAN%', 'Un DENY revocado deja de aplicar');

-- ---------------------------------------------------------------------------
-- MA-17 · aislamiento (SECURITY INVOKER + RLS)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is(pg_temp.truth(pg_temp.alpha()), '∅', 'El admin de omega no calcula entitlements de alpha');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is(pg_temp.truth(pg_temp.alpha()), '∅', 'authenticated sin rol no ve nada');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select ok(pg_temp.truth(pg_temp.alpha()) like 'esupplier.qa.ai.copilot:true:OVERRIDE,%', 'El admin de alpha ve los suyos');

-- ===========================================================================
-- MA-18 · tenant_features = read model derivado (source ENTITLEMENT)
-- ===========================================================================
create or replace function pg_temp.features(p_tenant uuid) returns text language sql as $$
  select coalesce(string_agg(feature_key || ':' || source || ':' || enabled, ',' order by feature_key), '∅')
    from platform.tenant_features where tenant_id = p_tenant
$$;
create or replace function pg_temp.effective_keys(p_tenant uuid) returns text language sql as $$
  select coalesce(string_agg(capability_code, ',' order by capability_code), '∅')
    from platform.compute_entitlements(p_tenant, '20000000-0000-4000-a000-000000000001', now())
$$;

select pg_temp.act_as_postgres();
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname)
     from pg_proc p where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('refresh_tenant_features', 'materialize_tenant_features')),
  'materialize_tenant_features:true:false:false,refresh_tenant_features:true:false:true',
  'La materialización es interna; refresh es una RPC con gate');
select is(
  (select string_agg(feature_key, ',' order by feature_key) from platform.tenant_features
    where tenant_id = pg_temp.alpha() and source = 'ENTITLEMENT'),
  pg_temp.effective_keys(pg_temp.alpha()),
  'Cada cambio comercial dejó tenant_features = entitlements efectivos (sin refresh manual)');
select is(
  (select string_agg(feature_key || ':' || source, ',' order by feature_key) from platform.tenant_features
    where tenant_id = pg_temp.alpha() and source <> 'ENTITLEMENT'),
  'homologacion:PLAN,licitaciones:PLAN,ocr:ADDON',
  'Las filas legacy (PLAN/ADDON) no se tocan');
select is(
  (select value from platform.tenant_features where tenant_id = pg_temp.alpha() and feature_key = 'esupplier.qa.users.max'),
  '{"kind": "LIMIT", "unit": "user", "scope": "TENANT", "value": 100, "sources": ["OVERRIDE", "PLAN"], "enforcement": "HARD"}'::jsonb,
  'El valor materializado lleva límite, enforcement y fuentes (sin precios)');

-- Un override MANUAL (set_tenant_feature, auditado) no se pisa.
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.set_tenant_feature(pg_temp.alpha(), 'esupplier.qa.tenders', false, '{}'::jsonb);
select platform.refresh_tenant_features(pg_temp.alpha());
select is(
  (select source || ':' || enabled from platform.tenant_features where tenant_id = pg_temp.alpha() and feature_key = 'esupplier.qa.tenders'),
  'MANUAL:false', 'Una fila MANUAL no la pisa el read model');

-- Una capacidad que deja de estar concedida desaparece del read model.
select platform.revoke_entitlement_override(
  (select id from platform.tenant_entitlement_overrides
    where tenant_id = pg_temp.alpha() and override_type = 'GRANT' and revoked_at is null
      and capability_id = (select id from platform.product_capabilities where code = 'esupplier.qa.ai.copilot')), 'Fin piloto QA');
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.tenant_features where tenant_id = pg_temp.alpha() and feature_key = 'esupplier.qa.ai.copilot'),
  0, 'Revocar el override retira la fila derivada');

-- Autoridad.
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.refresh_tenant_features('50000000-0000-4000-a000-000000000001') $$,
  '42501', null, 'TENANT_ADMIN no refresca el read model');
select throws_ok($$ insert into platform.tenant_features (tenant_id, feature_key, enabled, source)
                    values ('50000000-0000-4000-a000-000000000001', 'esupplier.qa.hack', true, 'ENTITLEMENT') $$,
  '42501', null, 'Nadie de la API escribe tenant_features (tampoco como ENTITLEMENT)');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.refresh_tenant_features('50000000-0000-4000-a000-0000000000fe') $$,
  '23503', null, 'Tenant inexistente');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.tenant_features where tenant_id = pg_temp.alpha()), 0,
  'El read model respeta RLS: omega no ve los features de alpha');

select * from finish();
rollback;
