-- ============================================================================
-- EBIM Control Plane V4 — 38 · Integraciones de producto, credenciales y
--                              propiedad técnica
-- ----------------------------------------------------------------------------
-- MasterAdmin se convierte en el ORQUESTADOR del provisioning de la suite.
--
-- REGLA DE ORO DE ESTA FASE (no negociable, y el schema la hace cumplir):
--   · MasterAdmin NO se conecta a la base de datos de ningún SaaS.
--   · MasterAdmin NO conoce las tablas internas de ningún SaaS.
--   · MasterAdmin NO almacena credenciales de PostgreSQL de ningún SaaS.
--   · MasterAdmin NO usa el `service_role` de ninguna aplicación.
--
-- Cada SaaS expone una API interna de provisioning y MasterAdmin habla contra un
-- CONTRATO ESTÁNDAR, no contra su tecnología (Java, Edge Function, FastAPI…).
--
-- LO QUE SÍ SE GUARDA: configuración. Endpoint, issuer, audience, algoritmo,
-- TTL, scopes, timeouts, reintentos, política, propietario técnico, estado.
-- LO QUE JAMÁS SE GUARDA: el VALOR de un secreto. Sólo su REFERENCIA
-- (`EWM_QAS_M2M_PRIVATE_KEY`), que la Edge Function resuelve server-side.
-- El CHECK de forma sobre `secret_ref` es lo que hace esa promesa verificable:
-- un PEM, un JWT o una clave real NO pasan la expresión regular.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

-- Tipo de integración. `DB_DIRECT` NO EXISTE Y NO DEBE EXISTIR: conectarse a la
-- base del SaaS rompe la frontera del Control Plane. El test 21 comprueba que
-- este enum nunca gane esa etiqueta.
create type platform.integration_type as enum (
  'HTTP_M2M',       -- API HTTP del SaaS autenticada con JWT asimétrico M2M
  'EDGE_FUNCTION',  -- reservado: invocación directa de una función del SaaS
  'MANUAL',         -- sin API todavía: el alta se registra a mano con auditoría
  'MOCK'            -- sólo LOCAL/DEV: ejercita el flujo sin contactar a nadie
);

comment on type platform.integration_type is
  'Cómo habla MasterAdmin con un SaaS. DB_DIRECT está PROHIBIDO por diseño y no '
  'figura en el enum: el Control Plane nunca toca la base de datos de un producto.';

create type platform.integration_status as enum (
  'DRAFT',     -- en configuración; no se puede provisionar
  'READY',     -- configuración completa y validada
  'DEGRADED',  -- operativa pero con salud comprometida
  'DISABLED'   -- apagada explícitamente
);

-- Ambiente de PROVISIONING. Eje distinto de `platform.environment_kind`
-- (DEMO/TRIAL/PRODUCTION/SANDBOX), que describe la naturaleza COMERCIAL del
-- tenant. Aquí se describe el ambiente TÉCNICO al que se apunta.
create type platform.provisioning_environment as enum ('DEV', 'QAS', 'DEMO', 'PRD');

comment on type platform.provisioning_environment is
  'Ambiente técnico del destino de provisioning. No sustituye a environment_kind: '
  'un tenant TRIAL (comercial) puede vivir en QAS o en PRD (técnico).';

create type platform.deployment_target_status as enum (
  'DRAFT', 'READY', 'MAINTENANCE', 'DISABLED'
);

create type platform.deployment_health as enum (
  'UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY'
);

comment on type platform.deployment_health is
  'UNKNOWN es el default HONESTO: si el producto no expone health y nadie ha '
  'verificado la conexión, no se inventa HEALTHY.';

create type platform.credential_profile_type as enum (
  'M2M_ASYMMETRIC_JWT',  -- MasterAdmin firma con clave privada; el SaaS verifica con la pública
  'NONE'                 -- sin credencial (MANUAL/MOCK)
);

-- Sólo algoritmos ASIMÉTRICOS. `none` y `HS256` quedan fuera a propósito: con
-- HS256 el secreto de firma sería compartido y cualquiera que pudiera verificar
-- podría también EMITIR tokens en nombre de MasterAdmin.
create type platform.m2m_algorithm as enum ('RS256', 'ES256');

comment on type platform.m2m_algorithm is
  'Algoritmos permitidos para el JWT M2M de provisioning. Deliberadamente NO '
  'incluye `none` ni HS256: la verificación debe ser con clave pública.';

create type platform.product_owner_role as enum (
  'TECHNICAL_OWNER', 'BACKUP_OWNER', 'VIEWER'
);

create type platform.provisioning_role as enum (
  'TECH_LEAD',            -- visión transversal de toda la suite
  'PROVISIONING_ADMIN',   -- opera provisioning de todos los productos
  'PRODUCT_OWNER',        -- sólo SU producto (se otorga vía product_owners)
  'PROVISIONING_VIEWER'   -- sólo lectura
);

create type platform.provisioning_policy as enum (
  'MANUAL',                    -- default seguro: alguien decide y pulsa
  'AFTER_SUBSCRIPTION_ACTIVE',
  'AFTER_PAYMENT_CONFIRMED'
);

comment on type platform.provisioning_policy is
  'Cuándo puede provisionarse. MANUAL es el default seguro hasta certificar el '
  'contrato de cada producto: crear una cotización NUNCA aprovisiona.';

-- ---------------------------------------------------------------------------
-- 2. Utilidades de validación (IMMUTABLE: se usan en CHECK constraints)
-- ---------------------------------------------------------------------------

-- Referencia a secreto, NO secreto. `EWM_QAS_M2M_PRIVATE_KEY` pasa; un PEM, un
-- JWT, una cadena base64 o cualquier cosa con minúsculas, puntos, barras o
-- guiones NO pasa. Esta expresión regular es la barrera estructural que hace
-- imposible "pegar la clave en el campo equivocado".
create or replace function platform.is_secret_reference(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_value ~ '^[A-Z][A-Z0-9_]{2,63}$';
$$;

comment on function platform.is_secret_reference(text) is
  'true si el texto tiene forma de NOMBRE de secreto (MAYUSCULAS_CON_GUION_BAJO). '
  'Un valor real de clave privada, un JWT o una clave base64 fallan siempre: '
  'llevan minúsculas, puntos, barras o guiones. Es la garantía verificable de '
  'que la columna guarda una referencia y no un secreto.';

-- Fragmento de ruta seguro para componer el endpoint bajo la base_url.
-- Impide escapar de la base (`..`), inyectar un host (`//`, `@`), colar un
-- esquema (`:`) o arrastrar query/fragmento.
create or replace function platform.is_safe_url_path(p_path text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_path ~ '^/[A-Za-z0-9._~/{}-]*$'
     and p_path !~ '//'
     and p_path !~ '\.\.'
     and p_path !~ '[?#@:\\]'
     and length(p_path) between 1 and 300;
$$;

comment on function platform.is_safe_url_path(text) is
  'Plantilla de ruta relativa segura. Sólo puede añadir segmentos bajo la '
  'base_url configurada: nada de `..`, `//`, `@`, `:` ni query/fragmento. '
  'La Edge Function vuelve a validarlo — esto es defensa en profundidad, no '
  'la única barrera.';

-- ---------------------------------------------------------------------------
-- 3. Catálogo de permisos (capa ADITIVA sobre los roles existentes)
-- ---------------------------------------------------------------------------
-- El modelo del baseline es por rol enumerado, no por permisos dinámicos
-- (decisión D-P02 del baseline). En vez de reescribirlo —lo que rompería
-- 37 migraciones y 537 tests— se añade un catálogo de permisos que SÓLO
-- gobierna este subsistema. Ningún rol existente cambia de alcance.
-- ---------------------------------------------------------------------------

create table platform.platform_permissions (
  code        text primary key,
  description text not null,
  created_at  timestamptz not null default now(),
  constraint platform_permissions_code_ck check (code ~ '^platform\.[a-z_]+\.[a-z_]+$')
);

comment on table platform.platform_permissions is
  'Catálogo cerrado de permisos del plano de provisioning. Una FK desde '
  'provisioning_role_permissions impide conceder un permiso que no existe: '
  'un typo es un error, no un permiso silenciosamente inexistente.';

insert into platform.platform_permissions (code, description) values
  ('platform.integration.read',      'Ver integraciones de producto y su configuración no secreta'),
  ('platform.integration.manage',    'Crear y editar integraciones de producto'),
  ('platform.deployment.read',       'Ver destinos de deployment y su configuración de provisioning'),
  ('platform.deployment.manage',     'Configurar destinos de deployment (base URL, credencial, estado)'),
  ('platform.provisioning.read',     'Ver solicitudes de provisioning y sus mapeos'),
  ('platform.provisioning.execute',  'Ejecutar el provisioning de un tenant contra un SaaS'),
  ('platform.provisioning.retry',    'Reintentar una solicitud fallida con la misma clave de idempotencia'),
  ('platform.provisioning.cancel',   'Cancelar una solicitud que todavía no se ha ejecutado'),
  ('platform.credentials.read',      'Ver metadata de perfiles de credencial (SIN la referencia del secreto)'),
  ('platform.credentials.manage',    'Administrar perfiles de credencial y su referencia de secreto'),
  ('platform.product_owner.manage',  'Asignar propietarios técnicos a un producto');

-- ---- Roles del plano de provisioning --------------------------------------
create table platform.provisioning_role_permissions (
  role            platform.provisioning_role not null,
  permission_code text not null references platform.platform_permissions (code) on delete cascade,
  primary key (role, permission_code)
);

comment on table platform.provisioning_role_permissions is
  'Qué puede cada rol. Es DATO, no código: ampliar un rol es un INSERT en una '
  'migración nueva, no un `if` repartido por la aplicación.';

insert into platform.provisioning_role_permissions (role, permission_code)
-- TECH_LEAD: visión y mando transversal sobre toda la suite.
select 'TECH_LEAD'::platform.provisioning_role, code from platform.platform_permissions
union all
-- PROVISIONING_ADMIN: opera todo salvo repartir la propiedad de los productos.
select 'PROVISIONING_ADMIN', code from platform.platform_permissions
 where code <> 'platform.product_owner.manage'
union all
-- PRODUCT_OWNER: manda en SU producto, pero no configura la plataforma.
-- Puede ejecutar, reintentar y cancelar lo suyo; no puede editar integraciones,
-- deployments ni credenciales de nadie — tampoco de su propio producto.
select 'PRODUCT_OWNER', code from platform.platform_permissions
 where code in (
   'platform.integration.read', 'platform.deployment.read',
   'platform.provisioning.read', 'platform.provisioning.execute',
   'platform.provisioning.retry', 'platform.provisioning.cancel',
   'platform.credentials.read'
 )
union all
-- PROVISIONING_VIEWER: mira y no toca.
select 'PROVISIONING_VIEWER', code from platform.platform_permissions
 where code in (
   'platform.integration.read', 'platform.deployment.read',
   'platform.provisioning.read', 'platform.credentials.read'
 );

-- ---- Membresías GLOBALES de rol -------------------------------------------
-- PRODUCT_OWNER NO se concede aquí: es un rol por producto y se otorga en
-- `platform.product_owners`. Un CHECK lo impide para que nadie se conceda
-- "propietario de producto" sin decir de qué producto.
create table platform.provisioning_role_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references platform.profiles (id) on delete cascade,
  role       platform.provisioning_role not null,
  granted_by uuid references platform.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provisioning_role_members_scope_ck check (role <> 'PRODUCT_OWNER')
);

create unique index provisioning_role_members_uk
  on platform.provisioning_role_members (user_id, role) where is_active;
create index provisioning_role_members_user_ix
  on platform.provisioning_role_members (user_id) where is_active;
create trigger provisioning_role_members_set_updated_at before update
  on platform.provisioning_role_members
  for each row execute function platform.set_updated_at();

comment on table platform.provisioning_role_members is
  'Roles GLOBALES del plano de provisioning. La propiedad por producto vive en '
  'product_owners: aquí sólo hay alcance transversal.';

-- ---------------------------------------------------------------------------
-- 4. product_integrations — cómo se integra MasterAdmin con cada SaaS
-- ---------------------------------------------------------------------------
create table platform.product_integrations (
  id                uuid primary key default gen_random_uuid(),
  saas_product_id   uuid not null references platform.saas_products (id) on delete restrict,
  code              text not null,
  name              text not null,
  integration_type  platform.integration_type not null,
  contract_version  text not null default 'v1',

  -- Propietario técnico visible. La AUTORIZACIÓN vive en product_owners; esto
  -- es a quién llamar cuando algo falla a las 3 de la mañana.
  owner_user_id     uuid references platform.profiles (id) on delete set null,
  owner_name        text,

  -- ---- Contrato M2M. TODO configurable; NADA hardcodeado. ----------------
  -- `issuer` por defecto masteradmin.ebim. `audience` NO tiene default: cada
  -- producto tiene la suya (`ewm.ebim`, `tms.ebim`, …) y adivinarla sería
  -- exactamente el hardcode que esta fase prohíbe.
  issuer            text not null default 'masteradmin.ebim',
  audience          text,
  subject           text not null default 'masteradmin-provisioning',
  algorithm         platform.m2m_algorithm,
  token_ttl_seconds integer,
  create_scope      text,
  read_scope        text,
  additional_scopes text[] not null default '{}'::text[],

  -- ---- Contrato HTTP -----------------------------------------------------
  -- Plantillas RELATIVAS. El host vive en el deployment, no aquí: el mismo
  -- contrato sirve a QAS, a PRD y al dedicado de un partner.
  create_path_template text,
  status_path_template text,
  health_path_template text,

  -- Allowlist de hosts para el guard SSRF. Vacío = sólo se admite el host de la
  -- propia base_url del deployment (comportamiento estricto por defecto).
  allowed_hosts     text[] not null default '{}'::text[],

  provisioning_policy platform.provisioning_policy not null default 'MANUAL',

  enabled           boolean not null default false,
  status            platform.integration_status not null default 'DRAFT',
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint product_integrations_code_ck check (platform.is_slug(code)),
  constraint product_integrations_contract_ck check (contract_version ~ '^v[0-9]+$'),
  constraint product_integrations_issuer_ck check (
    issuer ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
  ),
  constraint product_integrations_audience_ck check (
    audience is null or audience ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
  ),
  constraint product_integrations_subject_ck check (
    -- El `sub` identifica al SISTEMA, no a la persona. Un correo aquí sería un
    -- error de diseño: el humano viaja en `actor_id`, que es sólo auditoría.
    subject ~ '^[a-z][a-z0-9-]{2,63}$'
  ),
  -- TTL corto y acotado. Un token M2M de provisioning que vive una hora es un
  -- token robado que sirve una hora.
  constraint product_integrations_ttl_ck check (
    token_ttl_seconds is null or token_ttl_seconds between 30 and 300
  ),
  constraint product_integrations_paths_ck check (
    (create_path_template is null or platform.is_safe_url_path(create_path_template))
    and (status_path_template is null or platform.is_safe_url_path(status_path_template))
    and (health_path_template is null or platform.is_safe_url_path(health_path_template))
  ),
  -- Una integración HTTP_M2M no puede declararse READY a medias. Si falta la
  -- audience, el algoritmo, el TTL, la ruta de alta o el scope de creación, la
  -- configuración está incompleta y el estado honesto es DRAFT.
  constraint product_integrations_http_ready_ck check (
    integration_type <> 'HTTP_M2M'
    or status <> 'READY'
    or (audience is not null and algorithm is not null and token_ttl_seconds is not null
        and create_path_template is not null and create_scope is not null)
  ),
  -- Un adaptador MANUAL/MOCK no debe arrastrar configuración criptográfica que
  -- nadie usa: es configuración muerta que mañana alguien cree activa.
  constraint product_integrations_no_crypto_ck check (
    integration_type in ('HTTP_M2M', 'EDGE_FUNCTION')
    or (algorithm is null and token_ttl_seconds is null and audience is null)
  ),
  constraint product_integrations_scopes_ck check (
    array_position(additional_scopes, null) is null
    and coalesce(array_length(additional_scopes, 1), 0) <= 10
  )
);

create unique index product_integrations_code_uk
  on platform.product_integrations (saas_product_id, code);
-- Un producto SÍ necesita varias integraciones habilitadas a la vez: MOCK en
-- DEV y HTTP_M2M en QAS/PRD es la topología normal, no una excepción. Lo que no
-- puede haber son dos del MISMO tipo y la MISMA versión de contrato habilitadas,
-- porque entonces «la integración HTTP_M2M v1 de EWM» dejaría de tener respuesta
-- única. Quién usa cuál lo decide cada destino, que la referencia explícitamente.
create unique index product_integrations_enabled_uk
  on platform.product_integrations (saas_product_id, integration_type, contract_version)
  where enabled;
create index product_integrations_product_ix
  on platform.product_integrations (saas_product_id);
create index product_integrations_owner_ix
  on platform.product_integrations (owner_user_id) where owner_user_id is not null;

create trigger product_integrations_set_updated_at before update
  on platform.product_integrations
  for each row execute function platform.set_updated_at();
create trigger product_integrations_no_secrets
  before insert or update of metadata on platform.product_integrations
  for each row execute function platform.reject_secret_like_json('metadata');

comment on table platform.product_integrations is
  'CONTRATO de integración entre MasterAdmin y un SaaS. Guarda configuración '
  '(endpoint relativo, issuer, audience, algoritmo, TTL, scopes, política), '
  'nunca secretos ni lógica interna del producto. El host concreto vive en el '
  'deployment: el mismo contrato sirve a QAS, PRD y al dedicado de un partner.';
comment on column platform.product_integrations.allowed_hosts is
  'Allowlist SSRF adicional. Vacío = sólo el host de la base_url del deployment.';
comment on column platform.product_integrations.subject is
  'Claim `sub` del JWT M2M: identifica al SISTEMA (masteradmin-provisioning). '
  'El humano que inició la operación viaja en `actor_id`, que es AUDITORÍA y no '
  'autoriza por sí mismo.';

-- ---------------------------------------------------------------------------
-- 5. credential_profiles — REFERENCIAS a secretos, jamás secretos
-- ---------------------------------------------------------------------------
create table platform.credential_profiles (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  name              text not null,
  saas_product_id   uuid references platform.saas_products (id) on delete restrict,
  type              platform.credential_profile_type not null,
  environment       platform.provisioning_environment not null,

  -- NOMBRE del secreto en el almacén del servidor (Supabase Secrets / Vault /
  -- variables de entorno de la Edge Function). NUNCA su valor.
  secret_ref        text,
  public_key_ref    text,
  -- Columna DERIVADA para que la UI pueda decir "la referencia está
  -- configurada" sin tener privilegio de lectura sobre `secret_ref`. Es la
  -- pieza que permite revocar la columna del secreto a `authenticated` sin
  -- dejar la pantalla ciega.
  secret_configured boolean generated always as (secret_ref is not null) stored,

  algorithm         platform.m2m_algorithm,
  issuer            text,
  audience          text,
  token_ttl_seconds integer,
  enabled           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint credential_profiles_code_ck check (platform.is_slug(code)),
  -- secrets-scan:allow el comentario NOMBRA el encabezado que la regla rechaza
  -- LA barrera. Si alguien intenta pegar aquí un `-----BEGIN PRIVATE KEY-----`,
  -- un JWT o una clave base64, el INSERT falla: todos llevan minúsculas, puntos
  -- o guiones que la forma de referencia no admite.
  constraint credential_profiles_secret_ref_ck check (
    secret_ref is null or platform.is_secret_reference(secret_ref)
  ),
  constraint credential_profiles_public_key_ref_ck check (
    public_key_ref is null or platform.is_secret_reference(public_key_ref)
  ),
  constraint credential_profiles_m2m_ck check (
    type <> 'M2M_ASYMMETRIC_JWT'
    or (secret_ref is not null and algorithm is not null and token_ttl_seconds is not null)
  ),
  -- Tipo NONE significa NONE: no puede arrastrar referencias ni algoritmo.
  constraint credential_profiles_none_ck check (
    type <> 'NONE'
    or (secret_ref is null and public_key_ref is null and algorithm is null)
  ),
  constraint credential_profiles_ttl_ck check (
    token_ttl_seconds is null or token_ttl_seconds between 30 and 300
  ),
  constraint credential_profiles_issuer_ck check (
    issuer is null or issuer ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
  ),
  constraint credential_profiles_audience_ck check (
    audience is null or audience ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
  )
);

create unique index credential_profiles_code_uk on platform.credential_profiles (code);
create index credential_profiles_product_ix on platform.credential_profiles (saas_product_id)
  where saas_product_id is not null;
create index credential_profiles_env_ix on platform.credential_profiles (environment);

create trigger credential_profiles_set_updated_at before update
  on platform.credential_profiles
  for each row execute function platform.set_updated_at();

comment on table platform.credential_profiles is
  'Metadata de credencial M2M. `secret_ref` es el NOMBRE del secreto en el '
  'almacén del servidor, nunca su valor: un CHECK con forma de identificador en '
  'MAYÚSCULAS hace estructuralmente imposible guardar aquí una clave privada, un '
  'JWT o un service_role. La Edge Function resuelve el valor con Deno.env.get().';
comment on column platform.credential_profiles.secret_ref is
  'Ej.: EWM_QAS_M2M_PRIVATE_KEY. Se expone SÓLO a quien tiene '
  'platform.credentials.manage, y sólo a través de la RPC '
  'platform.reveal_credential_secret_ref(), que audita cada lectura. '
  '`authenticated` no tiene GRANT de SELECT sobre esta columna.';

-- ---------------------------------------------------------------------------
-- 6. product_owners — propiedad TÉCNICA por producto
-- ---------------------------------------------------------------------------
-- Independiente de los permisos globales: el owner de EWM ve la integración, los
-- deployments y el provisioning de EWM, y NO los de eSupplier.
-- ---------------------------------------------------------------------------
create table platform.product_owners (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete cascade,
  user_id          uuid not null references platform.profiles (id) on delete cascade,
  role             platform.product_owner_role not null default 'TECHNICAL_OWNER',
  -- NULL = todos los ambientes. Un owner puede estar acotado a QAS.
  environment_scope platform.provisioning_environment[],
  is_active        boolean not null default true,
  granted_by       uuid references platform.profiles (id) on delete set null,
  granted_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint product_owners_env_scope_ck check (
    environment_scope is null
    or (array_position(environment_scope, null) is null
        and array_length(environment_scope, 1) between 1 and 4)
  )
);

create unique index product_owners_uk
  on platform.product_owners (saas_product_id, user_id) where is_active;
create index product_owners_user_ix on platform.product_owners (user_id) where is_active;
create index product_owners_product_ix on platform.product_owners (saas_product_id) where is_active;

create trigger product_owners_set_updated_at before update on platform.product_owners
  for each row execute function platform.set_updated_at();

comment on table platform.product_owners is
  'Propiedad TÉCNICA de un producto. Da alcance a la integración, los '
  'deployments y el provisioning de ESE producto y de ninguno más. No es un rol '
  'de plataforma: un owner de EWM sigue sin ver eSupplier.';

-- ---------------------------------------------------------------------------
-- 7. Helpers de autorización (SECURITY DEFINER, search_path fijo, STABLE)
-- ---------------------------------------------------------------------------
-- Mismo patrón que la migración 08 del baseline: definer porque consultan
-- tablas con RLS, `search_path` fijo para que nadie shadowee una tabla, y
-- EXECUTE denegado a `anon`.
-- ---------------------------------------------------------------------------

-- ¿Viene esta llamada del SERVIDOR (Edge Function con clave de servicio)?
--
-- NO se puede usar `current_user` para esto: dentro de una función
-- SECURITY DEFINER, `current_user` es el PROPIETARIO de la función (postgres),
-- no quien llama — así que la comprobación siempre daría falso y las funciones
-- del orquestador serían inalcanzables incluso para el propio servidor.
-- `session_user` tampoco sirve: PostgREST siempre conecta como `authenticator`.
--
-- La señal fiable es el claim `role` del JWT, que PostgREST rellena a partir de
-- un token ya VERIFICADO criptográficamente. Un usuario normal no puede
-- falsificarlo: su token lleva `authenticated`.
create or replace function platform.is_service_request()
returns boolean
language sql
stable
set search_path = platform, pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

comment on function platform.is_service_request() is
  'true sólo si la llamada llega con la clave de servicio. Se lee del claim `role` '
  'del JWT verificado, no de current_user: dentro de una función SECURITY DEFINER '
  'current_user es siempre el propietario y la comprobación sería inútil.';

-- Permisos GLOBALES del usuario. El super admin los tiene todos por definición
-- (contrato §13: es único y transversal); el resto, por membresía explícita.
create or replace function platform.has_platform_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.is_super_admin()
      or exists (
        select 1
          from platform.provisioning_role_members m
          join platform.provisioning_role_permissions rp on rp.role = m.role
         where m.user_id = auth.uid() and m.is_active
           and rp.permission_code = p_code
      );
$$;

comment on function platform.has_platform_permission(text) is
  'Permiso TRANSVERSAL (todos los productos). Devuelve un booleano explícito: '
  'nunca se infiere autorización de "la consulta no dio error".';

-- Permiso ACOTADO A UN PRODUCTO: global, o por propiedad técnica de ese
-- producto. Es la función que hace real el aislamiento entre product owners.
create or replace function platform.has_product_permission(p_code text, p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.has_platform_permission(p_code)
      or (p_product is not null and exists (
        select 1
          from platform.product_owners po
          join platform.provisioning_role_permissions rp
            on rp.role = case po.role
                 when 'VIEWER' then 'PROVISIONING_VIEWER'::platform.provisioning_role
                 else 'PRODUCT_OWNER'::platform.provisioning_role
               end
         where po.user_id = auth.uid() and po.is_active
           and po.saas_product_id = p_product
           and rp.permission_code = p_code
      ));
$$;

comment on function platform.has_product_permission(text, uuid) is
  'Permiso sobre UN producto: global o por propiedad técnica. Un TECHNICAL_OWNER '
  'de EWM obtiene true para EWM y false para eSupplier — ese aislamiento es lo '
  'que verifican los tests de la fase.';

-- Productos sobre los que el usuario tiene ALGÚN alcance de provisioning.
-- Se usa en las políticas RLS para no repetir el mismo EXISTS en cada una.
create or replace function platform.my_provisioning_product_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select p.id
    from platform.saas_products p
   where platform.has_platform_permission('platform.provisioning.read')
  union
  select po.saas_product_id
    from platform.product_owners po
   where po.user_id = auth.uid() and po.is_active;
$$;

comment on function platform.my_provisioning_product_ids() is
  'Productos visibles en el plano de provisioning: todos si el permiso es '
  'transversal, sólo los propios si la visibilidad viene de product_owners.';

-- Roles efectivos, para que la UI no tenga que deducirlos y para auditoría.
create or replace function platform.my_provisioning_permissions()
returns jsonb
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select jsonb_build_object(
    'permissions', coalesce((
      select jsonb_agg(distinct code order by code)
        from platform.platform_permissions
       where platform.has_platform_permission(code)
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(distinct m.role::text order by m.role::text)
        from platform.provisioning_role_members m
       where m.user_id = auth.uid() and m.is_active
    ), '[]'::jsonb),
    'is_super_admin', platform.is_super_admin(),
    'owned_products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'saas_product_id', po.saas_product_id,
               'role', po.role::text,
               'environment_scope', po.environment_scope
             ) order by po.saas_product_id)
        from platform.product_owners po
       where po.user_id = auth.uid() and po.is_active
    ), '[]'::jsonb)
  );
$$;

comment on function platform.my_provisioning_permissions() is
  'Permisos EFECTIVOS del usuario actual. La UI los usa para no ofrecer botones '
  'que la base va a rechazar. Esto es UX: la autorización sigue estando en las '
  'RPCs y en RLS.';

-- ---------------------------------------------------------------------------
-- 8. Rol técnico del actor, para el claim de auditoría `actor_role`
-- ---------------------------------------------------------------------------
create or replace function platform.my_provisioning_actor_role()
returns text
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select case
    when platform.is_super_admin() then 'EBIM_SUPER_ADMIN'
    when exists (select 1 from platform.provisioning_role_members m
                  where m.user_id = auth.uid() and m.is_active and m.role = 'TECH_LEAD')
      then 'TECH_LEAD'
    when exists (select 1 from platform.provisioning_role_members m
                  where m.user_id = auth.uid() and m.is_active and m.role = 'PROVISIONING_ADMIN')
      then 'PROVISIONING_ADMIN'
    when exists (select 1 from platform.product_owners po
                  where po.user_id = auth.uid() and po.is_active
                    and po.role in ('TECHNICAL_OWNER', 'BACKUP_OWNER'))
      then 'PRODUCT_OWNER'
    when exists (select 1 from platform.provisioning_role_members m
                  where m.user_id = auth.uid() and m.is_active and m.role = 'PROVISIONING_VIEWER')
      then 'PROVISIONING_VIEWER'
    else 'NONE'
  end;
$$;

comment on function platform.my_provisioning_actor_role() is
  'Rol del actor para el claim `actor_role` del JWT M2M. Es AUDITORÍA: viaja '
  'para que el SaaS sepa quién pidió la operación, NO para que el SaaS decida '
  'autorización a partir de él.';
