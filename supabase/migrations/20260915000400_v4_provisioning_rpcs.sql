-- ============================================================================
-- EBIM Control Plane V4 — 41 · RPCs del plano de provisioning
-- ----------------------------------------------------------------------------
-- Mismo contrato que la decisión DV2-001 del baseline: `authenticated` no
-- escribe directamente en ninguna tabla nueva. Toda escritura entra por una RPC
-- que:
--   1. es `security definer` con `search_path = platform, pg_catalog`;
--   2. AUTORIZA en la primera línea del cuerpo, con un booleano EXPLÍCITO;
--   3. valida el estado previo antes de tocar nada;
--   4. deja rastro con auditoría;
--   5. revoca `public, anon` y concede lo mínimo.
--
-- Estas funciones son propiedad de `postgres`, que ELUDE la RLS FORCE. Por eso
-- el punto 2 no es decorativo: es la única barrera.
-- ============================================================================

-- ############################################################################
-- 1. INTEGRACIONES DE PRODUCTO
-- ############################################################################

create or replace function platform.upsert_product_integration(
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
  p_id                   uuid default null
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
    allowed_hosts, provisioning_policy, enabled, status, metadata
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
    coalesce(p_metadata, '{}'::jsonb)
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
    enabled = excluded.enabled, status = excluded.status, metadata = excluded.metadata
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

-- ############################################################################
-- 2. PERFILES DE CREDENCIAL
-- ############################################################################

create or replace function platform.upsert_credential_profile(
  p_code              text,
  p_name              text,
  p_type              platform.credential_profile_type,
  p_environment       platform.provisioning_environment,
  p_saas_product_id   uuid default null,
  p_secret_ref        text default null,
  p_public_key_ref    text default null,
  p_algorithm         platform.m2m_algorithm default null,
  p_issuer            text default null,
  p_audience          text default null,
  p_token_ttl_seconds integer default null,
  p_enabled           boolean default false,
  p_id                uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_code   text := lower(nullif(trim(coalesce(p_code, '')), ''));
  v_ref    text := nullif(trim(coalesce(p_secret_ref, '')), '');
  v_pub    text := nullif(trim(coalesce(p_public_key_ref, '')), '');
  v_before jsonb;
  v_after  jsonb;
begin
  if not platform.has_product_permission('platform.credentials.manage', p_saas_product_id) then
    raise exception 'NO_AUTORIZADO: administrar credenciales exige platform.credentials.manage'
      using errcode = '42501';
  end if;

  if v_code is null or not platform.is_slug(v_code) then
    raise exception 'CODIGO_INVALIDO: el perfil de credencial necesita un código kebab-case'
      using errcode = '23514';
  end if;

  -- Segunda barrera contra el error caro: alguien pega la CLAVE en el campo de
  -- la REFERENCIA. El CHECK de la tabla ya lo impide; este mensaje explica qué
  -- se esperaba, en vez de dejar un «violates check constraint».
  if v_ref is not null and not platform.is_secret_reference(v_ref) then
    raise exception 'SECRET_REF_INVALIDA: "%" no tiene forma de NOMBRE de secreto (EWM_QAS_M2M_PRIVATE_KEY). '
                    'Aquí va la REFERENCIA; el valor vive en los secrets del servidor y nunca en la base.',
                    left(v_ref, 24) || case when length(v_ref) > 24 then '…' else '' end
      using errcode = '42501';
  end if;
  if v_pub is not null and not platform.is_secret_reference(v_pub) then
    raise exception 'PUBLIC_KEY_REF_INVALIDA: se esperaba un NOMBRE de secreto, no un valor'
      using errcode = '42501';
  end if;

  if p_id is not null then
    select to_jsonb(c) - 'secret_ref' - 'public_key_ref' into v_before
      from platform.credential_profiles c where c.id = p_id;
    if v_before is null then
      raise exception 'PERFIL_NO_ENCONTRADO' using errcode = 'P0002';
    end if;
  end if;

  insert into platform.credential_profiles as t (
    id, code, name, saas_product_id, type, environment, secret_ref, public_key_ref,
    algorithm, issuer, audience, token_ttl_seconds, enabled
  ) values (
    coalesce(p_id, gen_random_uuid()), v_code, trim(p_name), p_saas_product_id,
    p_type, p_environment, v_ref, v_pub, p_algorithm,
    nullif(trim(coalesce(p_issuer, '')), ''), nullif(trim(coalesce(p_audience, '')), ''),
    p_token_ttl_seconds, coalesce(p_enabled, false)
  )
  on conflict (id) do update set
    code = excluded.code, name = excluded.name,
    saas_product_id = excluded.saas_product_id, type = excluded.type,
    environment = excluded.environment, secret_ref = excluded.secret_ref,
    public_key_ref = excluded.public_key_ref, algorithm = excluded.algorithm,
    issuer = excluded.issuer, audience = excluded.audience,
    token_ttl_seconds = excluded.token_ttl_seconds, enabled = excluded.enabled
  where t.id = excluded.id
  returning t.id into v_id;

  -- El diff de auditoría EXCLUYE secret_ref y public_key_ref: ni siquiera el
  -- nombre del secreto entra en la bitácora, que tiene lectura más amplia.
  select to_jsonb(c) - 'secret_ref' - 'public_key_ref' into v_after
    from platform.credential_profiles c where c.id = v_id;

  perform platform.log_provisioning_config_change(
    'credential_profile', v_id,
    case when p_id is null then 'CREDENTIAL_PROFILE_CREATED' else 'CREDENTIAL_PROFILE_UPDATED' end,
    v_before, v_after, p_saas_product_id);

  return v_id;
end;
$$;

comment on function platform.upsert_credential_profile is
  'Administra METADATA de credencial. `p_secret_ref` es un NOMBRE de secreto; si '
  'alguien pega ahí una clave real, la función la rechaza con un mensaje que '
  'explica dónde va de verdad.';

-- ---------------------------------------------------------------------------
-- reveal_credential_secret_ref — única vía de leer la referencia
-- ---------------------------------------------------------------------------
-- `authenticated` NO tiene GRANT de SELECT sobre la columna `secret_ref`
-- (migración 42). Esta RPC es el único camino, exige el permiso de
-- ADMINISTRACIÓN y deja rastro de cada lectura.
--
-- Devuelve el NOMBRE, nunca el VALOR: el valor no existe en esta base.
-- ---------------------------------------------------------------------------
create or replace function platform.reveal_credential_secret_ref(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v record;
begin
  select c.id, c.code, c.saas_product_id, c.secret_ref, c.public_key_ref
    into v from platform.credential_profiles c where c.id = p_id;

  if v.id is null then
    raise exception 'PERFIL_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  if not platform.has_product_permission('platform.credentials.manage', v.saas_product_id) then
    raise exception 'NO_AUTORIZADO: ver la referencia de secreto exige platform.credentials.manage'
      using errcode = '42501';
  end if;

  perform platform.log_audit(
    'CREDENTIAL_SECRET_REF_REVEALED', 'credential_profile', v.id::text, null, null,
    jsonb_build_object('credential_code', v.code, 'saas_product_id', v.saas_product_id,
                       'actor_role', platform.my_provisioning_actor_role()));

  return jsonb_build_object(
    'id', v.id, 'code', v.code,
    'secret_ref', v.secret_ref, 'public_key_ref', v.public_key_ref,
    -- Recordatorio que viaja con el dato, para que nadie confunda una cosa con
    -- la otra al leer una respuesta suelta en la consola del navegador.
    'note', 'Referencia, no valor. El secreto vive en el almacén del servidor.');
end;
$$;

-- ############################################################################
-- 3. DESTINOS DE PROVISIONING
-- ############################################################################

create or replace function platform.configure_deployment_provisioning(
  p_deployment_target_id  uuid,
  p_product_integration_id uuid default null,
  p_credential_profile_id uuid default null,
  p_provisioning_environment platform.provisioning_environment default null,
  p_base_url              text default null,
  p_timeout_ms            integer default null,
  p_retry_count           integer default null,
  p_provisioning_status   platform.deployment_target_status default null,
  p_provisioning_enabled  boolean default null,
  p_provisioning_policy   platform.provisioning_policy default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_target  record;
  v_before  jsonb;
  v_after   jsonb;
  v_url     text := nullif(trim(coalesce(p_base_url, '')), '');
  v_env     platform.provisioning_environment;
  v_promoted integer := 0;
begin
  select * into v_target from platform.deployment_targets where id = p_deployment_target_id;
  if v_target.id is null then
    raise exception 'DESTINO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  if not platform.has_product_permission('platform.deployment.manage', v_target.saas_product_id) then
    raise exception 'NO_AUTORIZADO: configurar un destino exige platform.deployment.manage sobre su producto'
      using errcode = '42501';
  end if;

  v_env := coalesce(p_provisioning_environment, v_target.provisioning_environment);

  -- Validación EXPLÍCITA antes del UPDATE. El CHECK de la tabla haría lo mismo,
  -- pero con un mensaje que no explica qué regla se rompió.
  if v_url is not null then
    if v_env is null then
      raise exception 'AMBIENTE_REQUERIDO: fije el ambiente de provisioning antes que la base_url'
        using errcode = '23502';
    end if;
    if not platform.is_valid_provisioning_base_url(v_url, v_env) then
      raise exception 'BASE_URL_INVALIDA: "%" no es admisible en % — se exige http(s) sin credenciales '
                      'embebidas, sin query ni fragmento, sin barra final, y en DEMO/QAS/PRD además '
                      'HTTPS y un host público (nada de localhost, rangos privados ni endpoints de metadatos)',
                      left(v_url, 80), v_env
        using errcode = '42501';
    end if;
  end if;

  select to_jsonb(d) - 'metadata' into v_before
    from platform.deployment_targets d where d.id = p_deployment_target_id;

  update platform.deployment_targets set
    product_integration_id   = coalesce(p_product_integration_id, product_integration_id),
    credential_profile_id    = coalesce(p_credential_profile_id, credential_profile_id),
    provisioning_environment = coalesce(p_provisioning_environment, provisioning_environment),
    base_url                 = coalesce(v_url, base_url),
    timeout_ms               = coalesce(p_timeout_ms, timeout_ms),
    retry_count              = coalesce(p_retry_count, retry_count),
    provisioning_status      = coalesce(p_provisioning_status, provisioning_status),
    provisioning_enabled     = coalesce(p_provisioning_enabled, provisioning_enabled),
    provisioning_policy      = coalesce(p_provisioning_policy, provisioning_policy)
  where id = p_deployment_target_id;

  select to_jsonb(d) - 'metadata' into v_after
    from platform.deployment_targets d where d.id = p_deployment_target_id;

  perform platform.log_provisioning_config_change(
    'deployment_target', p_deployment_target_id, 'DEPLOYMENT_PROVISIONING_CONFIGURED',
    v_before, v_after, v_target.saas_product_id);

  -- ---- Flujo dedicado (fase 31) -----------------------------------------
  -- Cuando por fin existe la infraestructura y el destino pasa a READY, las
  -- solicitudes que esperaban por ella se promueven solas. Si no, alguien
  -- tendría que acordarse de volver a tocar cada una a mano.
  if coalesce(p_provisioning_status, v_target.provisioning_status) = 'READY'
     and v_target.provisioning_status <> 'READY' then
    with promoted as (
      update platform.saas_provisioning_requests r
         set status = 'READY_TO_PROVISION',
             deployment_target_id = p_deployment_target_id,
             product_integration_id = coalesce(
               p_product_integration_id, v_target.product_integration_id, r.product_integration_id)
       where r.status = 'WAITING_INFRA'
         and r.saas_product_id = v_target.saas_product_id
         and (r.deployment_target_id = p_deployment_target_id or r.deployment_target_id is null)
         and exists (
           select 1 from platform.tenants t
            where t.id = r.tenant_id
              and t.deployment_mode = v_target.deployment_mode
              and (v_target.owner_organization_id is null
                   or v_target.owner_organization_id in (t.customer_organization_id,
                                                         t.managing_organization_id))
         )
      returning r.id, r.correlation_id, r.attempt_count
    )
    insert into platform.saas_provisioning_events (
      saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
      correlation_id, attempt, detail)
    select p.id, 'READY_TO_PROVISION', 'INFRA_READY',
           'La infraestructura dedicada quedó lista; la solicitud pasa a READY_TO_PROVISION',
           auth.uid(), platform.my_provisioning_actor_role(), p.correlation_id, p.attempt_count,
           jsonb_build_object('deployment_target_id', p_deployment_target_id)
      from promoted p;

    get diagnostics v_promoted = row_count;
  end if;

  return p_deployment_target_id;
end;
$$;

comment on function platform.configure_deployment_provisioning is
  'Configura el eje de provisioning de un destino. Al marcarlo READY promueve '
  'automáticamente las solicitudes en WAITING_INFRA que esperaban esa '
  'infraestructura: el flujo dedicado se cierra solo en vez de depender de que '
  'alguien recuerde volver.';

-- ---------------------------------------------------------------------------
-- Salud del destino. La escribe la verificación server-side o un operador.
-- ---------------------------------------------------------------------------
create or replace function platform.set_deployment_health(
  p_deployment_target_id uuid,
  p_health               platform.deployment_health,
  p_detail               text default null
)
returns platform.deployment_health
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
begin
  select saas_product_id into v_product
    from platform.deployment_targets where id = p_deployment_target_id;
  if v_product is null then
    raise exception 'DESTINO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  -- El rol de servidor (Edge Function) escribe salud tras una verificación real.
  -- Un humano necesita permiso de lectura de deployments sobre ese producto.
  if not platform.is_service_request()
     and not platform.has_product_permission('platform.deployment.read', v_product) then
    raise exception 'NO_AUTORIZADO: registrar salud exige platform.deployment.read sobre el producto'
      using errcode = '42501';
  end if;

  update platform.deployment_targets
     set health_status = p_health,
         health_checked_at = now(),
         health_detail = left(nullif(trim(coalesce(p_detail, '')), ''), 500)
   where id = p_deployment_target_id;

  perform platform.log_audit(
    'DEPLOYMENT_HEALTH_RECORDED', 'deployment_target', p_deployment_target_id::text, null, null,
    jsonb_build_object('health_status', p_health::text, 'saas_product_id', v_product));

  return p_health;
end;
$$;

comment on function platform.set_deployment_health is
  'Registra el resultado de una verificación de conexión. Nadie marca HEALTHY '
  'sin haber comprobado nada: el default del modelo es UNKNOWN y sólo la '
  'verificación server-side o un operador explícito lo cambian.';

-- ############################################################################
-- 4. PROPIEDAD TÉCNICA Y ROLES
-- ############################################################################

create or replace function platform.upsert_product_owner(
  p_saas_product_id   uuid,
  p_user_id           uuid,
  p_role              platform.product_owner_role default 'TECHNICAL_OWNER',
  p_environment_scope platform.provisioning_environment[] default null,
  p_is_active         boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  -- Repartir la propiedad de un producto es transversal a propósito: si un
  -- owner pudiera nombrar owners, el aislamiento entre productos duraría lo que
  -- tarde alguien en auto-nombrarse en el producto del vecino.
  if not platform.has_platform_permission('platform.product_owner.manage') then
    raise exception 'NO_AUTORIZADO: asignar propietarios técnicos exige platform.product_owner.manage'
      using errcode = '42501';
  end if;

  if not exists (select 1 from platform.saas_products where id = p_saas_product_id) then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if not exists (select 1 from platform.profiles where id = p_user_id) then
    raise exception 'USUARIO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  -- Retirar a un propietario va por deactivate_product_owner(). Insertar aquí
  -- una fila inactiva no chocaría con el índice único PARCIAL (que sólo cubre
  -- is_active) y acabaría sembrando duplicados invisibles.
  if not coalesce(p_is_active, true) then
    raise exception 'USE_DEACTIVATE: para retirar a un propietario use platform.deactivate_product_owner()'
      using errcode = '23514';
  end if;

  insert into platform.product_owners as po (
    saas_product_id, user_id, role, environment_scope, is_active, granted_by)
  values (p_saas_product_id, p_user_id, p_role, p_environment_scope,
          coalesce(p_is_active, true), auth.uid())
  on conflict (saas_product_id, user_id) where is_active
  do update set role = excluded.role,
                environment_scope = excluded.environment_scope
  returning po.id into v_id;

  perform platform.log_audit(
    'PRODUCT_OWNER_ASSIGNED', 'product_owner', v_id::text, null, null,
    jsonb_build_object('saas_product_id', p_saas_product_id, 'user_id', p_user_id,
                       'role', p_role::text, 'is_active', coalesce(p_is_active, true)));

  return v_id;
end;
$$;

create or replace function platform.deactivate_product_owner(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.has_platform_permission('platform.product_owner.manage') then
    raise exception 'NO_AUTORIZADO: exige platform.product_owner.manage' using errcode = '42501';
  end if;

  update platform.product_owners set is_active = false where id = p_id;
  if not found then
    raise exception 'OWNER_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  perform platform.log_audit('PRODUCT_OWNER_REVOKED', 'product_owner', p_id::text);
  return p_id;
end;
$$;

create or replace function platform.grant_provisioning_role(
  p_user_id uuid,
  p_role    platform.provisioning_role,
  p_notes   text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  -- Sólo el super admin reparte roles transversales. Un PROVISIONING_ADMIN que
  -- pudiera crear otros PROVISIONING_ADMIN convierte el modelo en decorativo.
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: sólo el super admin EBIM concede roles del plano de provisioning'
      using errcode = '42501';
  end if;

  if p_role = 'PRODUCT_OWNER' then
    raise exception 'ROL_POR_PRODUCTO: PRODUCT_OWNER se concede con upsert_product_owner(), '
                    'que exige decir DE QUÉ producto' using errcode = '23514';
  end if;

  insert into platform.provisioning_role_members as m (user_id, role, granted_by, is_active, notes)
  values (p_user_id, p_role, auth.uid(), true, nullif(trim(coalesce(p_notes, '')), ''))
  on conflict (user_id, role) where is_active
  do update set notes = excluded.notes, granted_by = excluded.granted_by
  returning m.id into v_id;

  perform platform.log_audit('PROVISIONING_ROLE_GRANTED', 'provisioning_role_member', v_id::text,
    null, null, jsonb_build_object('user_id', p_user_id, 'role', p_role::text));
  return v_id;
end;
$$;

create or replace function platform.revoke_provisioning_role(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: sólo el super admin EBIM revoca roles del plano de provisioning'
      using errcode = '42501';
  end if;
  update platform.provisioning_role_members set is_active = false where id = p_id;
  if not found then
    raise exception 'MEMBRESIA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  perform platform.log_audit('PROVISIONING_ROLE_REVOKED', 'provisioning_role_member', p_id::text);
  return p_id;
end;
$$;

-- ############################################################################
-- 5. POLÍTICA DE PROVISIONING
-- ############################################################################
-- Crear una cotización NO aprovisiona. La política decide cuándo se puede, y es
-- CONFIGURABLE por integración y, si hace falta, por destino. El default es
-- MANUAL hasta que el contrato de cada producto esté certificado.
-- ############################################################################

create or replace function platform.evaluate_provisioning_policy(
  p_policy          platform.provisioning_policy,
  p_subscription_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub record;
begin
  if p_policy = 'MANUAL' then
    -- MANUAL no significa "nunca": significa que la decisión es de una persona
    -- con permiso, no de un evento comercial.
    return jsonb_build_object('satisfied', true, 'policy', p_policy::text, 'reason', 'MANUAL_DECISION');
  end if;

  if p_subscription_id is null then
    return jsonb_build_object('satisfied', false, 'policy', p_policy::text,
                              'reason', 'SUBSCRIPTION_REQUIRED');
  end if;

  select s.id, s.status into v_sub from platform.subscriptions s where s.id = p_subscription_id;
  if v_sub.id is null then
    return jsonb_build_object('satisfied', false, 'policy', p_policy::text,
                              'reason', 'SUBSCRIPTION_NOT_FOUND');
  end if;

  if p_policy = 'AFTER_SUBSCRIPTION_ACTIVE' then
    return jsonb_build_object(
      'satisfied', v_sub.status = 'ACTIVE', 'policy', p_policy::text,
      'reason', case when v_sub.status = 'ACTIVE' then 'SUBSCRIPTION_ACTIVE'
                     else 'SUBSCRIPTION_NOT_ACTIVE' end,
      'subscription_status', v_sub.status::text);
  end if;

  -- AFTER_PAYMENT_CONFIRMED: sólo cuenta un pago CONFIRMED. Un pago PENDING es
  -- una promesa, y provisionar contra una promesa es regalar el producto.
  return jsonb_build_object(
    'satisfied', exists (
      select 1 from platform.payments pay
        join platform.invoices inv on inv.id = pay.invoice_id
       where inv.subscription_id = p_subscription_id and pay.status = 'CONFIRMED'),
    'policy', p_policy::text,
    'reason', case when exists (
        select 1 from platform.payments pay
          join platform.invoices inv on inv.id = pay.invoice_id
         where inv.subscription_id = p_subscription_id and pay.status = 'CONFIRMED')
      then 'PAYMENT_CONFIRMED' else 'NO_CONFIRMED_PAYMENT' end);
end;
$$;

comment on function platform.evaluate_provisioning_policy is
  'Decide si el estado COMERCIAL permite provisionar. Sólo un pago CONFIRMED '
  'satisface AFTER_PAYMENT_CONFIRMED: un PENDING es una promesa, no un cobro.';

-- ############################################################################
-- 6. CICLO DE VIDA DE LA SOLICITUD
-- ############################################################################

create or replace function platform.create_saas_provisioning_request(
  p_tenant_id       uuid,
  p_environment     platform.provisioning_environment,
  p_subscription_id uuid default null,
  p_max_attempts    integer default 3
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant     record;
  v_resolution jsonb;
  -- `v_target_id` existe aparte del record a propósito: en PL/pgSQL, leer un
  -- campo de un RECORD al que nunca se le asignó una fila lanza 55000
  -- («tuple structure is indeterminate»), no devuelve NULL. Y el caso normal
  -- de un dedicado sin infraestructura es exactamente ese: no hay fila.
  v_target_id  uuid;
  v_target_ready boolean;
  v_target_policy platform.provisioning_policy;
  v_integration_id uuid;
  v_integration_policy platform.provisioning_policy;
  v_policy     platform.provisioning_policy;
  v_status     platform.saas_provisioning_status;
  v_key        text;
  v_id         uuid;
  v_existing   record;
  v_version    integer := 1;
begin
  select t.* into v_tenant from platform.tenants t where t.id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  -- AUTORIZACIÓN EXPLÍCITA, y acotada al producto del tenant: un owner de EWM
  -- no puede lanzar el provisioning de un tenant de eSupplier.
  if not platform.has_product_permission('platform.provisioning.execute', v_tenant.saas_product_id) then
    raise exception 'NO_AUTORIZADO: crear un provisioning exige platform.provisioning.execute sobre el producto del tenant'
      using errcode = '42501';
  end if;

  -- ---- Idempotencia (fase 8) --------------------------------------------
  -- Si ya hay una solicitud VIVA se devuelve ESA, no se crea otra. Cinco clics
  -- producen una sola solicitud y cuatro respuestas idénticas.
  select r.* into v_existing
    from platform.saas_provisioning_requests r
   where r.tenant_id = p_tenant_id
     and r.saas_product_id = v_tenant.saas_product_id
     and r.status not in ('FAILED', 'CANCELLED')
   limit 1;

  if v_existing.id is not null then
    return v_existing.id;
  end if;

  -- Un reprovisioning tras un intento cerrado necesita clave NUEVA: para el
  -- SaaS es una operación distinta, no el reintento de la anterior.
  select coalesce(max(r.request_version), 0) + 1 into v_version
    from platform.saas_provisioning_requests r
   where r.tenant_id = p_tenant_id and r.saas_product_id = v_tenant.saas_product_id;

  v_resolution := platform.resolve_deployment_target(p_tenant_id, v_tenant.saas_product_id, p_environment);

  if v_resolution ->> 'outcome' = 'DEPLOYMENT_AMBIGUOUS' then
    raise exception 'DEPLOYMENT_AMBIGUOUS: hay % destinos válidos para este tenant en %; '
                    'MasterAdmin no elige uno al azar — desactive o diferencie los sobrantes',
                    v_resolution ->> 'candidates', p_environment using errcode = '23514';
  end if;

  if v_resolution ->> 'outcome' = 'RESOLVED' then
    v_target_id := (v_resolution ->> 'deployment_target_id')::uuid;
    select d.product_integration_id,
           d.provisioning_policy,
           d.provisioning_status = 'READY' and d.provisioning_enabled
      into v_integration_id, v_target_policy, v_target_ready
      from platform.deployment_targets d where d.id = v_target_id;
  end if;

  -- Integración de referencia cuando todavía no hay destino resuelto. Se anota
  -- SÓLO si el producto tiene exactamente una habilitada; con varias (MOCK en
  -- DEV + HTTP_M2M en QAS es lo normal) se deja NULL en vez de elegir al azar.
  -- La integración real la fija el destino cuando la infraestructura exista.
  if v_integration_id is null then
    select i.id into v_integration_id
      from platform.product_integrations i
     where i.saas_product_id = v_tenant.saas_product_id and i.enabled
       and (select count(*) from platform.product_integrations i2
             where i2.saas_product_id = v_tenant.saas_product_id and i2.enabled) = 1;
  end if;

  select i.provisioning_policy into v_integration_policy
    from platform.product_integrations i where i.id = v_integration_id;

  -- Jerarquía de política: destino > integración > MANUAL. Nunca un default
  -- escondido en el código de la aplicación.
  v_policy := coalesce(v_target_policy, v_integration_policy, 'MANUAL');

  -- ---- Estado inicial ----------------------------------------------------
  if v_target_id is null then
    if v_tenant.deployment_mode = 'TENANT_DEDICATED' then
      -- Fase 10/31: el dedicado que todavía no tiene infraestructura NO es un
      -- error. Es un estado del negocio, y tiene nombre.
      v_status := 'WAITING_INFRA';
    else
      raise exception 'DEPLOYMENT_NOT_CONFIGURED: no hay ningún destino % configurado para este producto en %',
        v_tenant.deployment_mode, p_environment using errcode = '23514';
    end if;
  elsif not coalesce(v_target_ready, false) then
    v_status := 'WAITING_INFRA';
  elsif (platform.evaluate_provisioning_policy(v_policy, p_subscription_id) ->> 'satisfied')::boolean then
    v_status := 'READY_TO_PROVISION';
  else
    v_status := 'PENDING';
  end if;

  v_key := platform.build_provisioning_idempotency_key(p_tenant_id, v_tenant.saas_product_id, v_version);

  insert into platform.saas_provisioning_requests (
    tenant_id, saas_product_id, subscription_id, deployment_target_id,
    product_integration_id, idempotency_key, request_version, status,
    provisioning_environment, provisioning_policy, max_attempts, requested_by
  ) values (
    p_tenant_id, v_tenant.saas_product_id, p_subscription_id, v_target_id,
    v_integration_id, v_key, v_version, v_status,
    p_environment, v_policy, coalesce(p_max_attempts, 3), auth.uid()
  )
  returning id into v_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  select v_id, v_status, 'REQUEST_CREATED',
         'Solicitud de provisioning creada en estado ' || v_status::text,
         auth.uid(), platform.my_provisioning_actor_role(), r.correlation_id, 0,
         jsonb_build_object('resolution', v_resolution, 'policy', v_policy::text,
                            'deployment_mode', v_tenant.deployment_mode)
    from platform.saas_provisioning_requests r where r.id = v_id;

  perform platform.log_audit(
    'SAAS_PROVISIONING_REQUESTED', 'saas_provisioning_request', v_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('saas_product_id', v_tenant.saas_product_id,
                       'deployment_target_id', v_target_id,
                       'idempotency_key', v_key, 'status', v_status::text,
                       'environment', p_environment::text,
                       'actor_role', platform.my_provisioning_actor_role()));

  return v_id;
end;
$$;

comment on function platform.create_saas_provisioning_request is
  'Crea (o devuelve) la solicitud de provisioning de un tenant en su producto. '
  'Idempotente: si ya existe una solicitud viva devuelve ESA. Resuelve el '
  'destino server-side; con un dedicado sin infraestructura deja WAITING_INFRA '
  'en vez de fallar, y con dos destinos válidos falla en vez de adivinar.';

-- ---------------------------------------------------------------------------
-- Reintento: MISMA fila, MISMA clave de idempotencia.
-- ---------------------------------------------------------------------------
create or replace function platform.retry_saas_provisioning_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req record;
begin
  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  if not platform.has_product_permission('platform.provisioning.retry', v_req.saas_product_id) then
    raise exception 'NO_AUTORIZADO: reintentar exige platform.provisioning.retry sobre el producto'
      using errcode = '42501';
  end if;

  if v_req.status <> 'FAILED' then
    raise exception 'ESTADO_NO_REINTENTABLE: sólo se reintenta una solicitud FAILED (actual: %)',
      v_req.status using errcode = '23514';
  end if;
  if v_req.attempt_count >= v_req.max_attempts then
    raise exception 'REINTENTOS_AGOTADOS: % de % intentos consumidos; reprovisione explícitamente',
      v_req.attempt_count, v_req.max_attempts using errcode = '23514';
  end if;

  update platform.saas_provisioning_requests
     set status = 'READY_TO_PROVISION', last_error_code = null,
         last_error_message = null, provider_http_status = null
   where id = p_request_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  values (p_request_id, 'READY_TO_PROVISION', 'RETRY_REQUESTED',
          'Reintento solicitado; se conserva la misma clave de idempotencia',
          auth.uid(), platform.my_provisioning_actor_role(), v_req.correlation_id,
          v_req.attempt_count,
          jsonb_build_object('previous_error_code', v_req.last_error_code,
                             'idempotency_key', v_req.idempotency_key));

  perform platform.log_audit(
    'SAAS_PROVISIONING_RETRY', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('idempotency_key', v_req.idempotency_key,
                       'attempt', v_req.attempt_count,
                       'actor_role', platform.my_provisioning_actor_role()));

  return p_request_id;
end;
$$;

comment on function platform.retry_saas_provisioning_request is
  'Reintenta la MISMA solicitud. No crea fila nueva ni clave nueva: si la clave '
  'cambiara, el SaaS vería un alta distinta y podría duplicar el tenant.';

create or replace function platform.cancel_saas_provisioning_request(
  p_request_id uuid,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req record;
begin
  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  if not platform.has_product_permission('platform.provisioning.cancel', v_req.saas_product_id) then
    raise exception 'NO_AUTORIZADO: cancelar exige platform.provisioning.cancel sobre el producto'
      using errcode = '42501';
  end if;

  -- PROVISIONING no se cancela: la llamada al SaaS está en vuelo y no sabemos
  -- si el alta se completó al otro lado. ACTIVE tampoco: ya existe allí.
  if v_req.status in ('PROVISIONING', 'ACTIVE', 'CANCELLED') then
    raise exception 'ESTADO_NO_CANCELABLE: una solicitud en % no se cancela', v_req.status
      using errcode = '23514';
  end if;

  update platform.saas_provisioning_requests
     set status = 'CANCELLED', cancelled_at = now(),
         cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 500)
   where id = p_request_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  values (p_request_id, 'CANCELLED', 'REQUEST_CANCELLED',
          coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Cancelada por el operador'),
          auth.uid(), platform.my_provisioning_actor_role(), v_req.correlation_id,
          v_req.attempt_count, '{}'::jsonb);

  perform platform.log_audit(
    'SAAS_PROVISIONING_CANCELLED', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('idempotency_key', v_req.idempotency_key,
                       'actor_role', platform.my_provisioning_actor_role()));

  return p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro MANUAL (fases 22 y 31)
-- ---------------------------------------------------------------------------
-- Para SaaS todavía no integrados o para dedicados donde el alta física la hace
-- una persona. El resultado es el MISMO mapeo que produciría el adaptador
-- automático, marcado como manual y con auditoría.
-- ---------------------------------------------------------------------------
create or replace function platform.register_manual_provisioning(
  p_request_id               uuid,
  p_external_tenant_id       text,
  p_external_organization_id text default null,
  p_external_company_id      text default null,
  p_metadata                 jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    record;
  v_ext    text := nullif(trim(coalesce(p_external_tenant_id, '')), '');
  v_map_id uuid;
begin
  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  if not platform.has_product_permission('platform.provisioning.execute', v_req.saas_product_id) then
    raise exception 'NO_AUTORIZADO: registrar un alta manual exige platform.provisioning.execute sobre el producto'
      using errcode = '42501';
  end if;

  if v_ext is null then
    raise exception 'EXTERNAL_TENANT_ID_REQUERIDO: sin el identificador del producto el mapeo no sirve para nada'
      using errcode = '23502';
  end if;

  if v_req.status not in ('PENDING', 'WAITING_INFRA', 'READY_TO_PROVISION', 'FAILED') then
    raise exception 'ESTADO_NO_REGISTRABLE: una solicitud en % no admite registro manual', v_req.status
      using errcode = '23514';
  end if;

  -- El estado intermedio es obligatorio: la máquina de estados no permite
  -- saltar de PENDING a ACTIVE, y esa regla también vale para el alta manual.
  if v_req.status <> 'READY_TO_PROVISION' then
    update platform.saas_provisioning_requests set status = 'READY_TO_PROVISION' where id = p_request_id;
  end if;
  update platform.saas_provisioning_requests
     set status = 'PROVISIONING', attempt_count = attempt_count + 1 where id = p_request_id;
  update platform.saas_provisioning_requests
     set status = 'ACTIVE', completed_at = now(), external_reference = v_ext
   where id = p_request_id;

  insert into platform.tenant_product_mappings as m (
    tenant_id, saas_product_id, deployment_target_id, saas_provisioning_request_id,
    external_tenant_id, external_organization_id, external_company_id,
    status, provisioned_at, registered_manually, metadata)
  values (
    v_req.tenant_id, v_req.saas_product_id, v_req.deployment_target_id, p_request_id,
    v_ext, nullif(trim(coalesce(p_external_organization_id, '')), ''),
    nullif(trim(coalesce(p_external_company_id, '')), ''),
    'ACTIVE', now(), true, coalesce(p_metadata, '{}'::jsonb))
  on conflict (tenant_id, saas_product_id) do update set
    deployment_target_id = excluded.deployment_target_id,
    saas_provisioning_request_id = excluded.saas_provisioning_request_id,
    external_tenant_id = excluded.external_tenant_id,
    external_organization_id = excluded.external_organization_id,
    external_company_id = excluded.external_company_id,
    status = 'ACTIVE', provisioned_at = now(), registered_manually = true,
    metadata = excluded.metadata
  returning m.id into v_map_id;

  insert into platform.saas_provisioning_events (
    saas_provisioning_request_id, status, action, message, actor_user_id, actor_role,
    correlation_id, attempt, detail)
  values (p_request_id, 'ACTIVE', 'MANUAL_REGISTRATION',
          'Alta registrada manualmente por un operador autorizado',
          auth.uid(), platform.my_provisioning_actor_role(), v_req.correlation_id,
          v_req.attempt_count + 1,
          jsonb_build_object('external_tenant_id', v_ext, 'registered_manually', true));

  perform platform.log_audit(
    'SAAS_PROVISIONING_MANUAL', 'saas_provisioning_request', p_request_id::text, null, v_req.tenant_id,
    jsonb_build_object('external_tenant_id', v_ext, 'mapping_id', v_map_id,
                       'idempotency_key', v_req.idempotency_key,
                       'actor_role', platform.my_provisioning_actor_role()));

  return v_map_id;
end;
$$;

comment on function platform.register_manual_provisioning is
  'Registra un alta hecha a mano (SaaS sin API todavía, o dedicado con alta '
  'manual). Recorre la máquina de estados completa en vez de saltar a ACTIVE: '
  'el historial tiene que contar lo mismo que el automático.';
