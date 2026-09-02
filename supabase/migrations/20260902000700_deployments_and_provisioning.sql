-- ============================================================================
-- EBIM Control Plane — 07 · Deployment targets, provisioning y auditoría
-- ----------------------------------------------------------------------------
-- Principio: el tenant LÓGICO está desacoplado de la infraestructura FÍSICA.
--   SHARED            : N tenants -> 1 target compartido
--   PARTNER_DEDICATED : N tenants del mismo partner -> 1 target del partner
--   TENANT_DEDICATED  : 1 tenant -> 1 target exclusivo
--
-- Seguridad: NUNCA se guarda DB password, service_role ni PAT en estas tablas.
-- Sólo referencias NO secretas. El token de Management API vive en secrets del
-- servidor (Edge Function), jamás en la app ni en la DB (prompt fase 8).
-- ============================================================================

create table platform.deployment_targets (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null,
  provider            platform.infra_provider not null default 'SUPABASE',
  deployment_mode     platform.deployment_mode not null,
  environment         platform.environment_kind not null default 'PRODUCTION',
  region              text,
  -- Referencia NO secreta del proyecto en el provider (ej. project ref de
  -- Supabase). Es un identificador público, no una credencial.
  provider_project_ref text,
  -- Sólo para PARTNER_DEDICATED / TENANT_DEDICATED: de quién es la infra.
  owner_organization_id uuid references platform.organizations (id) on delete restrict,
  saas_product_id     uuid references platform.saas_products (id) on delete restrict,
  status              platform.entity_status not null default 'ACTIVE',
  cost_center         text,
  -- Metadata NO sensible. Un trigger rechaza claves que huelan a secreto.
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deployment_targets_code_ck check (platform.is_slug(code)),
  -- Un target dedicado necesita dueño; uno compartido no debe tenerlo.
  constraint deployment_targets_owner_ck check (
    (deployment_mode = 'SHARED' and owner_organization_id is null)
    or (deployment_mode <> 'SHARED' and owner_organization_id is not null)
  )
);

create unique index deployment_targets_code_uk on platform.deployment_targets (code);
create index deployment_targets_owner_ix on platform.deployment_targets (owner_organization_id)
  where owner_organization_id is not null;
create index deployment_targets_mode_ix on platform.deployment_targets (deployment_mode);
create trigger deployment_targets_set_updated_at before update on platform.deployment_targets
  for each row execute function platform.set_updated_at();

comment on table platform.deployment_targets is
  'Metadata SEGURA de un entorno/instancia. Prohibido guardar aquí passwords, '
  'service_role keys o PATs: sólo referencias públicas del provider.';
comment on column platform.deployment_targets.provider_project_ref is
  'Identificador público del proyecto en el provider (ej. `abcdefghij` de Supabase). '
  'NO es una credencial.';

-- Guard anti-secretos. Un CHECK sobre JSONB no alcanza; un trigger sí puede
-- inspeccionar las claves. Es barato y evita el error clásico de pegar una key.
create or replace function platform.reject_secret_like_json()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_col text := tg_argv[0];
  v_doc jsonb := to_jsonb(new) -> v_col;
  v_key text;
  v_forbidden constant text[] := array[
    'password', 'passwd', 'secret', 'service_role', 'service_key', 'api_key',
    'apikey', 'token', 'pat', 'private_key', 'connection_string', 'dsn', 'jwt_secret'
  ];
begin
  if v_doc is null or jsonb_typeof(v_doc) <> 'object' then
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_doc) loop
    if exists (select 1 from unnest(v_forbidden) f where lower(v_key) like '%' || f || '%') then
      raise exception 'METADATA_CON_SECRETO: la clave "%" de %.% parece una credencial. Los secretos van en secrets del servidor, nunca en tablas de aplicación (prompt fase 8)',
        v_key, tg_table_name, v_col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function platform.reject_secret_like_json() is
  'Trigger genérico: rechaza claves con pinta de credencial en una columna JSONB. '
  'Se pasa el nombre de la columna como argumento del trigger.';

create trigger deployment_targets_no_secrets
  before insert or update of metadata on platform.deployment_targets
  for each row execute function platform.reject_secret_like_json('metadata');

-- FK diferida desde cost_allocations (declarada en la migración 05).
alter table platform.cost_allocations
  add constraint cost_alloc_deployment_target_fk
  foreign key (deployment_target_id) references platform.deployment_targets (id) on delete cascade;
create index cost_alloc_target_ix on platform.cost_allocations (deployment_target_id)
  where deployment_target_id is not null;

-- ---------------------------------------------------------------------------
-- tenant_deployments — dónde vive físicamente cada tenant
-- ---------------------------------------------------------------------------
create table platform.tenant_deployments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references platform.tenants (id) on delete cascade,
  deployment_target_id uuid not null references platform.deployment_targets (id) on delete restrict,
  is_primary          boolean not null default true,
  status              platform.entity_status not null default 'ACTIVE',
  deployed_at         timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index tenant_deployments_primary_uk on platform.tenant_deployments (tenant_id)
  where is_primary and status = 'ACTIVE';
create index tenant_deployments_target_ix on platform.tenant_deployments (deployment_target_id);
create trigger tenant_deployments_set_updated_at before update on platform.tenant_deployments
  for each row execute function platform.set_updated_at();

-- Coherencia entre el modo del tenant y el del target:
--   · TENANT_DEDICATED  -> el target no puede alojar otro tenant.
--   · PARTNER_DEDICATED -> el target debe pertenecer al partner que administra.
--   · SHARED            -> el target debe ser SHARED.
create or replace function platform.enforce_deployment_coherence()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_target record;
  v_others integer;
begin
  select t.deployment_mode, t.managing_organization_id, t.customer_organization_id, t.saas_product_id
    into v_tenant from platform.tenants t where t.id = new.tenant_id;

  select d.deployment_mode, d.owner_organization_id, d.saas_product_id
    into v_target from platform.deployment_targets d where d.id = new.deployment_target_id;

  if v_tenant.deployment_mode <> v_target.deployment_mode then
    raise exception 'MODO_DESPLIEGUE_INCOMPATIBLE: el tenant es % y el target es %',
      v_tenant.deployment_mode, v_target.deployment_mode using errcode = '23514';
  end if;

  if v_target.saas_product_id is not null and v_target.saas_product_id <> v_tenant.saas_product_id then
    raise exception 'PRODUCTO_INCOMPATIBLE: el target sirve a otro producto SaaS'
      using errcode = '23514';
  end if;

  if v_tenant.deployment_mode = 'TENANT_DEDICATED' then
    select count(*) into v_others
      from platform.tenant_deployments td
     where td.deployment_target_id = new.deployment_target_id
       and td.tenant_id <> new.tenant_id
       and td.status = 'ACTIVE';
    if v_others > 0 then
      raise exception 'TARGET_DEDICADO_OCUPADO: un target TENANT_DEDICATED aloja exactamente un tenant'
        using errcode = '23514';
    end if;
    if v_target.owner_organization_id is distinct from v_tenant.customer_organization_id then
      raise exception 'TARGET_DEDICADO_AJENO: el target dedicado pertenece a otra organización'
        using errcode = '23514';
    end if;
  end if;

  if v_tenant.deployment_mode = 'PARTNER_DEDICATED'
     and v_target.owner_organization_id is distinct from v_tenant.managing_organization_id then
    raise exception 'TARGET_PARTNER_AJENO: el target dedicado no pertenece al partner que administra el tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger tenant_deployments_coherence_guard
  before insert or update on platform.tenant_deployments
  for each row execute function platform.enforce_deployment_coherence();

-- ---------------------------------------------------------------------------
-- provisioning_requests — la cola de trabajo. Máquina de estados + idempotencia.
-- ---------------------------------------------------------------------------
create table platform.provisioning_requests (
  id                  uuid primary key default gen_random_uuid(),
  idempotency_key     text not null,
  action              platform.provisioning_action not null,
  status              platform.provisioning_status not null default 'PENDING',
  -- DRY_RUN por defecto (prompt fase 8). LIVE exige autorización explícita.
  mode                text not null default 'DRY_RUN',
  tenant_id           uuid references platform.tenants (id) on delete cascade,
  deployment_target_id uuid references platform.deployment_targets (id) on delete set null,
  saas_product_id     uuid references platform.saas_products (id) on delete set null,
  requested_by        uuid references platform.profiles (id) on delete set null,
  -- Payload SIN secretos (mismo guard que deployment_targets).
  payload             jsonb not null default '{}'::jsonb,
  result              jsonb not null default '{}'::jsonb,
  error_message       text,
  attempts            integer not null default 0,
  max_attempts        integer not null default 3,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint provisioning_mode_ck check (mode in ('DRY_RUN', 'LIVE')),
  constraint provisioning_attempts_ck check (attempts >= 0 and attempts <= max_attempts),
  -- Un fallo sin mensaje es un fallo que nadie puede diagnosticar mañana.
  constraint provisioning_failed_needs_message_ck
    check (status <> 'FAILED' or error_message is not null)
);

create unique index provisioning_idempotency_uk on platform.provisioning_requests (idempotency_key);
create index provisioning_status_ix on platform.provisioning_requests (status);
create index provisioning_tenant_ix on platform.provisioning_requests (tenant_id) where tenant_id is not null;
create trigger provisioning_set_updated_at before update on platform.provisioning_requests
  for each row execute function platform.set_updated_at();

create trigger provisioning_payload_no_secrets
  before insert or update of payload on platform.provisioning_requests
  for each row execute function platform.reject_secret_like_json('payload');

comment on table platform.provisioning_requests is
  'Cola de provisioning. mode=DRY_RUN por defecto: ninguna llamada remota real se '
  'ejecuta sin autorización explícita. idempotency_key evita duplicar trabajo al reintentar.';

-- Máquina de estados. Transiciones válidas y sólo esas: un request no puede
-- volver de SUCCEEDED a RUNNING ni saltar de PENDING a SUCCEEDED sin ejecutarse.
create or replace function platform.enforce_provisioning_transition()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_valid boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  v_valid := case old.status
    when 'PENDING'    then new.status in ('VALIDATING', 'CANCELLED', 'FAILED')
    when 'VALIDATING' then new.status in ('RUNNING', 'FAILED', 'CANCELLED')
    when 'RUNNING'    then new.status in ('SUCCEEDED', 'FAILED', 'CANCELLED')
    -- Reintento controlado: un FAILED puede volver a PENDING si quedan intentos.
    when 'FAILED'     then new.status = 'PENDING' and new.attempts < new.max_attempts
    else false  -- SUCCEEDED y CANCELLED son terminales
  end;

  if not v_valid then
    raise exception 'TRANSICION_INVALIDA: no se puede pasar de % a % (máquina de estados de provisioning)',
      old.status, new.status using errcode = '23514';
  end if;

  if new.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') and new.finished_at is null then
    new.finished_at := now();
  end if;
  if new.status = 'RUNNING' and new.started_at is null then
    new.started_at := now();
  end if;

  return new;
end;
$$;

create trigger provisioning_transition_guard
  before update of status on platform.provisioning_requests
  for each row execute function platform.enforce_provisioning_transition();

-- ---------------------------------------------------------------------------
-- provisioning_events — timeline de cada request. Append-only.
-- ---------------------------------------------------------------------------
create table platform.provisioning_events (
  id                      uuid primary key default gen_random_uuid(),
  provisioning_request_id uuid not null references platform.provisioning_requests (id) on delete cascade,
  status                  platform.provisioning_status not null,
  message                 text not null,
  -- Detalle SANITIZADO. El adapter nunca vuelca aquí la respuesta cruda del provider.
  detail                  jsonb not null default '{}'::jsonb,
  occurred_at             timestamptz not null default now()
);

create index provisioning_events_request_ix
  on platform.provisioning_events (provisioning_request_id, occurred_at);

create trigger provisioning_events_no_secrets
  before insert on platform.provisioning_events
  for each row execute function platform.reject_secret_like_json('detail');

comment on table platform.provisioning_events is
  'Timeline append-only de un request. El enforcement de append-only vive en las '
  'políticas RLS y en los GRANT (migración 09), no "por convención".';

-- ---------------------------------------------------------------------------
-- audit_logs — acciones administrativas sensibles. Append-only real.
-- ---------------------------------------------------------------------------
create table platform.audit_logs (
  id            bigint generated always as identity primary key,
  actor_user_id uuid references platform.profiles (id) on delete set null,
  actor_email   text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  organization_id uuid references platform.organizations (id) on delete set null,
  tenant_id     uuid references platform.tenants (id) on delete set null,
  -- Metadata segura: mismo guard anti-secretos.
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);

create index audit_logs_occurred_ix on platform.audit_logs (occurred_at desc);
create index audit_logs_actor_ix on platform.audit_logs (actor_user_id) where actor_user_id is not null;
create index audit_logs_entity_ix on platform.audit_logs (entity_type, entity_id);
create index audit_logs_org_ix on platform.audit_logs (organization_id) where organization_id is not null;
create index audit_logs_tenant_ix on platform.audit_logs (tenant_id) where tenant_id is not null;

create trigger audit_logs_no_secrets
  before insert on platform.audit_logs
  for each row execute function platform.reject_secret_like_json('metadata');

comment on table platform.audit_logs is
  'Bitácora append-only de acciones administrativas. APPEND-ONLY REAL: no hay GRANT de '
  'UPDATE/DELETE para authenticated (migración 09) y no existe política que los permita. '
  'El COMMENT describe el enforcement que existe, no una intención (lección esupplier-030).';

-- Helper para registrar auditoría desde otras funciones.
create or replace function platform.log_audit(
  p_action        text,
  p_entity_type   text,
  p_entity_id     text default null,
  p_organization_id uuid default null,
  p_tenant_id     uuid default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id bigint;
  v_email text;
begin
  select p.email into v_email from platform.profiles p where p.id = auth.uid();

  insert into platform.audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id,
    organization_id, tenant_id, metadata
  )
  values (
    auth.uid(), v_email, p_action, p_entity_type, p_entity_id,
    p_organization_id, p_tenant_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;
