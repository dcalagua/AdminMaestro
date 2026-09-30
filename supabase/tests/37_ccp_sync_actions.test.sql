-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · acciones del orquestador (MA-36)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (SYNC_ENTITLEMENTS / GET_ENTITLEMENTS en el orquestador, sin
-- tocar PROVISION/GET_STATUS/REPLAY_CERTIFICATION), §14 (autoridad). Plan §4
-- fila 16, §10.1 MA-36.
--   · can_sync_entitlements / can_read_entitlement_sync: los BOOLEANOS que el
--     orquestador pregunta antes de asumir service_role (patrón V4);
--   · claim_entitlement_push_for / claim_entitlement_verification_for: el
--     "sincronizar ahora" de un tenant concreto (solo service_role);
--   · v_entitlement_sync_status: read model SECURITY INVOKER para la consola.
-- ============================================================================
begin;
select plan(47);

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
create or replace function pg_temp.st() returns platform.entitlement_sync_state language sql as $$
  select * from platform.entitlement_sync_state where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup()
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || '/'
                     || has_function_privilege('authenticated', f, 'execute'), ',' order by f)
     from unnest(array['platform.can_sync_entitlements(uuid)', 'platform.can_read_entitlement_sync(uuid)']) f),
  'platform.can_read_entitlement_sync(uuid):false/true,platform.can_sync_entitlements(uuid):false/true',
  'Los booleanos de autorización: authenticated sí, anon no');
select is(
  (select string_agg(f || ':' || has_function_privilege('authenticated', f, 'execute') || '/'
                     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
     from unnest(array['platform.claim_entitlement_push_for(uuid, uuid, text, integer)',
                       'platform.claim_entitlement_verification_for(uuid, uuid, text, integer)']) f),
  'platform.claim_entitlement_push_for(uuid, uuid, text, integer):false/true,'
  || 'platform.claim_entitlement_verification_for(uuid, uuid, text, integer):false/true',
  'Los claims dirigidos son solo de service_role');
select is((select p.prosecdef::text || ':' || p.provolatile::text from pg_proc p
            where p.oid = 'platform.can_sync_entitlements(uuid)'::regprocedure),
  'true:s', 'can_sync_entitlements es DEFINER y STABLE (como can_execute_saas_provisioning)');
select is((select reloptions::text from pg_class where oid = 'platform.v_entitlement_sync_status'::regclass),
  '{security_invoker=true}', 'v_entitlement_sync_status es SECURITY INVOKER');
select is(has_table_privilege('anon', 'platform.v_entitlement_sync_status', 'select'), false, 'anon no lee el read model');

-- ---------------------------------------------------------------------------
-- Autorización por producto
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-00000000000f');
select is(platform.can_sync_entitlements(pg_temp.alpha()), true, 'Owner técnico de eSupplier sincroniza alpha-eSupplier');
select is(platform.can_read_entitlement_sync(pg_temp.alpha()), true, 'y lee su estado');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000e');
select is(platform.can_sync_entitlements(pg_temp.alpha()), false, 'La owner de EWM no sincroniza un tenant de eSupplier');
select is(platform.can_read_entitlement_sync(pg_temp.alpha()), false, 'ni lo lee por esta vía');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is(platform.can_sync_entitlements(pg_temp.alpha()), false, 'Un admin de tenant no dispara sync (comercial ≠ operativo)');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is(platform.can_sync_entitlements(pg_temp.alpha()), false, 'Sin rol: no');
select is(platform.can_sync_entitlements('00000000-0000-4000-a000-00000000dead'), false, 'Tenant inexistente: false, no error');

-- ---------------------------------------------------------------------------
-- Escenario: alpha enrolado en una integración HTTP_M2M con kill-switch
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [{"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "status": "ACTIVE"}]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date - 30, 'QA');

select pg_temp.act_as_postgres();
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
   enabled, status, entitlements_path, entitlements_manifest_path, entitlements_write_scope, entitlements_read_scope,
   entitlements_push_enabled, cutover_state_entitlements)
values ('70000000-0000-4000-a000-0000000000e1', pg_temp.esup(), 'esupplier-m2m-dev', 'eSupplier · M2M DEV (test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL',
        true, 'READY', '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest',
        'esupplier:entitlements:write', 'esupplier:entitlements:read', true, 'SHADOW');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000e1', 'esupplier-dev-m2m-test', 'eSupplier DEV M2M (test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = '70000000-0000-4000-a000-0000000000e1',
       credential_profile_id = '71000000-0000-4000-a000-0000000000e1', base_url = 'http://127.0.0.1:54999'
 where id = '40000000-0000-4000-a000-00000000000a';
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-alpha', 'ACTIVE', now(), true);

select pg_temp.act_as_service();
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'version', '1', 'v1');
select is((select state from pg_temp.st()), 'PENDING_PUSH', 'Enrolado por la integración (SHADOW) → PENDING_PUSH');

-- ---------------------------------------------------------------------------
-- claim_entitlement_push_for: manual, ignora el backoff, respeta incidentes
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-00000000000f');
select throws_ok($$ select * from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'o', 60) $$,
  '42501', null, 'Ni el owner técnico llama al claim directamente: pasa por el orquestador');

select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set next_attempt_at = now() + interval '30 minutes', consecutive_failures = 3
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('job', 10, 120)), 0, 'El job respeta el backoff');
select is((select string_agg(c.snapshot_version::text || ':' || (c.document ->> 'checksum' = c.checksum), ',')
             from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60) c),
  '1:true', 'El sync manual no espera el backoff');
select is((select state || ':' || lease_owner from pg_temp.st()), 'PUSHING:orq', 'Queda PUSHING con lease del orquestador');
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'otro', 60)), 0,
  'Con un push en vuelo, otro sync manual no lo pisa');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'orq', 1,
            '{"result":"REJECTED","httpStatus":403,"errorCode":"INSUFFICIENT_SCOPE"}'), 'REJECTED', 'REJECTED');
select is((select count(*)::int from platform.claim_entitlement_pushes('job', 10, 120)), 0, 'El job no reintenta REJECTED');
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60)), 1,
  'Un humano sí puede reintentar un REJECTED tras corregir la configuración');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'orq', 1,
            '{"result":"CONFLICT","httpStatus":409,"errorCode":"VERSION_CONFLICT"}'), 'DRIFT_CHECKSUM', 'DRIFT_CHECKSUM');
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60)), 0,
  'DRIFT_CHECKSUM no se sobrescribe a mano: se corrige con una versión nueva (spec §18)');
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'DRIFT_AHEAD' where tenant_id = pg_temp.alpha();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60)), 0,
  'DRIFT_AHEAD tampoco');

-- Kill-switch también para el sync manual.
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'PENDING_PUSH' where tenant_id = pg_temp.alpha();
update platform.product_integrations set entitlements_push_enabled = false where id = '70000000-0000-4000-a000-0000000000e1';
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60)), 0,
  'Con el kill-switch apagado ni el sync manual empuja');
select pg_temp.act_as_postgres();
update platform.product_integrations set entitlements_push_enabled = true where id = '70000000-0000-4000-a000-0000000000e1';

-- ---------------------------------------------------------------------------
-- claim_entitlement_verification_for
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_push_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60)), 1, 'claim');
select is(platform.claim_entitlement_verification_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60), false,
  'No se verifica un tenant con un push en vuelo');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'orq', 1, '{"result":"APPLIED","httpStatus":200}'),
  'AWAITING_VERIFY', 'push aplicado');
select is(platform.claim_entitlement_verification_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60), true, 'Verificación reclamada');
select is(platform.claim_entitlement_verification_for(pg_temp.alpha(), pg_temp.esup(), 'otro', 60), false,
  'Con el lease vigente, nadie más la reclama');
select is(platform.record_entitlement_verify_result(pg_temp.alpha(), pg_temp.esup(), 'orq',
            jsonb_build_object('result', 'OBSERVED', 'appliedVersion', 1,
                               'appliedChecksum', (select desired_checksum from pg_temp.st()), 'status', 'APPLIED')),
  'IN_SYNC', 'GET → IN_SYNC');
select is(platform.claim_entitlement_verification_for(pg_temp.alpha(), pg_temp.esup(), 'orq', 60), true,
  'Un IN_SYNC se puede re-verificar a demanda (GET_ENTITLEMENTS)');
select is(platform.claim_entitlement_verification_for('50000000-0000-4000-a000-000000000002', pg_temp.esup(), 'orq', 60), false,
  'Un tenant no aprovisionado no se verifica');

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is((select tenant_name is not null and product_code = 'esupplier' and state = 'IN_SYNC' and desired_version = 1
                  and applied_version = 1 and desired_dirty = false and integration_code = 'esupplier-m2m-dev'
                  and cutover_state_entitlements = 'SHADOW' and push_enabled
             from platform.v_entitlement_sync_status where tenant_id = pg_temp.alpha()),
  true, 'La consola ve deseado, aplicado, estado, eje y kill-switch por tenant×producto');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.v_entitlement_sync_status where tenant_id = pg_temp.alpha()), 0,
  'omega no ve el estado de alpha (RLS del llamante)');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is((select count(*)::int from platform.v_entitlement_sync_status), 0, 'Sin rol no ve nada');

-- ---------------------------------------------------------------------------
-- Selección de trabajo del job
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select * from platform.entitlement_issue_candidates(10, false) $$, '42501', null,
  'Los candidatos de emisión son solo del servidor');
select pg_temp.act_as_service();
select is((select count(*)::int from platform.entitlement_issue_candidates(10, false) where tenant_id = pg_temp.alpha()), 0,
  'alpha sin cambios pendientes no es candidato fuera del barrido');
select is((select count(*)::int from platform.entitlement_issue_candidates(10, true) where tenant_id = pg_temp.alpha()), 1,
  'En el barrido sí (cambios por paso del tiempo)');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.tenders', 'DENY', '{}', now() + interval '1 day', 'QA');
select pg_temp.act_as_service();
select is((select count(*)::int from platform.entitlement_issue_candidates(10, false) where tenant_id = pg_temp.alpha()), 1,
  'Con un cambio comercial (dirty) es candidato');
select is((select string_agg(product_integration_id::text || ':' || tenant_id::text, ',') from platform.entitlement_registry_targets()),
  '70000000-0000-4000-a000-0000000000e1:' || pg_temp.alpha()::text, 'Un objetivo de registry-verify por integración enrolada');

-- ---------------------------------------------------------------------------
-- Preservación: las acciones existentes siguen igual
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'platform' and p.proname = 'provisioning_execution_context'), 1,
  'provisioning_execution_context sigue siendo una sola función');
select is((select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'platform'
              and proname in ('can_execute_saas_provisioning', 'can_read_saas_provisioning', 'can_certify_saas_provisioning',
                              'can_check_deployment_health')),
  'can_certify_saas_provisioning,can_check_deployment_health,can_execute_saas_provisioning,can_read_saas_provisioning',
  'Los permisos de las cuatro acciones existentes siguen presentes y sin duplicados');
select is(platform.integration_capabilities('EWM_V1', '/x', 'r'), array['PROVISION', 'GET_STATUS', 'REPLAY_CERTIFICATION'],
  'Capacidades de provisioning de EWM_V1 intactas');
select is(platform.integration_capabilities('GENERIC', null, null), array['PROVISION'], 'GENERIC sigue solo PROVISION');

-- EWM_V1: el canal de entitlements no depende del codec de provisioning.
update platform.product_integrations set adapter_key = 'EWM_V1' where id = '70000000-0000-4000-a000-0000000000e1';
select pg_temp.act_as_service();
select is((select c -> 'integration' ->> 'entitlements_path'
             from platform.entitlement_delivery_context(pg_temp.alpha(), pg_temp.esup()) c),
  '/tenants/{controlPlaneTenantId}/entitlements',
  'Una integración EWM_V1 usa el mismo canal entitlements.v1 (el codec de provisioning no participa)');

select * from finish();
rollback;
