-- ============================================================================
-- Sincronización de tenants con las apps (20261021000100)
--   · canal tenant-inventory.v1 opcional por integración;
--   · plan / inicio / resultado / cierre solo para el canal servidor;
--   · la base decide los hallazgos (vínculo roto, estado distinto, solo en la
--     app), los deduplica y cierra solo lo que la corrida pudo comprobar;
--   · consola: RLS de lectura, resolver/descartar con motivo, registrar en el
--     Admin Maestro reutilizando las RPC de alta;
--   · job programado TENANT_SYNC.
-- Escenario: alpha y p1 (eSupplier del seed) vinculados en esupplier-shared-dev
-- a través de una integración HTTP_M2M con lifecycle e inventario.
-- ============================================================================
begin;
select plan(55);

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
create or replace function pg_temp.target() returns uuid language sql as $$ select '40000000-0000-4000-a000-00000000000a'::uuid $$;
create or replace function pg_temp.integ() returns uuid language sql as $$ select '70000000-0000-4000-a000-0000000000f8'::uuid $$;
create or replace function pg_temp.superadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.open_count(p_kind text) returns int language sql as $$
  select count(*)::int from platform.tenant_sync_findings
   where deployment_target_id = pg_temp.target() and status = 'OPEN' and kind = p_kind
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || '/'
                     || has_function_privilege('authenticated', f, 'execute') || '/'
                     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.begin_tenant_sync_run(text, uuid)',
       'platform.finish_tenant_sync_run(uuid, text, integer)',
       'platform.record_tenant_sync_target_result(uuid, uuid, jsonb)',
       'platform.tenant_sync_plan()']) f),
  'platform.begin_tenant_sync_run(text, uuid):false/false/true,'
  || 'platform.finish_tenant_sync_run(uuid, text, integer):false/false/true,'
  || 'platform.record_tenant_sync_target_result(uuid, uuid, jsonb):false/false/true,'
  || 'platform.tenant_sync_plan():false/false/true',
  'Plan, inicio, resultado y cierre son solo del canal servidor');
select is(
  (select bool_or(has_function_privilege(r,
     'platform._upsert_tenant_sync_finding(uuid, text, text, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb)',
     'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r),
  false, 'El núcleo de hallazgos no tiene GRANT para nadie');
select is(
  (select bool_and(has_function_privilege('authenticated', f, 'execute')
                   and not has_function_privilege('anon', f, 'execute'))
     from unnest(array[
       'platform.resolve_tenant_sync_finding(uuid, text, text)',
       'platform.register_tenant_sync_finding(uuid, text, text, text, uuid, text, text, text, text, text, platform.tenant_type, uuid, text)',
       'platform.list_tenant_sync_findings(text, uuid, integer)',
       'platform.can_manage_tenant_sync()']) f),
  true, 'Las RPC de consola son de authenticated, nunca de anon');
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('platform.tenant_sync_runs'::regclass, 'platform.tenant_sync_target_results'::regclass,
                  'platform.tenant_sync_findings'::regclass)),
  true, 'RLS habilitada y forzada en corridas, resultados y hallazgos');
select is(
  (select bool_or(has_table_privilege('authenticated', t, p))
     from unnest(array['platform.tenant_sync_runs', 'platform.tenant_sync_target_results',
                       'platform.tenant_sync_findings']) t,
          unnest(array['insert', 'update', 'delete']) p),
  false, 'authenticated no escribe ninguna tabla de la sincronización');
select is(
  (select bool_and(reloptions::text = '{security_invoker=true}') from pg_class
    where oid in ('platform.v_tenant_sync_targets'::regclass, 'platform.v_tenant_sync_findings'::regclass,
                  'platform.v_tenant_sync_runs'::regclass)),
  true, 'Las vistas son SECURITY INVOKER');
select is((select count(*)::int from cron.job where jobname = 'ebim-tenant-sync' and schedule = '30 10 * * *'),
  1, 'El job diario está programado (05:30 Lima)');

-- ---------------------------------------------------------------------------
-- Escenario: integración HTTP_M2M con lifecycle; alpha y p1 vinculados
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, provisioning_policy, enabled, status,
   lifecycle_path, lifecycle_write_scope, lifecycle_read_scope)
values (pg_temp.integ(), pg_temp.esup(), 'esupplier-m2m-sync', 'eSupplier · M2M (sync test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', 'MANUAL', true, 'READY',
        '/tenants/{controlPlaneTenantId}/lifecycle', 'esupplier:lifecycle:write', 'esupplier:lifecycle:read');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000f8', 'esupplier-sync-m2m-test', 'eSupplier M2M (sync test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = pg_temp.integ(),
       credential_profile_id = '71000000-0000-4000-a000-0000000000f8', base_url = 'http://127.0.0.1:54999'
 where id = pg_temp.target();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), pg_temp.target(), 'ext-alpha', 'ACTIVE', now(), true),
       (pg_temp.p1(), pg_temp.esup(), pg_temp.target(), 'ext-p1', 'ACTIVE', now(), true);

select throws_ok($$ update platform.product_integrations
                       set inventory_path = '/tenants', inventory_read_scope = 'esupplier:tenant:create'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope del inventario no puede ser el de alta');
select throws_ok($$ update platform.product_integrations set inventory_path = '/tenants' where id = pg_temp.integ() $$,
  '23514', null, 'Ruta y scope del inventario van juntos');

select pg_temp.act_as(pg_temp.alpha_admin());
select throws_ok($$ select platform.configure_inventory_integration(pg_temp.integ(), '/tenants', 'esupplier:tenants:list') $$,
  '42501', null, 'Un admin de tenant no configura el inventario');

select pg_temp.act_as(pg_temp.padmin());
select is(platform.configure_inventory_integration(pg_temp.integ(), '/tenants', 'esupplier:tenants:list'),
  pg_temp.integ(), 'EBIM_PRODUCT_ADMIN anuncia el inventario de la app');
select is((select count(*)::int from platform.audit_logs
            where action = 'INVENTORY_INTEGRATION_CONFIGURED' and entity_id = pg_temp.integ()::text), 1,
  'La configuración del inventario queda auditada');
select is(platform.can_manage_tenant_sync(), true, 'El admin de producto gestiona la sincronización');

select pg_temp.act_as(pg_temp.finance());
select is(platform.can_manage_tenant_sync(), false, 'Finanzas no gestiona la sincronización');

-- ---------------------------------------------------------------------------
-- Canal servidor: plan e inicio
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.tenant_sync_plan() $$, '42501', null,
  'Un usuario no lee el plan (configuración sensible)');

select pg_temp.act_as_service();
select is(
  (select jsonb_array_length(t -> 'links') || ':' || (t -> 'integration' ->> 'inventory_read_scope')
          || ':' || (t -> 'credential' ->> 'secret_ref')
     from jsonb_array_elements(platform.tenant_sync_plan()) t
    where t -> 'deployment' ->> 'id' = pg_temp.target()::text),
  '2:esupplier:tenants:list:LOCAL_ESUPPLIER_M2M_PRIVATE_KEY',
  'El plan trae los 2 vínculos activos, el canal de inventario y el NOMBRE del secreto');
select is(
  (select l ->> 'expected_state' from jsonb_array_elements(platform.tenant_sync_plan()) t,
          jsonb_array_elements(t -> 'links') l
    where l ->> 'tenant_id' = pg_temp.alpha()::text),
  'ACTIVE', 'El plan dice qué estado debería tener la app');

select throws_ok($$ select platform.begin_tenant_sync_run('MANUAL', null) $$, '22023', null,
  'Una corrida manual exige quién la pidió');

create temp table run_ids (n int primary key, id uuid);
grant all on run_ids to service_role, authenticated;
insert into run_ids values (1, platform.begin_tenant_sync_run('SCHEDULED'));
select isnt((select id from run_ids where n = 1), null, 'El job abre una corrida');
select throws_ok($$ select platform.begin_tenant_sync_run('SCHEDULED') $$, '55P03', null,
  'No hay dos corridas a la vez');

-- ---------------------------------------------------------------------------
-- Corrida 1: alpha no existe, p1 suspendido en la app, un cliente desconocido
-- ---------------------------------------------------------------------------
select is(
  (platform.record_tenant_sync_target_result((select id from run_ids where n = 1), pg_temp.target(),
    jsonb_build_object(
      'verify_methods', jsonb_build_array('LIFECYCLE', 'INVENTORY', 'INVENTADO'),
      'links', jsonb_build_array(
        jsonb_build_object('mapping_id', (select id from platform.tenant_product_mappings
                                           where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup()),
                           'exists', 'NOT_FOUND', 'http_status', 404),
        jsonb_build_object('mapping_id', (select id from platform.tenant_product_mappings
                                           where tenant_id = pg_temp.p1() and saas_product_id = pg_temp.esup()),
                           'exists', 'FOUND', 'app_state', 'SUSPENDED'),
        jsonb_build_object('mapping_id', gen_random_uuid(), 'exists', 'NOT_FOUND')),
      'inventory', jsonb_build_object('status', 'AVAILABLE', 'complete', true, 'items', jsonb_build_array(
        jsonb_build_object('externalTenantId', 'EXT-P1', 'status', 'ACTIVE', 'name', 'P1'),
        jsonb_build_object('externalTenantId', 'ext-new', 'code', 'cliente-nuevo', 'name', 'Cliente Nuevo S.A.C.',
                           'status', 'ACTIVE'),
        jsonb_build_object('externalTenantId', 'ext-new', 'status', 'ACTIVE'),
        jsonb_build_object('name', 'sin id')))
    )) ->> 'outcome'),
  'WITH_FINDINGS', 'Un destino con diferencias queda WITH_FINDINGS');

select is(
  (select links_total || '/' || links_ok || '/' || links_broken || '/' || links_state_mismatch || '/'
          || inventory_items || '/' || inventory_unknown || '/' || findings_opened || '/' || array_to_string(verify_methods, ',')
     from platform.tenant_sync_target_results where run_id = (select id from run_ids where n = 1)),
  '2/0/1/1/2/1/3/INVENTORY,LIFECYCLE',
  'Conteos: 2 vínculos (1 roto, 1 estado distinto), 2 ítems únicos (1 desconocido); un mapping ajeno no cuenta');
select is(
  (select string_agg(kind || ':' || coalesce(masteradmin_state, '-') || '>' || coalesce(app_state, '-'), ',' order by kind)
     from platform.tenant_sync_findings where deployment_target_id = pg_temp.target() and status = 'OPEN'),
  'APP_ONLY:->ACTIVE,BROKEN_LINK:ACTIVE>-,STATE_MISMATCH:ACTIVE>SUSPENDED',
  'Se abren vínculo roto, estado distinto (MasterAdmin ACTIVE, app SUSPENDED) y cliente solo en la app');
select is(
  (select app_code || '|' || app_name from platform.tenant_sync_findings where kind = 'APP_ONLY' and status = 'OPEN'),
  'cliente-nuevo|Cliente Nuevo S.A.C.', 'El hallazgo «solo en la app» guarda código y nombre del cliente');
select throws_ok(
  format($$ select platform.record_tenant_sync_target_result(%L, pg_temp.target(), '{}'::jsonb) $$,
         (select id from run_ids where n = 1)),
  '23505', null, 'Un destino se registra una vez por corrida');

select is((platform.finish_tenant_sync_run((select id from run_ids where n = 1), null, 1)) ->> 'status',
  'COMPLETED', 'La corrida termina COMPLETED (con hallazgos no es un fallo)');
select is((select findings_opened || '/' || targets_checked from platform.tenant_sync_runs
            where id = (select id from run_ids where n = 1)), '3/1', 'La corrida resume lo abierto');
select throws_ok(
  format($$ select platform.record_tenant_sync_target_result(%L, pg_temp.target(), '{}'::jsonb) $$,
         (select id from run_ids where n = 1)),
  '55000', null, 'Una corrida cerrada no admite resultados');

-- ---------------------------------------------------------------------------
-- Corrida 2: todo existe y coincide, pero el inventario llegó incompleto
-- ---------------------------------------------------------------------------
insert into run_ids values (2, platform.begin_tenant_sync_run('SCHEDULED'));
select is(
  (platform.record_tenant_sync_target_result((select id from run_ids where n = 2), pg_temp.target(),
    jsonb_build_object(
      'verify_methods', jsonb_build_array('LIFECYCLE', 'INVENTORY'),
      'links', (select jsonb_agg(jsonb_build_object('mapping_id', id, 'exists', 'FOUND', 'app_state', 'ACTIVE'))
                  from platform.tenant_product_mappings where deployment_target_id = pg_temp.target()),
      'inventory', jsonb_build_object('status', 'AVAILABLE', 'complete', false, 'error_code', 'INVENTORY_TOO_LARGE',
                                      'items', '[]'::jsonb)
    )) ->> 'findings_closed')::int,
  2, 'Vínculo roto y estado distinto que ya no se ven se cierran solos');
select is(pg_temp.open_count('APP_ONLY'), 1, 'Un inventario incompleto NO cierra «solo en la app»');
select is(
  (select resolution || ':' || (resolved_by is null)::text from platform.tenant_sync_findings
    where kind = 'BROKEN_LINK' and deployment_target_id = pg_temp.target()),
  'NO_LONGER_DETECTED:true', 'El cierre automático no inventa una persona');
select is((platform.finish_tenant_sync_run((select id from run_ids where n = 2))) ->> 'status',
  'PARTIAL', 'Inventario incompleto = corrida PARTIAL');

-- ---------------------------------------------------------------------------
-- Corrida 3: el mismo cliente vuelve a aparecer (dedup) y aparece otro
-- ---------------------------------------------------------------------------
insert into run_ids values (3, platform.begin_tenant_sync_run('SCHEDULED'));
select platform.record_tenant_sync_target_result((select id from run_ids where n = 3), pg_temp.target(),
  jsonb_build_object(
    'verify_methods', jsonb_build_array('INVENTORY'),
    'inventory', jsonb_build_object('status', 'AVAILABLE', 'complete', true, 'items', jsonb_build_array(
      jsonb_build_object('externalTenantId', 'ext-alpha', 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'x-otra', 'controlPlaneTenantId', pg_temp.p1(), 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'ext-new', 'code', 'cliente-nuevo', 'name', 'Cliente Nuevo S.A.C.', 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'ext-demo', 'code', 'demo', 'name', 'Demo SAC', 'status', 'ACTIVE')))));
select platform.finish_tenant_sync_run((select id from run_ids where n = 3));
select is(
  (select string_agg(external_tenant_id || ':' || times_seen, ',' order by external_tenant_id)
     from platform.tenant_sync_findings where kind = 'APP_ONLY' and status = 'OPEN'),
  'ext-demo:1,ext-new:2', 'Una diferencia vista dos veces es UNA fila; la app que apunta a un tenant vinculado no cuenta');
select is(pg_temp.open_count('BROKEN_LINK'), 0, 'Con el inventario completo, los vínculos que aparecen existen');

-- ---------------------------------------------------------------------------
-- Consola: quién ve los hallazgos
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select is((select count(*)::int from platform.list_tenant_sync_findings('OPEN', null, 50)), 2,
  'El admin de producto lista los hallazgos abiertos');
select is((select last_outcome || ':' || inventory_available::text || ':' || open_findings
             from platform.v_tenant_sync_targets where deployment_target_id = pg_temp.target()),
  'WITH_FINDINGS:true:2', 'La vista por app muestra la última revisión y que la app anuncia inventario');
select pg_temp.act_as(pg_temp.alpha_admin());
select is((select count(*)::int from platform.v_tenant_sync_findings), 0, 'Un admin de tenant no ve hallazgos');
select is((select count(*)::int from platform.tenant_sync_runs), 0, 'Un admin de tenant no ve corridas');
select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.tenant_sync_findings), 0, 'Finanzas no ve hallazgos');

-- ---------------------------------------------------------------------------
-- Resolver / descartar con motivo
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.alpha_admin());
select throws_ok(
  format($$ select platform.resolve_tenant_sync_finding(%L, 'DISMISS', 'No me gusta') $$,
         (select id from platform.tenant_sync_findings where external_tenant_id = 'ext-demo' and status = 'OPEN')),
  '42501', null, 'Un admin de tenant no descarta hallazgos');

select pg_temp.act_as(pg_temp.padmin());
select throws_ok(
  format($$ select platform.resolve_tenant_sync_finding(%L, 'DISMISS', '  ') $$,
         (select id from platform.tenant_sync_findings where external_tenant_id = 'ext-demo' and status = 'OPEN')),
  '23502', null, 'Descartar exige motivo');
select lives_ok(
  format($$ select platform.resolve_tenant_sync_finding(%L, 'DISMISS', 'Datos de demostración de la app') $$,
         (select id from platform.tenant_sync_findings where external_tenant_id = 'ext-demo' and status = 'OPEN')),
  'El admin de producto descarta con motivo');
select is(
  (select status || ':' || resolution_reason || ':' || (resolved_by = pg_temp.padmin())::text
     from platform.tenant_sync_findings where external_tenant_id = 'ext-demo'),
  'DISMISSED:Datos de demostración de la app:true', 'Queda descartado, con motivo y quién');
select is((select count(*)::int from platform.audit_logs where action = 'TENANT_SYNC_FINDING_DISMISSED'), 1,
  'El descarte queda auditado');

-- Lo descartado sigue descartado aunque la app lo siga mostrando.
select pg_temp.act_as_service();
insert into run_ids values (4, platform.begin_tenant_sync_run('SCHEDULED'));
select platform.record_tenant_sync_target_result((select id from run_ids where n = 4), pg_temp.target(),
  jsonb_build_object('verify_methods', jsonb_build_array('INVENTORY'),
    'inventory', jsonb_build_object('status', 'AVAILABLE', 'complete', true, 'items', jsonb_build_array(
      jsonb_build_object('externalTenantId', 'ext-alpha', 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'ext-p1', 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'ext-new', 'code', 'cliente-nuevo', 'name', 'Cliente Nuevo S.A.C.', 'status', 'ACTIVE'),
      jsonb_build_object('externalTenantId', 'ext-demo', 'status', 'ACTIVE')))));
select platform.finish_tenant_sync_run((select id from run_ids where n = 4));
select is(
  (select string_agg(status || ':' || times_seen, ',') from platform.tenant_sync_findings where external_tenant_id = 'ext-demo'),
  'DISMISSED:2', 'Un descartado visto otra vez no reabre nada');

-- ---------------------------------------------------------------------------
-- Registrar en el Admin Maestro (sin llamar a la app)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_ok(
  format($$ select platform.register_tenant_sync_finding(%L, 'cliente-nuevo-esupplier', 'Cliente Nuevo · eSupplier',
                     'admin@clientenuevo.ebim.test', null, 'cliente-nuevo', 'Cliente Nuevo S.A.C.', null, 'PE') $$,
         (select id from platform.tenant_sync_findings where external_tenant_id = 'ext-new' and status = 'OPEN')),
  '42501', null, 'Finanzas no registra clientes desde la sincronización');

select pg_temp.act_as(pg_temp.padmin());
create temp table reg as
select platform.register_tenant_sync_finding(
         (select id from platform.tenant_sync_findings where external_tenant_id = 'ext-new' and status = 'OPEN'),
         'cliente-nuevo-esupplier', 'Cliente Nuevo · eSupplier', 'admin@clientenuevo.ebim.test',
         null, 'cliente-nuevo', 'Cliente Nuevo S.A.C.', null, 'PE') as r;
select is(
  (select o.legal_name || '|' || t.slug || '|' || t.status::text
     from reg join platform.tenants t on t.id = (reg.r ->> 'tenant_id')::uuid
     join platform.organizations o on o.id = t.customer_organization_id),
  'Cliente Nuevo S.A.C.|cliente-nuevo-esupplier|ACTIVE', 'Crea la cuenta y el tenant, activo porque ya opera en la app');
select is(
  (select m.external_tenant_id || '|' || m.status::text || '|' || m.registered_manually::text || '|'
          || (m.deployment_target_id = pg_temp.target())::text
     from reg join platform.tenant_product_mappings m on m.id = (reg.r ->> 'mapping_id')::uuid),
  'ext-new|ACTIVE|true|true', 'El vínculo queda registrado a mano en el mismo destino');
select is(
  (select r.status::text || '|' || exists (select 1 from platform.saas_provisioning_events e
                                            where e.saas_provisioning_request_id = r.id
                                              and e.action = 'MANUAL_REGISTRATION')::text
     from reg join platform.saas_provisioning_requests r on r.id = (reg.r ->> 'request_id')::uuid),
  'ACTIVE|true', 'La solicitud recorre la máquina de estados como un alta manual');
select is(
  (select f.status || ':' || f.resolution || ':' || (f.registered_tenant_id = (reg.r ->> 'tenant_id')::uuid)::text
     from reg join platform.tenant_sync_findings f on f.id = (reg.r ->> 'finding_id')::uuid),
  'RESOLVED:REGISTERED:true', 'El hallazgo queda resuelto como registrado');
select throws_ok(
  format($$ select platform.register_tenant_sync_finding(%L, 'otro-slug', 'Otro', 'admin@otro.ebim.test',
                     null, 'otro', 'Otro S.A.C.', null, 'PE') $$, (select r ->> 'finding_id' from reg)),
  '55000', null, 'Un hallazgo ya registrado no se registra dos veces');

-- ---------------------------------------------------------------------------
-- Job programado
-- ---------------------------------------------------------------------------
select throws_ok($$ select platform.set_tenant_sync_enabled(false) $$, '42501', null,
  'Solo el super admin apaga la sincronización diaria');
select pg_temp.act_as(pg_temp.superadmin());
select is(platform.set_tenant_sync_enabled(false), false, 'El super admin la apaga');
select pg_temp.act_as_postgres();
select is(platform.invoke_scheduled_function('TENANT_SYNC') ->> 'outcome', 'SKIPPED_DISABLED',
  'Apagada, el job no llama a nadie');
update platform.tenant_lifecycle_settings set tenant_sync_enabled = true where id;
select ok(platform.invoke_scheduled_function('TENANT_SYNC') ->> 'outcome' in ('SKIPPED_NOT_CONFIGURED', 'DISPATCHED'),
  'Encendida, despacha o queda anotado que faltan los secretos del entorno');

select * from finish();
rollback;
