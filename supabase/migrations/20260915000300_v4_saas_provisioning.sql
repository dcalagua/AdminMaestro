-- ============================================================================
-- EBIM Control Plane V4 — 40 · Ciclo de vida del provisioning SaaS
-- ----------------------------------------------------------------------------
-- POR QUÉ UNA TABLA NUEVA Y NO `platform.provisioning_requests`:
-- esa tabla es la cola de INFRAESTRUCTURA (crear un proyecto Supabase, adjuntar
-- un tenant a un target, suspender…). Su máquina de estados es
-- PENDING→VALIDATING→RUNNING→SUCCEEDED y su `action` es un enum de operaciones
-- de infra. El eje de esta fase es APLICACIÓN: decirle a EWM "crea este tenant".
-- Son ciclos de vida distintos (aquí existe WAITING_INFRA, que en infra no tiene
-- sentido) y mezclarlos rompería la máquina de estados existente y sus tests.
-- Las dos coexisten; ninguna migración histórica se toca.
--
-- IDEMPOTENCIA (fase 8): cinco clics no pueden crear cinco solicitudes activas.
-- Se garantiza en DOS niveles, ambos en la base:
--   1. `idempotency_key` es DETERMINISTA sobre (tenant, producto, versión) y
--      tiene índice único: dos clics simultáneos generan la MISMA clave y el
--      segundo INSERT falla.
--   2. un índice único parcial impide más de una solicitud VIVA por
--      (tenant, producto), cualquiera que sea la clave.
-- Un reintento NO crea fila nueva ni clave nueva: reutiliza ambas. Sólo un
-- reprovisioning EXPLÍCITO incrementa `request_version` y, con ella, la clave.
-- ============================================================================

create type platform.saas_provisioning_status as enum (
  'PENDING',             -- creada; falta resolver destino o cumplir la política
  'WAITING_INFRA',       -- destino dedicado todavía inexistente
  'READY_TO_PROVISION',  -- todo resuelto; esperando la ejecución
  'PROVISIONING',        -- llamada al SaaS en curso
  'ACTIVE',              -- el SaaS confirmó el alta
  'FAILED',
  'CANCELLED'
);

create type platform.tenant_product_mapping_status as enum (
  'PENDING', 'ACTIVE', 'FAILED', 'SUSPENDED'
);

-- ---------------------------------------------------------------------------
-- 1. Clave de idempotencia determinista
-- ---------------------------------------------------------------------------
create or replace function platform.build_provisioning_idempotency_key(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_version    integer
)
returns text
language sql
immutable
set search_path = platform, extensions, pg_catalog
as $$
  select 'ma-prov-v' || p_version::text || '-' || encode(
    extensions.digest(
      p_tenant_id::text || ':' || p_product_id::text || ':' || p_version::text,
      'sha256'
    ), 'hex');
$$;

comment on function platform.build_provisioning_idempotency_key(uuid, uuid, integer) is
  'Clave DETERMINISTA: la misma entrada da siempre la misma clave. Es lo que '
  'convierte el índice único en protección real contra el doble clic — no hay '
  'ventana en la que dos peticiones generen claves distintas para el mismo '
  'intento. Sólo un reprovisioning explícito sube `p_version` y cambia la clave.';

-- ---------------------------------------------------------------------------
-- 2. saas_provisioning_requests
-- ---------------------------------------------------------------------------
create table platform.saas_provisioning_requests (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references platform.tenants (id) on delete restrict,
  saas_product_id         uuid not null references platform.saas_products (id) on delete restrict,
  subscription_id         uuid references platform.subscriptions (id) on delete set null,
  deployment_target_id    uuid references platform.deployment_targets (id) on delete restrict,
  product_integration_id  uuid references platform.product_integrations (id) on delete restrict,

  idempotency_key         text not null,
  correlation_id          uuid not null default gen_random_uuid(),
  request_version         integer not null default 1,

  status                  platform.saas_provisioning_status not null default 'PENDING',
  provisioning_environment platform.provisioning_environment not null,
  provisioning_policy     platform.provisioning_policy not null default 'MANUAL',

  attempt_count           integer not null default 0,
  max_attempts            integer not null default 3,

  requested_by            uuid references platform.profiles (id) on delete set null,
  requested_at            timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancel_reason           text,

  -- Error NORMALIZADO (fase 19). Nunca la cabecera Authorization, nunca el JWT,
  -- nunca el stack remoto completo.
  last_error_code         text,
  last_error_message      text,
  provider_http_status    integer,

  external_reference      text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint saas_prov_version_ck check (request_version between 1 and 999),
  constraint saas_prov_attempts_ck check (attempt_count >= 0 and attempt_count <= max_attempts),
  constraint saas_prov_max_attempts_ck check (max_attempts between 1 and 10),
  constraint saas_prov_http_status_ck check (
    provider_http_status is null or provider_http_status between 100 and 599
  ),
  -- Un fallo sin código es un fallo que nadie puede clasificar ni reintentar
  -- con criterio mañana.
  constraint saas_prov_failed_needs_code_ck check (
    status <> 'FAILED' or last_error_code is not null
  ),
  constraint saas_prov_cancelled_ck check (
    status <> 'CANCELLED' or cancelled_at is not null
  ),
  constraint saas_prov_active_ck check (
    status <> 'ACTIVE' or completed_at is not null
  ),
  -- El mensaje normalizado tiene tope: un stack remoto de 40 KB no cabe aquí
  -- por diseño, no por casualidad.
  constraint saas_prov_message_len_ck check (
    last_error_message is null or length(last_error_message) <= 1000
  ),
  constraint saas_prov_error_code_ck check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  )
);

-- Idempotencia nivel 1: la clave es única en toda la tabla.
create unique index saas_prov_idempotency_uk
  on platform.saas_provisioning_requests (idempotency_key);

-- Idempotencia nivel 2: como máximo UNA solicitud viva por (tenant, producto).
-- FAILED y CANCELLED quedan fuera del predicado a propósito: son los dos
-- estados desde los que tiene sentido volver a empezar.
create unique index saas_prov_live_uk
  on platform.saas_provisioning_requests (tenant_id, saas_product_id)
  where status not in ('FAILED', 'CANCELLED');

create index saas_prov_tenant_ix on platform.saas_provisioning_requests (tenant_id);
create index saas_prov_product_ix on platform.saas_provisioning_requests (saas_product_id);
create index saas_prov_status_ix on platform.saas_provisioning_requests (status);
create index saas_prov_target_ix on platform.saas_provisioning_requests (deployment_target_id)
  where deployment_target_id is not null;
create index saas_prov_correlation_ix on platform.saas_provisioning_requests (correlation_id);
create index saas_prov_subscription_ix on platform.saas_provisioning_requests (subscription_id)
  where subscription_id is not null;

create trigger saas_prov_set_updated_at before update on platform.saas_provisioning_requests
  for each row execute function platform.set_updated_at();

comment on table platform.saas_provisioning_requests is
  'Cada intento de provisionar un tenant en un SaaS de la suite. Eje de '
  'APLICACIÓN, distinto de platform.provisioning_requests (infraestructura). '
  'Sin DELETE físico: un trigger lo impide incluso para service_role.';
comment on column platform.saas_provisioning_requests.idempotency_key is
  'Determinista sobre (tenant, producto, request_version). Se envía al SaaS como '
  'cabecera Idempotency-Key y NO cambia entre reintentos del mismo intento.';
comment on column platform.saas_provisioning_requests.correlation_id is
  'Viaja al SaaS como X-Correlation-Id y queda en la auditoría. Permite cruzar '
  'un incidente entre los logs de MasterAdmin y los del producto.';

-- ---- Sin DELETE físico ----------------------------------------------------
create or replace function platform.reject_hard_delete()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  raise exception 'BORRADO_FISICO_PROHIBIDO: %.% no admite DELETE; use el estado CANCELLED',
    tg_table_schema, tg_table_name using errcode = '42501';
end;
$$;

comment on function platform.reject_hard_delete() is
  'Impide el DELETE físico. Se aplica incluso a service_role: el historial de '
  'provisioning es evidencia, y borrarlo deja al equipo sin saber qué se pidió, '
  'quién lo pidió y contra qué destino.';

create trigger saas_prov_no_delete before delete on platform.saas_provisioning_requests
  for each row execute function platform.reject_hard_delete();

-- ---- Máquina de estados ---------------------------------------------------
create or replace function platform.enforce_saas_provisioning_transition()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_valid boolean;
begin
  -- Se comprueba ANTES del atajo por estado sin cambios. Si estuviera después,
  -- un UPDATE que sólo tocara la clave pasaría de largo — y una clave alterada
  -- hace que el SaaS vea un intento NUEVO y pueda duplicar el tenant.
  if new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'IDEMPOTENCIA_ALTERADA: la clave de una solicitud no cambia entre reintentos'
      using errcode = '23514';
  end if;

  if old.status = new.status then
    return new;
  end if;

  v_valid := case old.status
    when 'PENDING'            then new.status in ('WAITING_INFRA', 'READY_TO_PROVISION', 'CANCELLED', 'FAILED')
    -- La infraestructura dedicada puede tardar semanas. Desde aquí sólo se sale
    -- cuando alguien marca el destino como READY, o cancelando.
    when 'WAITING_INFRA'      then new.status in ('READY_TO_PROVISION', 'CANCELLED', 'FAILED')
    when 'READY_TO_PROVISION' then new.status in ('PROVISIONING', 'CANCELLED', 'FAILED')
    -- Una vez llamando al SaaS ya no se puede cancelar: no sabemos si el alta
    -- se completó al otro lado. Se espera el resultado.
    when 'PROVISIONING'       then new.status in ('ACTIVE', 'FAILED')
    -- Reintento controlado: vuelve a la rampa de salida, con la MISMA clave de
    -- idempotencia, y sólo si quedan intentos.
    when 'FAILED'             then (new.status = 'READY_TO_PROVISION' and new.attempt_count < new.max_attempts)
                                   or new.status = 'CANCELLED'
    else false  -- ACTIVE y CANCELLED son terminales
  end;

  if not v_valid then
    raise exception 'TRANSICION_INVALIDA: no se puede pasar de % a % en el provisioning SaaS',
      old.status, new.status using errcode = '23514';
  end if;

  if new.status = 'PROVISIONING' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'ACTIVE' and new.completed_at is null then
    new.completed_at := now();
  end if;
  if new.status = 'CANCELLED' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;

  return new;
end;
$$;

create trigger saas_prov_transition_guard
  before update on platform.saas_provisioning_requests
  for each row execute function platform.enforce_saas_provisioning_transition();

-- ---------------------------------------------------------------------------
-- 3. tenant_product_mappings — identidades EXTERNAS del producto
-- ---------------------------------------------------------------------------
-- MasterAdmin NO interpreta `external_company_id` ni `external_organization_id`
-- como identificadores universales EBIM. Son identificadores DEL PRODUCTO.
-- Aunque hoy EWM pueda derivarlos de MasterAdmin, el modelo se mantiene
-- explícito: el día que un SaaS genere los suyos, nada aquí cambia.
-- ---------------------------------------------------------------------------
create table platform.tenant_product_mappings (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references platform.tenants (id) on delete restrict,
  saas_product_id             uuid not null references platform.saas_products (id) on delete restrict,
  deployment_target_id        uuid references platform.deployment_targets (id) on delete restrict,
  saas_provisioning_request_id uuid references platform.saas_provisioning_requests (id) on delete restrict,

  external_tenant_id          text,
  external_organization_id    text,
  external_company_id         text,

  status                      platform.tenant_product_mapping_status not null default 'PENDING',
  provisioned_at              timestamptz,
  registered_manually         boolean not null default false,
  -- Recursos NO sensibles devueltos por el SaaS (p. ej. initialWarehouseId).
  -- Nunca secretos: el mismo guard que protege deployment_targets.metadata.
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint tenant_product_mappings_active_ck check (
    status <> 'ACTIVE' or (external_tenant_id is not null and provisioned_at is not null)
  ),
  constraint tenant_product_mappings_ext_len_ck check (
    (external_tenant_id is null or length(external_tenant_id) between 1 and 200)
    and (external_organization_id is null or length(external_organization_id) between 1 and 200)
    and (external_company_id is null or length(external_company_id) between 1 and 200)
  )
);

create unique index tenant_product_mappings_uk
  on platform.tenant_product_mappings (tenant_id, saas_product_id);
create index tenant_product_mappings_product_ix
  on platform.tenant_product_mappings (saas_product_id);
create index tenant_product_mappings_request_ix
  on platform.tenant_product_mappings (saas_provisioning_request_id)
  where saas_provisioning_request_id is not null;

create trigger tenant_product_mappings_set_updated_at before update
  on platform.tenant_product_mappings
  for each row execute function platform.set_updated_at();
create trigger tenant_product_mappings_no_secrets
  before insert or update of metadata on platform.tenant_product_mappings
  for each row execute function platform.reject_secret_like_json('metadata');
create trigger tenant_product_mappings_no_delete before delete
  on platform.tenant_product_mappings
  for each row execute function platform.reject_hard_delete();

comment on table platform.tenant_product_mappings is
  'Correspondencia entre un tenant de MasterAdmin y su identidad DENTRO de un '
  'SaaS. Los external_* son identificadores DEL PRODUCTO, no identificadores '
  'universales EBIM: MasterAdmin los guarda y los muestra, no los interpreta.';
comment on column platform.tenant_product_mappings.metadata is
  'Recursos no sensibles devueltos por el SaaS (initialWarehouseId, etc.). '
  'El guard anti-secretos rechaza cualquier clave con pinta de credencial.';

-- ---------------------------------------------------------------------------
-- 4. Timeline auditable de cada solicitud
-- ---------------------------------------------------------------------------
create table platform.saas_provisioning_events (
  id                          bigint generated always as identity primary key,
  saas_provisioning_request_id uuid not null
    references platform.saas_provisioning_requests (id) on delete restrict,
  status                      platform.saas_provisioning_status not null,
  action                      text not null,
  message                     text not null,
  actor_user_id               uuid references platform.profiles (id) on delete set null,
  actor_role                  text,
  correlation_id              uuid,
  attempt                     integer,
  provider_http_status        integer,
  -- Detalle SANITIZADO. El adaptador nunca vuelca aquí el cuerpo crudo del
  -- proveedor ni ninguna cabecera de autorización.
  detail                      jsonb not null default '{}'::jsonb,
  occurred_at                 timestamptz not null default now(),
  constraint saas_prov_events_action_ck check (action ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint saas_prov_events_message_len_ck check (length(message) between 1 and 1000)
);

create index saas_prov_events_request_ix
  on platform.saas_provisioning_events (saas_provisioning_request_id, occurred_at);
create index saas_prov_events_correlation_ix
  on platform.saas_provisioning_events (correlation_id) where correlation_id is not null;

create trigger saas_prov_events_no_secrets before insert
  on platform.saas_provisioning_events
  for each row execute function platform.reject_secret_like_json('detail');
create trigger saas_prov_events_no_delete before delete
  on platform.saas_provisioning_events
  for each row execute function platform.reject_hard_delete();

comment on table platform.saas_provisioning_events is
  'Timeline append-only de una solicitud. APPEND-ONLY REAL: sin GRANT de '
  'INSERT/UPDATE/DELETE para authenticated y con trigger que bloquea el DELETE.';

-- ---------------------------------------------------------------------------
-- 5. Auditoría de CONFIGURACIÓN (fase 52)
-- ---------------------------------------------------------------------------
-- Cambiar la base_url de un destino de PRD es un acto de seguridad, no un
-- detalle de configuración. Se guarda el antes y el después, sin valores
-- secretos — que, por construcción, tampoco existen en estas tablas.
-- ---------------------------------------------------------------------------
create or replace function platform.log_provisioning_config_change(
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_before      jsonb,
  p_after       jsonb,
  p_product_id  uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_changed text[];
  v_key text;
begin
  -- Sólo los campos que REALMENTE cambiaron: un diff completo de 30 columnas
  -- esconde el único cambio que importaba.
  if p_before is not null and p_after is not null then
    for v_key in select jsonb_object_keys(p_after) loop
      if p_before -> v_key is distinct from p_after -> v_key then
        v_changed := array_append(v_changed, v_key);
      end if;
    end loop;
  end if;

  return platform.log_audit(
    p_action,
    p_entity_type,
    p_entity_id::text,
    null,
    null,
    jsonb_build_object(
      'before', coalesce(p_before, '{}'::jsonb),
      'after', coalesce(p_after, '{}'::jsonb),
      'changed_fields', to_jsonb(coalesce(v_changed, array[]::text[])),
      'saas_product_id', p_product_id,
      'actor_role', platform.my_provisioning_actor_role()
    )
  );
end;
$$;

comment on function platform.log_provisioning_config_change(text, uuid, text, jsonb, jsonb, uuid) is
  'Auditoría de cambios de configuración con antes/después y lista de campos '
  'modificados. Las tablas de configuración no contienen secretos, así que el '
  'diff completo es seguro por construcción — no por acuerdo.';

-- ---------------------------------------------------------------------------
-- 6. Vista operativa de provisioning
-- ---------------------------------------------------------------------------
create view platform.v_saas_provisioning
with (security_invoker = true) as
select
  r.id,
  r.tenant_id,
  t.name                       as tenant_name,
  t.slug                       as tenant_slug,
  t.deployment_mode,
  t.customer_organization_id,
  co.display_name              as customer_organization_name,
  t.managing_organization_id,
  mo.display_name              as managing_organization_name,
  r.saas_product_id,
  p.code                       as product_code,
  p.short_name                 as product_short_name,
  r.subscription_id,
  r.deployment_target_id,
  d.code                       as deployment_code,
  d.base_url,
  d.provisioning_status        as deployment_status,
  d.health_status              as deployment_health,
  r.product_integration_id,
  i.code                       as integration_code,
  i.integration_type,
  i.contract_version,
  r.idempotency_key,
  r.correlation_id,
  r.request_version,
  r.status,
  r.provisioning_environment,
  r.provisioning_policy,
  r.attempt_count,
  r.max_attempts,
  r.requested_by,
  pr.full_name                 as requested_by_name,
  r.requested_at,
  r.started_at,
  r.completed_at,
  r.cancelled_at,
  r.cancel_reason,
  r.last_error_code,
  r.last_error_message,
  r.provider_http_status,
  r.external_reference,
  m.id                         as mapping_id,
  m.external_tenant_id,
  m.external_organization_id,
  m.external_company_id,
  m.status                     as mapping_status,
  m.registered_manually,
  m.metadata                   as mapping_metadata,
  r.created_at,
  r.updated_at
from platform.saas_provisioning_requests r
join platform.tenants t on t.id = r.tenant_id
join platform.saas_products p on p.id = r.saas_product_id
left join platform.organizations co on co.id = t.customer_organization_id
left join platform.organizations mo on mo.id = t.managing_organization_id
left join platform.deployment_targets d on d.id = r.deployment_target_id
left join platform.product_integrations i on i.id = r.product_integration_id
left join platform.profiles pr on pr.id = r.requested_by
left join platform.tenant_product_mappings m
       on m.saas_provisioning_request_id = r.id;

comment on view platform.v_saas_provisioning is
  'Vista operativa de provisioning: solicitud + tenant + destino + integración + '
  'mapeo externo. No expone base de datos ni credenciales del SaaS. '
  'security_invoker: la RLS de las tablas base sigue mandando.';
