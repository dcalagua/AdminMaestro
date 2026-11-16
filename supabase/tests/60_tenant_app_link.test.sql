-- ============================================================================
-- Vínculo en la app de las altas manuales (20261023000100)
--   · scope propio del vínculo, distinto de los demás y solo con inventario;
--   · configurar exige platform.integration.manage;
--   · el plan entrega el scope y, por vínculo, si es manual y su estado;
--   · record_tenant_app_link: canal servidor, solo altas manuales, auditoría
--     solo de los cambios.
-- Escenario: alpha y p1 (eSupplier del seed) en esupplier-shared-dev; alpha
-- registrado a mano, p1 dado de alta por el Admin Maestro.
-- ============================================================================
begin;
select plan(17);

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
create or replace function pg_temp.integ() returns uuid language sql as $$ select '70000000-0000-4000-a000-0000000000f9'::uuid $$;
create or replace function pg_temp.superadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.map_of(p_tenant uuid) returns uuid language sql as $$
  select id from platform.tenant_product_mappings where tenant_id = p_tenant and deployment_target_id = pg_temp.target()
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'platform.configure_tenant_link_integration(uuid, text)', 'execute')
  or not has_function_privilege('authenticated', 'platform.configure_tenant_link_integration(uuid, text)', 'execute'),
  false, 'Configurar el vínculo es de authenticated (con permiso), nunca de anon');
select is(
  (select bool_or(has_function_privilege(r, 'platform.record_tenant_app_link(uuid, text, integer, text)', 'execute'))
     from unnest(array['anon', 'authenticated']) r)
  or not has_function_privilege('service_role', 'platform.record_tenant_app_link(uuid, text, integer, text)', 'execute'),
  false, 'El resultado del vínculo solo lo escribe el canal servidor');

-- ---------------------------------------------------------------------------
-- Escenario
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, provisioning_policy, enabled, status,
   lifecycle_path, lifecycle_write_scope, lifecycle_read_scope)
values (pg_temp.integ(), pg_temp.esup(), 'esupplier-m2m-link', 'eSupplier · M2M (link test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', 'MANUAL', true, 'READY',
        '/tenants/{controlPlaneTenantId}/lifecycle', 'esupplier:lifecycle:write', 'esupplier:lifecycle:read');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000f9', 'esupplier-link-m2m-test', 'eSupplier M2M (link test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = pg_temp.integ(),
       credential_profile_id = '71000000-0000-4000-a000-0000000000f9', base_url = 'http://127.0.0.1:54999'
 where id = pg_temp.target();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), pg_temp.target(), 'ext-alpha', 'ACTIVE', now(), true),
       (pg_temp.p1(), pg_temp.esup(), pg_temp.target(), 'ext-p1', 'ACTIVE', now(), false);

-- ---------------------------------------------------------------------------
-- Scope del vínculo
-- ---------------------------------------------------------------------------
select throws_ok($$ update platform.product_integrations set tenant_link_scope = 'esupplier:tenants:link'
                     where id = pg_temp.integ() $$,
  '23514', null, 'Sin inventario no hay vínculo');

update platform.product_integrations
   set inventory_path = '/tenants', inventory_read_scope = 'esupplier:tenants:list'
 where id = pg_temp.integ();

select throws_ok($$ update platform.product_integrations set tenant_link_scope = 'esupplier:tenant:create'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope del vínculo no puede ser el de alta');
select throws_ok($$ update platform.product_integrations set tenant_link_scope = 'esupplier:tenants:list'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope del vínculo no puede ser el de lectura del inventario');
select throws_ok($$ update platform.product_integrations set tenant_link_scope = 'esupplier:lifecycle:write'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope del vínculo no puede ser el de lifecycle');

select pg_temp.act_as(pg_temp.alpha_admin());
select throws_ok($$ select platform.configure_tenant_link_integration(pg_temp.integ(), 'esupplier:tenants:link') $$,
  '42501', null, 'Un admin de tenant no configura el vínculo');

select pg_temp.act_as(pg_temp.superadmin());
select lives_ok($$ select platform.configure_tenant_link_integration(pg_temp.integ(), 'esupplier:tenants:link') $$,
  'El super admin configura el vínculo');

select pg_temp.act_as_postgres();
select is((select tenant_link_scope from platform.product_integrations where id = pg_temp.integ()),
  'esupplier:tenants:link', 'El scope queda guardado');
select is((select count(*)::int from platform.audit_logs
            where action = 'TENANT_LINK_INTEGRATION_CONFIGURED' and entity_id = pg_temp.integ()::text),
  1, 'La configuración queda en auditoría');

-- ---------------------------------------------------------------------------
-- Plan
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  (select t -> 'integration' ->> 'tenant_link_scope'
     from jsonb_array_elements(platform.tenant_sync_plan()) t
    where t -> 'deployment' ->> 'id' = pg_temp.target()::text),
  'esupplier:tenants:link', 'El plan entrega el scope del vínculo');
select is(
  (select string_agg((l ->> 'external_tenant_id') || ':' || (l ->> 'registered_manually') || ':'
                     || coalesce(l ->> 'app_link_status', 'null'), ',' order by l ->> 'external_tenant_id')
     from jsonb_array_elements(platform.tenant_sync_plan()) t,
          jsonb_array_elements(t -> 'links') l
    where t -> 'deployment' ->> 'id' = pg_temp.target()::text),
  'ext-alpha:true:null,ext-p1:false:null', 'Por vínculo: si es manual y su estado en la app');

-- ---------------------------------------------------------------------------
-- Resultado del vínculo
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.superadmin());
select throws_ok($$ select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.alpha()), 'LINKED') $$,
  '42501', null, 'Ni el super admin escribe el resultado del vínculo');

select pg_temp.act_as_service();
select throws_ok($$ select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.p1()), 'LINKED') $$,
  '23514', null, 'Un alta del Admin Maestro no se vincula');

select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.alpha()), 'FAILED', 409, 'LINK_CONFLICT');
select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.alpha()), 'FAILED', 409, 'LINK_CONFLICT');
select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.alpha()), 'LINKED', 200, null);
select platform.record_tenant_app_link(pg_temp.map_of(pg_temp.alpha()), 'LINKED', 200, null);

select pg_temp.act_as_postgres();
select is(
  (select app_link_status || ':' || (app_linked_at is not null) || ':' || coalesce(app_link_error, 'null')
     from platform.tenant_product_mappings where id = pg_temp.map_of(pg_temp.alpha())),
  'LINKED:true:null', 'El vínculo confirmado limpia el error y fija la fecha');
select is(
  (select string_agg(action, ',' order by occurred_at, action) from platform.audit_logs
    where entity_type = 'tenant_product_mapping' and entity_id = pg_temp.map_of(pg_temp.alpha())::text),
  'TENANT_APP_LINK_FAILED,TENANT_APP_LINKED', 'Solo los cambios quedan en auditoría (sin repetidos)');
select is(
  (select l ->> 'app_link_status'
     from jsonb_array_elements(platform.tenant_sync_plan()) t,
          jsonb_array_elements(t -> 'links') l
    where t -> 'deployment' ->> 'id' = pg_temp.target()::text and l ->> 'external_tenant_id' = 'ext-alpha'),
  'LINKED', 'La siguiente corrida ya no lo vuelve a vincular');

select * from finish();
rollback;
