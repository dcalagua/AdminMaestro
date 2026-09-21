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

-- ############################################################################
-- 3. Capacidades por contrato — regla ÚNICA
-- ----------------------------------------------------------------------------
-- La usan el contexto del orquestador y la vista de la UI. El orquestador
-- exige además que el codec compilado declare la capacidad.
-- ############################################################################
create function platform.integration_capabilities(
  p_adapter_key          platform.integration_adapter,
  p_status_path_template text,
  p_read_scope           text
)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_adapter_key
    when 'EWM_V1' then
      case when p_status_path_template is not null and p_read_scope is not null
           then array['PROVISION', 'GET_STATUS', 'REPLAY_CERTIFICATION']
           else array['PROVISION', 'REPLAY_CERTIFICATION'] end
    else array['PROVISION']
  end;
$$;

comment on function platform.integration_capabilities(platform.integration_adapter, text, text) is
  'Capacidades efectivas de una integración: las que declara su contrato y '
  'permite su configuración. GENERIC sólo PROVISION, como siempre.';

revoke all on function platform.integration_capabilities(platform.integration_adapter, text, text)
  from public, anon;
grant execute on function platform.integration_capabilities(platform.integration_adapter, text, text)
  to authenticated, service_role;

-- ############################################################################
-- 4. Contexto de ejecución con `source` y `adapter`
-- ----------------------------------------------------------------------------
-- Copia literal de 20260915000500 (líneas 66–207) con tres añadidos: la
-- variable `v_map`, su SELECT INTO y las claves `source` y `adapter` DESPUÉS
-- de `payload`. La firma no cambia, así que los grants (sólo service_role)
-- siguen vigentes.
-- ############################################################################
create or replace function platform.provisioning_execution_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    record;
  v_tenant record;
  v_prod   record;
  v_target record;
  v_int    record;
  v_cred   record;
  v_org    record;
  v_comp   record;
  v_plan   record;
  v_map    record;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: provisioning_execution_context() resuelve configuración sensible '
                    'y sólo la invoca el orquestador server-side'
      using errcode = '42501';
  end if;

  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  select * into v_tenant from platform.tenants where id = v_req.tenant_id;
  select * into v_prod from platform.saas_products where id = v_req.saas_product_id;
  select * into v_org from platform.organizations where id = v_tenant.customer_organization_id;
  select * into v_comp from platform.companies where id = v_tenant.company_id;

  -- El SELECT INTO se ejecuta SIEMPRE, aunque el identificador sea NULL.
  -- Es deliberado: en PL/pgSQL, leer un campo de un RECORD que nunca fue
  -- destino de un INTO lanza 55000 («tuple structure is indeterminate»), no
  -- devuelve NULL. Un SELECT sin filas, en cambio, deja el record asignado y
  -- con todos sus campos en NULL — que es exactamente lo que el resto del
  -- cuerpo espera poder comprobar.
  select * into v_target from platform.deployment_targets
   where id = v_req.deployment_target_id;
  -- La integración efectiva es la del destino; si el destino no la fija todavía,
  -- la que quedó anotada en la solicitud.
  select * into v_int from platform.product_integrations
   where id = coalesce(v_target.product_integration_id, v_req.product_integration_id);
  select * into v_cred from platform.credential_profiles
   where id = v_target.credential_profile_id;

  select p.code, p.name into v_plan
    from platform.subscriptions s join platform.plans p on p.id = s.plan_id
   where s.id = v_req.subscription_id;

  -- Mapping externo de ESTA solicitud (null si todavía no existe).
  select * into v_map from platform.tenant_product_mappings
   where saas_provisioning_request_id = p_request_id;

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id,
      'status', v_req.status::text,
      'idempotency_key', v_req.idempotency_key,
      'correlation_id', v_req.correlation_id,
      'attempt_count', v_req.attempt_count,
      'max_attempts', v_req.max_attempts,
      'request_version', v_req.request_version,
      'environment', v_req.provisioning_environment::text,
      'policy', v_req.provisioning_policy::text,
      'requested_by', v_req.requested_by,
      'subscription_id', v_req.subscription_id
    ),
    'product', jsonb_build_object(
      'id', v_prod.id, 'code', v_prod.code, 'short_name', v_prod.short_name
    ),
    'deployment', case when v_target.id is null then null else jsonb_build_object(
      'id', v_target.id,
      'code', v_target.code,
      'deployment_mode', v_target.deployment_mode::text,
      'environment', v_target.provisioning_environment::text,
      'base_url', v_target.base_url,
      'timeout_ms', v_target.timeout_ms,
      'retry_count', v_target.retry_count,
      'status', v_target.provisioning_status::text,
      'enabled', v_target.provisioning_enabled,
      'health_status', v_target.health_status::text
    ) end,
    'integration', case when v_int.id is null then null else jsonb_build_object(
      'id', v_int.id,
      'code', v_int.code,
      'type', v_int.integration_type::text,
      'contract_version', v_int.contract_version,
      'status', v_int.status::text,
      'enabled', v_int.enabled,
      'issuer', v_int.issuer,
      'audience', v_int.audience,
      'subject', v_int.subject,
      'algorithm', v_int.algorithm::text,
      'token_ttl_seconds', v_int.token_ttl_seconds,
      'create_scope', v_int.create_scope,
      'read_scope', v_int.read_scope,
      'additional_scopes', to_jsonb(v_int.additional_scopes),
      'create_path_template', v_int.create_path_template,
      'status_path_template', v_int.status_path_template,
      'health_path_template', v_int.health_path_template,
      'allowed_hosts', to_jsonb(v_int.allowed_hosts)
    ) end,
    'credential', case when v_cred.id is null then null else jsonb_build_object(
      'id', v_cred.id,
      'code', v_cred.code,
      'type', v_cred.type::text,
      'enabled', v_cred.enabled,
      'algorithm', v_cred.algorithm::text,
      'token_ttl_seconds', v_cred.token_ttl_seconds,
      -- NOMBRE del secreto. El valor lo resuelve la Edge Function contra su
      -- propio almacén; esta base no lo conoce ni puede conocerlo.
      'secret_ref', v_cred.secret_ref,
      'public_key_ref', v_cred.public_key_ref
    ) end,
    -- ---- Payload ESTÁNDAR del contrato de provisioning --------------------
    -- Es el mismo para todos los productos. Un SaaS que necesite más datos los
    -- pide al contrato, no a MasterAdmin conociendo sus tablas.
    'payload', jsonb_build_object(
      'tenantCode', v_tenant.slug,
      'tenantName', v_tenant.name,
      'adminEmail', v_tenant.admin_email,
      'tenantType', v_tenant.tenant_type::text,
      'environment', v_req.provisioning_environment::text,
      'deploymentMode', v_tenant.deployment_mode::text,
      'organization', jsonb_build_object(
        'code', v_org.slug, 'legalName', v_org.legal_name,
        'displayName', v_org.display_name, 'countryCode', v_org.country_code,
        'taxId', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
        'code', v_comp.erp_code, 'name', v_comp.name,
        'countryCode', v_comp.country_code, 'currency', v_comp.currency,
        'taxId', v_comp.tax_id) end,
      'plan', case when v_plan.code is null then null else jsonb_build_object(
        'code', v_plan.code, 'name', v_plan.name) end,
      'masterAdmin', jsonb_build_object(
        'tenantId', v_tenant.id, 'productCode', v_prod.code,
        'requestId', v_req.id, 'correlationId', v_req.correlation_id,
        'contractVersion', coalesce(v_int.contract_version, 'v1'))
    )
    ,
    -- ---- Identidades de MasterAdmin para los codecs de contrato -----------
    -- Claves HERMANAS de `payload`; la expresión de `payload` no se toca.
    -- Nada aquí es específico de un producto.
    'source', jsonb_build_object(
      'tenant', jsonb_build_object('id', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
                                   'admin_email', v_tenant.admin_email,
                                   'deployment_mode', v_tenant.deployment_mode::text),
      'organization', jsonb_build_object('id', v_org.id, 'slug', v_org.slug,
                                   'legal_name', v_org.legal_name, 'display_name', v_org.display_name,
                                   'country_code', v_org.country_code, 'tax_id', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
                                   'id', v_comp.id, 'name', v_comp.name, 'erp_code', v_comp.erp_code,
                                   'country_code', v_comp.country_code, 'currency', v_comp.currency,
                                   'tax_id', v_comp.tax_id) end,
      'mapping', case when v_map.id is null then null else jsonb_build_object(
                                   'external_tenant_id', v_map.external_tenant_id,
                                   'external_organization_id', v_map.external_organization_id,
                                   'external_company_id', v_map.external_company_id) end,
      'product_configuration', v_req.product_configuration),
    'adapter', jsonb_build_object(
      'key', coalesce(v_int.adapter_key, 'GENERIC')::text,
      'capabilities', to_jsonb(platform.integration_capabilities(
                        coalesce(v_int.adapter_key, 'GENERIC'),
                        v_int.status_path_template, v_int.read_scope)))
  );
end;
$$;
