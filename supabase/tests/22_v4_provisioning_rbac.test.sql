-- ============================================================================
-- V4 · Fase 22 — RBAC, RLS y aislamiento por producto
-- ----------------------------------------------------------------------------
-- La pregunta que responde este archivo es una sola, planteada de muchas
-- maneras: ¿puede el propietario técnico de EWM ver o tocar eSupplier?
--
-- La respuesta tiene que ser NO en todos los casos, y tiene que serlo en la
-- BASE — no en la interfaz. Por eso cada negativo se ejerce con el rol
-- `authenticated` y el JWT del usuario concreto, igual que lo haría PostgREST.
--
-- Se comprueba además la separación que sostiene todo lo demás:
--   · `secret_ref` no es legible por `authenticated` NI CON POLÍTICA PERMISIVA,
--     porque el privilegio que falta es de COLUMNA;
--   · ninguna tabla nueva admite escritura directa desde el navegador.
-- ============================================================================
begin;
select plan(76);

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
create or replace function pg_temp.finance()     returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.partner()     returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.tenant_user() returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000b'::uuid $$;
create or replace function pg_temp.prov_admin()  returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000d'::uuid $$;
create or replace function pg_temp.ewm_owner()   returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000e'::uuid $$;
create or replace function pg_temp.esup_owner()  returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000f'::uuid $$;

create or replace function pg_temp.p_ewm()  returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.p_esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.t_alpha_ewm()  returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.t_alpha_esup() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.d_ewm_dev()  returns uuid language sql as $$ select '40000000-0000-4000-a000-000000000007'::uuid $$;
create or replace function pg_temp.d_esup_dev() returns uuid language sql as $$ select '40000000-0000-4000-a000-00000000000a'::uuid $$;
create or replace function pg_temp.c_qas()      returns uuid language sql as $$ select '71000000-0000-4000-a000-000000000001'::uuid $$;

-- ===========================================================================
-- 0. LÍNEA BASE DE AUDITORÍA
-- ---------------------------------------------------------------------------
-- Las aserciones de la sección 10 miden el DELTA, no el total. El stack local
-- acumula bitácora de ejecuciones anteriores del E2E, y un total absoluto haría
-- que el resultado dependiera del orden en que se lanzan los gates — un rojo que
-- no dice nada sobre el código.
-- ===========================================================================
-- La línea base va en GUCs de sesión y no en una tabla temporal: la tabla la
-- crea `postgres` y las aserciones corren como `authenticated`, que no tiene
-- privilegio sobre ella. `current_setting()` lo lee cualquier rol.
do $DELTA$
declare
  v_action text;
begin
  foreach v_action in array array[
    'SAAS_PROVISIONING_REQUESTED', 'CREDENTIAL_PROFILE_CREATED', 'CREDENTIAL_SECRET_REF_REVEALED'
  ] loop
    perform set_config(
      'tests.audit_base_' || lower(v_action),
      (select count(*)::text from platform.audit_logs where action = v_action),
      false);
  end loop;
end;
$DELTA$;

create or replace function pg_temp.audit_delta(p_action text)
returns int language sql as $DELTA$
  select (select count(*)::int from platform.audit_logs where action = p_action)
       - coalesce(nullif(current_setting('tests.audit_base_' || lower(p_action), true), ''), '0')::int;
$DELTA$;

-- ===========================================================================
-- 1. ESTRUCTURA: RLS y ausencia de escritura directa
-- ===========================================================================
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform'
      and c.relname in ('product_integrations', 'credential_profiles', 'product_owners',
                        'saas_provisioning_requests', 'tenant_product_mappings',
                        'saas_provisioning_events', 'provisioning_role_members',
                        'provisioning_role_permissions', 'platform_permissions')
      and c.relrowsecurity and c.relforcerowsecurity),
  9,
  'Las 9 tablas nuevas tienen RLS habilitada Y forzada'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('product_integrations', 'credential_profiles', 'product_owners',
                         'saas_provisioning_requests', 'tenant_product_mappings',
                         'saas_provisioning_events', 'provisioning_role_members',
                         'provisioning_role_permissions', 'platform_permissions')
      and grantee in ('authenticated', 'anon', 'PUBLIC')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  'Ninguna tabla nueva admite escritura directa: toda escritura pasa por RPC'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('product_integrations', 'credential_profiles', 'product_owners',
                         'saas_provisioning_requests', 'tenant_product_mappings',
                         'saas_provisioning_events')
      and grantee in ('anon', 'PUBLIC')),
  0,
  'anon no tiene ningún privilegio sobre el plano de provisioning'
);

-- EL privilegio de columna. Esto es lo que hace estructuralmente imposible leer
-- el nombre del secreto desde el navegador.
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'platform' and table_name = 'credential_profiles'
      and column_name in ('secret_ref', 'public_key_ref')
      and grantee in ('authenticated', 'anon', 'PUBLIC')),
  0,
  'authenticated NO tiene privilegio de SELECT sobre secret_ref ni public_key_ref'
);

select ok(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'platform' and table_name = 'credential_profiles'
      and column_name = 'secret_configured' and grantee = 'authenticated'
      and privilege_type = 'SELECT') = 1,
  'Pero sí sobre la columna derivada que dice si la referencia está configurada'
);

select is(
  (select count(*)::int from pg_views
    where schemaname = 'platform' and viewname in ('v_provisioning_targets', 'v_saas_provisioning')),
  2,
  'Las dos vistas del plano de provisioning existen'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'v'
      and c.relname in ('v_provisioning_targets', 'v_saas_provisioning')
      and (select option_value from pg_options_to_table(c.reloptions)
            where option_name = 'security_invoker') = 'true'),
  2,
  'Y las dos son security_invoker: no son una puerta trasera a RLS'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and p.proname in ('has_platform_permission', 'has_product_permission',
                        'my_provisioning_product_ids', 'create_saas_provisioning_request',
                        'upsert_product_integration', 'upsert_credential_profile',
                        'configure_deployment_provisioning', 'register_manual_provisioning',
                        'retry_saas_provisioning_request', 'cancel_saas_provisioning_request',
                        'reveal_credential_secret_ref', 'provisioning_execution_context')
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                       where cfg = 'search_path=platform, pg_catalog')),
  0,
  'Toda RPC SECURITY DEFINER de V4 fija search_path = platform, pg_catalog'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon sigue sin poder ejecutar ninguna función de platform tras V4'
);

-- ===========================================================================
-- 2. CATÁLOGO DE PERMISOS
-- ===========================================================================
select is(
  (select count(*)::int from platform.platform_permissions),
  11,
  'El catálogo declara los 11 permisos del plano de provisioning'
);

select is(
  (select count(*)::int from platform.provisioning_role_permissions where role = 'TECH_LEAD'),
  11,
  'TECH_LEAD tiene visión y mando transversal: los 11 permisos'
);

select ok(
  not exists (select 1 from platform.provisioning_role_permissions
               where role = 'PROVISIONING_ADMIN'
                 and permission_code = 'platform.product_owner.manage'),
  'PROVISIONING_ADMIN opera todo salvo repartir la propiedad de los productos'
);

select ok(
  not exists (select 1 from platform.provisioning_role_permissions
               where role = 'PRODUCT_OWNER'
                 and permission_code in ('platform.integration.manage', 'platform.deployment.manage',
                                         'platform.credentials.manage', 'platform.product_owner.manage')),
  'PRODUCT_OWNER manda en SU producto pero no configura la plataforma'
);

select set_eq(
  $$ select permission_code from platform.provisioning_role_permissions
      where role = 'PROVISIONING_VIEWER' $$,
  array['platform.integration.read', 'platform.deployment.read',
        'platform.provisioning.read', 'platform.credentials.read'],
  'PROVISIONING_VIEWER mira y no toca'
);

select throws_ok(
  $$ insert into platform.provisioning_role_members (user_id, role)
     values ('10000000-0000-4000-a000-00000000000e', 'PRODUCT_OWNER') $$,
  '23514', null,
  'PRODUCT_OWNER no se concede como rol global: exige decir DE QUÉ producto'
);

-- ===========================================================================
-- 3. SUPER ADMIN: transversal por definición del contrato §13
-- ===========================================================================
select pg_temp.act_as(pg_temp.super_admin());
select ok(platform.has_platform_permission('platform.provisioning.execute'),
  'Super admin: ejecuta provisioning sin necesidad de membresía explícita');
select ok(platform.has_platform_permission('platform.product_owner.manage'),
  'Super admin: reparte propiedad técnica');
select is(platform.my_provisioning_actor_role(), 'EBIM_SUPER_ADMIN',
  'Y su rol de actor lo identifica como tal en la auditoría');

-- ===========================================================================
-- 4. TECH LEAD: visión transversal de toda la suite
-- ===========================================================================
select pg_temp.act_as(pg_temp.tech_lead());
select ok(platform.has_platform_permission('platform.integration.manage'),
  'Tech Lead: administra integraciones');
select ok(platform.has_product_permission('platform.provisioning.execute', pg_temp.p_ewm()),
  'Tech Lead: ejecuta provisioning de EWM');
select ok(platform.has_product_permission('platform.provisioning.execute', pg_temp.p_esup()),
  'Tech Lead: y también de eSupplier — su alcance es transversal');
select is(platform.my_provisioning_actor_role(), 'TECH_LEAD', 'Rol de actor TECH_LEAD');

select is(
  (select count(*)::int from platform.product_integrations),
  3,
  'Tech Lead ve las integraciones de TODOS los productos'
);

select is(
  (select count(*)::int from platform.credential_profiles),
  2,
  'Y todos los perfiles de credencial'
);

-- ===========================================================================
-- 5. PROVISIONING ADMIN
-- ===========================================================================
select pg_temp.act_as(pg_temp.prov_admin());
select ok(platform.has_platform_permission('platform.provisioning.execute'),
  'Provisioning Admin: ejecuta provisioning');
select ok(platform.has_platform_permission('platform.deployment.manage'),
  'Provisioning Admin: configura destinos');
select ok(not platform.has_platform_permission('platform.product_owner.manage'),
  'Provisioning Admin: NO reparte propiedad técnica');
select throws_ok(
  format($$ select platform.upsert_product_owner('%s', '%s', 'TECHNICAL_OWNER') $$,
         pg_temp.p_ewm(), pg_temp.finance()),
  '42501', null,
  'Y la RPC se lo niega, no sólo la interfaz'
);
select throws_ok(
  format($$ select platform.grant_provisioning_role('%s', 'TECH_LEAD') $$, pg_temp.finance()),
  '42501', null,
  'Tampoco puede fabricarse un Tech Lead: sólo el super admin reparte roles'
);

-- ===========================================================================
-- 6. AISLAMIENTO ENTRE PROPIETARIOS DE PRODUCTO — el corazón de la fase
-- ===========================================================================
select pg_temp.act_as(pg_temp.ewm_owner());

select ok(platform.has_product_permission('platform.provisioning.read', pg_temp.p_ewm()),
  'Owner de EWM: LEE el provisioning de EWM');
select ok(platform.has_product_permission('platform.provisioning.execute', pg_temp.p_ewm()),
  'Owner de EWM: EJECUTA el provisioning de EWM');
select ok(not platform.has_product_permission('platform.provisioning.read', pg_temp.p_esup()),
  'Owner de EWM: NO lee el provisioning de eSupplier');
select ok(not platform.has_product_permission('platform.provisioning.execute', pg_temp.p_esup()),
  'Owner de EWM: NO ejecuta el provisioning de eSupplier');
select ok(not platform.has_platform_permission('platform.provisioning.read'),
  'Owner de EWM: no tiene NINGÚN permiso transversal');
select ok(not platform.has_product_permission('platform.integration.manage', pg_temp.p_ewm()),
  'Owner de EWM: ni siquiera administra la integración de su propio producto');
select is(platform.my_provisioning_actor_role(), 'PRODUCT_OWNER', 'Rol de actor PRODUCT_OWNER');

select set_eq(
  $$ select saas_product_id::text from platform.product_integrations $$,
  array['20000000-0000-4000-a000-000000000002'],
  'RLS: el owner de EWM sólo VE la integración de EWM'
);

select is(
  (select count(*)::int from platform.credential_profiles
    where saas_product_id = pg_temp.p_esup()),
  0,
  'RLS: no ve perfiles de credencial de otro producto'
);

select is(
  (select count(*)::int from platform.deployment_targets d
    where d.saas_product_id = pg_temp.p_esup()
      and d.provisioning_environment is not null),
  0,
  'RLS: no ve los destinos de provisioning de eSupplier'
);

select ok(
  exists (select 1 from platform.deployment_targets where id = pg_temp.d_ewm_dev()),
  'Pero SÍ ve los destinos de EWM, aunque no pertenezca a ninguna organización implicada'
);

select throws_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_esup()),
  '42501', null,
  'El owner de EWM NO puede lanzar el provisioning de un tenant de eSupplier'
);

select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Pero sí el de un tenant de EWM'
);

select throws_ok(
  format($$ select platform.configure_deployment_provisioning('%s', null, null, 'DEV') $$,
         pg_temp.d_esup_dev()),
  '42501', null,
  'Ni configurar un destino de eSupplier'
);

select throws_ok(
  format($$ select platform.configure_deployment_provisioning('%s', null, null, 'DEV') $$,
         pg_temp.d_ewm_dev()),
  '42501', null,
  'Ni el suyo: configurar destinos es platform.deployment.manage, que un owner no tiene'
);

select throws_ok(
  format($$ select platform.reveal_credential_secret_ref('%s') $$, pg_temp.c_qas()),
  '42501', null,
  'Ver la referencia del secreto exige credentials.MANAGE, no credentials.read'
);

-- La otra dirección: el owner de eSupplier tampoco entra en EWM.
select pg_temp.act_as(pg_temp.esup_owner());
select ok(platform.has_product_permission('platform.provisioning.read', pg_temp.p_esup()),
  'Owner de eSupplier: lee lo suyo');
select ok(not platform.has_product_permission('platform.provisioning.read', pg_temp.p_ewm()),
  'Owner de eSupplier: NO lee EWM — el aislamiento es simétrico');
select set_eq(
  $$ select saas_product_id::text from platform.product_integrations $$,
  array['20000000-0000-4000-a000-000000000001'],
  'RLS: el owner de eSupplier sólo ve la integración de eSupplier'
);

-- ===========================================================================
-- 7. VIEWER
-- ===========================================================================
select pg_temp.act_as(pg_temp.finance());
select ok(platform.has_platform_permission('platform.provisioning.read'),
  'Finanzas (PROVISIONING_VIEWER): ve el estado de las altas');
select ok(not platform.has_platform_permission('platform.provisioning.execute'),
  'Finanzas: NO ejecuta ninguna');
select ok(not platform.has_platform_permission('platform.deployment.manage'),
  'Finanzas: NO configura destinos');
select throws_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  '42501', null,
  'Y la RPC se lo niega');
select is(platform.my_provisioning_actor_role(), 'PROVISIONING_VIEWER', 'Rol de actor VIEWER');

-- ===========================================================================
-- 8. NEGATIVOS: partner y usuario de tenant
-- ===========================================================================
select pg_temp.act_as(pg_temp.partner());
select ok(not platform.has_platform_permission('platform.provisioning.read'),
  'Un PARTNER_ADMIN no obtiene permisos del plano de provisioning por serlo');
select is(
  (select count(*)::int from platform.product_integrations),
  0,
  'Un partner no ve NINGUNA integración: no es asunto suyo cómo se integra la suite'
);
select is(
  (select count(*)::int from platform.credential_profiles),
  0,
  'Ni ningún perfil de credencial'
);
select throws_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  '42501', null,
  'Ni puede lanzar un provisioning');
select throws_ok(
  $$ select platform.upsert_product_integration(
       '20000000-0000-4000-a000-000000000002', 'pirata', 'Pirata', 'HTTP_M2M') $$,
  '42501', null,
  'Ni crear una integración');

select pg_temp.act_as(pg_temp.tenant_user());
select ok(not platform.has_platform_permission('platform.provisioning.execute'),
  'Un TENANT_USER tampoco: el permiso no se hereda de tener un tenant');
select is(
  (select count(*)::int from platform.product_integrations),
  0,
  'Un TENANT_USER no ve integraciones');
select throws_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  '42501', null,
  'Ni ejecuta provisioning de su propio tenant');
select throws_ok(
  format($$ select platform.set_deployment_health('%s', 'HEALTHY') $$, pg_temp.d_ewm_dev()),
  '42501', null,
  'Ni declara sano un destino');

-- ===========================================================================
-- 9. VISIBILIDAD LEGÍTIMA DEL CLIENTE SOBRE SU PROPIO TENANT
-- ===========================================================================
-- El cliente y el partner sí ven EN QUÉ ESTADO está el alta de SU tenant. Eso
-- es información suya. Lo que no ven es la configuración con la que se hizo.
-- ===========================================================================
-- `user@alpha.ebim.test` es TENANT_USER de alpha-esupplier, no de alpha-ewm:
-- por eso el escenario se monta sobre su propio tenant.
select pg_temp.act_as(pg_temp.tech_lead());
select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_esup()),
  'Tech Lead crea la solicitud de alpha-esupplier');

select pg_temp.act_as(pg_temp.tenant_user());
select is(
  (select count(*)::int from platform.saas_provisioning_requests
    where tenant_id = pg_temp.t_alpha_esup()),
  1,
  'El usuario del tenant ve el estado del alta de SU tenant'
);
select is(
  (select count(*)::int from platform.saas_provisioning_requests
    where tenant_id <> pg_temp.t_alpha_esup()),
  0,
  'Y de ningún otro: la solicitud de alpha-ewm creada antes le es invisible'
);
select is(
  (select count(*)::int from platform.deployment_targets d
    where d.provisioning_environment is not null and d.base_url is not null),
  0,
  'Pero no ve la base_url de ningún destino: la configuración no es suya'
);

-- ===========================================================================
-- 10. AUDITORÍA
-- ===========================================================================
select pg_temp.act_as(pg_temp.super_admin());
select is(
  pg_temp.audit_delta('SAAS_PROVISIONING_REQUESTED'),
  2,
  'Las dos solicitudes creadas en este archivo dejaron rastro en la bitácora'
);

select ok(
  (select metadata ? 'idempotency_key' and metadata ? 'actor_role'
     from platform.audit_logs where action = 'SAAS_PROVISIONING_REQUESTED' limit 1),
  'Y el rastro incluye la clave de idempotencia y el rol del actor'
);

select ok(
  not exists (
    select 1 from platform.audit_logs
     where metadata::text ~* '(BEGIN PRIVATE KEY|eyJhbGciOi|Bearer |service_role)'),
  'La bitácora no contiene claves, tokens ni cabeceras de autorización'
);

select ok(
  not exists (select 1 from platform.audit_logs where metadata::text like '%EWM_QAS_M2M_PRIVATE_KEY%'),
  'Ni siquiera el NOMBRE del secreto entra en la bitácora al crear un perfil'
);

select lives_ok(
  format($$ select platform.upsert_credential_profile('auditada', 'Auditada', 'M2M_ASYMMETRIC_JWT',
              'QAS', '%s', 'NUEVA_REFERENCIA_QAS', null, 'RS256', null, null, 300, false) $$,
         pg_temp.p_ewm()),
  'Super admin crea un perfil de credencial'
);

select ok(
  not exists (select 1 from platform.audit_logs where metadata::text like '%NUEVA_REFERENCIA_QAS%'),
  'El diff de auditoría EXCLUYE secret_ref: la bitácora tiene lectura más amplia'
);

select is(
  pg_temp.audit_delta('CREDENTIAL_PROFILE_CREATED'),
  1,
  'Pero el hecho de que se creó sí queda registrado'
);

select lives_ok(
  format($$ select platform.reveal_credential_secret_ref('%s') $$, pg_temp.c_qas()),
  'El super admin sí puede consultar la referencia');

select is(
  pg_temp.audit_delta('CREDENTIAL_SECRET_REF_REVEALED'),
  1,
  'Y cada consulta de la referencia queda auditada'
);

select is(
  (select (platform.reveal_credential_secret_ref(pg_temp.c_qas())) ->> 'secret_ref'),
  'EWM_QAS_M2M_PRIVATE_KEY',
  'La RPC devuelve el NOMBRE del secreto, que es lo único que esta base conoce'
);

select * from finish();
rollback;
