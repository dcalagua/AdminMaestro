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
select plan(78);

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

-- ===========================================================================
-- 5. provisioning_execution_context: `payload` intacto; `source` y `adapter`
-- ===========================================================================
-- Expresión de `payload` PREVIA a esta migración, copiada literalmente de
-- 20260915000500_v4_orchestrator_rpcs.sql (líneas 183–204) con los mismos
-- SELECT INTO. Si el contexto nuevo difiere para alguna solicitud, `payload`
-- cambió: H2.
create or replace function pg_temp.legacy_payload(p_request_id uuid)
returns jsonb language plpgsql as $LEGACY$
declare
  v_req    record;
  v_tenant record;
  v_prod   record;
  v_target record;
  v_int    record;
  v_org    record;
  v_comp   record;
  v_plan   record;
begin
  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  select * into v_tenant from platform.tenants where id = v_req.tenant_id;
  select * into v_prod from platform.saas_products where id = v_req.saas_product_id;
  select * into v_org from platform.organizations where id = v_tenant.customer_organization_id;
  select * into v_comp from platform.companies where id = v_tenant.company_id;
  select * into v_target from platform.deployment_targets
   where id = v_req.deployment_target_id;
  select * into v_int from platform.product_integrations
   where id = coalesce(v_target.product_integration_id, v_req.product_integration_id);
  select p.code, p.name into v_plan
    from platform.subscriptions s join platform.plans p on p.id = s.plan_id
   where s.id = v_req.subscription_id;
  return
    jsonb_build_object(
      'tenantCode', v_tenant.slug,
      'tenantName', v_tenant.name,
      'adminEmail', v_tenant.admin_email,
      'tenantType', v_tenant.tenant_type::text,
      'environment', v_req.provisioning_environment::text,
      'deploymentMode', v_tenant.deployment_mode::text,
      'organization', jsonb_build_object(
        'code', v_org.slug, 'legalName', v_org.legal_name,
        'displayName', v_org.display_name, 'countryCode', v_org.country_code,
        'taxId', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
        'code', v_comp.erp_code, 'name', v_comp.name,
        'countryCode', v_comp.country_code, 'currency', v_comp.currency,
        'taxId', v_comp.tax_id) end,
      'plan', case when v_plan.code is null then null else jsonb_build_object(
        'code', v_plan.code, 'name', v_plan.name) end,
      'masterAdmin', jsonb_build_object(
        'tenantId', v_tenant.id, 'productCode', v_prod.code,
        'requestId', v_req.id, 'correlationId', v_req.correlation_id,
        'contractVersion', coalesce(v_int.contract_version, 'v1'))
    );
end;
$LEGACY$;

-- El contexto lo exige el claim de servicio (no el rol de la sesión).
create or replace function pg_temp.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$$;

-- Segunda solicitud, de EWM en QAS sobre `ewm-shared-qas` (integración HTTP_M2M).
do $$
begin
  perform pg_temp.act_as('10000000-0000-4000-a000-000000000002'::uuid);
  perform set_config('tests.req_p1_qas',
    platform.create_saas_provisioning_request('50000000-0000-4000-a000-000000000009'::uuid, 'QAS')::text,
    false);
  perform pg_temp.act_as_postgres();
end;
$$;
create or replace function pg_temp.req_p1_qas() returns uuid language sql as $$
  select current_setting('tests.req_p1_qas')::uuid $$;

select pg_temp.act_as_service();

select ok((select count(*) from platform.saas_provisioning_requests) >= 2,
  'hay solicitudes sobre las que comparar el payload');
select is(
  (select count(*) from platform.saas_provisioning_requests r
    where platform.provisioning_execution_context(r.id) -> 'payload'
          is distinct from pg_temp.legacy_payload(r.id)),
  0::bigint, 'payload del contexto idéntico a la expresión previa, para toda solicitud');

select ok(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) ? 'source',
  'el contexto trae la clave source');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'source' -> 'tenant' ->> 'id',
  '50000000-0000-4000-a000-000000000008', 'source.tenant.id = tenant de la solicitud');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'source' -> 'organization' ->> 'id',
  (select customer_organization_id::text from platform.tenants where id = '50000000-0000-4000-a000-000000000008'),
  'source.organization.id = tenants.customer_organization_id');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'source' -> 'company' ->> 'id',
  (select company_id::text from platform.tenants where id = '50000000-0000-4000-a000-000000000008'),
  'source.company.id = tenants.company_id');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'source' -> 'product_configuration',
  '{}'::jsonb, 'source.product_configuration = product_configuration de la solicitud');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'source' -> 'mapping',
  'null'::jsonb, 'sin mapping, source.mapping es null');

select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'adapter' ->> 'key',
  'GENERIC', 'integración MOCK → adapter.key GENERIC');
select is(platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) -> 'adapter' -> 'capabilities',
  '["PROVISION"]'::jsonb, 'GENERIC → capabilities [PROVISION]');

select pg_temp.act_as_postgres();
update platform.product_integrations set adapter_key = 'EWM_V1',
       status_path_template = '/internal/platform/v1/tenants/{controlPlaneTenantId}'
 where id = pg_temp.i_ewm_qas();
select pg_temp.act_as_service();

select is(platform.provisioning_execution_context(pg_temp.req_p1_qas()) -> 'adapter' ->> 'key',
  'EWM_V1', 'la integración efectiva EWM_V1 llega al contexto');
select is(platform.provisioning_execution_context(pg_temp.req_p1_qas()) -> 'adapter' -> 'capabilities',
  to_jsonb(platform.integration_capabilities('EWM_V1',
    '/internal/platform/v1/tenants/{controlPlaneTenantId}', 'provisioning:tenant:read')),
  'adapter.capabilities = integration_capabilities(...)');
select is(
  (select count(*) from platform.saas_provisioning_requests r
    where platform.provisioning_execution_context(r.id) -> 'payload'
          is distinct from pg_temp.legacy_payload(r.id)),
  0::bigint, 'payload sigue idéntico con una integración EWM_V1');

select pg_temp.act_as_postgres();

select is(platform.integration_capabilities('GENERIC', '/x/{externalTenantId}', 'r'),
  '{PROVISION}'::text[], 'GENERIC → {PROVISION}');
select is(platform.integration_capabilities('EWM_V1', null, 'r'),
  '{PROVISION,REPLAY_CERTIFICATION}'::text[], 'EWM_V1 sin ruta de estado → sin GET_STATUS');
select is(platform.integration_capabilities('EWM_V1', '/x', null),
  '{PROVISION,REPLAY_CERTIFICATION}'::text[], 'EWM_V1 sin read_scope → sin GET_STATUS');
select is(platform.integration_capabilities('EWM_V1', '/x', 'r'),
  '{PROVISION,GET_STATUS,REPLAY_CERTIFICATION}'::text[], 'EWM_V1 completo → las tres');

select pg_temp.act_as(pg_temp.tech_lead());
select throws_ok(
  $$ select platform.provisioning_execution_context(pg_temp.req_alpha_ewm()) $$,
  '42501', null, 'authenticated sigue sin EXECUTE sobre provisioning_execution_context');
select pg_temp.act_as_postgres();

-- ===========================================================================
-- 6. set_saas_provisioning_configuration: única vía de escritura, congelada
-- ===========================================================================
select has_function('platform', 'set_saas_provisioning_configuration', array['uuid', 'jsonb'],
  'existe set_saas_provisioning_configuration(uuid, jsonb)');
select ok(has_function_privilege('authenticated',
  'platform.set_saas_provisioning_configuration(uuid, jsonb)', 'EXECUTE'),
  'authenticated puede ejecutarla');
select ok(not has_function_privilege('anon',
  'platform.set_saas_provisioning_configuration(uuid, jsonb)', 'EXECUTE'),
  'anon no puede ejecutarla');

create or replace function pg_temp.ewm_conf() returns jsonb language sql as $$
  select '{"organizationTimezone":"America/Lima",
           "initialWarehouse":{"code":"WH-001","name":"Almacén Principal","timezone":"America/Lima"},
           "admin":{"fullName":"Nombre Secreto Admin"},
           "resolvedCurrency":"USD"}'::jsonb $$;

select pg_temp.act_as(pg_temp.esup_owner());
select throws_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_p1_qas(), pg_temp.ewm_conf()) $$,
  '42501', null, 'el owner de eSupplier no configura una solicitud de EWM');

select pg_temp.act_as(pg_temp.ewm_owner());
select lives_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_p1_qas(), pg_temp.ewm_conf()) $$,
  'el owner de EWM fija la configuración antes del primer intento');

select pg_temp.act_as_postgres();
select is(
  (select product_configuration - 'resolvedCurrency' from platform.saas_provisioning_requests
    where id = pg_temp.req_p1_qas()),
  pg_temp.ewm_conf() - 'resolvedCurrency', 'la fila guarda la configuración enviada');
select is(
  (select product_configuration ->> 'resolvedCurrency' from platform.saas_provisioning_requests
    where id = pg_temp.req_p1_qas()),
  (select c.currency::text from platform.tenants t join platform.companies c on c.id = t.company_id
    where t.id = '50000000-0000-4000-a000-000000000009'),
  'resolvedCurrency lo pone el servidor desde companies.currency (el USD del cliente se descarta)');

select ok(exists(
  select 1 from platform.saas_provisioning_events
   where saas_provisioning_request_id = pg_temp.req_p1_qas()
     and action = 'PRODUCT_CONFIGURATION_SET'
     and detail = '{"keys":["admin","initialWarehouse","organizationTimezone","resolvedCurrency"]}'::jsonb),
  'se registra PRODUCT_CONFIGURATION_SET con las claves');
select ok(not exists(
  select 1 from platform.saas_provisioning_events
   where saas_provisioning_request_id = pg_temp.req_p1_qas()
     and detail::text like '%Nombre Secreto Admin%'),
  'el evento no contiene valores (fullName)');

-- R1 · inmutable tras el primer intento
update platform.saas_provisioning_requests set attempt_count = 1 where id = pg_temp.req_p1_qas();
select pg_temp.act_as(pg_temp.ewm_owner());
select throws_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_p1_qas(), pg_temp.ewm_conf()) $$,
  'P0001', null, 'product_configuration es inmutable tras el primer intento');
select pg_temp.act_as_postgres();
update platform.saas_provisioning_requests set attempt_count = 0 where id = pg_temp.req_p1_qas();

-- Estado no configurable: la solicitud DEV de alpha-ewm pasa a CANCELLED.
update platform.saas_provisioning_requests set status = 'CANCELLED', cancelled_at = now()
 where id = pg_temp.req_alpha_ewm();
select pg_temp.act_as(pg_temp.tech_lead());
select throws_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_alpha_ewm(), '{"a":1}'::jsonb) $$,
  'P0001', null, 'una solicitud CANCELLED no admite configuración');
select throws_ok(
  $$ select platform.set_saas_provisioning_configuration('00000000-0000-4000-a000-0000000000ff', '{}'::jsonb) $$,
  'P0002', null, 'una solicitud inexistente da SOLICITUD_NO_ENCONTRADA');
select pg_temp.act_as_postgres();

-- Tenant sin sociedad: se guarda sin resolvedCurrency (el codec bloquea al ejecutar).
update platform.tenants set company_id = null where id = '50000000-0000-4000-a000-000000000009';
select pg_temp.act_as(pg_temp.ewm_owner());
select lives_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_p1_qas(), pg_temp.ewm_conf()) $$,
  'sin sociedad la configuración se guarda igual');
select pg_temp.act_as_postgres();
select ok(not ((select product_configuration from platform.saas_provisioning_requests
                 where id = pg_temp.req_p1_qas()) ? 'resolvedCurrency'),
  'sin sociedad no hay resolvedCurrency');
update platform.tenants set company_id = '31000000-0000-4000-a000-000000000005'
 where id = '50000000-0000-4000-a000-000000000009';

-- ===========================================================================
-- 7. R1 · el cuerpo no deriva: moneda y zona horaria congeladas
-- ===========================================================================
select pg_temp.act_as(pg_temp.ewm_owner());
select lives_ok(
  $$ select platform.set_saas_provisioning_configuration(pg_temp.req_p1_qas(), pg_temp.ewm_conf()) $$,
  'configuración fijada con la sociedad en PEN');
select pg_temp.act_as_postgres();

update platform.companies set currency = 'USD' where id = '31000000-0000-4000-a000-000000000005';
insert into platform.tenant_settings (tenant_id, config)
values ('50000000-0000-4000-a000-000000000009', '{"locale":{"timezone":"America/Bogota"}}')
on conflict (tenant_id) do update set config = excluded.config;

select pg_temp.act_as_service();
select is(
  platform.provisioning_execution_context(pg_temp.req_p1_qas()) -> 'source' -> 'product_configuration' ->> 'resolvedCurrency',
  'PEN', 'resolvedCurrency queda congelada aunque cambie companies.currency');
select is(
  platform.provisioning_execution_context(pg_temp.req_p1_qas()) -> 'source' -> 'product_configuration' ->> 'organizationTimezone',
  'America/Lima', 'la zona congelada no cambia aunque cambie la cascada del tenant');
select pg_temp.act_as_postgres();

select ok(has_function_privilege('authenticated', 'platform.effective_tenant_config(uuid)', 'EXECUTE'),
  'authenticated puede resolver la configuración efectiva (precarga de zona)');
select pg_temp.act_as(pg_temp.tech_lead());
select isnt(
  platform.effective_tenant_config('50000000-0000-4000-a000-000000000008') -> 'locale' ->> 'timezone',
  null, 'la cascada devuelve una zona horaria para precargar');
select pg_temp.act_as_postgres();

-- ===========================================================================
-- 10. GET_STATUS: can_read_saas_provisioning y columnas de la vista
-- ===========================================================================
select ok(not has_function_privilege('anon', 'platform.can_read_saas_provisioning(uuid)', 'EXECUTE'),
  'anon no puede ejecutar can_read_saas_provisioning');

select pg_temp.act_as(pg_temp.super_admin());
select is(platform.can_read_saas_provisioning(pg_temp.req_p1_qas()), true, 'super admin lee EWM');
select pg_temp.act_as(pg_temp.tech_lead());
select is(platform.can_read_saas_provisioning(pg_temp.req_p1_qas()), true, 'tech lead lee EWM');
select pg_temp.act_as(pg_temp.ewm_owner());
select is(platform.can_read_saas_provisioning(pg_temp.req_p1_qas()), true, 'owner de EWM lee EWM');
select pg_temp.act_as(pg_temp.esup_owner());
select is(platform.can_read_saas_provisioning(pg_temp.req_p1_qas()), false, 'owner de eSupplier NO lee EWM');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000b'::uuid);
select is(platform.can_read_saas_provisioning(pg_temp.req_p1_qas()), false, 'un usuario de tenant NO lee');
select pg_temp.act_as(pg_temp.tech_lead());
select is(platform.can_read_saas_provisioning('00000000-0000-4000-a000-0000000000ff'), false,
  'un id inexistente da false');
select pg_temp.act_as_postgres();

select is(
  (select (array_agg(attname::text order by attnum))[1:50] from pg_attribute
    where attrelid = 'platform.v_saas_provisioning'::regclass and attnum > 0),
  array['id', 'tenant_id', 'tenant_name', 'tenant_slug', 'deployment_mode', 'customer_organization_id', 'customer_organization_name', 'managing_organization_id', 'managing_organization_name', 'saas_product_id', 'product_code', 'product_short_name', 'subscription_id', 'deployment_target_id', 'deployment_code', 'base_url', 'deployment_status', 'deployment_health', 'product_integration_id', 'integration_code', 'integration_type', 'contract_version', 'idempotency_key', 'correlation_id', 'request_version', 'status', 'provisioning_environment', 'provisioning_policy', 'attempt_count', 'max_attempts', 'requested_by', 'requested_by_name', 'requested_at', 'started_at', 'completed_at', 'cancelled_at', 'cancel_reason', 'last_error_code', 'last_error_message', 'provider_http_status', 'external_reference', 'mapping_id', 'external_tenant_id', 'external_organization_id', 'external_company_id', 'mapping_status', 'registered_manually', 'mapping_metadata', 'created_at', 'updated_at'],
  'las columnas previas de v_saas_provisioning conservan nombre y orden');
select is(
  (select (array_agg(attname::text order by attnum))[51:] from pg_attribute
    where attrelid = 'platform.v_saas_provisioning'::regclass and attnum > 0),
  array['adapter_key', 'capabilities', 'product_configuration'],
  'las columnas nuevas van al final');

select pg_temp.act_as(pg_temp.tech_lead());
select is((select capabilities from platform.v_saas_provisioning where id = pg_temp.req_alpha_ewm()),
  '{PROVISION}'::text[], 'una solicitud GENERIC expone capabilities {PROVISION}');
select is((select adapter_key::text from platform.v_saas_provisioning where id = pg_temp.req_p1_qas()),
  'EWM_V1', 'la solicitud EWM expone adapter_key EWM_V1');
select pg_temp.act_as_postgres();

-- ===========================================================================
-- 11. REPLAY_CERTIFICATION: can_certify_saas_provisioning, nunca en PRD
-- ===========================================================================
select ok(not has_function_privilege('anon', 'platform.can_certify_saas_provisioning(uuid)', 'EXECUTE'),
  'anon no puede ejecutar can_certify_saas_provisioning');

-- Solicitud de PRD insertada como postgres (el alta PRD real no aplica aquí).
do $$
declare
  v_id uuid;
begin
  insert into platform.saas_provisioning_requests
    (tenant_id, saas_product_id, idempotency_key, provisioning_environment)
  values ('50000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-000000000002',
          'ma-prov-test-prd-certify', 'PRD')
  returning id into v_id;
  perform set_config('tests.req_prd', v_id::text, false);
end;
$$;

select pg_temp.act_as(pg_temp.tech_lead());
select is(platform.can_certify_saas_provisioning(pg_temp.req_p1_qas()), true,
  'tech lead puede certificar una solicitud EWM de QAS');
select pg_temp.act_as(pg_temp.ewm_owner());
select is(platform.can_certify_saas_provisioning(pg_temp.req_p1_qas()), true,
  'owner de EWM puede certificar una solicitud EWM de QAS');
select pg_temp.act_as(pg_temp.esup_owner());
select is(platform.can_certify_saas_provisioning(pg_temp.req_p1_qas()), false,
  'owner de eSupplier NO certifica EWM');
select pg_temp.act_as(pg_temp.super_admin());
select is(platform.can_certify_saas_provisioning(current_setting('tests.req_prd')::uuid), false,
  'nunca en PRD, ni siquiera el super admin');
select is(platform.can_certify_saas_provisioning('00000000-0000-4000-a000-0000000000ff'), false,
  'un id inexistente da false');
select pg_temp.act_as_postgres();

select * from finish();
rollback;
