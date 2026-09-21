-- ============================================================================
-- V4 · Adaptadores de contrato (spec 2026-09-21, migración 20260921000100)
-- ----------------------------------------------------------------------------
-- La pregunta de este archivo: ¿la migración deja EXACTAMENTE igual todo lo
-- genérico y restringe lo nuevo?
--   · toda fila previa queda en GENERIC y con product_configuration = '{}';
--   · `adapter_key` no admite valores libres ni combinaciones incoherentes;
--   · `upsert_product_integration` sin `p_adapter_key` preserva lo guardado;
--   · `product_configuration` no se escribe desde el navegador y su forma está
--     acotada por CHECK.
-- ============================================================================
begin;
select plan(24);

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

create or replace function pg_temp.super_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.tech_lead()   returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.ewm_owner()   returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000e'::uuid $$;
create or replace function pg_temp.esup_owner()  returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000f'::uuid $$;
create or replace function pg_temp.p_ewm()  returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.i_ewm_qas()    returns uuid language sql as $$ select '70000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.i_esup_manual() returns uuid language sql as $$ select '70000000-0000-4000-a000-000000000003'::uuid $$;

-- Reinvoca `upsert_product_integration` con los valores ACTUALES de la fila,
-- cambiando sólo lo que se pase. `p_adapter_key` se omite si es null, para
-- ejercer exactamente la llamada de un cliente anterior a la migración.
create or replace function pg_temp.reupsert(p_id uuid, p_adapter text default null)
returns uuid language plpgsql as $$
declare
  i platform.product_integrations;
begin
  select * into i from platform.product_integrations where id = p_id;
  if p_adapter is null then
    return platform.upsert_product_integration(
      p_saas_product_id => i.saas_product_id, p_code => i.code, p_name => i.name,
      p_integration_type => i.integration_type, p_contract_version => i.contract_version,
      p_owner_user_id => i.owner_user_id, p_owner_name => i.owner_name,
      p_issuer => i.issuer, p_audience => i.audience, p_subject => i.subject,
      p_algorithm => i.algorithm, p_token_ttl_seconds => i.token_ttl_seconds,
      p_create_scope => i.create_scope, p_read_scope => i.read_scope,
      p_additional_scopes => i.additional_scopes,
      p_create_path_template => i.create_path_template,
      p_status_path_template => i.status_path_template,
      p_health_path_template => i.health_path_template,
      p_allowed_hosts => i.allowed_hosts, p_provisioning_policy => i.provisioning_policy,
      p_enabled => i.enabled, p_status => i.status, p_metadata => i.metadata, p_id => i.id);
  end if;
  return platform.upsert_product_integration(
    p_saas_product_id => i.saas_product_id, p_code => i.code, p_name => i.name,
    p_integration_type => i.integration_type, p_contract_version => i.contract_version,
    p_owner_user_id => i.owner_user_id, p_owner_name => i.owner_name,
    p_issuer => i.issuer, p_audience => i.audience, p_subject => i.subject,
    p_algorithm => i.algorithm, p_token_ttl_seconds => i.token_ttl_seconds,
    p_create_scope => i.create_scope, p_read_scope => i.read_scope,
    p_additional_scopes => i.additional_scopes,
    p_create_path_template => i.create_path_template,
    p_status_path_template => i.status_path_template,
    p_health_path_template => i.health_path_template,
    p_allowed_hosts => i.allowed_hosts, p_provisioning_policy => i.provisioning_policy,
    p_enabled => i.enabled, p_status => i.status, p_metadata => i.metadata, p_id => i.id,
    p_adapter_key => p_adapter::platform.integration_adapter);
end;
$$;

-- ===========================================================================
-- 1. Catálogo cerrado de adaptadores
-- ===========================================================================
select has_type('platform', 'integration_adapter', 'existe el enum integration_adapter');
select enum_has_labels('platform', 'integration_adapter', array['GENERIC', 'EWM_V1'],
  'el enum tiene exactamente GENERIC y EWM_V1');

-- ===========================================================================
-- 2. product_integrations.adapter_key
-- ===========================================================================
select has_column('platform', 'product_integrations', 'adapter_key', 'existe adapter_key');
select col_not_null('platform', 'product_integrations', 'adapter_key', 'adapter_key es NOT NULL');
select col_default_is('platform', 'product_integrations', 'adapter_key',
  'GENERIC'::platform.integration_adapter, 'adapter_key tiene default GENERIC');

-- R4
select is((select count(*) from platform.product_integrations where adapter_key <> 'GENERIC'),
  0::bigint, 'toda fila previa queda en GENERIC');

select throws_ok(
  $$ update platform.product_integrations set adapter_key = 'EWM_V1'
      where id = '70000000-0000-4000-a000-000000000003' $$,
  '23514', null, 'EWM_V1 sobre una integración MANUAL viola product_integrations_adapter_ck');

select throws_ok(
  $$ select 'OTRO'::platform.integration_adapter $$,
  '22P02', null, 'un adaptador arbitrario es imposible');

-- ===========================================================================
-- 3. upsert_product_integration preserva adapter_key (R4) y lo audita
-- ===========================================================================
select pg_temp.act_as(pg_temp.tech_lead());

select lives_ok($$ select pg_temp.reupsert(pg_temp.i_ewm_qas(), 'EWM_V1') $$,
  'tech lead fija EWM_V1 con p_adapter_key');
select is((select adapter_key::text from platform.product_integrations where id = pg_temp.i_ewm_qas()),
  'EWM_V1', 'la integración queda en EWM_V1');

select lives_ok($$ select pg_temp.reupsert(pg_temp.i_ewm_qas()) $$,
  'upsert sin p_adapter_key sobre una integración EWM_V1');
select is((select adapter_key::text from platform.product_integrations where id = pg_temp.i_ewm_qas()),
  'EWM_V1', 'upsert sin p_adapter_key preserva EWM_V1');

select lives_ok($$ select pg_temp.reupsert(pg_temp.i_esup_manual()) $$,
  'upsert sin p_adapter_key sobre una integración GENERIC');
select is((select adapter_key::text from platform.product_integrations where id = pg_temp.i_esup_manual()),
  'GENERIC', 'upsert sin p_adapter_key preserva GENERIC');

select lives_ok($$ select pg_temp.reupsert(pg_temp.i_ewm_qas(), 'GENERIC') $$,
  'p_adapter_key GENERIC explícito funciona');

select pg_temp.act_as_postgres();
select ok(exists(
  select 1 from platform.audit_logs
   where action = 'INTEGRATION_UPDATED'
     and entity_id = pg_temp.i_ewm_qas()::text
     and metadata -> 'before' ->> 'adapter_key' = 'GENERIC'
     and metadata -> 'after'  ->> 'adapter_key' = 'EWM_V1'
     and metadata -> 'changed_fields' ? 'adapter_key'),
  'el cambio de adaptador queda en audit_logs con antes/después');

-- ===========================================================================
-- 4. saas_provisioning_requests.product_configuration
-- ===========================================================================
select has_column('platform', 'saas_provisioning_requests', 'product_configuration',
  'existe product_configuration');
select col_not_null('platform', 'saas_provisioning_requests', 'product_configuration',
  'product_configuration es NOT NULL');
select is((select count(*) from platform.saas_provisioning_requests
            where product_configuration <> '{}'::jsonb),
  0::bigint, 'toda solicitud previa tiene product_configuration = {}');

-- Solicitud propia del test (el seed no trae ninguna): alpha-ewm en DEV.
do $$
begin
  perform pg_temp.act_as('10000000-0000-4000-a000-000000000002'::uuid);
  perform set_config('tests.req_alpha_ewm',
    platform.create_saas_provisioning_request('50000000-0000-4000-a000-000000000008'::uuid, 'DEV')::text,
    false);
  perform pg_temp.act_as_postgres();
end;
$$;

create or replace function pg_temp.req_alpha_ewm() returns uuid language sql as $$
  select current_setting('tests.req_alpha_ewm')::uuid $$;

-- R3 — forma acotada por CHECK
select throws_ok(
  $$ update platform.saas_provisioning_requests set product_configuration = '[]'::jsonb
      where id = pg_temp.req_alpha_ewm() $$,
  '23514', null, 'rechaza no-objeto');
select throws_ok(
  $$ update platform.saas_provisioning_requests set product_configuration = '{"a":{"b":[1]}}'::jsonb
      where id = pg_temp.req_alpha_ewm() $$,
  '23514', null, 'rechaza arrays');
select throws_ok(
  $$ update platform.saas_provisioning_requests set product_configuration = '{"a":{"b":{"c":1}}}'::jsonb
      where id = pg_temp.req_alpha_ewm() $$,
  '23514', null, 'rechaza profundidad > 2');
select throws_ok(
  $$ update platform.saas_provisioning_requests
        set product_configuration = jsonb_build_object('x', repeat('a', 4100))
      where id = pg_temp.req_alpha_ewm() $$,
  '23514', null, 'rechaza > 4096 bytes');

-- RLS: no hay escritura directa desde el navegador.
select pg_temp.act_as(pg_temp.tech_lead());
select throws_ok(
  $$ update platform.saas_provisioning_requests set product_configuration = '{"a":1}'::jsonb
      where id = pg_temp.req_alpha_ewm() $$,
  '42501', null, 'authenticated no escribe product_configuration directamente');
select pg_temp.act_as_postgres();

select * from finish();
rollback;
