-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · estado deseado/aplicado (MA-33)
-- ----------------------------------------------------------------------------
-- Spec §9 (13 estados, jobs push/verify/registry-verify), §18 (modos de falla).
-- Plan §10.1 MA-33. Los casos de las funciones puras son los de
-- supabase/functions/_shared/entitlements/sync-state-cases.json (el mismo
-- archivo que prueba states.test.ts; un test de vitest comprueba que están
-- todos aquí).
-- ============================================================================
begin;
select plan(127);

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

create or replace function pg_temp.st(p_tenant uuid default null) returns platform.entitlement_sync_state
language sql as $$
  select s.* from platform.entitlement_sync_state s
   where s.tenant_id = coalesce(p_tenant, pg_temp.alpha()) and s.saas_product_id = pg_temp.esup()
$$;

create or replace function pg_temp.verdict(p_id text, dv bigint, dc text, av bigint, ac text, ast text, rd boolean)
returns text language sql as $$ select platform.entitlement_verify_verdict(dv, dc, av, ac, ast, rd) $$;
create or replace function pg_temp.push(p_id text, r text, f int)
returns text language sql as $$ select t.state || ':' || t.failures from platform.entitlement_push_transition(r, f) t $$;
create or replace function pg_temp.vfail(p_id text, s text, r text, f int)
returns text language sql as $$ select t.state || ':' || t.failures from platform.entitlement_verify_failure_transition(s, r, f) t $$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'entitlement_sync_state', 'Existe entitlement_sync_state');
select has_table('platform', 'entitlement_sync_attempts', 'Existe entitlement_sync_attempts');
select has_table('platform', 'entitlement_registry_checks', 'Existe entitlement_registry_checks');
select is((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
            where oid in ('platform.entitlement_sync_state'::regclass, 'platform.entitlement_sync_attempts'::regclass,
                          'platform.entitlement_registry_checks'::regclass)),
  true, 'RLS habilitado y forzado en las tres tablas');
select is(
  (select string_agg(t || ':' || has_table_privilege('authenticated', t, 'insert,update,delete'), ',' order by t)
     from unnest(array['platform.entitlement_sync_state', 'platform.entitlement_sync_attempts',
                       'platform.entitlement_registry_checks']) t),
  'platform.entitlement_registry_checks:false,platform.entitlement_sync_attempts:false,platform.entitlement_sync_state:false',
  'authenticated no escribe ninguna tabla de sync');
select is(
  (select string_agg(f || ':' || has_function_privilege('authenticated', f, 'execute') || '/'
                     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.refresh_entitlement_sync_state(uuid, uuid)',
       'platform.claim_entitlement_pushes(text, integer, integer)',
       'platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb)',
       'platform.claim_entitlement_verifications(text, integer, integer, interval)',
       'platform.record_entitlement_verify_result(uuid, uuid, text, jsonb)',
       'platform.record_entitlement_registry_check(uuid, text, text[])']) f),
  'platform.claim_entitlement_pushes(text, integer, integer):false/true,'
  || 'platform.claim_entitlement_verifications(text, integer, integer, interval):false/true,'
  || 'platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb):false/true,'
  || 'platform.record_entitlement_registry_check(uuid, text, text[]):false/true,'
  || 'platform.record_entitlement_verify_result(uuid, uuid, text, jsonb):false/true,'
  || 'platform.refresh_entitlement_sync_state(uuid, uuid):false/true',
  'Las RPCs de transición son solo de service_role');
select is((select count(*)::int from pg_constraint
            where conrelid = 'platform.entitlement_sync_state'::regclass and conname = 'entitlement_sync_state_state_ck'
              and pg_get_constraintdef(oid) ~ 'REGISTRY_DRIFT'),
  1, 'El CHECK de estado enumera los 13 estados');

-- ---------------------------------------------------------------------------
-- Funciones puras — casos de sync-state-cases.json
-- ---------------------------------------------------------------------------
select is(pg_temp.verdict('v-in-sync', 3, 'A', 3, 'A', 'APPLIED', false), 'IN_SYNC', 'v-in-sync');
select is(pg_temp.verdict('v-warnings', 3, 'A', 3, 'A', 'APPLIED_WITH_WARNINGS', false), 'IN_SYNC_WITH_WARNINGS', 'v-warnings');
select is(pg_temp.verdict('v-never-applied', 3, 'A', null, null, 'NONE', false), 'DRIFT_BEHIND', 'v-never-applied');
select is(pg_temp.verdict('v-behind', 3, 'A', 2, 'B', 'APPLIED', false), 'DRIFT_BEHIND', 'v-behind');
select is(pg_temp.verdict('v-checksum', 3, 'A', 3, 'B', 'APPLIED', false), 'DRIFT_CHECKSUM', 'v-checksum');
select is(pg_temp.verdict('v-ahead', 3, 'A', 4, 'C', 'APPLIED', false), 'DRIFT_AHEAD', 'v-ahead');
select is(pg_temp.verdict('v-ahead-without-desired', null, null, 1, 'C', 'APPLIED', false), 'DRIFT_AHEAD', 'v-ahead-without-desired');
select is(pg_temp.verdict('v-registry-drift', 3, 'A', 3, 'A', 'APPLIED', true), 'REGISTRY_DRIFT', 'v-registry-drift');
select is(pg_temp.verdict('v-registry-drift-does-not-mask', 3, 'A', 2, 'B', 'APPLIED', true), 'DRIFT_BEHIND', 'v-registry-drift-does-not-mask');

select is(pg_temp.push('p-applied', 'APPLIED', 2), 'AWAITING_VERIFY:0', 'p-applied');
select is(pg_temp.push('p-replayed', 'REPLAYED', 0), 'AWAITING_VERIFY:0', 'p-replayed');
select is(pg_temp.push('p-stale', 'STALE', 1), 'DRIFT_AHEAD:1', 'p-stale');
select is(pg_temp.push('p-conflict', 'CONFLICT', 0), 'DRIFT_CHECKSUM:0', 'p-conflict');
select is(pg_temp.push('p-rejected', 'REJECTED', 0), 'REJECTED:0', 'p-rejected');
select is(pg_temp.push('p-invalid-snapshot', 'INVALID_SNAPSHOT', 0), 'REJECTED:0', 'p-invalid-snapshot');
select is(pg_temp.push('p-retryable-first', 'RETRYABLE', 0), 'PENDING_PUSH:1', 'p-retryable-first');
select is(pg_temp.push('p-retryable-exhausted', 'RETRYABLE', 4), 'UNREACHABLE:5', 'p-retryable-exhausted');
select throws_ok($$ select * from platform.entitlement_push_transition('IN_SYNC', 0) $$, '22023', null,
  'Un resultado de push desconocido (p. ej. IN_SYNC) se rechaza');

select is(pg_temp.vfail('vf-retryable-awaiting', 'AWAITING_VERIFY', 'RETRYABLE', 0), 'AWAITING_VERIFY:1', 'vf-retryable-awaiting');
select is(pg_temp.vfail('vf-retryable-sample', 'IN_SYNC', 'RETRYABLE', 1), 'IN_SYNC:2', 'vf-retryable-sample');
select is(pg_temp.vfail('vf-retryable-exhausted', 'AWAITING_VERIFY', 'RETRYABLE', 4), 'UNREACHABLE:5', 'vf-retryable-exhausted');
select is(pg_temp.vfail('vf-rejected', 'AWAITING_VERIFY', 'REJECTED', 0), 'REJECTED:0', 'vf-rejected');

select is(
  (select string_agg(s || '/' || f || ':' || platform.entitlement_is_pushable(s, f), ',' order by s, f)
     from (values ('PENDING_PUSH', 0), ('DRIFT_BEHIND', 1), ('DRIFT_BEHIND', 5), ('UNREACHABLE', 5),
                  ('DRIFT_AHEAD', 0), ('DRIFT_CHECKSUM', 0), ('REJECTED', 0), ('IN_SYNC', 0),
                  ('NOT_ENROLLED', 0), ('NOT_PROVISIONED', 0), ('AWAITING_VERIFY', 0)) v(s, f)),
  'AWAITING_VERIFY/0:false,DRIFT_AHEAD/0:false,DRIFT_BEHIND/1:true,DRIFT_BEHIND/5:false,DRIFT_CHECKSUM/0:false,'
  || 'IN_SYNC/0:false,NOT_ENROLLED/0:false,NOT_PROVISIONED/0:false,PENDING_PUSH/0:true,REJECTED/0:false,UNREACHABLE/5:true',
  'isPushable: tabla completa (DRIFT_AHEAD no hace push)');
select is(
  (select string_agg(f || '=' || extract(epoch from platform.entitlement_retry_delay(f))::int, ',' order by f)
     from unnest(array[1, 2, 4, 7, 20]) f),
  '1=60,2=120,4=480,7=3600,20=3600', 'Backoff exponencial con techo de 1 h');

-- ---------------------------------------------------------------------------
-- Escenario: registro QA y mapping ACTIVE de alpha
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "status": "ACTIVE"},
    {"code": "esupplier.qa.scoped", "name": "QA por compañía", "kind": "FEATURE", "scopeLevel": "COMPANY", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date - 30, 'QA');

select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-alpha', 'ACTIVE', now(), true);
-- Integración HTTP_M2M de eSupplier en DEV para alpha (dentro del rollback).
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
   enabled, status)
values ('70000000-0000-4000-a000-0000000000e1', pg_temp.esup(), 'esupplier-m2m-dev', 'eSupplier · M2M DEV (test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL',
        true, 'READY');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000e1', 'esupplier-dev-m2m-test', 'eSupplier DEV M2M (test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = '70000000-0000-4000-a000-0000000000e1',
       credential_profile_id = '71000000-0000-4000-a000-0000000000e1',
       base_url = 'http://127.0.0.1:54999'
 where id = '40000000-0000-4000-a000-00000000000a';
-- Parte 1: integración ya configurada y con el kill-switch encendido (la parte 2 prueba cómo se llega aquí).
update platform.product_integrations
   set entitlements_path = '/tenants/{controlPlaneTenantId}/entitlements',
       entitlements_manifest_path = '/entitlements/manifest',
       entitlements_write_scope = 'esupplier:entitlements:write',
       entitlements_read_scope = 'esupplier:entitlements:read',
       entitlements_push_enabled = true
 where id = '70000000-0000-4000-a000-0000000000e1';

-- ---------------------------------------------------------------------------
-- NOT_PROVISIONED / NOT_ENROLLED
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.refresh_entitlement_sync_state(pg_temp.alpha(), pg_temp.esup()) $$,
  '42501', null, 'Un humano no mueve el estado de sync');
select pg_temp.act_as_service();
select is(platform.refresh_entitlement_sync_state(pg_temp.p1(), pg_temp.esup()), 'NOT_PROVISIONED',
  'Sin mapping ACTIVE → NOT_PROVISIONED');
select is(platform.refresh_entitlement_sync_state(pg_temp.alpha(), pg_temp.esup()), 'NOT_ENROLLED',
  'Con mapping pero eje LEGACY_ONLY → NOT_ENROLLED (no se empuja)');
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'version', '1', 'Snapshot v1 emitido');
select is((select state || ':' || desired_version || ':' || (desired_checksum = (select checksum from platform.entitlement_snapshots
             where tenant_id = pg_temp.alpha() and snapshot_version = 1)) from pg_temp.st()),
  'NOT_ENROLLED:1:true', 'Emitir registra desired_version/checksum pero NOT_ENROLLED sigue sin empujar');
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 0,
  'claim no toma tenants NOT_ENROLLED');

-- Cohorte en SHADOW (spec §15: cohort_state por tenant).
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set cohort_state = 'SHADOW'
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is(platform.refresh_entitlement_sync_state(pg_temp.alpha(), pg_temp.esup()), 'PENDING_PUSH',
  'Enrolado con desired v1 y nada aplicado → PENDING_PUSH');

-- ---------------------------------------------------------------------------
-- Push: claim con lease, fallo reintentable, backoff, lease vencido
-- ---------------------------------------------------------------------------
select is((select string_agg(c.snapshot_version || ':' || (c.document ->> 'snapshotVersion') || ':'
                             || (c.document ->> 'checksum' = c.checksum), ',')
             from platform.claim_entitlement_pushes('w1', 10, 120) c where c.tenant_id = pg_temp.alpha()),
  '1:1:true', 'claim devuelve la versión deseada con su documento');
select is((select state || ':' || lease_owner || ':' || pushing_version from pg_temp.st()), 'PUSHING:w1:1',
  'Queda PUSHING con lease de w1');
select is((select count(*)::int from platform.claim_entitlement_pushes('w2', 10, 120)), 0,
  'Otro worker no la toma mientras el lease está vigente');
select throws_ok($$ select platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w2', 1, '{"result":"APPLIED"}') $$,
  '55000', null, 'Un worker sin el lease no registra resultado (LEASE_PERDIDO)');
select throws_ok($$ select platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 7, '{"result":"APPLIED"}') $$,
  '55000', null, 'Tampoco con otra versión que la reclamada');

select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 1,
            '{"result":"RETRYABLE","httpStatus":503,"errorCode":"PROVIDER_UNAVAILABLE"}'),
  'PENDING_PUSH', '503 → PENDING_PUSH');
select is((select consecutive_failures || ':' || (lease_owner is null) || ':'
                  || (next_attempt_at between now() + interval '59 seconds' and now() + interval '61 seconds')
             from pg_temp.st()),
  '1:true:true', 'Un fallo, lease liberado, próximo intento en 60 s');
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 0,
  'No se reclama antes del backoff');

select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set next_attempt_at = now() - interval '1 second'
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'Tras el backoff se reclama');

-- w1 "muere": el lease vence y w2 lo retoma, contando el fallo.
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set lease_until = now() - interval '1 second'
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w2', 10, 120)), 1,
  'Un PUSHING con lease vencido se puede retomar');
select is((select lease_owner || ':' || consecutive_failures from pg_temp.st()), 'w2:2',
  'El lease pasa a w2 y el abandono cuenta como fallo');
select is((select count(*)::int from platform.entitlement_sync_attempts
            where tenant_id = pg_temp.alpha() and outcome = 'LEASE_EXPIRED'), 1,
  'El abandono queda en la bitácora');
select throws_ok($$ select platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 1, '{"result":"APPLIED"}') $$,
  '55000', null, 'El worker que perdió el lease ya no puede registrar');

-- Push aplicado: AWAITING_VERIFY; la respuesta del PUT NO es prueba.
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w2', 1,
            '{"result":"APPLIED","httpStatus":200,"appliedVersion":1,"appliedChecksum":"sha256:x","status":"APPLIED"}'),
  'AWAITING_VERIFY', '200 → AWAITING_VERIFY');
select is((select last_pushed_version || ':' || consecutive_failures || ':' || coalesce(applied_version::text, 'null')
                  || ':' || last_push_result from pg_temp.st()),
  '1:0:null:APPLIED', 'last_pushed=1, fallos a 0 y applied_* intacto: solo el GET cuenta como prueba');

-- ---------------------------------------------------------------------------
-- Verify: el GET decide
-- ---------------------------------------------------------------------------
select is((select string_agg(c.tenant_id::text || ':' || c.state, ',')
             from platform.claim_entitlement_verifications('v1', 10, 60, interval '1 hour') c
            where c.tenant_id = pg_temp.alpha()),
  pg_temp.alpha()::text || ':AWAITING_VERIFY', 'claim de verificación toma AWAITING_VERIFY');
select throws_ok($$ select platform.record_entitlement_verify_result(pg_temp.alpha(), pg_temp.esup(), 'otro', '{"result":"OBSERVED"}') $$,
  '55000', null, 'La verificación también exige el lease');
select is(platform.record_entitlement_verify_result(pg_temp.alpha(), pg_temp.esup(), 'v1',
            jsonb_build_object('result', 'OBSERVED', 'httpStatus', 200, 'appliedVersion', 1,
                               'appliedChecksum', (select desired_checksum from pg_temp.st()),
                               'status', 'APPLIED', 'unknownCapabilities', '[]'::jsonb)),
  'IN_SYNC', 'GET con la misma versión y checksum → IN_SYNC');
select is((select applied_version || ':' || (applied_checksum = desired_checksum) || ':' || applied_status || ':'
                  || (last_verified_at is not null) from pg_temp.st()),
  '1:true:APPLIED:true', 'El GET registra lo aplicado y last_verified_at');
select is((select count(*)::int from platform.claim_entitlement_verifications('v1', 10, 60, interval '1 hour') c
            where c.tenant_id = pg_temp.alpha()),
  0, 'Un IN_SYNC recién verificado no entra en la muestra');
select is((select count(*)::int from platform.claim_entitlement_verifications('v1', 10, 60, interval '0 seconds') c
            where c.tenant_id = pg_temp.alpha()),
  1, 'Sí entra en la muestra periódica cuando vence su ventana');
select is(platform.record_entitlement_verify_result(pg_temp.alpha(), pg_temp.esup(), 'v1',
            '{"result":"RETRYABLE","httpStatus":503}'),
  'IN_SYNC', 'Un fallo de red en la muestra no degrada IN_SYNC');

-- Cambio comercial → versión 2 → PENDING_PUSH automáticamente.
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.scoped', 'GRANT', '{"enabled": true}',
  now() + interval '30 days', 'Piloto QA');
select pg_temp.act_as_service();
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'version', '2', 'v2 emitida');
select is((select state || ':' || desired_version || ':' || consecutive_failures from pg_temp.st()), 'PENDING_PUSH:2:0',
  'Una versión deseada nueva pasa a PENDING_PUSH');

-- DRIFT_BEHIND tras un GET que sigue en v1, y re-push.
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'claim v2');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 2, '{"result":"REPLAYED","httpStatus":200}'),
  'AWAITING_VERIFY', 'REPLAYED también espera verificación');
select is((select count(*)::int from platform.claim_entitlement_verifications('v2', 10, 60, interval '1 hour')), 1, 'claim verify');
select is(platform.record_entitlement_verify_result(pg_temp.alpha(), pg_temp.esup(), 'v2',
            jsonb_build_object('result', 'OBSERVED', 'appliedVersion', 1, 'appliedChecksum', 'sha256:' || repeat('a', 64),
                               'status', 'APPLIED')),
  'DRIFT_BEHIND', 'El GET dice v1 aunque el PUT dijo 200 → DRIFT_BEHIND');
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1,
  'DRIFT_BEHIND se vuelve a empujar');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 2,
            '{"result":"STALE","httpStatus":409,"errorCode":"STALE_SNAPSHOT","appliedVersion":9}'),
  'DRIFT_AHEAD', '409 STALE_SNAPSHOT → DRIFT_AHEAD');
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 0,
  'DRIFT_AHEAD no hace push automático');

select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'PENDING_PUSH', next_attempt_at = now()
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'claim');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 2,
            '{"result":"CONFLICT","httpStatus":409,"errorCode":"VERSION_CONFLICT"}'),
  'DRIFT_CHECKSUM', '409 VERSION_CONFLICT → DRIFT_CHECKSUM (incidente)');
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'PENDING_PUSH', next_attempt_at = now()
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'claim');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 2,
            '{"result":"REJECTED","httpStatus":422,"errorCode":"ENVIRONMENT_MISMATCH"}'),
  'REJECTED', '422 → REJECTED');
select is((select state_reason from pg_temp.st()), 'ENVIRONMENT_MISMATCH', 'El motivo es el código estable del receptor');
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 0, 'REJECTED no se reintenta solo');

-- Agotar reintentos → UNREACHABLE (y se reintenta más tarde).
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'PENDING_PUSH', next_attempt_at = now(), consecutive_failures = 4
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'claim');
select is(platform.record_entitlement_push_result(pg_temp.alpha(), pg_temp.esup(), 'w1', 2,
            '{"result":"RETRYABLE","errorCode":"PROVIDER_TIMEOUT"}'),
  'UNREACHABLE', 'Quinto fallo → UNREACHABLE');
select is((select (next_attempt_at > now() + interval '59 minutes')::text from pg_temp.st()), 'true',
  'UNREACHABLE se reintenta con el techo de backoff (1 h)');

-- Una versión nueva no revive DRIFT_AHEAD si sigue por debajo de lo aplicado.
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state set state = 'DRIFT_AHEAD', applied_version = 9
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.revoke_entitlement_override(
  (select id from platform.tenant_entitlement_overrides where tenant_id = pg_temp.alpha() and revoked_at is null), 'Fin piloto');
select pg_temp.act_as_service();
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'version', '3', 'v3');
select is((select state from pg_temp.st()), 'DRIFT_AHEAD', 'v3 < aplicada (9): sigue DRIFT_AHEAD, sin push');

-- ---------------------------------------------------------------------------
-- registry-verify
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state
   set state = 'IN_SYNC', applied_version = 3, applied_checksum = desired_checksum, applied_status = 'APPLIED'
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as_service();
select is(platform.record_entitlement_registry_check(pg_temp.esup(), 'm-2', array['esupplier.qa.tenders', 'esupplier.qa.extra']),
  true, 'Manifiesto distinto del registro → drift');
select is((select missing_in_manifest::text || ':' || missing_in_registry::text from platform.entitlement_registry_checks
            where saas_product_id = pg_temp.esup() order by checked_at desc, id desc limit 1),
  '{esupplier.qa.scoped}:{esupplier.qa.extra}', 'El check registra la diferencia en las dos direcciones');
select is((select state from pg_temp.st()), 'REGISTRY_DRIFT', 'Los tenants IN_SYNC del producto pasan a REGISTRY_DRIFT');
select is(platform.record_entitlement_registry_check(pg_temp.esup(), 'm-3', array['esupplier.qa.scoped', 'esupplier.qa.tenders']),
  false, 'Manifiesto igual al registro → sin drift');
select is((select state from pg_temp.st()), 'AWAITING_VERIFY', 'Resuelto el drift, se re-verifica por GET');

-- ---------------------------------------------------------------------------
-- Bitácora append-only y lectura
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select ok((select count(*) from platform.entitlement_sync_attempts where tenant_id = pg_temp.alpha()) >= 10,
  'Cada push/verify/lease queda en entitlement_sync_attempts');
select is((select count(*)::int from platform.entitlement_sync_attempts
            where tenant_id = pg_temp.alpha() and detail::text ~* '(-----BEGIN|eyJ[A-Za-z0-9_-]+\.)'),
  0, 'La bitácora no guarda tokens ni claves');
select throws_ok($$ update platform.entitlement_sync_attempts set outcome = outcome $$, '55000', null, 'Bitácora: UPDATE bloqueado');
select throws_ok($$ delete from platform.entitlement_sync_attempts $$, '55000', null, 'Bitácora: DELETE bloqueado');
select throws_ok($$ delete from platform.entitlement_registry_checks $$, '55000', null, 'Registry checks: DELETE bloqueado');
select throws_ok($$ select * from platform.entitlement_push_transition('APPLIED', -1) $$, '22023', null,
  'Fallos negativos → error');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is((select count(*)::int from platform.entitlement_sync_state where tenant_id = pg_temp.alpha()), 1,
  'Plataforma lee el estado de sync');
select is((select count(*)::int from platform.entitlement_sync_attempts where tenant_id = pg_temp.alpha()) > 0, true,
  'Plataforma lee la bitácora');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.entitlement_sync_state where tenant_id = pg_temp.alpha()), 0,
  'omega no ve el estado de alpha');
select is((select count(*)::int from platform.entitlement_sync_attempts where tenant_id = pg_temp.alpha()), 0,
  'omega no ve la bitácora de alpha');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is((select count(*)::int from platform.entitlement_sync_state), 0, 'Sin rol no ve nada');

-- ============================================================================
-- PARTE 2 (MA-34) · product_integrations: eje de cutover y kill-switch
-- Spec §3.2 (columnas nuevas), §15 (un paso adelante o atrás), §18 (kill-switch).
-- ============================================================================
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.product_integrations
            where id <> '70000000-0000-4000-a000-0000000000e1'
              and (cutover_state_entitlements <> 'LEGACY_ONLY' or cutover_state_billing <> 'BILLING_LEGACY'
               or entitlements_push_enabled or usage_ingest_enabled
               or entitlements_path is not null or entitlements_manifest_path is not null
               or entitlements_write_scope is not null or entitlements_read_scope is not null)),
  0, 'Integraciones existentes: LEGACY_ONLY / BILLING_LEGACY, kill-switch apagado, sin rutas ni scopes');
select throws_ok($$ update platform.product_integrations set entitlements_path = '/tenants/../x'
                     where id = '70000000-0000-4000-a000-000000000003' $$,
  '23514', null, 'Ruta de entitlements insegura → CHECK');
select throws_ok($$ update platform.product_integrations set cutover_state_entitlements = 'PRIMARY'
                     where id = '70000000-0000-4000-a000-000000000003' $$,
  '23514', null, 'Estado de cutover fuera del catálogo → CHECK');

update platform.product_integrations
   set entitlements_path = null, entitlements_manifest_path = null, entitlements_write_scope = null,
       entitlements_read_scope = null, entitlements_push_enabled = false
 where id = '70000000-0000-4000-a000-0000000000e1';
update platform.entitlement_sync_state set cohort_state = null
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();

select pg_temp.act_as_service();
select is(platform.refresh_entitlement_sync_state(pg_temp.alpha(), pg_temp.esup()), 'NOT_ENROLLED',
  'Sin cohorte, manda el eje de la integración: LEGACY_ONLY → NOT_ENROLLED');

-- Autoridad
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', 'x') $$,
  '42501', null, 'Un admin de tenant no mueve el cutover');
select throws_ok($$ select platform.configure_entitlements_integration('70000000-0000-4000-a000-0000000000e1',
                     '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest', 'esupplier:entitlements:write',
                     'esupplier:entitlements:read') $$,
  '42501', null, 'Un admin de tenant no configura la integración');
select throws_ok($$ select platform.set_entitlements_push_enabled('70000000-0000-4000-a000-0000000000e1', true, 'x') $$,
  '42501', null, 'Un admin de tenant no toca el kill-switch');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', 'x') $$,
  '42501', null, 'Sin rol tampoco');

-- Configuración incompleta no sale de LEGACY_ONLY.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', 'Piloto') $$,
  '23514', null, 'Sin ruta ni scopes de entitlements no se enrola (CONFIG_ENTITLEMENTS_INCOMPLETA)');
select throws_ok($$ select platform.configure_entitlements_integration('70000000-0000-4000-a000-0000000000e1',
                     '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest', 'esupplier:tenant:create',
                     'esupplier:entitlements:read') $$,
  '23514', null, 'El scope de escritura no puede ser el de provisioning (scopes separados, spec §8.1)');
select lives_ok($$ select platform.configure_entitlements_integration('70000000-0000-4000-a000-0000000000e1',
                     '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest', 'esupplier:entitlements:write',
                     'esupplier:entitlements:read') $$,
  'El product admin configura rutas y scopes de entitlements');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', '  ') $$,
  '23514', null, 'Motivo obligatorio');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'DUAL_READ', 'Salto') $$,
  '23514', null, 'No se salta un paso (LEGACY_ONLY → DUAL_READ)');
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', 'Piloto DEV'),
  'SHADOW', 'LEGACY_ONLY → SHADOW');
select is((select count(*)::int from platform.commercial_cutover_events
            where product_integration_id = '70000000-0000-4000-a000-0000000000e1' and axis = 'ENTITLEMENTS'
              and from_state = 'LEGACY_ONLY' and to_state = 'SHADOW' and reason = 'Piloto DEV'
              and actor_user_id = '10000000-0000-4000-a000-000000000002'),
  1, 'La transición queda en commercial_cutover_events con actor y motivo');

select pg_temp.act_as_postgres();
select is((select state from pg_temp.st()), 'PENDING_PUSH',
  'Enrolar la integración reevalúa las puertas de sus tenants: NOT_ENROLLED → PENDING_PUSH');

-- Kill-switch: apagado por defecto, nada se empuja.
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 0,
  'Kill-switch apagado: no se empuja aunque esté PENDING_PUSH');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is(platform.set_entitlements_push_enabled('70000000-0000-4000-a000-0000000000e1', true, 'Habilitar piloto'),
  true, 'Finanzas puede operar el kill-switch');
select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_entitlement_pushes('w1', 10, 120)), 1, 'Con el kill-switch encendido, sí');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is(platform.set_entitlements_push_enabled('70000000-0000-4000-a000-0000000000e1', false, 'Revocación masiva no deseada'),
  false, 'El product admin apaga el kill-switch');
select is((select count(*)::int from platform.commercial_cutover_events
            where product_integration_id = '70000000-0000-4000-a000-0000000000e1' and axis = 'PUSH_KILL_SWITCH'),
  2, 'Cada cambio del kill-switch queda registrado');

-- Contexto de entrega: solo servidor, sin valores de secreto.
select throws_ok($$ select platform.entitlement_delivery_context(pg_temp.alpha(), pg_temp.esup()) $$,
  '42501', null, 'Un humano no lee el contexto de entrega');
select pg_temp.act_as_service();
select is((select jsonb_build_object(
              'env', c -> 'deployment' ->> 'environment', 'base', c -> 'deployment' ->> 'base_url',
              'path', c -> 'integration' ->> 'entitlements_path', 'w', c -> 'integration' ->> 'entitlements_write_scope',
              'r', c -> 'integration' ->> 'entitlements_read_scope', 'aud', c -> 'integration' ->> 'audience',
              'ref', c -> 'credential' ->> 'secret_ref', 'push', c ->> 'push_enabled',
              'provisioning_scope', c -> 'integration' ? 'create_scope')
             from platform.entitlement_delivery_context(pg_temp.alpha(), pg_temp.esup()) c),
  jsonb_build_object('env', 'DEV', 'base', 'http://127.0.0.1:54999', 'path', '/tenants/{controlPlaneTenantId}/entitlements',
                     'w', 'esupplier:entitlements:write', 'r', 'esupplier:entitlements:read', 'aud', 'esupplier.ebim',
                     'ref', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'push', 'false', 'provisioning_scope', false),
  'Contexto: destino, rutas y scopes de entitlements, NOMBRE del secreto; sin scopes de provisioning');

-- Avanzar exige que la cohorte esté IN_SYNC; retroceder siempre se puede.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'DUAL_READ', 'Avance') $$,
  '23514', null, 'SHADOW → DUAL_READ exige todos los tenants IN_SYNC (COHORTE_NO_SINCRONIZADA)');
select pg_temp.act_as_postgres();
update platform.entitlement_sync_state
   set state = 'IN_SYNC', pushing_version = null, lease_owner = null, lease_until = null
 where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup();
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'DUAL_READ', 'Cohorte IN_SYNC'),
  'DUAL_READ', 'SHADOW → DUAL_READ con la cohorte IN_SYNC');
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'SHADOW', 'Rollback'),
  'SHADOW', 'Un paso atrás siempre se permite');
select pg_temp.act_as_postgres();
update platform.product_integrations set cutover_state_entitlements = 'MASTERADMIN_PRIMARY'
 where id = '70000000-0000-4000-a000-0000000000e1';
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'ENTITLEMENTS', 'LEGACY_RETIRED', 'Fin') $$,
  '23514', null, 'LEGACY_RETIRED no se alcanza en este programa (ni siquiera el super admin)');

-- Eje de facturación: finanzas.
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select throws_ok($$ select platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'BILLING', 'BILLING_SHADOW', 'x') $$,
  '42501', null, 'El admin de omega no mueve el eje de facturación');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000e1', 'BILLING', 'BILLING_SHADOW', 'Shadow DEV'),
  'BILLING_SHADOW', 'Finanzas: BILLING_LEGACY → BILLING_SHADOW');

select pg_temp.act_as_postgres();
select throws_ok($$ delete from platform.commercial_cutover_events $$, '55000', null, 'commercial_cutover_events es append-only');
select is((select string_agg(r || ':' || has_table_privilege(r, 'platform.commercial_cutover_events', 'insert,update,delete'), ',' order by r)
             from unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false', 'Sin escritura directa del historial de cutover');

select * from finish();
rollback;
