-- ============================================================================
-- EBIM Control Plane V4 — Adaptadores de contrato (spec 2026-09-21)
-- ----------------------------------------------------------------------------
-- SÓLO ADITIVA. Ninguna fila existente cambia de significado:
--   · `adapter_key` nace con default GENERIC, que es exactamente el
--     comportamiento anterior a esta migración;
--   · `product_configuration` nace con default '{}' y sólo la escribe una RPC
--     nueva, antes del primer envío;
--   · la expresión SQL de `payload` en `provisioning_execution_context` se
--     conserva carácter a carácter (sólo se añaden claves hermanas).
--
-- La lógica de cada contrato vive en el orquestador (codecs compilados). La
-- base sólo guarda QUÉ contrato se habla y los datos congelados de cada alta.
-- ============================================================================

-- ############################################################################
-- 1. Catálogo cerrado de adaptadores y columnas nuevas
-- ############################################################################
create type platform.integration_adapter as enum ('GENERIC', 'EWM_V1');

comment on type platform.integration_adapter is
  'Contrato de provisioning que habla una integración HTTP_M2M. GENERIC es el '
  'estándar EBIM v1; cualquier otro valor es un codec compilado del orquestador.';

alter table platform.product_integrations
  add column adapter_key platform.integration_adapter not null default 'GENERIC';
alter table platform.product_integrations
  add constraint product_integrations_adapter_ck
  check (adapter_key = 'GENERIC' or integration_type = 'HTTP_M2M');

comment on column platform.product_integrations.adapter_key is
  'Codec de contrato. Columna y no metadata: cambiarlo queda auditado por '
  'upsert_product_integration y no admite valores libres.';

alter table platform.saas_provisioning_requests
  add column product_configuration jsonb not null default '{}'::jsonb;
alter table platform.saas_provisioning_requests
  add constraint saas_prov_product_configuration_ck check (
    jsonb_typeof(product_configuration) = 'object'
    and octet_length(product_configuration::text) <= 4096
    and not jsonb_path_exists(product_configuration, 'strict $.**?(@.type() == "array")')
    and not jsonb_path_exists(product_configuration, '$.*.*.*')
  );

comment on column platform.saas_provisioning_requests.product_configuration is
  'Datos propios de un alta concreta (p. ej. almacén inicial), congelados antes '
  'del primer envío para que un reintento mande exactamente el mismo cuerpo. '
  'La base valida forma y tamaño; la semántica la valida el codec.';

-- ############################################################################
-- 2. upsert_product_integration con p_adapter_key
-- ----------------------------------------------------------------------------
-- Se elimina la firma anterior para no dejar una sobrecarga ambigua en
-- PostgREST. La nueva acepta exactamente las mismas llamadas: el parámetro
-- nuevo va al final, con default NULL, y NULL significa «no tocar»: GENERIC al
-- insertar y el valor guardado al actualizar.
-- ############################################################################
drop function platform.upsert_product_integration(uuid, text, text, platform.integration_type, text, uuid, text, text, text, text, platform.m2m_algorithm, integer, text, text, text[], text, text, text, text[], platform.provisioning_policy, boolean, platform.integration_status, jsonb, uuid);

create function platform.upsert_product_integration(
  p_saas_product_id      uuid,
  p_code                 text,
  p_name                 text,
  p_integration_type     platform.integration_type,
  p_contract_version     text default 'v1',
  p_owner_user_id        uuid default null,
  p_owner_name           text default null,
  p_issuer               text default 'masteradmin.ebim',
  p_audience             text default null,
  p_subject              text default 'masteradmin-provisioning',
  p_algorithm            platform.m2m_algorithm default null,
  p_token_ttl_seconds    integer default null,
  p_create_scope         text default null,
  p_read_scope           text default null,
  p_additional_scopes    text[] default '{}'::text[],
  p_create_path_template text default null,
  p_status_path_template text default null,
  p_health_path_template text default null,
  p_allowed_hosts        text[] default '{}'::text[],
  p_provisioning_policy  platform.provisioning_policy default 'MANUAL',
  p_enabled              boolean default false,
  p_status               platform.integration_status default 'DRAFT',
  p_metadata             jsonb default '{}'::jsonb,
  p_id                   uuid default null,
  p_adapter_key          platform.integration_adapter default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
  v_code   text := lower(nullif(trim(coalesce(p_code, '')), ''));
begin
  if not platform.has_product_permission('platform.integration.manage', p_saas_product_id) then
    raise exception 'NO_AUTORIZADO: administrar integraciones exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;

  if v_code is null or not platform.is_slug(v_code) then
    raise exception 'CODIGO_INVALIDO: el código de la integración debe ser kebab-case en minúsculas'
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NOMBRE_REQUERIDO: la integración necesita un nombre' using errcode = '23502';
  end if;

  -- `DB_DIRECT` no existe en el enum, así que PostgreSQL ya lo rechazaría. El
  -- mensaje explícito existe para que quien lo intente entienda POR QUÉ, en vez
  -- de recibir «invalid input value for enum».
  if p_integration_type::text = 'DB_DIRECT' then
    raise exception 'INTEGRACION_PROHIBIDA: MasterAdmin nunca se conecta a la base de datos de un SaaS'
      using errcode = '42501';
  end if;

  if p_id is not null then
    select to_jsonb(i) - 'metadata' into v_before
      from platform.product_integrations i where i.id = p_id;
    if v_before is null then
      raise exception 'INTEGRACION_NO_ENCONTRADA' using errcode = 'P0002';
    end if;
    -- El producto de una integración es inmutable: moverla de producto
    -- reapuntaría en silencio todos los destinos que ya la referencian.
    if (v_before ->> 'saas_product_id')::uuid is distinct from p_saas_product_id then
      raise exception 'PRODUCTO_INMUTABLE: una integración no cambia de producto SaaS'
        using errcode = '23514';
    end if;
  end if;

  insert into platform.product_integrations as t (
    id, saas_product_id, code, name, integration_type, contract_version,
    owner_user_id, owner_name, issuer, audience, subject, algorithm,
    token_ttl_seconds, create_scope, read_scope, additional_scopes,
    create_path_template, status_path_template, health_path_template,
    allowed_hosts, provisioning_policy, enabled, status, metadata,
    adapter_key
  ) values (
    coalesce(p_id, gen_random_uuid()), p_saas_product_id, v_code, trim(p_name),
    p_integration_type, coalesce(nullif(trim(p_contract_version), ''), 'v1'),
    p_owner_user_id, nullif(trim(coalesce(p_owner_name, '')), ''),
    coalesce(nullif(trim(p_issuer), ''), 'masteradmin.ebim'),
    nullif(trim(coalesce(p_audience, '')), ''),
    coalesce(nullif(trim(p_subject), ''), 'masteradmin-provisioning'),
    p_algorithm, p_token_ttl_seconds,
    nullif(trim(coalesce(p_create_scope, '')), ''),
    nullif(trim(coalesce(p_read_scope, '')), ''),
    coalesce(p_additional_scopes, '{}'::text[]),
    nullif(trim(coalesce(p_create_path_template, '')), ''),
    nullif(trim(coalesce(p_status_path_template, '')), ''),
    nullif(trim(coalesce(p_health_path_template, '')), ''),
    coalesce(p_allowed_hosts, '{}'::text[]), p_provisioning_policy,
    coalesce(p_enabled, false), coalesce(p_status, 'DRAFT'),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_adapter_key, 'GENERIC')
  )
  on conflict (id) do update set
    code = excluded.code, name = excluded.name,
    integration_type = excluded.integration_type,
    contract_version = excluded.contract_version,
    owner_user_id = excluded.owner_user_id, owner_name = excluded.owner_name,
    issuer = excluded.issuer, audience = excluded.audience, subject = excluded.subject,
    algorithm = excluded.algorithm, token_ttl_seconds = excluded.token_ttl_seconds,
    create_scope = excluded.create_scope, read_scope = excluded.read_scope,
    additional_scopes = excluded.additional_scopes,
    create_path_template = excluded.create_path_template,
    status_path_template = excluded.status_path_template,
    health_path_template = excluded.health_path_template,
    allowed_hosts = excluded.allowed_hosts,
    provisioning_policy = excluded.provisioning_policy,
    enabled = excluded.enabled, status = excluded.status, metadata = excluded.metadata,
    adapter_key = coalesce(p_adapter_key, t.adapter_key)
  where t.id = excluded.id
  returning t.id into v_id;

  select to_jsonb(i) - 'metadata' into v_after
    from platform.product_integrations i where i.id = v_id;

  perform platform.log_provisioning_config_change(
    'product_integration', v_id,
    case when p_id is null then 'INTEGRATION_CREATED' else 'INTEGRATION_UPDATED' end,
    v_before, v_after, p_saas_product_id);

  return v_id;
end;
$$;

comment on function platform.upsert_product_integration is
  'Alta y edición del contrato de integración de un producto. Todo lo operativo '
  '(issuer, audience, algoritmo, TTL, scopes, rutas, política) se administra '
  'aquí: nada de esto vive en el código de la aplicación.';


revoke all on function platform.upsert_product_integration(uuid, text, text, platform.integration_type, text, uuid, text, text, text, text, platform.m2m_algorithm, integer, text, text, text[], text, text, text, text[], platform.provisioning_policy, boolean, platform.integration_status, jsonb, uuid, platform.integration_adapter)
  from public, anon;
grant execute on function platform.upsert_product_integration(uuid, text, text, platform.integration_type, text, uuid, text, text, text, text, platform.m2m_algorithm, integer, text, text, text[], text, text, text, text[], platform.provisioning_policy, boolean, platform.integration_status, jsonb, uuid, platform.integration_adapter)
  to authenticated, service_role;
