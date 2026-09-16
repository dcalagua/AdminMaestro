-- ============================================================================
-- EBIM Control Plane V4 — 42 · Contrato servidor del orquestador
-- ----------------------------------------------------------------------------
-- Estas funciones son el contrato entre la Edge Function `provisioning-
-- orchestrator` y la base. Se dividen en dos grupos, y la separación es el
-- punto entero del diseño:
--
--   A) LO QUE COMPRUEBA LA IDENTIDAD HUMANA
--      `can_execute_saas_provisioning()` se invoca con el JWT del usuario, ANTES
--      de que la función construya un cliente `service_role`. Devuelve un
--      booleano explícito.
--
--      Esto corrige por diseño el fallo que ya ocurrió en payments: asumir que
--      «si la consulta con RLS no dio error, entonces está autorizado». RLS
--      filtra FILAS; no responde «¿puede esta persona ejecutar esta acción?».
--      Una lista vacía y una prohibición se ven exactamente igual.
--
--   B) LO QUE SÓLO PUEDE HACER EL SERVIDOR
--      `provisioning_execution_context()` y las transiciones de ejecución exigen
--      `service_role`. Resuelven TODA la configuración server-side: base_url,
--      issuer, audience, scopes, algoritmo, TTL y referencia de secreto.
--      React nunca envía nada de eso (fase 39): manda tenant y ambiente, y el
--      servidor decide contra qué se llama.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) Autorización humana explícita
-- ---------------------------------------------------------------------------
create or replace function platform.can_execute_saas_provisioning(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
begin
  select saas_product_id into v_product
    from platform.saas_provisioning_requests where id = p_request_id;

  -- Una solicitud inexistente da FALSE, no error: fallar cerrado y sin revelar
  -- si el identificador existe.
  if v_product is null then
    return false;
  end if;

  return platform.has_product_permission('platform.provisioning.execute', v_product);
end;
$$;

comment on function platform.can_execute_saas_provisioning(uuid) is
  'Booleano EXPLÍCITO para el gate de la Edge Function. Se llama con el JWT del '
  'humano, antes de asumir el rol de servidor. Un id inexistente devuelve false: '
  'falla cerrado y no filtra la existencia de la solicitud.';

-- ---------------------------------------------------------------------------
-- B) Contexto de ejecución — SÓLO service_role
-- ---------------------------------------------------------------------------
-- Devuelve la configuración completa MÁS el payload estándar del contrato.
-- Incluye `secret_ref` porque quien la invoca es el servidor y es lo que
-- necesita para resolver la clave privada en su almacén de secretos. Ni esta
-- función ni su resultado llegan jamás al navegador: el GRANT es sólo para
-- `service_role`.
-- ---------------------------------------------------------------------------
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
  );
end;
$$;

comment on function platform.provisioning_execution_context(uuid) is
  'Resolución SERVER-SIDE de toda la configuración de una ejecución más el '
  'payload estándar del contrato. Exige service_role. React nunca elige base_url, '
  'scope, issuer, audience, credencial ni tipo de adaptador (fase 39): sólo dice '
  'qué tenant y en qué ambiente.';

-- ---------------------------------------------------------------------------
-- Precondiciones de ejecución, evaluadas en la base
-- ---------------------------------------------------------------------------
-- Cada bloqueo devuelve un CÓDIGO, no un booleano suelto: la UI necesita poder
-- decir «el destino está en mantenimiento» en vez de «no se puede».
-- ---------------------------------------------------------------------------
create or replace function platform.check_provisioning_preconditions(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    record;
  v_target record;
  v_int    record;
  v_cred   record;
  v_block  text[] := array[]::text[];
  v_policy jsonb;
begin
  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  -- El SELECT INTO se ejecuta SIEMPRE, aunque el identificador sea NULL.
  -- Es deliberado: en PL/pgSQL, leer un campo de un RECORD que nunca fue
  -- destino de un INTO lanza 55000 («tuple structure is indeterminate»), no
  -- devuelve NULL. Un SELECT sin filas, en cambio, deja el record asignado y
  -- con todos sus campos en NULL — que es exactamente lo que el resto del
  -- cuerpo espera poder comprobar.
  select * into v_target from platform.deployment_targets
   where id = v_req.deployment_target_id;
  select * into v_int from platform.product_integrations
   where id = coalesce(v_target.product_integration_id, v_req.product_integration_id);
  select * into v_cred from platform.credential_profiles
   where id = v_target.credential_profile_id;

  if v_req.status <> 'READY_TO_PROVISION' then
    v_block := array_append(v_block, 'REQUEST_NOT_READY');
  end if;
  if v_req.attempt_count >= v_req.max_attempts then
    v_block := array_append(v_block, 'ATTEMPTS_EXHAUSTED');
  end if;

  if v_target.id is null then
    v_block := array_append(v_block, 'DEPLOYMENT_NOT_CONFIGURED');
  else
    if v_target.provisioning_status <> 'READY' then
      v_block := array_append(v_block, 'DEPLOYMENT_NOT_READY');
    end if;
    if not v_target.provisioning_enabled then
      v_block := array_append(v_block, 'DEPLOYMENT_DISABLED');
    end if;
    -- UNKNOWN no bloquea: hay productos que todavía no exponen /health y
    -- inventar un HEALTHY sería peor. UNHEALTHY sí bloquea.
    if v_target.health_status = 'UNHEALTHY' then
      v_block := array_append(v_block, 'DEPLOYMENT_UNHEALTHY');
    end if;
  end if;

  if v_int.id is null then
    v_block := array_append(v_block, 'INTEGRATION_NOT_CONFIGURED');
  else
    if not v_int.enabled then
      v_block := array_append(v_block, 'INTEGRATION_DISABLED');
    end if;
    if v_int.status in ('DRAFT', 'DISABLED') then
      v_block := array_append(v_block, 'INTEGRATION_NOT_READY');
    end if;
    -- Guard de ambiente (fase 50): MOCK jamás fuera de DEV, pase lo que pase.
    if v_int.integration_type = 'MOCK' and v_req.provisioning_environment <> 'DEV' then
      v_block := array_append(v_block, 'MOCK_NOT_ALLOWED_IN_ENVIRONMENT');
    end if;
    if v_int.integration_type in ('HTTP_M2M', 'EDGE_FUNCTION') then
      if v_target.base_url is null then
        v_block := array_append(v_block, 'BASE_URL_MISSING');
      elsif not platform.is_valid_provisioning_base_url(
              v_target.base_url, v_req.provisioning_environment) then
        v_block := array_append(v_block, 'BASE_URL_INSECURE');
      end if;
      if v_cred.id is null or v_cred.type <> 'M2M_ASYMMETRIC_JWT' then
        v_block := array_append(v_block, 'CREDENTIAL_PROFILE_MISSING');
      elsif not v_cred.enabled then
        v_block := array_append(v_block, 'CREDENTIAL_PROFILE_DISABLED');
      elsif v_cred.secret_ref is null then
        v_block := array_append(v_block, 'SECRET_REF_MISSING');
      elsif v_cred.algorithm is null then
        v_block := array_append(v_block, 'ALGORITHM_NOT_CONFIGURED');
      end if;
    end if;
  end if;

  v_policy := platform.evaluate_provisioning_policy(v_req.provisioning_policy, v_req.subscription_id);
  if not (v_policy ->> 'satisfied')::boolean then
    v_block := array_append(v_block, 'POLICY_NOT_SATISFIED');
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'can_execute', coalesce(array_length(v_block, 1), 0) = 0,
    'blockers', to_jsonb(v_block),
    'policy', v_policy,
    'adapter_type', coalesce(v_int.integration_type::text, 'UNCONFIGURED'));
end;
$$;

comment on function platform.check_provisioning_preconditions(uuid) is
  'Precondiciones de ejecución con CÓDIGOS de bloqueo, no un booleano suelto: la '
  'UI necesita decir POR QUÉ no se puede. UNKNOWN de salud no bloquea (hay '
  'productos sin /health); UNHEALTHY sí.';

-- ---------------------------------------------------------------------------
-- Transiciones de ejecución (sólo servidor)
-- ---------------------------------------------------------------------------

create or replace function platform.begin_saas_provisioning(
  p_request_id uuid,
  p_actor_id   uuid default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req   record;
  v_check jsonb;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: la ejecución la marca el orquestador, no el cliente'
      using errcode = '42501';
  end if;

  v_check := platform.check_provisioning_preconditions(p_request_id);
  if not (v_check ->> 'can_execute')::boolean then
    raise exception 'PRECONDICIONES_NO_CUMPLIDAS: %', v_check ->> 'blockers'
      using errcode = '23514';
  end if;

  -- El UPDATE condicional es el candado contra la doble ejecución: si otra
  -- invocación ya movió la solicitud a PROVISIONING, aquí no hay fila que tocar.
  update platform.saas_provisioning_requests
     set status = 'PROVISIONING', attempt_count = attempt_count + 1, started_at = now()
   where id = p_request_id and status = 'READY_TO_PROVISION'
  returning * into v_req;

  if v_req.id is null then
    raise exception 'EJECUCION_CONCURRENTE: la solicitud ya no estaba en READY_TO_PROVISION'
      using errcode = '40001';
  end if;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  values (p_request_id, 'PROVISIONING', 'PROVISIONING_STARTED',
          'Llamada al SaaS iniciada por el orquestador', p_actor_id, p_actor_role,
          v_req.correlation_id, v_req.attempt_count,
          jsonb_build_object('adapter_type', v_check ->> 'adapter_type',
                             'idempotency_key', v_req.idempotency_key));

  perform platform.log_audit(
    'SAAS_PROVISIONING_STARTED', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('attempt', v_req.attempt_count, 'actor_id', p_actor_id,
                       'actor_role', p_actor_role, 'correlation_id', v_req.correlation_id,
                       'idempotency_key', v_req.idempotency_key));

  return jsonb_build_object('request_id', p_request_id, 'attempt', v_req.attempt_count,
                            'correlation_id', v_req.correlation_id,
                            'idempotency_key', v_req.idempotency_key);
end;
$$;

create or replace function platform.complete_saas_provisioning(
  p_request_id               uuid,
  p_external_tenant_id       text,
  p_external_organization_id text default null,
  p_external_company_id      text default null,
  p_resources                jsonb default '{}'::jsonb,
  p_external_reference       text default null,
  p_actor_id                 uuid default null,
  p_actor_role               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    record;
  v_map_id uuid;
  v_ext    text := nullif(trim(coalesce(p_external_tenant_id, '')), '');
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;

  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PROVISIONING' then
    raise exception 'ESTADO_INESPERADO: se esperaba PROVISIONING y la solicitud está en %', v_req.status
      using errcode = '23514';
  end if;

  -- Sin identificador externo no hay alta que registrar: marcar ACTIVE aquí
  -- sería declarar un éxito que nadie puede verificar después.
  if v_ext is null then
    raise exception 'PROVIDER_RESPONSE_INVALID: el SaaS no devolvió externalTenantId'
      using errcode = '23514';
  end if;

  insert into platform.tenant_product_mappings as m (
    tenant_id, saas_product_id, deployment_target_id, saas_provisioning_request_id,
    external_tenant_id, external_organization_id, external_company_id,
    status, provisioned_at, registered_manually, metadata)
  values (
    v_req.tenant_id, v_req.saas_product_id, v_req.deployment_target_id, p_request_id,
    v_ext, nullif(trim(coalesce(p_external_organization_id, '')), ''),
    nullif(trim(coalesce(p_external_company_id, '')), ''),
    'ACTIVE', now(), false, coalesce(p_resources, '{}'::jsonb))
  on conflict (tenant_id, saas_product_id) do update set
    deployment_target_id = excluded.deployment_target_id,
    saas_provisioning_request_id = excluded.saas_provisioning_request_id,
    external_tenant_id = excluded.external_tenant_id,
    external_organization_id = excluded.external_organization_id,
    external_company_id = excluded.external_company_id,
    status = 'ACTIVE', provisioned_at = now(), registered_manually = false,
    metadata = excluded.metadata
  returning m.id into v_map_id;

  update platform.saas_provisioning_requests
     set status = 'ACTIVE', completed_at = now(),
         external_reference = coalesce(nullif(trim(coalesce(p_external_reference, '')), ''), v_ext),
         last_error_code = null, last_error_message = null, provider_http_status = null
   where id = p_request_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  values (p_request_id, 'ACTIVE', 'PROVISIONING_COMPLETED',
          'El SaaS confirmó el alta del tenant', p_actor_id, p_actor_role,
          v_req.correlation_id, v_req.attempt_count,
          jsonb_build_object('external_tenant_id', v_ext, 'mapping_id', v_map_id));

  perform platform.log_audit(
    'SAAS_PROVISIONING_COMPLETED', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('external_tenant_id', v_ext, 'mapping_id', v_map_id,
                       'correlation_id', v_req.correlation_id,
                       'idempotency_key', v_req.idempotency_key,
                       'actor_id', p_actor_id, 'actor_role', p_actor_role));

  return jsonb_build_object('request_id', p_request_id, 'mapping_id', v_map_id, 'status', 'ACTIVE');
end;
$$;

create or replace function platform.fail_saas_provisioning(
  p_request_id  uuid,
  p_error_code  text,
  p_message     text default null,
  p_http_status integer default null,
  p_actor_id    uuid default null,
  p_actor_role  text default null,
  p_detail      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req  record;
  v_code text := upper(nullif(trim(coalesce(p_error_code, '')), ''));
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;

  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    v_code := 'PROVIDER_ERROR_UNCLASSIFIED';
  end if;

  update platform.saas_provisioning_requests
     set status = 'FAILED',
         last_error_code = v_code,
         -- Truncado duro: el mensaje del proveedor ya viene saneado del
         -- adaptador, y aun así no se le confía la longitud.
         last_error_message = left(nullif(trim(coalesce(p_message, '')), ''), 1000),
         provider_http_status = p_http_status
   where id = p_request_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, provider_http_status, detail)
  values (p_request_id, 'FAILED', 'PROVISIONING_FAILED',
          left(coalesce(nullif(trim(coalesce(p_message, '')), ''), v_code), 1000),
          p_actor_id, p_actor_role, v_req.correlation_id, v_req.attempt_count,
          p_http_status, coalesce(p_detail, '{}'::jsonb));

  perform platform.log_audit(
    'SAAS_PROVISIONING_FAILED', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('error_code', v_code, 'http_status', p_http_status,
                       'attempt', v_req.attempt_count,
                       'correlation_id', v_req.correlation_id,
                       'idempotency_key', v_req.idempotency_key,
                       'actor_id', p_actor_id, 'actor_role', p_actor_role));

  return jsonb_build_object('request_id', p_request_id, 'status', 'FAILED', 'error_code', v_code);
end;
$$;

comment on function platform.fail_saas_provisioning is
  'Registra un fallo NORMALIZADO: código estable, estado HTTP y mensaje saneado '
  'y truncado. Nunca entra aquí la cabecera Authorization, el JWT ni el stack '
  'remoto completo — el adaptador ya los descarta, y esto es la segunda barrera.';

-- ---------------------------------------------------------------------------
-- Evento libre para el timeline, desde el orquestador
-- ---------------------------------------------------------------------------
create or replace function platform.record_provisioning_event(
  p_request_id  uuid,
  p_action      text,
  p_message     text,
  p_detail      jsonb default '{}'::jsonb,
  p_actor_id    uuid default null,
  p_actor_role  text default null,
  p_http_status integer default null
)
returns bigint
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req record;
  v_id  bigint;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;

  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, provider_http_status, detail)
  values (p_request_id, v_req.status, upper(p_action), left(p_message, 1000),
          p_actor_id, p_actor_role, v_req.correlation_id, v_req.attempt_count,
          p_http_status, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Health check: contexto para la verificación manual de conexión
-- ---------------------------------------------------------------------------
create or replace function platform.deployment_health_context(p_deployment_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_target record;
  v_int    record;
  v_cred   record;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;

  select * into v_target from platform.deployment_targets where id = p_deployment_target_id;
  if v_target.id is null then
    raise exception 'DESTINO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  select * into v_int from platform.product_integrations where id = v_target.product_integration_id;
  select * into v_cred from platform.credential_profiles
   where id = v_target.credential_profile_id;

  return jsonb_build_object(
    'deployment_target_id', v_target.id,
    'saas_product_id', v_target.saas_product_id,
    'environment', v_target.provisioning_environment::text,
    'base_url', v_target.base_url,
    'timeout_ms', v_target.timeout_ms,
    'integration_type', coalesce(v_int.integration_type::text, 'UNCONFIGURED'),
    -- NULL significa «este producto todavía no expone /health». El resultado
    -- honesto entonces es UNKNOWN, no HEALTHY.
    'health_path_template', v_int.health_path_template,
    'allowed_hosts', to_jsonb(coalesce(v_int.allowed_hosts, '{}'::text[])),
    'issuer', v_int.issuer, 'audience', v_int.audience, 'subject', v_int.subject,
    'algorithm', v_int.algorithm::text,
    'token_ttl_seconds', v_int.token_ttl_seconds,
    'read_scope', v_int.read_scope,
    'secret_ref', v_cred.secret_ref,
    'credential_type', coalesce(v_cred.type::text, 'NONE'),
    'credential_enabled', coalesce(v_cred.enabled, false));
end;
$$;

-- Permiso para pedir una verificación de conexión desde la UI.
create or replace function platform.can_check_deployment_health(p_deployment_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
begin
  select saas_product_id into v_product
    from platform.deployment_targets where id = p_deployment_target_id;
  if v_product is null then
    return false;
  end if;
  return platform.has_product_permission('platform.deployment.read', v_product);
end;
$$;

comment on function platform.can_check_deployment_health(uuid) is
  'Gate humano de la verificación de conexión, con el mismo patrón que '
  'can_execute_saas_provisioning(): booleano explícito antes de que el '
  'orquestador asuma el rol de servidor.';
