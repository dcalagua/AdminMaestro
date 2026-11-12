-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · registro de capacidades
-- (Tasks MA-10 enum USAGE_OVERAGE, MA-11 product_capabilities / aliases)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (charge_kind + USAGE_OVERAGE), §4 (registro), §14 (autoridad).
-- Todo se revierte al final (rollback).
-- ============================================================================
begin;
select plan(35);

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

-- Manifiesto QA (códigos ficticios con segmento `qa`; todo se revierte).
create or replace function pg_temp.manifest(p_caps jsonb, p_product text default 'esupplier')
returns jsonb language sql as $$
  select jsonb_build_object('schema', 'ebim.capabilities/v1', 'productCode', p_product,
                            'manifestVersion', 'qa-1', 'capabilities', p_caps)
$$;

create or replace function pg_temp.base_caps()
returns jsonb language sql as $$
  select '[
    {"code": "esupplier.qa.core", "name": "QA núcleo", "kind": "FEATURE", "isBaseline": true,
     "scopeLevel": "TENANT", "status": "ACTIVE"},
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE",
     "scopeLevel": "COMPANY", "status": "ACTIVE",
     "aliases": [{"source": "LOCAL_ADDON", "code": "qa_tenders"}]},
    {"code": "esupplier.qa.users.max", "name": "QA usuarios", "kind": "LIMIT", "unit": "user",
     "combineRule": "MAX", "scopeLevel": "TENANT", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE",
     "scopeLevel": "TENANT", "status": "DRAFT", "meterCode": "ai.credits",
     "aliases": [{"source": "GMAO_HUB", "code": "qa_copilot"}]}
  ]'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- MA-10 · cargo por exceso de uso (spec §13.1): valor de enum aditivo.
-- ---------------------------------------------------------------------------
select ok(
  'USAGE_OVERAGE' = any(enum_range(null::platform.charge_kind)::text[]),
  'platform.charge_kind admite USAGE_OVERAGE');

-- ---------------------------------------------------------------------------
-- MA-11 · estructura y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'product_capabilities', 'Existe platform.product_capabilities');
select has_table('platform', 'capability_aliases', 'Existe platform.capability_aliases');

select is(
  (select string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' order by c.relname)
     from pg_class c
    where c.relnamespace = 'platform'::regnamespace and c.relname in ('product_capabilities', 'capability_aliases')),
  'capability_aliases:true:true,product_capabilities:true:true',
  'RLS habilitada y forzada en el registro');

select is(
  (select string_agg(t || ':' || has_table_privilege('anon', 'platform.' || t, 'select') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'select') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'insert') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'update') || ':'
            || has_table_privilege('authenticated', 'platform.' || t, 'delete'), ',' order by t)
     from unnest(array['capability_aliases', 'product_capabilities']) t),
  'capability_aliases:false:true:false:false:false,product_capabilities:false:true:false:false:false',
  'anon sin acceso; authenticated solo SELECT (escritura solo por RPC)');

select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('public', p.oid, 'execute') || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || has_function_privilege('authenticated', p.oid, 'execute') || ':'
            || coalesce(array_to_string(p.proconfig, ';') like '%search_path%', false),
            ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('import_capability_manifest', 'upsert_capability_alias')),
  'import_capability_manifest:true:false:false:true:true,upsert_capability_alias:true:false:false:true:true',
  'RPCs del registro: DEFINER, search_path fijo, sin EXECUTE para PUBLIC ni anon');

-- ---------------------------------------------------------------------------
-- MA-11 · autoridad (spec §14.1: EBIM_PRODUCT_ADMIN o super admin)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps())) $$,
  '42501', null, 'anon no importa manifiestos');

select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps())) $$,
  '42501', null, 'authenticated sin rol no importa manifiestos');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps())) $$,
  '42501', null, 'TENANT_ADMIN no importa manifiestos');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select throws_ok($$ select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps())) $$,
  '42501', null, 'EBIM_FINANCE no registra capacidades (no es autoridad de producto)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ insert into platform.product_capabilities (saas_product_id, code, name, kind)
                    values ('20000000-0000-4000-a000-000000000001', 'esupplier.qa.direct', 'x', 'FEATURE') $$,
  '42501', null, 'Ni el product admin escribe el registro directamente');

-- ---------------------------------------------------------------------------
-- MA-11 · importación idempotente
-- ---------------------------------------------------------------------------
select is(
  (select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps()))
          - 'import_id'),
  '{"product": "esupplier", "inserted": 4, "updated": 0, "unchanged": 0, "aliases": 2, "missing": []}'::jsonb,
  'EBIM_PRODUCT_ADMIN importa el manifiesto: 4 capacidades y 2 alias');

select is(
  (select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps()))
          - 'import_id'),
  '{"product": "esupplier", "inserted": 0, "updated": 0, "unchanged": 4, "aliases": 0, "missing": []}'::jsonb,
  'Reimportar el mismo manifiesto no cambia nada (idempotente)');

select is(
  (select platform.import_capability_manifest('esupplier',
            pg_temp.manifest(jsonb_set(pg_temp.base_caps(), '{3,status}', '"ACTIVE"'))) - 'import_id'),
  '{"product": "esupplier", "inserted": 0, "updated": 1, "unchanged": 3, "aliases": 0, "missing": []}'::jsonb,
  'Un cambio de estado DRAFT→ACTIVE se registra como actualización');

select is(
  (select platform.import_capability_manifest('esupplier',
            pg_temp.manifest(pg_temp.base_caps() - 3)) -> 'missing'),
  '["esupplier.qa.ai.copilot"]'::jsonb,
  'Una capacidad ausente del manifiesto se informa como drift de registro');

select pg_temp.act_as_postgres();
select is(
  (select string_agg(code || ':' || kind || ':' || is_baseline || ':' || status || ':'
            || coalesce(combine_rule, '-') || ':' || scope_level, ',' order by code)
     from platform.product_capabilities where code like 'esupplier.qa.%'),
  'esupplier.qa.ai.copilot:AI_FEATURE:false:ACTIVE:-:TENANT,esupplier.qa.core:FEATURE:true:ACTIVE:-:TENANT,'
  || 'esupplier.qa.tenders:FEATURE:false:ACTIVE:-:COMPANY,esupplier.qa.users.max:LIMIT:false:ACTIVE:MAX:TENANT',
  'El registro conserva la capacidad ausente (no se borra) y guarda la forma declarada');

select is(
  (select string_agg(a.alias_source || '/' || a.alias_code || '->' || c.code, ',' order by a.alias_code)
     from platform.capability_aliases a join platform.product_capabilities c on c.id = a.capability_id
    where c.code like 'esupplier.qa.%'),
  'GMAO_HUB/qa_copilot->esupplier.qa.ai.copilot,LOCAL_ADDON/qa_tenders->esupplier.qa.tenders',
  'Los alias legacy traducen a códigos canónicos');

select ok(
  (select count(*) from platform.audit_logs
    where action = 'CAPABILITY_MANIFEST_IMPORTED' and entity_id = 'esupplier') >= 4,
  'Cada importación queda en audit_logs');

-- ---------------------------------------------------------------------------
-- MA-11 · validación
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "tms.qa.route", "name": "x", "kind": "FEATURE"}]'::jsonb)) $$,
  '23514', null, 'Un código de otro producto se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier", "name": "x", "kind": "FEATURE"}]'::jsonb)) $$,
  '23514', null, 'Un código sin segmento tras el producto se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.QA.Upper", "name": "x", "kind": "FEATURE"}]'::jsonb)) $$,
  '23514', null, 'Un código con mayúsculas se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.qa.bad", "name": "x", "kind": "PRICE"}]'::jsonb)) $$,
  '23514', null, 'Un kind desconocido se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.qa.lim", "name": "x", "kind": "LIMIT"}]'::jsonb)) $$,
  '23514', null, 'Un LIMIT sin combineRule se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.qa.flag", "name": "x", "kind": "FEATURE", "combineRule": "SUM"}]'::jsonb)) $$,
  '23514', null, 'Un FEATURE con combineRule se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.qa.alw", "name": "x", "kind": "ALLOWANCE", "combineRule": "SUM"}]'::jsonb)) $$,
  '23514', null, 'Un ALLOWANCE sin meterCode se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest(jsonb_set(pg_temp.base_caps(), '{1,kind}', '"AI_FEATURE"'))) $$,
  '23514', null, 'El kind de una capacidad registrada es inmutable');
select throws_ok($$ select platform.import_capability_manifest('esupplier', pg_temp.manifest(pg_temp.base_caps(), 'ewm')) $$,
  '23514', null, 'productCode del manifiesto distinto del producto destino se rechaza');
select throws_ok($$ select platform.import_capability_manifest('no-existe', pg_temp.manifest(pg_temp.base_caps(), 'no-existe')) $$,
  '23503', null, 'Producto inexistente se rechaza');
select throws_ok($$ select platform.import_capability_manifest('esupplier',
                    pg_temp.manifest('[{"code": "esupplier.qa.x", "name": "x", "kind": "FEATURE", "limitValue": 10}]'::jsonb)) $$,
  '23514', null, 'Una clave desconocida (p. ej. un valor de límite) se rechaza: el manifiesto no trae valores');

-- ---------------------------------------------------------------------------
-- MA-11 · alias
-- ---------------------------------------------------------------------------
select lives_ok($$ select platform.upsert_capability_alias('esupplier', 'LOCAL_FEATURE', 'qa-core', 'esupplier.qa.core') $$,
  'EBIM_PRODUCT_ADMIN registra un alias');
select throws_ok($$ select platform.upsert_capability_alias('esupplier', 'LOCAL_ADDON', 'qa_tenders', 'esupplier.qa.core') $$,
  '23505', null, 'Un alias ya asignado a otra capacidad no se reasigna en silencio');
select throws_ok($$ select platform.upsert_capability_alias('esupplier', 'SOMEWHERE', 'qa_x', 'esupplier.qa.core') $$,
  '23514', null, 'Un origen de alias desconocido se rechaza');
select throws_ok($$ select platform.upsert_capability_alias('ewm', 'LOCAL_ADDON', 'qa_y', 'esupplier.qa.core') $$,
  '23503', null, 'Un alias no apunta a una capacidad de otro producto');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.upsert_capability_alias('esupplier', 'LOCAL_FEATURE', 'qa-z', 'esupplier.qa.core') $$,
  '42501', null, 'TENANT_ADMIN no registra alias');
select ok((select count(*) from platform.product_capabilities where code like 'esupplier.qa.%') = 4,
  'authenticated lee el registro (catálogo técnico, sin datos comerciales)');

select * from finish();
rollback;
