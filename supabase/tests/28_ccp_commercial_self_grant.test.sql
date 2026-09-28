-- ============================================================================
-- EBIM Commercial Control Plane · Fase 03 · sin autootorgamiento comercial
-- (Task MA-03, P0-MA-1)
-- ----------------------------------------------------------------------------
-- Hallazgo: `authenticated` tenía INSERT/UPDATE/DELETE en tenant_addons y
-- tenant_features con políticas can_manage_tenant(): un TENANT_ADMIN, un
-- ORG_ADMIN del cliente o el PARTNER_ADMIN que gestiona el tenant podían
-- encenderse add-ons y features (autootorgamiento comercial). set_tenant_feature
-- usaba el mismo gate.
--
-- Regla: otorgar/revocar es COMERCIAL (comercial ≠ acceso operativo) y solo
-- ocurre por RPC auditada con gate can_manage_commercial() (EBIM_FINANCE,
-- EBIM_PRODUCT_ADMIN, super admin). Ningún rol `authenticated` escribe las
-- tablas directamente. La lectura sigue gobernada por can_read_tenant().
-- Todo se revierte al final (rollback).
-- ============================================================================
begin;
select plan(46);

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

-- Intenta las 6 escrituras directas y devuelve el SQLSTATE (u 'ok') de cada una.
create or replace function pg_temp.direct_writes(p_tenant uuid)
returns text language plpgsql as $$
declare
  v_out text[] := '{}';
  v_sql text;
begin
  foreach v_sql in array array[
    format($q$insert into platform.tenant_addons (tenant_id, addon_code) values (%L, 'consolidation')$q$, p_tenant),
    format($q$update platform.tenant_addons set active = not active where tenant_id = %L$q$, p_tenant),
    format($q$delete from platform.tenant_addons where tenant_id = %L$q$, p_tenant),
    format($q$insert into platform.tenant_features (tenant_id, feature_key, enabled) values (%L, 'qa_self_grant', true)$q$, p_tenant),
    format($q$update platform.tenant_features set enabled = true where tenant_id = %L$q$, p_tenant),
    format($q$delete from platform.tenant_features where tenant_id = %L$q$, p_tenant)
  ] loop
    begin
      execute v_sql;
      v_out := v_out || 'ok'::text;
    exception when others then
      v_out := v_out || sqlstate::text;
    end;
  end loop;
  return array_to_string(v_out, ',');
end;
$$;

create or replace function pg_temp.alpha()     returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.cliente_p1() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000002'::uuid $$;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'platform' and tablename in ('tenant_addons', 'tenant_features')
      and cmd <> 'SELECT'),
  0, 'No queda ninguna política de escritura en tenant_addons / tenant_features');

select ok(
  not has_table_privilege('authenticated', 'platform.tenant_addons', 'insert')
  and not has_table_privilege('authenticated', 'platform.tenant_addons', 'update')
  and not has_table_privilege('authenticated', 'platform.tenant_addons', 'delete')
  and not has_table_privilege('authenticated', 'platform.tenant_features', 'insert')
  and not has_table_privilege('authenticated', 'platform.tenant_features', 'update')
  and not has_table_privilege('authenticated', 'platform.tenant_features', 'delete'),
  'authenticated no tiene INSERT/UPDATE/DELETE en tenant_addons / tenant_features');

select ok(
  has_table_privilege('authenticated', 'platform.tenant_addons', 'select')
  and has_table_privilege('authenticated', 'platform.tenant_features', 'select'),
  'authenticated conserva SELECT (filtrado por RLS)');

select has_function('platform', 'set_tenant_addon_active', array['uuid', 'text', 'boolean', 'text'],
  'Existe platform.set_tenant_addon_active(tenant, addon_code, active, reason)');

select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('public', p.oid, 'execute') || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || has_function_privilege('authenticated', p.oid, 'execute') || ':'
            || coalesce(array_to_string(p.proconfig, ';') like '%search_path=platform, pg_catalog%', false),
            ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('set_tenant_addon_active', 'set_tenant_feature')),
  'set_tenant_addon_active:true:false:false:true:true,set_tenant_feature:true:false:false:true:true',
  'RPCs DEFINER con search_path fijo, sin EXECUTE para PUBLIC ni anon');

-- ---------------------------------------------------------------------------
-- Escritura directa: denegada a TODOS los roles de la API
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'anon: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'authenticated sin rol: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'TENANT_ADMIN de su propio tenant: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-00000000000c');
select is(pg_temp.direct_writes(pg_temp.cliente_p1()), '42501,42501,42501,42501,42501,42501', 'ORG_ADMIN del cliente: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');
select is(pg_temp.direct_writes(pg_temp.cliente_p1()), '42501,42501,42501,42501,42501,42501', 'PARTNER_ADMIN que gestiona el tenant: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'Comercial con el tenant atribuido: escritura directa denegada');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'EBIM_FINANCE: escritura directa denegada (solo por RPC)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'EBIM_PRODUCT_ADMIN: escritura directa denegada (solo por RPC)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');
select is(pg_temp.direct_writes(pg_temp.alpha()), '42501,42501,42501,42501,42501,42501', 'Super admin: escritura directa denegada (solo por RPC)');

-- ---------------------------------------------------------------------------
-- Lectura: sin cambios (can_read_tenant)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is((select count(*)::int from platform.tenant_features where tenant_id = pg_temp.alpha()), 3,
  'TENANT_ADMIN sigue leyendo los features de su tenant');
select is((select count(*)::int from platform.tenant_addons where tenant_id = pg_temp.alpha()), 1,
  'TENANT_ADMIN sigue leyendo los add-ons de su tenant');
select is((select count(*)::int from platform.tenant_addons where tenant_id <> pg_temp.alpha()), 0,
  'TENANT_ADMIN no lee add-ons de otros tenants');

select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is((select count(*)::int from platform.tenant_features), 0, 'authenticated sin rol no lee features');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select ok((select count(*) from platform.tenant_addons) >= 6, 'EBIM_FINANCE lee todos los add-ons');

-- ---------------------------------------------------------------------------
-- set_tenant_feature: solo plataforma comercial, auditado
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000001', 'ocr', true) $$,
  '42501', null, 'anon no ejecuta set_tenant_feature');

select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000001', 'ocr', true) $$,
  '42501', null, 'authenticated sin rol no se otorga features');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000001', 'ocr', true) $$,
  '42501', null, 'TENANT_ADMIN no se otorga features a sí mismo');

select pg_temp.act_as('10000000-0000-4000-a000-00000000000c');
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000002', 'ocr', true) $$,
  '42501', null, 'ORG_ADMIN del cliente no se otorga features');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000002', 'ocr', true) $$,
  '42501', null, 'PARTNER_ADMIN no otorga features a los tenants que gestiona');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000001', 'ocr', true) $$,
  '42501', null, 'El comercial no otorga features (comercial ≠ acceso operativo)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.set_tenant_feature('50000000-0000-4000-a000-000000000001', 'ocr', true) $$,
  'EBIM_FINANCE otorga un feature por la RPC');

select pg_temp.act_as_postgres();
select is(
  (select enabled::text || ' ' || source from platform.tenant_features
    where tenant_id = pg_temp.alpha() and feature_key = 'ocr'),
  'true MANUAL', 'El feature queda encendido');
select is(
  (select count(*)::int from platform.audit_logs
    where action = 'TENANT_FEATURE_SET' and entity_id = pg_temp.alpha()::text || ':ocr'
      and actor_user_id = '10000000-0000-4000-a000-000000000003'),
  1, 'set_tenant_feature deja audit_logs con el actor');

-- ---------------------------------------------------------------------------
-- set_tenant_addon_active: única vía de otorgar/revocar un add-on
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, 'QA') $$,
  '42501', null, 'anon no ejecuta set_tenant_addon_active');

select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, 'QA') $$,
  '42501', null, 'authenticated sin rol no se otorga add-ons');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, 'QA') $$,
  '42501', null, 'TENANT_ADMIN no se otorga add-ons');

select pg_temp.act_as('10000000-0000-4000-a000-00000000000c');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000002', 'consolidation', true, 'QA') $$,
  '42501', null, 'ORG_ADMIN del cliente no se otorga add-ons');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000002', 'consolidation', true, 'QA') $$,
  '42501', null, 'PARTNER_ADMIN no otorga add-ons a los tenants que gestiona');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, 'QA') $$,
  '42501', null, 'El comercial no otorga add-ons');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, 'Alta comercial QA') $$,
  'EBIM_PRODUCT_ADMIN otorga un add-on disponible');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'licitaciones', false, 'Baja comercial QA') $$,
  'EBIM_FINANCE revoca un add-on');

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');
select lives_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'licitaciones', true, 'Reactivación QA') $$,
  'Super admin reactiva un add-on');

select pg_temp.act_as_postgres();
select is(
  (select string_agg(addon_code || '=' || active, ',' order by addon_code) from platform.tenant_addons
    where tenant_id = pg_temp.alpha()),
  'consolidation=true,licitaciones=true', 'Estado resultante de los add-ons del tenant');
select is(
  (select string_agg(metadata ->> 'addon_code' || ':' || coalesce(metadata ->> 'previous_active', '') || '>' || (metadata ->> 'active')
                     || ':' || (metadata ->> 'reason'), ',' order by id)
     from platform.audit_logs
    where action = 'TENANT_ADDON_SET' and tenant_id = pg_temp.alpha()),
  'consolidation:>true:Alta comercial QA,licitaciones:true>false:Baja comercial QA,licitaciones:false>true:Reactivación QA',
  'Cada cambio de add-on queda en audit_logs con estado previo, nuevo y motivo');
select is(
  (select count(*)::int from platform.audit_logs where action = 'TENANT_ADDON_SET' and actor_user_id is null),
  0, 'Todo cambio de add-on tiene actor');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'echange_desk', true, 'QA') $$,
  '23514', null, 'Un item de catálogo no disponible no se otorga');
select lives_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', false, 'QA') $$,
  'Revocar siempre es posible');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'consolidation', true, '  ') $$,
  '23502', null, 'El motivo es obligatorio');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-000000000001', 'no_existe', true, 'QA') $$,
  '23503', null, 'Un add-on inexistente se rechaza');
select throws_ok($$ select platform.set_tenant_addon_active('50000000-0000-4000-a000-0000000000fe', 'consolidation', true, 'QA') $$,
  '23503', null, 'Un tenant inexistente se rechaza');

select pg_temp.act_as_postgres();
select is(
  (select active::text from platform.tenant_addons where tenant_id = pg_temp.alpha() and addon_code = 'echange_desk'),
  null, 'El intento rechazado no dejó fila');

select * from finish();
rollback;
