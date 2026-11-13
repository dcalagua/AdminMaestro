-- ============================================================================
-- Ciclo de vida del tenant · entrega a las apps (20261020000200, lifecycle.v1)
--   · ruta y scopes por integración (distintos de alta y entitlements);
--   · el cambio de estado del tenant sube la versión deseada;
--   · claim / contexto / resultado solo para el canal servidor;
--   · STALE/CONFLICT re-emiten por encima de lo aplicado; backoff; read model.
-- Escenario: alpha-eSupplier del seed, enrolado en una integración HTTP_M2M.
-- ============================================================================
begin;
select plan(40);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
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
create or replace function pg_temp.integ() returns uuid language sql as $$ select '70000000-0000-4000-a000-0000000000f7'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.d() returns platform.tenant_lifecycle_delivery language sql as $$
  select * from platform.tenant_lifecycle_delivery where tenant_id = pg_temp.alpha()
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || '/'
                     || has_function_privilege('authenticated', f, 'execute') || '/'
                     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.claim_lifecycle_deliveries(text, integer, integer)',
       'platform.lifecycle_delivery_context(uuid)',
       'platform.record_lifecycle_delivery_result(uuid, text, integer, text, text, integer, text, integer)']) f),
  'platform.claim_lifecycle_deliveries(text, integer, integer):false/false/true,'
  || 'platform.lifecycle_delivery_context(uuid):false/false/true,'
  || 'platform.record_lifecycle_delivery_result(uuid, text, integer, text, text, integer, text, integer):false/false/true',
  'Claim, contexto y resultado son solo del canal servidor');
select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['platform._mark_lifecycle_desired(uuid)', 'platform.lifecycle_channel_of(uuid)']) f),
  false, 'Los núcleos no tienen GRANT para nadie');
select is(has_function_privilege('anon', 'platform.configure_lifecycle_integration(uuid, text, text, text)', 'execute'),
  false, 'anon no configura el canal');
select is((select relrowsecurity and relforcerowsecurity from pg_class
            where oid = 'platform.tenant_lifecycle_delivery'::regclass), true, 'RLS habilitada y forzada');
select is(has_table_privilege('authenticated', 'platform.tenant_lifecycle_delivery', 'update'), false,
  'authenticated no escribe la entrega');
select is((select reloptions::text from pg_class where oid = 'platform.v_tenant_lifecycle'::regclass),
  '{security_invoker=true}', 'v_tenant_lifecycle sigue SECURITY INVOKER');

-- ---------------------------------------------------------------------------
-- Escenario: alpha con alta ACTIVA en una integración HTTP_M2M (sin canal aún)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
   enabled, status, entitlements_path, entitlements_manifest_path, entitlements_write_scope, entitlements_read_scope)
values (pg_temp.integ(), pg_temp.esup(), 'esupplier-m2m-lc', 'eSupplier · M2M (lifecycle test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL',
        true, 'READY', '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest',
        'esupplier:entitlements:write', 'esupplier:entitlements:read');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000f7', 'esupplier-lc-m2m-test', 'eSupplier M2M (lifecycle test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = pg_temp.integ(),
       credential_profile_id = '71000000-0000-4000-a000-0000000000f7', base_url = 'http://127.0.0.1:54999'
 where id = '40000000-0000-4000-a000-00000000000a';
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-alpha', 'ACTIVE', now(), true);

select is((select count(*)::int from platform.tenant_lifecycle_delivery where tenant_id = pg_temp.alpha()), 0,
  'Un tenant activo que nunca se suspendió no genera entrega');

select throws_ok($$ update platform.product_integrations
                       set lifecycle_path = '/tenants/{controlPlaneTenantId}/lifecycle',
                           lifecycle_write_scope = 'esupplier:tenant:create', lifecycle_read_scope = 'esupplier:lifecycle:read'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope de escritura lifecycle no puede ser el de alta');
select throws_ok($$ update platform.product_integrations
                       set lifecycle_path = '/tenants/{controlPlaneTenantId}/lifecycle'
                     where id = pg_temp.integ() $$,
  '23514', null, 'Ruta y scopes van juntos (los tres o ninguno)');

-- ---------------------------------------------------------------------------
-- Suspender: la versión deseada nace con la causa
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.request_tenant_suspension(pg_temp.alpha(), 'Incumplimiento QA lifecycle');

select is((select desired_state || ':' || desired_reason || ':v' || desired_version from pg_temp.d()),
  'SUSPENDED:MANUAL:v1', 'Suspender crea la entrega SUSPENDED/MANUAL v1');
select is((select lifecycle_desired_state || ':' || lifecycle_channel::text from platform.v_tenant_lifecycle
            where tenant_id = pg_temp.alpha()), 'SUSPENDED:false', 'La matriz ve la entrega y que la app no tiene canal');

select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_lifecycle_deliveries('w1', 10, 60)), 0,
  'Sin canal configurado no se reclama nada');

select pg_temp.act_as('10000000-0000-4000-a000-00000000000e');
select throws_ok($$ select platform.configure_lifecycle_integration(pg_temp.integ(),
                      '/tenants/{controlPlaneTenantId}/lifecycle', 'esupplier:lifecycle:write', 'esupplier:lifecycle:read') $$,
  '42501', null, 'La owner de EWM no configura el canal de eSupplier');

select pg_temp.act_as(pg_temp.padmin());
select is(platform.configure_lifecycle_integration(pg_temp.integ(),
            '/tenants/{controlPlaneTenantId}/lifecycle', 'esupplier:lifecycle:write', 'esupplier:lifecycle:read'),
  pg_temp.integ(), 'EBIM_PRODUCT_ADMIN configura ruta y scopes');
select is((select count(*)::int from platform.audit_logs
            where action = 'LIFECYCLE_INTEGRATION_CONFIGURED' and entity_id = pg_temp.integ()::text), 1,
  'La configuración queda auditada');

-- ---------------------------------------------------------------------------
-- Claim → contexto → resultado
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select * from platform.claim_lifecycle_deliveries('w1', 10, 60) $$,
  '42501', null, 'Un usuario no reclama entregas');

select pg_temp.act_as_service();
select is((select string_agg(desired_state || ':' || desired_reason || ':v' || desired_version, ',')
             from platform.claim_lifecycle_deliveries('w1', 10, 60)),
  'SUSPENDED:MANUAL:v1', 'Con canal, el job reclama SUSPENDED v1');
select is((select lease_owner || ':' || attempts from pg_temp.d()), 'w1:1', 'Queda con lease del worker y un intento');
select is((select count(*)::int from platform.claim_lifecycle_deliveries('w2', 10, 60)), 0,
  'Con un PUT en vuelo, otro worker no la toma');

select is((select (c -> 'tenant' ->> 'productCode') || '|' || (c -> 'integration' ->> 'lifecycle_path') || '|'
                  || (c -> 'integration' ->> 'lifecycle_write_scope') || '|' || (c -> 'credential' ->> 'secret_ref')
                  || '|' || (c -> 'deployment' ->> 'environment')
             from platform.lifecycle_delivery_context(pg_temp.alpha()) c),
  'esupplier|/tenants/{controlPlaneTenantId}/lifecycle|esupplier:lifecycle:write|LOCAL_ESUPPLIER_M2M_PRIVATE_KEY|DEV',
  'El contexto trae ruta, scope y NOMBRE del secreto (nunca su valor)');
select is((select (c -> 'integration') ? 'create_scope' or (c -> 'integration') ? 'entitlements_write_scope'
             from platform.lifecycle_delivery_context(pg_temp.alpha()) c),
  false, 'El contexto no expone scopes de alta ni de entitlements');

select is(platform.record_lifecycle_delivery_result(pg_temp.alpha(), 'w2', 1, 'SUSPENDED', 'APPLIED', 200),
  'LEASE_PERDIDO', 'Un worker sin el lease no registra');
select is(platform.record_lifecycle_delivery_result(pg_temp.alpha(), 'w1', 1, 'SUSPENDED', 'APPLIED', 200),
  'APPLIED', 'El worker con lease registra APPLIED');
select is((select applied_state || ':v' || applied_version || ':' || coalesce(lease_owner, '-') from pg_temp.d()),
  'SUSPENDED:v1:-', 'Aplicado v1 SUSPENDED y lease liberado');
select is((select count(*)::int from platform.audit_logs
            where action = 'TENANT_LIFECYCLE_APPLIED' and entity_id = pg_temp.alpha()::text), 1,
  'La confirmación de la app queda auditada');
select is((select count(*)::int from platform.claim_lifecycle_deliveries('w1', 10, 60)), 0,
  'Aplicada, ya no hay nada pendiente');

-- ---------------------------------------------------------------------------
-- Reanudar: v2 ACTIVE sin causa
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.request_tenant_resume(pg_temp.alpha(), 'Acuerdo QA lifecycle');
select is((select desired_state || ':' || coalesce(desired_reason, '-') || ':v' || desired_version from pg_temp.d()),
  'ACTIVE:-:v2', 'Reanudar sube a v2 ACTIVE sin causa');

-- STALE: la app vio una versión mayor → se re-emite por encima
select pg_temp.act_as_service();
select is((select desired_version from platform.claim_lifecycle_deliveries('w1', 10, 60)), 2, 'Se reclama v2');
select is(platform.record_lifecycle_delivery_result(pg_temp.alpha(), 'w1', 2, 'ACTIVE', 'STALE', 409, 'STALE_LIFECYCLE', 5),
  'STALE', 'La app responde STALE con appliedVersion 5');
select is((select desired_version || ':' || desired_state from pg_temp.d()), '6:ACTIVE',
  'Se re-emite como v6, por encima de lo aplicado en la app');
select is((select desired_version from platform.claim_lifecycle_deliveries('w1', 10, 60)), 6, 'y se reclama v6 en el acto');

-- RETRYABLE: backoff
select is(platform.record_lifecycle_delivery_result(pg_temp.alpha(), 'w1', 6, 'ACTIVE', 'RETRYABLE', 503, 'HTTP_503'),
  'RETRYABLE', 'Un 503 es reintentable');
select is((select next_attempt_at > now() and last_error_code = 'HTTP_503' from pg_temp.d()), true,
  'Queda en backoff con el código de error');
select is((select count(*)::int from platform.claim_lifecycle_deliveries('w1', 10, 60)), 0, 'El job respeta el backoff');

-- REJECTED: una hora; un código no estable se normaliza
select pg_temp.act_as_postgres();
update platform.tenant_lifecycle_delivery set next_attempt_at = now() where tenant_id = pg_temp.alpha();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_lifecycle_deliveries('w1', 10, 60)), 1, 'Vencido el backoff se reclama');
select is(platform.record_lifecycle_delivery_result(pg_temp.alpha(), 'w1', 6, 'ACTIVE', 'REJECTED', 404, 'not a code'),
  'REJECTED', 'Un 404 se rechaza');
select is((select (next_attempt_at > now() + interval '50 minutes')::text || ':' || last_error_code from pg_temp.d()),
  'true:ERROR', 'Rechazo: reintento en una hora y código normalizado');

-- ---------------------------------------------------------------------------
-- Baja: CHURNED viaja como SUSPENDED/TERMINATED
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update platform.tenants set status = 'CHURNED' where id = pg_temp.alpha();
select is((select desired_state || ':' || desired_reason || ':v' || desired_version from pg_temp.d()),
  'SUSPENDED:TERMINATED:v7', 'La baja viaja como SUSPENDED/TERMINATED en una versión nueva');
select is((select lifecycle_desired_reason || ':' || lifecycle_channel::text from platform.v_tenant_lifecycle
            where tenant_id = pg_temp.alpha()), 'TERMINATED:true', 'La matriz lo refleja con canal configurado');

-- Un tenant sin alta en su app no genera entrega
select pg_temp.act_as(pg_temp.padmin());
select platform.request_tenant_suspension(pg_temp.p1(), 'QA sin alta');
select is((select count(*)::int from platform.tenant_lifecycle_delivery where tenant_id = pg_temp.p1()), 0,
  'Sin alta ACTIVA en la app no hay a quién decirle nada');

select * from finish();
rollback;
