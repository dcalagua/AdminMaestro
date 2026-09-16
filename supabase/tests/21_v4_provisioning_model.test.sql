-- ============================================================================
-- V4 · Fase 21 — Modelo del plano de provisioning SaaS
-- ----------------------------------------------------------------------------
-- Qué fija este archivo, por orden de importancia:
--
--   1. MasterAdmin NO puede conectarse a la base de datos de un SaaS:
--      `DB_DIRECT` no existe como tipo de integración y no puede existir.
--   2. La base no puede guardar un secreto: `secret_ref` sólo admite forma de
--      NOMBRE, así que un PEM, un JWT o una clave base64 son imposibles.
--   3. `base_url` es configurable, pero NO arbitraria: la validación SSRF vive
--      en la base y ninguna interfaz puede saltársela.
--   4. La resolución de destino nunca elige al azar entre dos candidatos.
--   5. Cinco clics producen UNA solicitud, no cinco.
-- ============================================================================
begin;
select plan(106);

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

-- Actores del seed
create or replace function pg_temp.super_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.tech_lead()   returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.prov_admin()  returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000d'::uuid $$;
create or replace function pg_temp.ewm_owner()   returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000e'::uuid $$;

-- Objetos del seed
create or replace function pg_temp.p_ewm()       returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.p_esup()      returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.t_alpha_ewm() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.t_titan()     returns uuid language sql as $$ select '50000000-0000-4000-a000-00000000000d'::uuid $$;
create or replace function pg_temp.t_ewm_sur()   returns uuid language sql as $$ select '50000000-0000-4000-a000-00000000000c'::uuid $$;
create or replace function pg_temp.t_alpha_esup() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.d_ewm_dev()   returns uuid language sql as $$ select '40000000-0000-4000-a000-000000000007'::uuid $$;
create or replace function pg_temp.d_ewm_qas()   returns uuid language sql as $$ select '40000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.d_pacifico()  returns uuid language sql as $$ select '40000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.d_esup_dev()  returns uuid language sql as $$ select '40000000-0000-4000-a000-00000000000a'::uuid $$;
create or replace function pg_temp.i_mock()      returns uuid language sql as $$ select '70000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.i_http()      returns uuid language sql as $$ select '70000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.c_qas()       returns uuid language sql as $$ select '71000000-0000-4000-a000-000000000001'::uuid $$;

-- ===========================================================================
-- 0. NORMALIZACIÓN DEL PUNTO DE PARTIDA
-- ---------------------------------------------------------------------------
-- Este archivo corre dentro de una transacción que termina en ROLLBACK, así que
-- nada de lo que sigue sobrevive. Existe porque el E2E deja el stack local con
-- tenants ya provisionados y con la infraestructura dedicada de Titán
-- configurada: sin esto, `db:test` sólo pasaría inmediatamente después de un
-- `db:reset`, y un rojo por orden de ejecución no dice nada sobre el código.
--
-- El guard de transiciones se desactiva SÓLO para cerrar las solicitudes vivas
-- que dejó una ejecución anterior. Cerrarlas por la vía normal es imposible a
-- propósito: ACTIVE es terminal, que es justo la regla que este archivo verifica
-- más abajo.
-- ===========================================================================
select pg_temp.act_as_postgres();

alter table platform.saas_provisioning_requests disable trigger saas_prov_transition_guard;
update platform.saas_provisioning_requests
   set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Normalización de pgTAP'
 where status not in ('FAILED', 'CANCELLED');
alter table platform.saas_provisioning_requests enable trigger saas_prov_transition_guard;

-- El destino dedicado de Titán vuelve a "sin infraestructura", que es como lo
-- deja el seed y lo que exige el escenario de WAITING_INFRA.
update platform.deployment_targets
   set product_integration_id = null, credential_profile_id = null,
       provisioning_environment = null, base_url = null,
       provisioning_status = 'DRAFT', provisioning_enabled = false,
       health_status = 'UNKNOWN'
 where id = '40000000-0000-4000-a000-000000000006';

-- ===========================================================================
-- 1. FRONTERA DEL CONTROL PLANE
-- ===========================================================================
select is(
  (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'platform' and t.typname = 'integration_type'
     and e.enumlabel = 'DB_DIRECT'),
  0,
  'DB_DIRECT no existe como tipo de integración: MasterAdmin nunca toca la BD de un SaaS'
);

select set_eq(
  $$ select e.enumlabel::text from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'platform' and t.typname = 'integration_type' $$,
  array['HTTP_M2M', 'EDGE_FUNCTION', 'MANUAL', 'MOCK'],
  'Los tipos de integración admitidos son exactamente cuatro, y ninguno es directo a BD'
);

select is(
  (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'platform' and t.typname = 'm2m_algorithm'
     and e.enumlabel in ('none', 'HS256', 'HS384', 'HS512')),
  0,
  'El enum de algoritmos M2M no admite `none` ni ningún HMAC simétrico'
);

select set_eq(
  $$ select e.enumlabel::text from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'platform' and t.typname = 'm2m_algorithm' $$,
  array['RS256', 'ES256'],
  'Sólo algoritmos asimétricos: con un secreto compartido, quien verifica también emite'
);

-- Ninguna columna del schema puede oler a credencial de un SaaS.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'platform'
      and table_name in ('product_integrations', 'credential_profiles', 'deployment_targets',
                         'saas_provisioning_requests', 'tenant_product_mappings')
      and (column_name ~* '(password|private_key|service_role|connection_string|dsn|db_user|db_host)'
           -- `secret_ref` y `public_key_ref` son REFERENCIAS y están permitidas.
           and column_name not in ('secret_ref', 'public_key_ref'))),
  0,
  'Ninguna tabla del plano de provisioning tiene columna de credencial de SaaS'
);

-- ===========================================================================
-- 2. REFERENCIAS DE SECRETO, NUNCA SECRETOS
-- ===========================================================================
select ok(platform.is_secret_reference('EWM_QAS_M2M_PRIVATE_KEY'),
  'Un NOMBRE de secreto en mayúsculas es una referencia válida');
-- secrets-scan:allow encabezado PEM: el test exige que la base lo RECHACE
select ok(not platform.is_secret_reference('-----BEGIN PRIVATE KEY-----'),
  'Un encabezado PEM no pasa como referencia');
select ok(not platform.is_secret_reference('eyJhbGciOiJSUzI1NiJ9.eyJhIjoxfQ.firma'),
  'Un JWT no pasa como referencia');
select ok(not platform.is_secret_reference('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj'),
  'Una clave base64 no pasa como referencia (lleva minúsculas)');
-- secrets-scan:allow clave de pasarela inventada: el test exige que se RECHACE
select ok(not platform.is_secret_reference('sk_live_abcdef123456'),
  'Una clave secreta de pasarela no pasa como referencia');
select ok(not platform.is_secret_reference('AB'), 'Una referencia de 2 caracteres es demasiado corta');

select pg_temp.act_as_postgres();

select throws_ok(
  $$ insert into platform.credential_profiles (code, name, type, environment, secret_ref, algorithm, token_ttl_seconds)
     values ('intento-pem', 'Intento', 'M2M_ASYMMETRIC_JWT', 'QAS',
             -- secrets-scan:allow PEM sintético: el test exige que la base lo RECHACE
             '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkq-----END PRIVATE KEY-----', 'RS256', 300) $$,
  '23514', null,
  'La base RECHAZA guardar una clave privada en secret_ref, aunque sea el superusuario'
);

select throws_ok(
  $$ insert into platform.credential_profiles (code, name, type, environment, secret_ref, algorithm, token_ttl_seconds)
     values ('sin-alg', 'Sin algoritmo', 'M2M_ASYMMETRIC_JWT', 'QAS', 'ALGUN_SECRETO', null, 300) $$,
  '23514', null,
  'Un perfil M2M sin algoritmo no es un perfil M2M'
);

select throws_ok(
  $$ insert into platform.credential_profiles (code, name, type, environment, secret_ref)
     values ('none-con-ref', 'NONE con referencia', 'NONE', 'DEV', 'ALGUN_SECRETO') $$,
  '23514', null,
  'Tipo NONE significa NONE: no arrastra referencias de secreto'
);

select throws_ok(
  $$ insert into platform.credential_profiles (code, name, type, environment, secret_ref, algorithm, token_ttl_seconds)
     values ('ttl-eterno', 'TTL eterno', 'M2M_ASYMMETRIC_JWT', 'QAS', 'OTRO_SECRETO', 'RS256', 86400) $$,
  '23514', null,
  'El TTL de un token M2M está acotado: 86400 segundos no es un token de provisioning'
);

select is(
  (select secret_configured from platform.credential_profiles where id = pg_temp.c_qas()),
  true,
  'La columna derivada dice que la referencia está configurada, sin revelar cuál'
);

-- ===========================================================================
-- 3. VALIDACIÓN SSRF DE base_url (server-side)
-- ===========================================================================
select ok(platform.is_valid_provisioning_base_url('https://ewm-qas.example.invalid', 'QAS'),
  'HTTPS con host público es válido en QAS');
select ok(platform.is_valid_provisioning_base_url('https://api.example.com:8443/ewm', 'PRD'),
  'Puerto y prefijo de ruta son válidos');
select ok(platform.is_valid_provisioning_base_url('http://127.0.0.1:54321', 'DEV'),
  'DEV admite http y loopback: es donde corre el stack local');

select ok(not platform.is_valid_provisioning_base_url('http://api.example.com', 'PRD'),
  'PRD exige HTTPS: un token M2M en claro es un token regalado');
select ok(not platform.is_valid_provisioning_base_url('http://api.example.com', 'QAS'),
  'QAS también exige HTTPS');
select ok(not platform.is_valid_provisioning_base_url('https://169.254.169.254', 'PRD'),
  'El endpoint de metadatos del cloud está bloqueado: devuelve credenciales de la instancia');
select ok(not platform.is_valid_provisioning_base_url('https://metadata.google.internal', 'PRD'),
  'Y su alias DNS también');
select ok(not platform.is_valid_provisioning_base_url('https://localhost', 'PRD'),
  'localhost bloqueado fuera de DEV');
select ok(not platform.is_valid_provisioning_base_url('https://10.0.0.5', 'PRD'),
  'Rango privado 10/8 bloqueado');
select ok(not platform.is_valid_provisioning_base_url('https://192.168.1.10', 'QAS'),
  'Rango privado 192.168/16 bloqueado');
select ok(not platform.is_valid_provisioning_base_url('https://172.20.0.1', 'PRD'),
  'Rango privado 172.16-31 bloqueado');
select ok(platform.is_valid_provisioning_base_url('https://172.32.0.1', 'PRD'),
  '172.32 NO es privado: el bloqueo es exactamente 172.16-172.31');
select ok(not platform.is_valid_provisioning_base_url('https://db.internal', 'PRD'),
  'Dominios de red interna bloqueados');
select ok(not platform.is_valid_provisioning_base_url('file:///etc/passwd', 'DEV'),
  'file:// rechazado incluso en DEV');
select ok(not platform.is_valid_provisioning_base_url('ftp://host/x', 'DEV'),
  'ftp:// rechazado incluso en DEV');
select ok(not platform.is_valid_provisioning_base_url('https://user:pass@api.example.com', 'PRD'),
  'Credenciales embebidas en la URL rechazadas');
select ok(not platform.is_valid_provisioning_base_url('https://api.example.com?x=1', 'PRD'),
  'Query string rechazada: una base_url es una BASE');
select ok(not platform.is_valid_provisioning_base_url('https://api.example.com/', 'PRD'),
  'Barra final rechazada: componer base+ruta debe ser determinista');
select ok(not platform.is_valid_provisioning_base_url(E'https://api.example.com\nHost: evil', 'PRD'),
  'Salto de línea rechazado (inyección de cabecera)');
select ok(not platform.is_valid_provisioning_base_url('https://api.example.com:99999', 'PRD'),
  'Puerto fuera de rango rechazado');

select throws_ok(
  format($$ update platform.deployment_targets set base_url = 'http://169.254.169.254'
             where id = '%s' $$, pg_temp.d_ewm_qas()),
  '23514', null,
  'El CHECK de la tabla impide guardar una base_url insegura, aunque escriba el superusuario'
);

-- Rutas seguras
select ok(platform.is_safe_url_path('/internal/platform/v1/tenants'), 'Ruta relativa simple válida');
select ok(platform.is_safe_url_path('/v1/tenants/{externalTenantId}'), 'Marcador de plantilla válido');
select ok(not platform.is_safe_url_path('/v1/../../etc'), 'Escape con .. rechazado');
select ok(not platform.is_safe_url_path('//evil.com/v1'), 'Host relativo al protocolo rechazado');
select ok(not platform.is_safe_url_path('/v1?admin=1'), 'Query en la plantilla rechazada');
select ok(not platform.is_safe_url_path('/v1@evil.com'), 'Userinfo en la plantilla rechazado');
select ok(not platform.is_safe_url_path('v1/tenants'), 'Ruta no absoluta rechazada');

-- ===========================================================================
-- 4. COHERENCIA DE INTEGRACIÓN Y DESTINO
-- ===========================================================================
select throws_ok(
  format($$ update platform.deployment_targets
              set product_integration_id = '%s', provisioning_environment = 'QAS'
            where id = '%s' $$, pg_temp.i_mock(), pg_temp.d_ewm_qas()),
  '42501', null,
  'MOCK fuera de DEV se rechaza: declararía ACTIVE un tenant que no existe'
);

select throws_ok(
  format($$ update platform.deployment_targets
              set product_integration_id = '%s'
            where id = '%s' $$, pg_temp.i_mock(), pg_temp.d_esup_dev()),
  '23514', null,
  'Una integración de EWM no puede asociarse a un destino de eSupplier'
);

select throws_ok(
  format($$ update platform.deployment_targets set provisioning_status = 'READY'
             where id = '%s' $$, pg_temp.d_ewm_qas()),
  '23514', null,
  'Un destino HTTP_M2M con la credencial deshabilitada no puede declararse READY'
);

select throws_ok(
  format($$ update platform.deployment_targets set provisioning_enabled = true
             where id = '%s' $$, pg_temp.d_ewm_qas()),
  '23514', null,
  'Habilitado implica READY: no se enciende un destino a medio configurar'
);

select throws_ok(
  format($$ update platform.deployment_targets set timeout_ms = 600000 where id = '%s' $$,
         pg_temp.d_ewm_dev()),
  '23514', null,
  'Un timeout de 10 minutos bloquearía el orquestador: está acotado'
);

select throws_ok(
  $$ insert into platform.product_integrations
       (saas_product_id, code, name, integration_type, status, audience, algorithm, token_ttl_seconds)
     values ('20000000-0000-4000-a000-000000000002', 'incompleta', 'Incompleta', 'HTTP_M2M',
             'READY', 'x.ebim', 'RS256', 300) $$,
  '23514', null,
  'Una integración HTTP_M2M sin ruta de alta ni scope no puede declararse READY'
);

select throws_ok(
  $$ insert into platform.product_integrations
       (saas_product_id, code, name, integration_type, subject)
     values ('20000000-0000-4000-a000-000000000002', 'sujeto-humano', 'Sujeto humano', 'HTTP_M2M',
             'persona@ebim.pe') $$,
  '23514', null,
  'El `sub` del token identifica al SISTEMA: un correo no es un sujeto válido'
);

select throws_ok(
  $$ insert into platform.product_integrations
       (saas_product_id, code, name, integration_type, create_path_template)
     values ('20000000-0000-4000-a000-000000000002', 'ruta-insegura', 'Ruta insegura', 'HTTP_M2M',
             '/v1/../../admin') $$,
  '23514', null,
  'Una plantilla de ruta con escape se rechaza en la base'
);

-- ===========================================================================
-- 5. RESOLUCIÓN DE DESTINO (fase 34)
-- ===========================================================================
select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'DEV') ->> 'outcome'),
  'RESOLVED',
  'SHARED: alpha-ewm resuelve un destino único en DEV'
);
select is(
  (select (platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'DEV') ->> 'deployment_target_id')::uuid),
  pg_temp.d_ewm_dev(),
  'SHARED: resuelve exactamente ewm-shared-dev'
);

select is(
  (select platform.resolve_deployment_target(pg_temp.t_ewm_sur(), pg_temp.p_ewm(), 'DEV') ->> 'deployment_target_id'),
  pg_temp.d_pacifico()::text,
  'PARTNER_DEDICATED: ewm-sur resuelve al destino del partner que lo ADMINISTRA'
);

select is(
  (select platform.resolve_deployment_target(pg_temp.t_titan(), pg_temp.p_ewm(), 'DEV') ->> 'outcome'),
  'DEPLOYMENT_NOT_CONFIGURED',
  'TENANT_DEDICATED sin infraestructura: DEPLOYMENT_NOT_CONFIGURED, no un destino ajeno'
);

select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_esup(), 'DEV') ->> 'outcome'),
  'PRODUCT_MISMATCH',
  'Pedir el producto equivocado para un tenant se detecta, no se resuelve'
);

select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'PRD') ->> 'outcome'),
  'DEPLOYMENT_NOT_CONFIGURED',
  'Sin destino en PRD no se cae al de DEV'
);

select is(
  (select platform.resolve_deployment_target(
     '00000000-0000-4000-a000-000000000000', pg_temp.p_ewm(), 'DEV') ->> 'outcome'),
  'TENANT_NOT_FOUND',
  'Un tenant inexistente da TENANT_NOT_FOUND'
);

-- AMBIGÜEDAD: se crea un segundo destino SHARED de EWM en DEV.
insert into platform.deployment_targets
  (id, code, name, provider, deployment_mode, environment, saas_product_id, provisioning_environment)
values ('4f000000-0000-4000-a000-0000000000ff', 'ewm-shared-dev-bis', 'EWM DEV duplicado',
        'SUPABASE', 'SHARED', 'SANDBOX', '20000000-0000-4000-a000-000000000002', 'DEV');

select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'DEV') ->> 'outcome'),
  'DEPLOYMENT_AMBIGUOUS',
  'Con dos destinos válidos NO se elige el primero: se declara la ambigüedad'
);
select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'DEV') ->> 'deployment_target_id'),
  null,
  'Y no se devuelve ningún destino: elegir al azar provisiona en el sitio equivocado'
);
select throws_ok(
  format($$ select platform.require_deployment_target('%s', '%s', 'DEV') $$,
         pg_temp.t_alpha_ewm(), pg_temp.p_ewm()),
  '23514', null,
  'La variante estricta lanza DEPLOYMENT_AMBIGUOUS en vez de desempatar'
);

-- Un destino DISABLED deja de ser candidato y se resuelve la ambigüedad.
update platform.deployment_targets set provisioning_status = 'DISABLED'
 where id = '4f000000-0000-4000-a000-0000000000ff';
select is(
  (select platform.resolve_deployment_target(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 'DEV') ->> 'outcome'),
  'RESOLVED',
  'Al deshabilitar el duplicado, la resolución vuelve a ser única'
);
delete from platform.deployment_targets where id = '4f000000-0000-4000-a000-0000000000ff';

-- ===========================================================================
-- 6. IDEMPOTENCIA
-- ===========================================================================
select is(
  platform.build_provisioning_idempotency_key(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 1),
  platform.build_provisioning_idempotency_key(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 1),
  'La clave de idempotencia es DETERMINISTA: misma entrada, misma clave'
);
select isnt(
  platform.build_provisioning_idempotency_key(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 1),
  platform.build_provisioning_idempotency_key(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 2),
  'Un reprovisioning explícito (versión nueva) genera una clave distinta'
);
select isnt(
  platform.build_provisioning_idempotency_key(pg_temp.t_alpha_ewm(), pg_temp.p_ewm(), 1),
  platform.build_provisioning_idempotency_key(pg_temp.t_titan(), pg_temp.p_ewm(), 1),
  'Tenants distintos producen claves distintas'
);

select pg_temp.act_as(pg_temp.tech_lead());

select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Tech Lead crea la solicitud de provisioning'
);

-- Se cuentan las VIVAS, no todas: el invariante es «una solicitud viva por
-- tenant y producto». Las cerradas son historial y pueden ser muchas.
select is(
  (select count(*)::int from platform.saas_provisioning_requests
    where tenant_id = pg_temp.t_alpha_ewm() and saas_product_id = pg_temp.p_ewm()
      and status not in ('FAILED', 'CANCELLED')),
  1,
  'Una solicitud viva'
);

-- Cinco clics.
select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Segundo clic: no falla');
select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Tercer clic: no falla');
select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Cuarto clic: no falla');
select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_alpha_ewm()),
  'Quinto clic: no falla');

select is(
  (select count(*)::int from platform.saas_provisioning_requests
    where tenant_id = pg_temp.t_alpha_ewm() and saas_product_id = pg_temp.p_ewm()
      and status not in ('FAILED', 'CANCELLED')),
  1,
  'CINCO CLICS, UNA SOLICITUD VIVA: la idempotencia es real, no un comentario'
);

select is(
  (select status::text from platform.saas_provisioning_requests where tenant_id = pg_temp.t_alpha_ewm()),
  'READY_TO_PROVISION',
  'Con destino READY y política MANUAL, la solicitud queda lista para ejecutarse'
);

select pg_temp.act_as_postgres();
select throws_ok(
  format($$ insert into platform.saas_provisioning_requests
              (tenant_id, saas_product_id, idempotency_key, provisioning_environment)
            values ('%s', '%s', 'otra-clave-distinta', 'DEV') $$,
         pg_temp.t_alpha_ewm(), pg_temp.p_ewm()),
  '23505', null,
  'El índice único parcial impide una SEGUNDA solicitud viva del mismo tenant y producto'
);

select throws_ok(
  format($$ update platform.saas_provisioning_requests set idempotency_key = 'clave-cambiada'
             where tenant_id = '%s' $$, pg_temp.t_alpha_ewm()),
  '23514', null,
  'La clave de idempotencia no cambia dentro de la vida de una solicitud'
);

-- ===========================================================================
-- 7. MÁQUINA DE ESTADOS
-- ===========================================================================
select throws_ok(
  format($$ update platform.saas_provisioning_requests set status = 'ACTIVE', completed_at = now()
             where tenant_id = '%s' $$, pg_temp.t_alpha_ewm()),
  '23514', null,
  'No se salta de READY_TO_PROVISION a ACTIVE sin pasar por PROVISIONING'
);

update platform.saas_provisioning_requests set status = 'PROVISIONING'
 where tenant_id = pg_temp.t_alpha_ewm();
select is(
  (select started_at is not null from platform.saas_provisioning_requests
    where tenant_id = pg_temp.t_alpha_ewm()),
  true,
  'Al entrar en PROVISIONING se sella started_at automáticamente'
);

select throws_ok(
  format($$ update platform.saas_provisioning_requests set status = 'CANCELLED'
             where tenant_id = '%s' $$, pg_temp.t_alpha_ewm()),
  '23514', null,
  'Una llamada en vuelo NO se cancela: no sabemos si el alta se completó al otro lado'
);

update platform.saas_provisioning_requests set status = 'ACTIVE'
 where tenant_id = pg_temp.t_alpha_ewm();
select is(
  (select completed_at is not null from platform.saas_provisioning_requests
    where tenant_id = pg_temp.t_alpha_ewm()),
  true,
  'Al llegar a ACTIVE se sella completed_at automáticamente'
);

select throws_ok(
  format($$ update platform.saas_provisioning_requests set status = 'PROVISIONING'
             where tenant_id = '%s' $$, pg_temp.t_alpha_ewm()),
  '23514', null,
  'ACTIVE es terminal: no se vuelve a PROVISIONING'
);

select throws_ok(
  format($$ delete from platform.saas_provisioning_requests where tenant_id = '%s' $$,
         pg_temp.t_alpha_ewm()),
  '42501', null,
  'Sin DELETE físico: el historial de provisioning es evidencia, incluso para el superusuario'
);

select throws_ok(
  $$ delete from platform.saas_provisioning_events where true $$,
  '42501', null,
  'El timeline tampoco admite DELETE'
);

select throws_ok(
  $$ insert into platform.saas_provisioning_requests
       (tenant_id, saas_product_id, idempotency_key, provisioning_environment, status, last_error_code)
     values ('50000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-000000000002',
             'k-fallo-sin-codigo', 'DEV', 'FAILED', null) $$,
  '23514', null,
  'Un FAILED sin código de error es un fallo que nadie puede clasificar mañana'
);

-- ===========================================================================
-- 8. MAPEO EXTERNO
-- ===========================================================================
select throws_ok(
  $$ insert into platform.tenant_product_mappings
       (tenant_id, saas_product_id, status, external_tenant_id)
     values ('50000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-000000000002',
             'ACTIVE', null) $$,
  '23514', null,
  'Un mapeo ACTIVE sin identificador externo sería un éxito que nadie puede verificar'
);

select throws_ok(
  $$ insert into platform.tenant_product_mappings
       (tenant_id, saas_product_id, metadata)
     values ('50000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-000000000002',
             '{"api_key":"abc123"}'::jsonb) $$,
  '42501', null,
  'El guard anti-secretos rechaza metadata con pinta de credencial'
);

select lives_ok(
  $$ insert into platform.tenant_product_mappings
       (tenant_id, saas_product_id, metadata)
     values ('50000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-000000000002',
             '{"initialWarehouseId":"WH-01"}'::jsonb) $$,
  'Un recurso no sensible como initialWarehouseId sí se acepta'
);

-- ===========================================================================
-- 9. POLÍTICA DE PROVISIONING
-- ===========================================================================
select is(
  (platform.evaluate_provisioning_policy('MANUAL', null) ->> 'satisfied')::boolean,
  true,
  'MANUAL siempre se satisface: la decisión es de una persona con permiso'
);
select is(
  (platform.evaluate_provisioning_policy('AFTER_SUBSCRIPTION_ACTIVE', null) ->> 'reason'),
  'SUBSCRIPTION_REQUIRED',
  'Una política ligada a la suscripción exige una suscripción'
);
select is(
  (platform.evaluate_provisioning_policy('AFTER_PAYMENT_CONFIRMED',
     (select id from platform.subscriptions where status = 'DRAFT' limit 1)) ->> 'satisfied')::boolean,
  false,
  'Sin pago CONFIRMED no se provisiona: un pago PENDING es una promesa'
);
select is(
  (platform.evaluate_provisioning_policy('AFTER_SUBSCRIPTION_ACTIVE',
     (select id from platform.subscriptions where status = 'ACTIVE' limit 1)) ->> 'satisfied')::boolean,
  true,
  'Con la suscripción ACTIVE, la política se satisface'
);

-- ===========================================================================
-- 10. FLUJO DEDICADO (WAITING_INFRA → READY_TO_PROVISION)
-- ===========================================================================
select pg_temp.act_as(pg_temp.tech_lead());

select lives_ok(
  format($$ select platform.create_saas_provisioning_request('%s', 'DEV') $$, pg_temp.t_titan()),
  'Se puede crear la solicitud de un dedicado aunque no exista todavía su infraestructura'
);

select is(
  (select status::text from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()),
  'WAITING_INFRA',
  'El dedicado sin infraestructura queda en WAITING_INFRA, que es un estado del negocio y no un error'
);

select is(
  (select deployment_target_id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()),
  null,
  'Y sin destino asignado: no se le adjudica el de otro'
);

-- El Tech Lead registra la infraestructura del dedicado y la marca READY.
select lives_ok(
  format($$ select platform.configure_deployment_provisioning(
              '40000000-0000-4000-a000-000000000006', '%s', null, 'DEV', null, null, null,
              'READY', true, null) $$, pg_temp.i_mock()),
  'Tech Lead configura el destino dedicado de Titán y lo marca READY'
);

select is(
  (select status::text from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()),
  'READY_TO_PROVISION',
  'Al quedar lista la infraestructura, la solicitud se promueve SOLA a READY_TO_PROVISION'
);

select is(
  (select deployment_target_id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()),
  '40000000-0000-4000-a000-000000000006'::uuid,
  'Y queda apuntando al destino dedicado recién configurado'
);

select is(
  (select count(*)::int from platform.saas_provisioning_events e
    join platform.saas_provisioning_requests r on r.id = e.saas_provisioning_request_id
   where r.tenant_id = pg_temp.t_titan() and e.action = 'INFRA_READY'),
  1,
  'La promoción queda registrada en el timeline'
);

-- ===========================================================================
-- 11. PRECONDICIONES Y GUARDS DE AMBIENTE
-- ===========================================================================
select is(
  (platform.check_provisioning_preconditions(
     (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()))
   ->> 'can_execute')::boolean,
  true,
  'Con todo configurado, las precondiciones se cumplen'
);

select is(
  (platform.check_provisioning_preconditions(
     (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()))
   ->> 'adapter_type'),
  'MOCK',
  'Y el adaptador resuelto es el configurado en la integración del destino'
);

select pg_temp.act_as_postgres();
update platform.deployment_targets set health_status = 'UNHEALTHY'
 where id = '40000000-0000-4000-a000-000000000006';
select ok(
  (platform.check_provisioning_preconditions(
     (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()))
   -> 'blockers') @> '["DEPLOYMENT_UNHEALTHY"]'::jsonb,
  'Un destino UNHEALTHY bloquea la ejecución y lo dice con un código'
);

update platform.deployment_targets set health_status = 'UNKNOWN'
 where id = '40000000-0000-4000-a000-000000000006';
select is(
  (platform.check_provisioning_preconditions(
     (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()))
   ->> 'can_execute')::boolean,
  true,
  'UNKNOWN NO bloquea: hay productos sin /health y inventar un HEALTHY sería peor'
);

update platform.deployment_targets set provisioning_enabled = false, provisioning_status = 'MAINTENANCE'
 where id = '40000000-0000-4000-a000-000000000006';
select ok(
  (platform.check_provisioning_preconditions(
     (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan()))
   -> 'blockers') @> '["DEPLOYMENT_NOT_READY", "DEPLOYMENT_DISABLED"]'::jsonb,
  'Un destino en mantenimiento bloquea con dos códigos distinguibles'
);

-- ===========================================================================
-- 12. EL CONTEXTO DE EJECUCIÓN ES SÓLO DEL SERVIDOR
-- ===========================================================================
select pg_temp.act_as(pg_temp.super_admin());
select throws_ok(
  format($$ select platform.provisioning_execution_context('%s') $$,
         (select id from platform.saas_provisioning_requests where tenant_id = pg_temp.t_titan())),
  '42501', null,
  'Ni el super admin resuelve el contexto de ejecución desde el cliente: es del servidor'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('provisioning_execution_context', 'begin_saas_provisioning',
                        'complete_saas_provisioning', 'fail_saas_provisioning',
                        'record_provisioning_event', 'deployment_health_context')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'Ninguna función de ejecución está expuesta a authenticated por PostgREST'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('provisioning_execution_context', 'begin_saas_provisioning',
                        'complete_saas_provisioning', 'fail_saas_provisioning',
                        'record_provisioning_event', 'deployment_health_context')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  6,
  'Pero las seis sí las puede ejecutar service_role'
);

select * from finish();
rollback;
