-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · grants plan/add-on → capacidad,
-- overrides auditados y estado deseado (Task MA-14)
-- ----------------------------------------------------------------------------
-- Spec §6.1 (forma de `grant`, sin valores inventados), §3.3 (overrides con
-- reason/approved_by/expires_at), §14.1 (autoridad). Capacidades y valores QA,
-- todo se revierte (rollback).
-- ============================================================================
begin;
select plan(63);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
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
create or replace function pg_temp.omega() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000007'::uuid $$;
create or replace function pg_temp.grant_id(p_source text, p_cap text) returns uuid language sql as $$
  select g.id from platform.entitlement_grants g
    join platform.product_capabilities c on c.id = g.capability_id
    left join platform.plans p on p.id = g.plan_id
    left join platform.catalog_items ci on ci.id = g.catalog_item_id
   where c.code = p_cap and coalesce(p.code, ci.code) = p_source
   order by g.valid_from desc limit 1
$$;

-- Registro QA (el product admin importa; así también se prueba el camino real).
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [
    {"code": "esupplier.qa.core", "name": "QA núcleo", "kind": "FEATURE", "isBaseline": true, "status": "ACTIVE"},
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "scopeLevel": "COMPANY", "status": "ACTIVE"},
    {"code": "esupplier.qa.users.max", "name": "QA usuarios", "kind": "LIMIT", "unit": "user", "combineRule": "MAX", "status": "ACTIVE"},
    {"code": "esupplier.qa.docs", "name": "QA documentos", "kind": "ALLOWANCE", "unit": "document", "combineRule": "SUM", "meterCode": "documents", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE", "meterCode": "ai.credits", "status": "ACTIVE"},
    {"code": "esupplier.qa.old", "name": "QA retirada", "kind": "FEATURE", "status": "DEPRECATED"}
  ]}'::jsonb) $$, 'Registro QA importado');

-- ---------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select has_table('platform', 'entitlement_grants', 'Existe entitlement_grants');
select has_table('platform', 'tenant_entitlement_overrides', 'Existe tenant_entitlement_overrides');
select has_table('platform', 'entitlement_desired_state', 'Existe entitlement_desired_state');

select is(
  (select string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' order by c.relname)
     from pg_class c
    where c.relnamespace = 'platform'::regnamespace
      and c.relname in ('entitlement_grants', 'tenant_entitlement_overrides', 'entitlement_desired_state')),
  'entitlement_desired_state:true:true,entitlement_grants:true:true,tenant_entitlement_overrides:true:true',
  'RLS habilitada y forzada');

select is(
  (select string_agg(t || ':' || has_table_privilege('anon', 'platform.' || t, 'select') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'select') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'insert') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'update') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'delete'), ',' order by t)
     from unnest(array['entitlement_desired_state', 'entitlement_grants', 'tenant_entitlement_overrides']) t),
  'entitlement_desired_state:false:true:false:false:false,entitlement_grants:false:true:false:false:false,'
  || 'tenant_entitlement_overrides:false:true:false:false:false',
  'anon sin acceso; authenticated solo SELECT');

select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('public', p.oid, 'execute') || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || has_function_privilege('authenticated', p.oid, 'execute') || ':'
            || coalesce(array_to_string(p.proconfig, ';') like '%search_path%', false),
            ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('create_entitlement_grant', 'close_entitlement_grant', 'create_entitlement_override',
                        'revoke_entitlement_override', 'mark_entitlements_dirty', 'mark_entitlements_dirty_for_source')),
  'close_entitlement_grant:true:false:false:true:true,create_entitlement_grant:true:false:false:true:true,'
  || 'create_entitlement_override:true:false:false:true:true,mark_entitlements_dirty:true:false:false:false:true,'
  || 'mark_entitlements_dirty_for_source:true:false:false:false:true,revoke_entitlement_override:true:false:false:true:true',
  'RPCs DEFINER con search_path; los marcadores internos no son ejecutables por authenticated');

-- ---------------------------------------------------------------------------
-- Autoridad de grants: EBIM_PRODUCT_ADMIN / super admin (spec §14.1)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '42501', null, 'anon no crea grants');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '42501', null, 'TENANT_ADMIN no se concede capacidades');
select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '42501', null, 'El comercial no concede capacidades');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '42501', null, 'EBIM_FINANCE no edita el mapeo plan→capacidad');

-- ---------------------------------------------------------------------------
-- Forma de grant por kind (spec §6.1)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  'FEATURE {"enabled": true}');
select lives_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.users.max', '{"value": 25, "enforcement": "HARD"}', current_date, 'QA') $$,
  'LIMIT {"value", "enforcement"}');
select lives_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.docs', '{"included": 100, "period": "MONTH"}', current_date, 'QA') $$,
  'ALLOWANCE {"included", "period": "MONTH"}');
select lives_ok($$ select platform.create_entitlement_grant('CATALOG_ITEM', 'white_label', 'esupplier.qa.ai.copilot', '{"enabled": true, "creditPolicyId": "qa-policy"}', current_date, 'QA') $$,
  'AI_FEATURE con creditPolicyId desde un add-on transversal');
select lives_ok($$ select platform.create_entitlement_grant('CATALOG_ITEM', 'licitaciones', 'esupplier.qa.users.max', '{"value": 10, "enforcement": "SOFT"}', current_date, 'QA') $$,
  'Un add-on del mismo producto concede un LIMIT');

select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.tenders', '{"enabled": false}', current_date, 'QA') $$,
  '23514', null, 'FEATURE con enabled=false no es un grant');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.tenders', '{"enabled": true, "value": 1}', current_date, 'QA') $$,
  '23514', null, 'FEATURE con claves extra se rechaza');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.users.max', '{"value": -1, "enforcement": "HARD"}', current_date, 'QA') $$,
  '23514', null, 'LIMIT negativo se rechaza');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.users.max', '{"value": 1.5, "enforcement": "HARD"}', current_date, 'QA') $$,
  '23514', null, 'LIMIT no entero se rechaza');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.users.max', '{"value": 30}', current_date, 'QA') $$,
  '23514', null, 'LIMIT sin enforcement se rechaza (no hay default inventado)');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.docs', '{"included": 10, "period": "YEAR"}', current_date, 'QA') $$,
  '23514', null, 'ALLOWANCE con periodo distinto de MONTH se rechaza');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.docs', '{"period": "MONTH"}', current_date, 'QA') $$,
  '23514', null, 'ALLOWANCE sin included se rechaza (valor no decidido = no se crea)');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.core', '{"enabled": true}', current_date, 'QA') $$,
  '23514', null, 'Una capacidad baseline no se otorga (va incluida)');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.old', '{"enabled": true}', current_date, 'QA') $$,
  '23514', null, 'Una capacidad DEPRECATED no recibe grants nuevos');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'ewm-enterprise', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '23514', null, 'Un plan no concede capacidades de otro producto');
select throws_ok($$ select platform.create_entitlement_grant('CATALOG_ITEM', 'compras_repuestos', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '23514', null, 'Un add-on de otro producto no concede capacidades de este');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'no-existe', 'esupplier.qa.tenders', '{"enabled": true}', current_date, 'QA') $$,
  '23503', null, 'Origen inexistente');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date + 3, 'QA') $$,
  '23514', null, 'GRANT_SOLAPADO: una capacidad tiene un solo grant vigente por origen');
select throws_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-enterprise', 'esupplier.qa.tenders', '{"enabled": true}', current_date, '  ') $$,
  '23502', null, 'El motivo es obligatorio');

-- ---------------------------------------------------------------------------
-- Inmutabilidad salvo valid_to; versionado por cierre
-- ---------------------------------------------------------------------------
select lives_ok($$ select platform.close_entitlement_grant(pg_temp.grant_id('esupplier-shared-standard', 'esupplier.qa.users.max'), current_date + 9, 'Cambio de tope QA') $$,
  'Cerrar la vigencia de un grant');
select lives_ok($$ select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.users.max', '{"value": 40, "enforcement": "HARD"}', current_date + 10, 'Nuevo tope QA') $$,
  'Un valor nuevo es un grant nuevo desde el día siguiente');
select throws_ok($$ select platform.close_entitlement_grant(
                      (select g.id from platform.entitlement_grants g join platform.product_capabilities c on c.id = g.capability_id
                        where c.code = 'esupplier.qa.users.max' and g.valid_to is not null), current_date + 20, 'QA') $$,
  '23514', null, 'Una vigencia cerrada no se alarga');
select throws_ok($$ select platform.close_entitlement_grant(pg_temp.grant_id('esupplier-shared-standard', 'esupplier.qa.tenders'), current_date - 1, 'QA') $$,
  '23514', null, 'valid_to anterior a valid_from se rechaza');

select pg_temp.act_as_postgres();
select throws_ok($$ update platform.entitlement_grants set grant_value = '{"enabled": true}' where id = pg_temp.grant_id('esupplier-shared-standard', 'esupplier.qa.docs') $$,
  '23514', null, 'GRANT_INMUTABLE: el contenido no se edita');
select throws_ok($$ delete from platform.entitlement_grants where id = pg_temp.grant_id('esupplier-shared-standard', 'esupplier.qa.docs') $$,
  '23514', null, 'GRANT_INMUTABLE: la historia no se borra');
select throws_ok($$ insert into platform.entitlement_grants (source_type, plan_id, capability_id, grant_value, valid_from)
                    select 'PLAN', '60000000-0000-4000-a000-000000000001', c.id, '{"enabled": true}', current_date + 1
                      from platform.product_capabilities c where c.code = 'esupplier.qa.tenders' $$,
  '23P01', null, 'Exclusión GiST: sin solapes aunque se escriba directo');

select is(
  (select string_agg(c.code || ':' || (g.valid_from - current_date) || ':' || coalesce((g.valid_to - current_date)::text, '∞'), ',' order by c.code, g.valid_from)
     from platform.entitlement_grants g join platform.product_capabilities c on c.id = g.capability_id
    where g.plan_id = '60000000-0000-4000-a000-000000000001'),
  'esupplier.qa.docs:0:∞,esupplier.qa.tenders:0:∞,esupplier.qa.users.max:0:9,esupplier.qa.users.max:10:∞',
  'Historia de grants del plan');

-- ---------------------------------------------------------------------------
-- Estado deseado: cada cambio marca dirty a los tenants afectados
-- ---------------------------------------------------------------------------
select ok(
  (select desired_dirty and desired_revision > 0 from platform.entitlement_desired_state
    where tenant_id = pg_temp.alpha() and saas_product_id = '20000000-0000-4000-a000-000000000001'),
  'Un grant del plan marca dirty al tenant con suscripción activa en ese plan');
select ok(
  (select desired_dirty from platform.entitlement_desired_state where tenant_id = pg_temp.omega()),
  'Un grant de add-on marca dirty a los tenants que tienen ese add-on (omega: licitaciones)');
select is(
  (select count(*)::int from platform.entitlement_desired_state where tenant_id = '50000000-0000-4000-a000-000000000005'),
  0, 'Un tenant sin ese plan ni ese add-on no se marca');
select ok(
  (select count(*) from platform.audit_logs where action in ('ENTITLEMENT_GRANT_CREATED', 'ENTITLEMENT_GRANT_CLOSED')) >= 7,
  'Crear y cerrar grants queda auditado');

-- ---------------------------------------------------------------------------
-- Overrides: finanzas o super admin, motivo, aprobador y vencimiento
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '30 days', 'Piloto QA') $$,
  '42501', null, 'EBIM_PRODUCT_ADMIN no crea overrides (spec §14.1: finanzas)');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '30 days', 'Piloto QA') $$,
  '42501', null, 'TENANT_ADMIN no se crea overrides');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '30 days', 'Piloto QA') $$,
  'EBIM_FINANCE crea un override de cortesía');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '40 days', 'Otro QA') $$,
  '23514', null, 'OVERRIDE_SOLAPADO: un override vigente por capacidad');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.docs', 'GRANT', '{"included": 5, "period": "MONTH"}', null, 'QA') $$,
  '23502', null, 'expires_at obligatorio');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.docs', 'GRANT', '{"included": 5, "period": "MONTH"}', now() - interval '1 day', 'QA') $$,
  '23514', null, 'Un override ya vencido se rechaza');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.docs', 'GRANT', '{"included": 5, "period": "MONTH"}', now() + interval '1 day', '') $$,
  '23502', null, 'reason obligatorio');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.users.max', 'DENY', '{"value": 1}', now() + interval '1 day', 'QA') $$,
  '23514', null, 'Un DENY no lleva contenido');
select throws_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.users.max', 'GRANT', '{"value": 5}', now() + interval '1 day', 'QA') $$,
  '23514', null, 'Un override GRANT respeta la forma del kind');
select throws_ok($$ select platform.create_entitlement_override('50000000-0000-4000-a000-000000000008', 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '1 day', 'QA') $$,
  '23514', null, 'Un override no cruza productos (tenant EWM, capacidad eSupplier)');
select lives_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.users.max', 'DENY', '{}', now() + interval '7 days', 'Bloqueo QA') $$,
  'Un DENY temporal');

select pg_temp.act_as_postgres();
select is(
  (select string_agg(o.override_type || ':' || (o.approved_by = '10000000-0000-4000-a000-000000000003') || ':' || o.reason, ',' order by o.override_type)
     from platform.tenant_entitlement_overrides o where o.tenant_id = pg_temp.alpha()),
  'DENY:true:Bloqueo QA,GRANT:true:Piloto QA',
  'El aprobador es quien ejecuta la RPC y el motivo queda guardado');
select throws_ok($$ update platform.tenant_entitlement_overrides set expires_at = now() + interval '1 year' where tenant_id = pg_temp.alpha() $$,
  '23514', null, 'OVERRIDE_INMUTABLE: solo se revoca');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.revoke_entitlement_override(
                     (select id from platform.tenant_entitlement_overrides where tenant_id = pg_temp.alpha() and override_type = 'GRANT'), 'Fin del piloto QA') $$,
  'EBIM_FINANCE revoca el override');
select lives_ok($$ select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'GRANT', '{"enabled": true}', now() + interval '10 days', 'Piloto QA 2') $$,
  'Tras revocar, un override nuevo no solapa');
select throws_ok($$ select platform.revoke_entitlement_override(
                     (select id from platform.tenant_entitlement_overrides where tenant_id = pg_temp.alpha() and revoked_at is not null), 'otra vez') $$,
  '23514', null, 'Un override revocado no se revoca dos veces');

select pg_temp.act_as_postgres();
select ok(
  (select count(*) from platform.audit_logs where action in ('ENTITLEMENT_OVERRIDE_CREATED', 'ENTITLEMENT_OVERRIDE_REVOKED')
      and tenant_id = pg_temp.alpha()) = 4,
  'Overrides y revocaciones auditados con el tenant');

-- ---------------------------------------------------------------------------
-- Aislamiento de lectura
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is((select count(*)::int from platform.tenant_entitlement_overrides), 3,
  'TENANT_ADMIN de alpha ve los overrides de su tenant');
select is((select count(*)::int from platform.entitlement_desired_state where tenant_id <> pg_temp.alpha()), 0,
  'TENANT_ADMIN de alpha no ve el estado deseado de otros tenants');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.tenant_entitlement_overrides), 0,
  'TENANT_ADMIN de omega no ve overrides de alpha');
select ok((select count(*) from platform.entitlement_grants) > 0,
  'Los grants de plan/add-on son catálogo: authenticated los lee');

select * from finish();
rollback;
