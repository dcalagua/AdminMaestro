-- ============================================================================
-- EBIM Control Plane V4 — 39 · Destinos de provisioning y endurecimiento SSRF
-- ----------------------------------------------------------------------------
-- `platform.deployment_targets` YA modela la infraestructura física y ya
-- distingue SHARED / PARTNER_DEDICATED / TENANT_DEDICATED. Esta migración la
-- EXTIENDE con el eje de provisioning de aplicación: a qué URL se llama, con qué
-- integración, con qué perfil de credencial, con qué timeout y en qué estado de
-- salud. No se crea una tabla paralela: un destino es un destino.
--
-- PROBLEMA CENTRAL: `base_url` es configurable desde la UI. Eso convierte al
-- orquestador en un posible proxy SSRF — quien pueda editar un deployment podría
-- hacer que el servidor llame al endpoint de metadatos del cloud y devuelva
-- credenciales de la máquina.
--
-- Por eso la validación es SERVER-SIDE y en DOS capas:
--   1. aquí, en un CHECK de la base, que ninguna UI puede saltarse;
--   2. otra vez en la Edge Function antes de cada llamada (defensa en
--      profundidad, porque el CHECK no vuelve a evaluarse si mañana alguien
--      cambia las reglas sin revalidar las filas existentes).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Descomposición de URL (IMMUTABLE: se usa en CHECK)
-- ---------------------------------------------------------------------------

create or replace function platform.url_scheme(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(substring(p_url from '^([a-zA-Z][a-zA-Z0-9+.-]*)://'));
$$;

-- Autoridad = todo lo que hay entre `://` y la primera `/`. Incluye, si lo
-- hubiera, el `user:pass@` que precisamente queremos detectar y rechazar.
create or replace function platform.url_authority(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select split_part(regexp_replace(p_url, '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''), '/', 1);
$$;

create or replace function platform.url_host(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  -- Sin userinfo y sin puerto. Se normaliza a minúsculas porque los nombres de
  -- host son insensibles a mayúsculas y `LOCALHOST` debe bloquearse igual.
  select lower(split_part(
    case when platform.url_authority(p_url) like '%@%'
         then split_part(platform.url_authority(p_url), '@', 2)
         else platform.url_authority(p_url)
    end, ':', 1));
$$;

comment on function platform.url_host(text) is
  'Host de una URL, en minúsculas, sin userinfo ni puerto. La normalización es '
  'parte de la defensa: `LOCALHOST`, `localhost` y `user@localhost` deben caer '
  'en la misma comprobación.';

-- ---------------------------------------------------------------------------
-- 2. Hosts prohibidos para un destino de provisioning
-- ---------------------------------------------------------------------------
-- Esta lista no es paranoia decorativa. `169.254.169.254` es el endpoint de
-- metadatos de AWS/Azure/GCP: una llamada a esa IP desde el servidor devuelve
-- credenciales de la instancia. `metadata.google.internal` es su alias DNS.
-- ---------------------------------------------------------------------------
create or replace function platform.is_blocked_provisioning_host(p_host text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_host is null
      or p_host = ''
      -- Loopback
      or p_host in ('localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', '::')
      or p_host like '%.localhost'
      or p_host ~ '^127\.'
      -- Link-local IPv4 y metadatos de cloud
      or p_host ~ '^169\.254\.'
      or p_host in ('metadata.google.internal', 'metadata.goog', 'instance-data',
                    'instance-data.ec2.internal', 'metadata.azure.com')
      -- Link-local IPv6 y direcciones locales únicas
      or p_host ~ '^\[?fe80:'
      or p_host ~ '^\[?f[cd][0-9a-f]{2}:'
      -- Rangos privados RFC1918
      or p_host ~ '^10\.'
      or p_host ~ '^192\.168\.'
      or p_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
      -- CGNAT RFC6598
      or p_host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
      -- Dominios de red interna
      or p_host like '%.internal'
      or p_host like '%.local'
      or p_host like '%.home.arpa';
$$;

comment on function platform.is_blocked_provisioning_host(text) is
  'Hosts que el orquestador NUNCA debe llamar: loopback, link-local, metadatos '
  'de cloud (169.254.169.254 y sus alias DNS devuelven credenciales de la '
  'instancia), rangos privados y dominios de red interna. Sólo se relajan en DEV.';

-- ---------------------------------------------------------------------------
-- 3. Validación completa de base_url según el ambiente
-- ---------------------------------------------------------------------------
create or replace function platform.is_valid_provisioning_base_url(
  p_url text,
  p_env platform.provisioning_environment
)
returns boolean
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select
      p_url is not null
  and length(p_url) between 8 and 500
  -- Sólo http/https. Este ancla, por sí solo, elimina file://, ftp://, gopher://,
  -- data:, jar:, ldap:// y cualquier otro esquema.
  and p_url ~ '^https?://'
  -- Nada de espacios, saltos de línea ni caracteres de control: son el vector
  -- clásico de inyección de cabecera / división de petición.
  and p_url !~ '[[:space:][:cntrl:]]'
  -- Credenciales embebidas: `https://user:pass@host/…`. Prohibidas siempre.
  and platform.url_authority(p_url) not like '%@%'
  -- Sin query ni fragmento: una base_url es una BASE, no una petición.
  and p_url !~ '[?#]'
  -- Sin barra final, para que componer `base || path` sea determinista y no
  -- produzca `//` — que además cambiaría el host en algunos clientes.
  and p_url !~ '/$'
  -- Host sintácticamente válido: nombre DNS o literal IPv4. Los literales IPv6
  -- entre corchetes se rechazan a propósito: no hay ningún caso de uso y
  -- validarlos bien es mucha superficie para nada.
  and platform.url_host(p_url) ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  -- Puerto, si lo hay, numérico y en rango.
  and (
    platform.url_authority(p_url) !~ ':'
    or (split_part(platform.url_authority(p_url), ':', 2) ~ '^[0-9]{1,5}$'
        and split_part(platform.url_authority(p_url), ':', 2)::integer between 1 and 65535)
  )
  and case
    -- DEV es el ÚNICO ambiente donde se admite http:// y un host local: es
    -- donde corre el stack local y el adaptador MOCK.
    when p_env = 'DEV' then true
    -- DEMO, QAS y PRD: HTTPS obligatorio y ningún host interno.
    else platform.url_scheme(p_url) = 'https'
     and not platform.is_blocked_provisioning_host(platform.url_host(p_url))
  end;
$$;

comment on function platform.is_valid_provisioning_base_url(text, platform.provisioning_environment) is
  'Validación SERVER-SIDE de la base_url de un destino de provisioning. '
  'Rechaza esquemas que no sean http/https, credenciales embebidas, query, '
  'fragmento, espacios y barra final; exige HTTPS y host público en DEMO/QAS/PRD. '
  'La Edge Function vuelve a validar antes de cada llamada: esto es la primera '
  'capa, no la única.';

-- ---------------------------------------------------------------------------
-- 4. Extensión de deployment_targets
-- ---------------------------------------------------------------------------
-- Las columnas nuevas son NULLABLE o traen default: ninguna fila existente se
-- invalida y ninguna migración histórica se toca. `provisioning_status` arranca
-- en DRAFT, así que ningún destino heredado queda automáticamente habilitado.
-- ---------------------------------------------------------------------------
alter table platform.deployment_targets
  add column product_integration_id   uuid references platform.product_integrations (id) on delete restrict,
  add column credential_profile_id    uuid references platform.credential_profiles (id) on delete restrict,
  add column provisioning_environment platform.provisioning_environment,
  add column base_url                 text,
  add column timeout_ms               integer not null default 15000,
  add column retry_count              integer not null default 2,
  add column provisioning_status      platform.deployment_target_status not null default 'DRAFT',
  add column provisioning_enabled     boolean not null default false,
  add column health_status            platform.deployment_health not null default 'UNKNOWN',
  add column health_checked_at        timestamptz,
  add column health_detail            text,
  add column provisioning_policy      platform.provisioning_policy;

comment on column platform.deployment_targets.provisioning_environment is
  'Ambiente TÉCNICO (DEV/QAS/DEMO/PRD). Distinto de `environment`, que es la '
  'naturaleza COMERCIAL del entorno (DEMO/TRIAL/PRODUCTION/SANDBOX) y ya existía.';
comment on column platform.deployment_targets.provisioning_status is
  'Ciclo de vida del destino COMO DESTINO DE PROVISIONING. Distinto de `status` '
  '(entity_status), que describe el alta administrativa del target.';
comment on column platform.deployment_targets.provisioning_policy is
  'Anula la política de la integración para este destino concreto. NULL = hereda. '
  'Jerarquía: deployment > integración. Nunca hay un default en código.';
comment on column platform.deployment_targets.base_url is
  'Raíz del API de provisioning del SaaS, sin barra final. Configurable desde la '
  'UI pero validada por platform.is_valid_provisioning_base_url() y otra vez por '
  'la Edge Function. NO es una credencial y NO puede contener userinfo.';

alter table platform.deployment_targets
  add constraint deployment_targets_base_url_ck check (
    base_url is null
    or (provisioning_environment is not null
        and platform.is_valid_provisioning_base_url(base_url, provisioning_environment))
  ),
  -- Un timeout de 10 minutos convierte al orquestador en un recurso bloqueado.
  add constraint deployment_targets_timeout_ck check (timeout_ms between 1000 and 60000),
  add constraint deployment_targets_retry_ck check (retry_count between 0 and 5),
  -- Habilitado implica listo. Lo contrario sería un destino "encendido" al que
  -- le falta la mitad de la configuración.
  add constraint deployment_targets_enabled_ck check (
    not provisioning_enabled or provisioning_status = 'READY'
  );

create index deployment_targets_integration_ix on platform.deployment_targets (product_integration_id)
  where product_integration_id is not null;
create index deployment_targets_credential_ix on platform.deployment_targets (credential_profile_id)
  where credential_profile_id is not null;
-- Índice de resolución (fase 34): producto + ambiente + modo.
create index deployment_targets_resolution_ix
  on platform.deployment_targets (saas_product_id, provisioning_environment, deployment_mode)
  where provisioning_environment is not null;

-- ---------------------------------------------------------------------------
-- 5. Coherencia del destino de provisioning
-- ---------------------------------------------------------------------------
-- Un CHECK no puede consultar otras tablas; esto sí. Aquí se concentran todas
-- las reglas que cruzan destino ↔ integración ↔ credencial, para que no haya que
-- repetirlas en cada RPC ni confiar en que la UI las respete.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_deployment_provisioning_coherence()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_int  record;
  v_cred record;
begin
  -- Nada que validar si el destino no participa todavía del provisioning.
  if new.product_integration_id is null
     and new.credential_profile_id is null
     and new.base_url is null
     and new.provisioning_status = 'DRAFT' then
    return new;
  end if;

  if new.product_integration_id is not null then
    select * into v_int from platform.product_integrations where id = new.product_integration_id;

    if v_int.saas_product_id is distinct from new.saas_product_id then
      raise exception 'INTEGRACION_DE_OTRO_PRODUCTO: la integración % pertenece a otro producto SaaS que este destino',
        v_int.code using errcode = '23514';
    end if;

    -- GUARD DE AMBIENTE (fases 23 y 50). MOCK existe para ejercitar el flujo
    -- completo sin contactar a nadie; fuera de DEV sería un provisioning que
    -- REPORTA éxito sin haber creado nada. Falla cerrado.
    if v_int.integration_type = 'MOCK'
       and new.provisioning_environment is distinct from 'DEV' then
      raise exception 'MOCK_FUERA_DE_DEV: el adaptador MOCK sólo puede usarse en DEV; % no es un ambiente admitido',
        coalesce(new.provisioning_environment::text, 'sin ambiente') using errcode = '42501';
    end if;
  end if;

  if new.credential_profile_id is not null then
    select * into v_cred from platform.credential_profiles where id = new.credential_profile_id;

    if v_cred.saas_product_id is not null
       and v_cred.saas_product_id is distinct from new.saas_product_id then
      raise exception 'CREDENCIAL_DE_OTRO_PRODUCTO: el perfil % está acotado a otro producto SaaS',
        v_cred.code using errcode = '23514';
    end if;

    if new.provisioning_environment is not null
       and v_cred.environment is distinct from new.provisioning_environment then
      raise exception 'CREDENCIAL_DE_OTRO_AMBIENTE: el perfil % es de % y el destino es de %',
        v_cred.code, v_cred.environment, new.provisioning_environment using errcode = '23514';
    end if;
  end if;

  -- ---- Requisitos para declararse READY ----------------------------------
  if new.provisioning_status = 'READY' then
    if new.product_integration_id is null or new.provisioning_environment is null then
      raise exception 'DESTINO_INCOMPLETO: un destino READY necesita integración y ambiente de provisioning'
        using errcode = '23514';
    end if;

    if v_int.integration_type in ('HTTP_M2M', 'EDGE_FUNCTION') then
      if new.base_url is null then
        raise exception 'BASE_URL_REQUERIDA: una integración % exige base_url en el destino',
          v_int.integration_type using errcode = '23514';
      end if;
      if new.credential_profile_id is null then
        raise exception 'CREDENCIAL_REQUERIDA: una integración % exige un perfil de credencial',
          v_int.integration_type using errcode = '23514';
      end if;
      if v_cred.type <> 'M2M_ASYMMETRIC_JWT' then
        raise exception 'CREDENCIAL_INVALIDA: el perfil % es de tipo % y el M2M exige M2M_ASYMMETRIC_JWT',
          v_cred.code, v_cred.type using errcode = '23514';
      end if;
      if not v_cred.enabled then
        raise exception 'CREDENCIAL_DESHABILITADA: el perfil % no está habilitado', v_cred.code
          using errcode = '23514';
      end if;
      -- Redundante con el CHECK de la tabla, pero explícito: en QAS/PRD/DEMO no
      -- se acepta texto plano ni un host interno, y el mensaje lo dice.
      if new.provisioning_environment <> 'DEV'
         and not platform.is_valid_provisioning_base_url(new.base_url, new.provisioning_environment) then
        raise exception 'BASE_URL_INSEGURA: % no cumple las reglas de % (HTTPS obligatorio, host público)',
          new.base_url, new.provisioning_environment using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger deployment_targets_provisioning_coherence
  before insert or update of product_integration_id, credential_profile_id,
                             provisioning_environment, base_url, provisioning_status,
                             provisioning_enabled, saas_product_id
  on platform.deployment_targets
  for each row execute function platform.enforce_deployment_provisioning_coherence();

comment on function platform.enforce_deployment_provisioning_coherence() is
  'Reglas que cruzan destino ↔ integración ↔ credencial. Incluye el guard de '
  'ambiente que impide MOCK fuera de DEV: un MOCK en QAS reportaría ACTIVE sin '
  'haber creado nada en el SaaS real.';

-- ---------------------------------------------------------------------------
-- 6. Resolución de destino (fase 34)
-- ---------------------------------------------------------------------------
-- Devuelve un resultado EXPLÍCITO en vez de lanzar: el llamador decide si 0
-- candidatos significa "error" (SHARED mal configurado) o "todavía no hay
-- infraestructura" (TENANT_DEDICATED → WAITING_INFRA).
--
-- NUNCA se elige el primero de varios candidatos. Elegir arbitrariamente entre
-- dos destinos válidos es provisionar un tenant en el sitio equivocado y no
-- enterarse hasta que el cliente llama.
-- ---------------------------------------------------------------------------
create or replace function platform.resolve_deployment_target(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_environment platform.provisioning_environment
)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant     record;
  v_ids        uuid[];
  v_count      integer;
begin
  select t.id, t.deployment_mode, t.customer_organization_id, t.managing_organization_id,
         t.saas_product_id
    into v_tenant
    from platform.tenants t
   where t.id = p_tenant_id;

  if v_tenant.id is null then
    return jsonb_build_object('outcome', 'TENANT_NOT_FOUND', 'deployment_target_id', null,
                              'candidates', 0);
  end if;

  if v_tenant.saas_product_id is distinct from p_product_id then
    return jsonb_build_object('outcome', 'PRODUCT_MISMATCH', 'deployment_target_id', null,
                              'candidates', 0, 'deployment_mode', v_tenant.deployment_mode);
  end if;

  select array_agg(d.id order by d.code)
    into v_ids
    from platform.deployment_targets d
   where d.saas_product_id = p_product_id
     and d.provisioning_environment = p_environment
     and d.deployment_mode = v_tenant.deployment_mode
     and d.status = 'ACTIVE'
     and d.provisioning_status <> 'DISABLED'
     and case v_tenant.deployment_mode
           -- SHARED: un destino compartido no tiene dueño, por construcción.
           when 'SHARED' then d.owner_organization_id is null
           -- PARTNER_DEDICATED: el destino es del partner que ADMINISTRA el
           -- tenant, no de la organización cliente.
           when 'PARTNER_DEDICATED' then d.owner_organization_id = v_tenant.managing_organization_id
           -- TENANT_DEDICATED: el destino es de la organización CLIENTE.
           when 'TENANT_DEDICATED' then d.owner_organization_id = v_tenant.customer_organization_id
           else false
         end;

  v_count := coalesce(array_length(v_ids, 1), 0);

  if v_count = 0 then
    return jsonb_build_object(
      'outcome', 'DEPLOYMENT_NOT_CONFIGURED', 'deployment_target_id', null,
      'candidates', 0, 'deployment_mode', v_tenant.deployment_mode,
      'environment', p_environment);
  end if;

  if v_count > 1 then
    return jsonb_build_object(
      'outcome', 'DEPLOYMENT_AMBIGUOUS', 'deployment_target_id', null,
      'candidates', v_count, 'candidate_ids', to_jsonb(v_ids),
      'deployment_mode', v_tenant.deployment_mode, 'environment', p_environment);
  end if;

  return jsonb_build_object(
    'outcome', 'RESOLVED', 'deployment_target_id', v_ids[1], 'candidates', 1,
    'deployment_mode', v_tenant.deployment_mode, 'environment', p_environment);
end;
$$;

comment on function platform.resolve_deployment_target(uuid, uuid, platform.provisioning_environment) is
  'Resuelve el destino de provisioning a partir de tenant + producto + ambiente. '
  'Devuelve RESOLVED / DEPLOYMENT_NOT_CONFIGURED / DEPLOYMENT_AMBIGUOUS / '
  'PRODUCT_MISMATCH / TENANT_NOT_FOUND. Con 2 candidatos NO elige uno: un '
  'desempate arbitrario provisiona el tenant en el sitio equivocado en silencio.';

-- Variante estricta, para los llamadores que no tienen un plan B.
create or replace function platform.require_deployment_target(
  p_tenant_id uuid,
  p_product_id uuid,
  p_environment platform.provisioning_environment
)
returns uuid
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v jsonb := platform.resolve_deployment_target(p_tenant_id, p_product_id, p_environment);
begin
  if v ->> 'outcome' <> 'RESOLVED' then
    raise exception '%: no se pudo resolver un destino único para el tenant en % (candidatos: %)',
      v ->> 'outcome', p_environment, v ->> 'candidates' using errcode = '23514';
  end if;
  return (v ->> 'deployment_target_id')::uuid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Vista de configuración de destinos (sin secretos)
-- ---------------------------------------------------------------------------
-- `security_invoker = true` como todas las vistas del proyecto: la vista no es
-- una puerta trasera a RLS, sólo evita repetir el JOIN en cada pantalla.
-- NO incluye `secret_ref`: quien necesite la referencia pasa por la RPC que la
-- audita.
-- ---------------------------------------------------------------------------
create view platform.v_provisioning_targets
with (security_invoker = true) as
select
  d.id                          as deployment_target_id,
  d.code,
  d.name,
  d.saas_product_id,
  p.code                        as product_code,
  p.short_name                  as product_short_name,
  d.deployment_mode,
  d.owner_organization_id,
  o.display_name                as owner_organization_name,
  d.provisioning_environment,
  d.base_url,
  d.timeout_ms,
  d.retry_count,
  d.provisioning_status,
  d.provisioning_enabled,
  d.health_status,
  d.health_checked_at,
  d.health_detail,
  d.product_integration_id,
  i.code                        as integration_code,
  i.integration_type,
  i.contract_version,
  i.status                      as integration_status,
  i.enabled                     as integration_enabled,
  i.issuer,
  i.audience,
  i.subject,
  i.algorithm,
  i.token_ttl_seconds,
  i.create_scope,
  i.read_scope,
  i.create_path_template,
  i.status_path_template,
  i.health_path_template,
  d.credential_profile_id,
  c.code                        as credential_profile_code,
  c.type                        as credential_profile_type,
  c.enabled                     as credential_profile_enabled,
  -- Se expone si la referencia EXISTE, nunca cuál es ni cuánto vale. Se usa la
  -- columna derivada y no `secret_ref is not null` a propósito: con
  -- `security_invoker` el lector necesitaría privilegio sobre la columna del
  -- secreto, que es justamente lo que se le revoca.
  c.secret_configured           as credential_secret_configured,
  coalesce(d.provisioning_policy, i.provisioning_policy) as effective_provisioning_policy
from platform.deployment_targets d
join platform.saas_products p on p.id = d.saas_product_id
left join platform.organizations o on o.id = d.owner_organization_id
left join platform.product_integrations i on i.id = d.product_integration_id
left join platform.credential_profiles c on c.id = d.credential_profile_id;

comment on view platform.v_provisioning_targets is
  'Configuración efectiva de cada destino de provisioning. Expone que la '
  'referencia de secreto está configurada (booleano), jamás su nombre ni su '
  'valor. security_invoker: respeta la RLS de las tablas base.';
