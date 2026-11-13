-- ============================================================================
-- Sincronización periódica de tenants: MasterAdmin ↔ las 8 apps de la suite
-- ----------------------------------------------------------------------------
-- Brecha (auditoría 2026-11-12): las apps tienen clientes que MasterAdmin no
-- conoce (32) y hubo un vínculo roto (un tenant dado de alta que ya no existe
-- en la app). MasterAdmin solo sabía lo que él mismo dio de alta, y nadie lo
-- detectaba hasta que una persona cruzaba las bases a mano.
--
-- Esta migración:
--   1. Canal opcional `tenant-inventory.v1` por integración (ruta + scope de
--      lectura). Una app que no lo anuncia NO tiene inventario: la consola lo
--      dice y no lo inventa. Contrato: docs/platform-provisioning/TENANT_INVENTORY_CONTRACT.md.
--   2. Corridas (`tenant_sync_runs`), resultado por destino
--      (`tenant_sync_target_results`) y hallazgos (`tenant_sync_findings`):
--      vínculo roto, estado distinto o cliente que existe solo en la app.
--   3. Canal servidor (job / clave de servicio): plan, inicio, resultado por
--      destino y cierre. La Edge Function `tenant-sync` OBSERVA (GET firmados);
--      la base DECIDE qué es un hallazgo, lo deduplica y lo cierra solo cuando
--      deja de verse.
--   4. Consola (super admin o EBIM_PRODUCT_ADMIN): listar, marcar como
--      resuelto, descartar con motivo, y «Registrar en el Admin Maestro», que
--      reutiliza upsert_organization → create_tenant →
--      create_saas_provisioning_request → register_manual_provisioning sin
--      llamar a la app.
--   5. Job diario con pg_cron vía `invoke_scheduled_function('TENANT_SYNC')`
--      (sin URL ni claves en git: Vault del entorno).
--
-- Idempotente: se puede aplicar dos veces sin error ni duplicados.
-- Test: supabase/tests/58_tenant_sync.test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canal tenant-inventory.v1 (opcional) en la integración
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column if not exists inventory_path       text,
  add column if not exists inventory_read_scope text;

alter table platform.product_integrations
  drop constraint if exists product_integrations_inventory_path_ck,
  drop constraint if exists product_integrations_inventory_scope_ck,
  drop constraint if exists product_integrations_inventory_all_or_none_ck;

alter table platform.product_integrations
  add constraint product_integrations_inventory_path_ck check (
    inventory_path is null or platform.is_safe_url_path(inventory_path)),
  -- Scope de SOLO LECTURA y propio: nunca el de alta ni uno de escritura. Una
  -- credencial que lista clientes no da de alta ni suspende a nadie.
  add constraint product_integrations_inventory_scope_ck check (
    inventory_read_scope is null
    or (inventory_read_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$'
        and inventory_read_scope is distinct from create_scope
        and inventory_read_scope is distinct from entitlements_write_scope
        and inventory_read_scope is distinct from lifecycle_write_scope
        and not (inventory_read_scope = any (additional_scopes)))),
  add constraint product_integrations_inventory_all_or_none_ck check (
    (inventory_path is null) = (inventory_read_scope is null));

comment on column platform.product_integrations.inventory_path is
  'Ruta relativa de GET /tenants del contrato tenant-inventory.v1. NULL = la app no anuncia inventario.';
comment on column platform.product_integrations.inventory_read_scope is
  'Scope de solo lectura del inventario (<productCode>:tenants:list). Distinto de alta, entitlements y lifecycle.';

create or replace function platform.configure_inventory_integration(
  p_integration_id uuid,
  p_inventory_path text,
  p_read_scope     text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_int record;
begin
  select * into v_int from platform.product_integrations where id = p_integration_id for update;
  if v_int.id is null then
    raise exception 'INTEGRACION_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if not platform.has_product_permission('platform.integration.manage', v_int.saas_product_id) then
    raise exception 'NO_AUTORIZADO: configurar el inventario exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;
  if v_int.integration_type <> 'HTTP_M2M' then
    raise exception 'TIPO_NO_SOPORTADO: el contrato tenant-inventory.v1 solo viaja por HTTP_M2M' using errcode = '23514';
  end if;

  update platform.product_integrations
     set inventory_path = nullif(btrim(p_inventory_path), ''),
         inventory_read_scope = nullif(btrim(p_read_scope), '')
   where id = p_integration_id;

  insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'INVENTORY_INTEGRATION_CONFIGURED', 'product_integration', p_integration_id::text,
          jsonb_build_object('inventory_route', p_inventory_path, 'read_scope', p_read_scope));
  return p_integration_id;
end;
$$;

comment on function platform.configure_inventory_integration(uuid, text, text) is
  'Ruta y scope del contrato tenant-inventory.v1 de una integración HTTP_M2M (los dos o ninguno). '
  'Se configura cuando la app certifica el inventario. platform.integration.manage.';

revoke all on function platform.configure_inventory_integration(uuid, text, text) from public, anon;
grant execute on function platform.configure_inventory_integration(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Interruptor global y bitácora del job
-- ---------------------------------------------------------------------------
alter table platform.tenant_lifecycle_settings
  add column if not exists tenant_sync_enabled boolean not null default true;

comment on column platform.tenant_lifecycle_settings.tenant_sync_enabled is
  'Sincronización diaria de tenants con las apps (solo lectura en las apps). Encendida por defecto.';

alter table platform.lifecycle_job_runs drop constraint if exists lifecycle_job_runs_job_ck;
alter table platform.lifecycle_job_runs
  add constraint lifecycle_job_runs_job_ck
  check (job in ('LIFECYCLE_CYCLE', 'ENTITLEMENT_SYNC', 'ENTITLEMENT_SWEEP', 'AUTOCHARGE', 'TENANT_SYNC'));

-- ---------------------------------------------------------------------------
-- 3. Corridas, resultado por destino y hallazgos
-- ---------------------------------------------------------------------------
create table if not exists platform.tenant_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  trigger_kind     text not null,
  requested_by     uuid references platform.profiles (id) on delete set null,
  status           text not null default 'RUNNING',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  targets_total    integer not null default 0,
  targets_checked  integer not null default 0,
  findings_opened  integer not null default 0,
  findings_closed  integer not null default 0,
  error_code       text,
  constraint tenant_sync_runs_trigger_ck check (trigger_kind in ('SCHEDULED', 'MANUAL')),
  constraint tenant_sync_runs_status_ck check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  constraint tenant_sync_runs_finished_ck check ((status = 'RUNNING') = (finished_at is null)),
  constraint tenant_sync_runs_error_ck check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

create index if not exists tenant_sync_runs_started_ix on platform.tenant_sync_runs (started_at desc);
create index if not exists tenant_sync_runs_requested_by_ix on platform.tenant_sync_runs (requested_by);
-- Una sola corrida en curso a la vez.
create unique index if not exists tenant_sync_runs_running_uk on platform.tenant_sync_runs ((true))
  where status = 'RUNNING';

comment on table platform.tenant_sync_runs is
  'Cada sincronización de tenants con las apps (diaria o «Sincronizar ahora»). Escribe solo el canal servidor.';

create table if not exists platform.tenant_sync_target_results (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references platform.tenant_sync_runs (id) on delete cascade,
  deployment_target_id   uuid not null references platform.deployment_targets (id) on delete cascade,
  saas_product_id        uuid not null references platform.saas_products (id) on delete cascade,
  product_integration_id uuid references platform.product_integrations (id) on delete set null,
  checked_at             timestamptz not null default now(),
  verify_methods         text[] not null default '{}'::text[],
  links_total            integer not null default 0,
  links_ok               integer not null default 0,
  links_broken           integer not null default 0,
  links_state_mismatch   integer not null default 0,
  links_unverified       integer not null default 0,
  inventory_status       text not null default 'NOT_AVAILABLE',
  inventory_items        integer not null default 0,
  inventory_unknown      integer not null default 0,
  findings_opened        integer not null default 0,
  findings_closed        integer not null default 0,
  outcome                text not null,
  error_code             text,
  constraint tenant_sync_target_results_methods_ck
    check (verify_methods <@ array['GET_STATUS', 'LIFECYCLE', 'INVENTORY']::text[]),
  constraint tenant_sync_target_results_inventory_ck
    check (inventory_status in ('AVAILABLE', 'NOT_AVAILABLE', 'FAILED')),
  constraint tenant_sync_target_results_outcome_ck
    check (outcome in ('OK', 'WITH_FINDINGS', 'PARTIAL', 'FAILED', 'NOT_VERIFIABLE')),
  constraint tenant_sync_target_results_error_ck
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint tenant_sync_target_results_counts_ck
    check (least(links_total, links_ok, links_broken, links_state_mismatch, links_unverified,
                 inventory_items, inventory_unknown, findings_opened, findings_closed) >= 0)
);

create unique index if not exists tenant_sync_target_results_run_target_uk
  on platform.tenant_sync_target_results (run_id, deployment_target_id);
create index if not exists tenant_sync_target_results_target_ix
  on platform.tenant_sync_target_results (deployment_target_id, checked_at desc);
create index if not exists tenant_sync_target_results_product_ix
  on platform.tenant_sync_target_results (saas_product_id);
create index if not exists tenant_sync_target_results_integration_ix
  on platform.tenant_sync_target_results (product_integration_id);

comment on table platform.tenant_sync_target_results is
  'Lo que vio una corrida en un destino (app × entorno): vínculos revisados, inventario y resultado.';

create table if not exists platform.tenant_sync_findings (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null,
  -- Identidad estable del hallazgo: una misma diferencia vista en N corridas es UNA fila.
  fingerprint              text not null,
  saas_product_id          uuid not null references platform.saas_products (id) on delete cascade,
  deployment_target_id     uuid not null references platform.deployment_targets (id) on delete cascade,
  tenant_id                uuid references platform.tenants (id) on delete set null,
  mapping_id               uuid references platform.tenant_product_mappings (id) on delete set null,
  external_tenant_id       text,
  external_organization_id text,
  external_company_id      text,
  app_code                 text,
  app_name                 text,
  app_status               text,
  masteradmin_state        text,
  app_state                text,
  detail                   jsonb not null default '{}'::jsonb,
  status                   text not null default 'OPEN',
  first_run_id             uuid references platform.tenant_sync_runs (id) on delete set null,
  last_run_id              uuid references platform.tenant_sync_runs (id) on delete set null,
  first_seen_at            timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  times_seen               integer not null default 1,
  resolution               text,
  resolution_reason        text,
  resolved_by              uuid references platform.profiles (id) on delete set null,
  resolved_at              timestamptz,
  registered_tenant_id     uuid references platform.tenants (id) on delete set null,
  constraint tenant_sync_findings_kind_ck check (kind in ('BROKEN_LINK', 'STATE_MISMATCH', 'APP_ONLY')),
  constraint tenant_sync_findings_status_ck check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  constraint tenant_sync_findings_resolution_ck check (
    resolution is null or resolution in ('REGISTERED', 'MARKED_RESOLVED', 'DISMISSED', 'NO_LONGER_DETECTED')),
  constraint tenant_sync_findings_closed_ck check (
    (status = 'OPEN' and resolution is null and resolved_at is null)
    or (status = 'RESOLVED' and resolution in ('REGISTERED', 'MARKED_RESOLVED', 'NO_LONGER_DETECTED')
        and resolved_at is not null)
    or (status = 'DISMISSED' and resolution = 'DISMISSED' and resolved_at is not null)),
  -- Una persona que cierra o descarta deja motivo; el cierre automático no.
  constraint tenant_sync_findings_reason_ck check (
    resolution is null or resolution = 'NO_LONGER_DETECTED'
    or nullif(btrim(coalesce(resolution_reason, '')), '') is not null),
  constraint tenant_sync_findings_registered_ck check (
    (resolution = 'REGISTERED') = (registered_tenant_id is not null)),
  constraint tenant_sync_findings_shape_ck check (
    (kind = 'APP_ONLY' and external_tenant_id is not null)
    or (kind <> 'APP_ONLY' and mapping_id is not null) or status <> 'OPEN'),
  constraint tenant_sync_findings_ext_len_ck check (
    coalesce(length(external_tenant_id), 0) <= 200 and coalesce(length(external_organization_id), 0) <= 200
    and coalesce(length(external_company_id), 0) <= 200 and coalesce(length(app_code), 0) <= 200
    and coalesce(length(app_name), 0) <= 300 and coalesce(length(fingerprint), 0) <= 400)
);

-- Viva = abierta o descartada: lo descartado sigue descartado aunque se vuelva a ver.
create unique index if not exists tenant_sync_findings_live_uk
  on platform.tenant_sync_findings (fingerprint) where status in ('OPEN', 'DISMISSED');
create index if not exists tenant_sync_findings_status_ix
  on platform.tenant_sync_findings (status, last_seen_at desc);
create index if not exists tenant_sync_findings_target_ix
  on platform.tenant_sync_findings (deployment_target_id, kind) where status = 'OPEN';
create index if not exists tenant_sync_findings_product_ix on platform.tenant_sync_findings (saas_product_id);
create index if not exists tenant_sync_findings_tenant_ix on platform.tenant_sync_findings (tenant_id);
create index if not exists tenant_sync_findings_mapping_ix on platform.tenant_sync_findings (mapping_id);
create index if not exists tenant_sync_findings_first_run_ix on platform.tenant_sync_findings (first_run_id);
create index if not exists tenant_sync_findings_last_run_ix on platform.tenant_sync_findings (last_run_id);
create index if not exists tenant_sync_findings_resolved_by_ix on platform.tenant_sync_findings (resolved_by);
create index if not exists tenant_sync_findings_registered_ix on platform.tenant_sync_findings (registered_tenant_id);

drop trigger if exists tenant_sync_findings_no_secrets on platform.tenant_sync_findings;
create trigger tenant_sync_findings_no_secrets
  before insert or update of detail on platform.tenant_sync_findings
  for each row execute function platform.reject_secret_like_json('detail');

comment on table platform.tenant_sync_findings is
  'Diferencias entre MasterAdmin y una app: vínculo roto, estado distinto o cliente que existe solo en la app. '
  'La base las abre, deduplica y cierra; una persona las resuelve o descarta con motivo.';

-- RLS: lectura para quien gestiona la plataforma; escritura solo por las RPC de esta migración.
alter table platform.tenant_sync_runs enable row level security;
alter table platform.tenant_sync_runs force row level security;
alter table platform.tenant_sync_target_results enable row level security;
alter table platform.tenant_sync_target_results force row level security;
alter table platform.tenant_sync_findings enable row level security;
alter table platform.tenant_sync_findings force row level security;

revoke all on platform.tenant_sync_runs from public, anon, authenticated;
revoke all on platform.tenant_sync_target_results from public, anon, authenticated;
revoke all on platform.tenant_sync_findings from public, anon, authenticated;
grant select on platform.tenant_sync_runs to authenticated, service_role;
grant select on platform.tenant_sync_target_results to authenticated, service_role;
grant select on platform.tenant_sync_findings to authenticated, service_role;

drop policy if exists tenant_sync_runs_select on platform.tenant_sync_runs;
create policy tenant_sync_runs_select on platform.tenant_sync_runs
  for select to authenticated using (platform.can_manage_platform_entities());
drop policy if exists tenant_sync_target_results_select on platform.tenant_sync_target_results;
create policy tenant_sync_target_results_select on platform.tenant_sync_target_results
  for select to authenticated using (platform.can_manage_platform_entities());
drop policy if exists tenant_sync_findings_select on platform.tenant_sync_findings;
create policy tenant_sync_findings_select on platform.tenant_sync_findings
  for select to authenticated using (platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 4. ¿Quién gestiona la sincronización? (reutiliza los helpers existentes)
-- ---------------------------------------------------------------------------
create or replace function platform.can_manage_tenant_sync()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.is_super_admin() or platform.can_manage_platform_entities();
$$;

comment on function platform.can_manage_tenant_sync() is
  'Super admin o EBIM_PRODUCT_ADMIN: lanzan la sincronización, resuelven y descartan hallazgos. '
  'La usa la Edge Function tenant-sync como booleano explícito antes de asumir service_role.';

revoke all on function platform.can_manage_tenant_sync() from public, anon;
grant execute on function platform.can_manage_tenant_sync() to authenticated, service_role;

-- Estado que la app DEBERÍA tener según MasterAdmin (mismo criterio que lifecycle.v1).
create or replace function platform.tenant_sync_expected_state(p_status platform.tenant_status)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_status::text
    when 'ACTIVE' then 'ACTIVE'
    when 'SUSPENDED' then 'SUSPENDED'
    when 'CHURNED' then 'SUSPENDED'
    when 'ARCHIVED' then 'SUSPENDED'
    else null  -- PENDING: aún no opera; no se compara.
  end;
$$;

revoke all on function platform.tenant_sync_expected_state(platform.tenant_status) from public, anon;
grant execute on function platform.tenant_sync_expected_state(platform.tenant_status) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Canal servidor: plan, inicio, resultado por destino y cierre
-- ---------------------------------------------------------------------------

-- Destinos a revisar: con integración, activos, y habilitados o con vínculos vivos.
create or replace function platform.tenant_sync_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: tenant_sync_plan() resuelve configuración sensible' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product', jsonb_build_object('id', p.id, 'code', p.code, 'short_name', p.short_name),
      'deployment', jsonb_build_object(
        'id', d.id, 'code', d.code, 'environment', d.provisioning_environment::text,
        'base_url', d.base_url, 'timeout_ms', d.timeout_ms, 'retry_count', d.retry_count,
        'enabled', d.provisioning_enabled),
      'integration', jsonb_build_object(
        'id', i.id, 'code', i.code, 'type', i.integration_type::text, 'enabled', i.enabled,
        'adapter_key', i.adapter_key::text,
        'capabilities', to_jsonb(platform.integration_capabilities(i.adapter_key, i.status_path_template, i.read_scope)),
        'issuer', i.issuer, 'audience', i.audience, 'subject', i.subject,
        'algorithm', i.algorithm::text, 'token_ttl_seconds', i.token_ttl_seconds,
        'lifecycle_path', i.lifecycle_path, 'lifecycle_read_scope', i.lifecycle_read_scope,
        'inventory_path', i.inventory_path, 'inventory_read_scope', i.inventory_read_scope,
        'allowed_hosts', to_jsonb(i.allowed_hosts)),
      'credential', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'type', c.type::text, 'enabled', c.enabled, 'algorithm', c.algorithm::text,
        'token_ttl_seconds', c.token_ttl_seconds,
        -- NOMBRE del secreto. El valor lo resuelve la Edge Function.
        'secret_ref', c.secret_ref) end,
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'mapping_id', m.id, 'tenant_id', m.tenant_id, 'request_id', m.saas_provisioning_request_id,
                 'external_tenant_id', m.external_tenant_id,
                 'external_organization_id', m.external_organization_id,
                 'external_company_id', m.external_company_id,
                 'expected_state', platform.tenant_sync_expected_state(t.status))
               order by m.provisioned_at)
          from platform.tenant_product_mappings m
          join platform.tenants t on t.id = m.tenant_id
         where m.deployment_target_id = d.id and m.status = 'ACTIVE'), '[]'::jsonb)
    ) order by p.sort_order, d.code)
      from platform.deployment_targets d
      join platform.saas_products p on p.id = d.saas_product_id
      join platform.product_integrations i on i.id = d.product_integration_id
      left join platform.credential_profiles c on c.id = d.credential_profile_id
     where d.status = 'ACTIVE'
       and (d.provisioning_enabled
            or exists (select 1 from platform.tenant_product_mappings m
                        where m.deployment_target_id = d.id and m.status = 'ACTIVE'))
  ), '[]'::jsonb);
end;
$$;

comment on function platform.tenant_sync_plan() is
  'Destinos y vínculos activos que revisa la sincronización, con la configuración M2M (nombre del secreto, no su valor). Solo el canal servidor.';

revoke all on function platform.tenant_sync_plan() from public, anon, authenticated;
grant execute on function platform.tenant_sync_plan() to service_role;

create or replace function platform.begin_tenant_sync_run(
  p_trigger      text,
  p_requested_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: las corridas las abre el job o la Edge Function' using errcode = '42501';
  end if;
  if p_trigger not in ('SCHEDULED', 'MANUAL') then
    raise exception 'PETICION_INVALIDA: trigger' using errcode = '22023';
  end if;
  if p_trigger = 'MANUAL' and p_requested_by is null then
    raise exception 'PETICION_INVALIDA: una corrida manual dice quién la pidió' using errcode = '22023';
  end if;

  -- Una corrida que murió a medias (función cortada) no bloquea para siempre.
  update platform.tenant_sync_runs
     set status = 'FAILED', finished_at = now(), error_code = 'INTERRUMPIDA'
   where status = 'RUNNING' and started_at < now() - interval '30 minutes';

  if exists (select 1 from platform.tenant_sync_runs where status = 'RUNNING') then
    raise exception 'SINCRONIZACION_EN_CURSO: ya hay una sincronización corriendo; espere a que termine'
      using errcode = '55P03';
  end if;

  insert into platform.tenant_sync_runs (trigger_kind, requested_by)
  values (p_trigger, case when p_trigger = 'MANUAL' then p_requested_by end)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function platform.begin_tenant_sync_run(text, uuid) from public, anon, authenticated;
grant execute on function platform.begin_tenant_sync_run(text, uuid) to service_role;

-- Núcleo: abrir o refrescar un hallazgo vivo. Devuelve true si es nuevo. Sin GRANT.
create or replace function platform._upsert_tenant_sync_finding(
  p_run_id      uuid,
  p_kind        text,
  p_fingerprint text,
  p_product_id  uuid,
  p_target_id   uuid,
  p_tenant_id   uuid,
  p_mapping_id  uuid,
  p_ext_tenant  text,
  p_ext_org     text,
  p_ext_company text,
  p_app_code    text,
  p_app_name    text,
  p_app_status  text,
  p_ma_state    text,
  p_app_state   text,
  p_detail      jsonb
)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  update platform.tenant_sync_findings
     set last_run_id = p_run_id, last_seen_at = now(), times_seen = times_seen + 1,
         app_code = p_app_code, app_name = p_app_name, app_status = p_app_status,
         masteradmin_state = p_ma_state, app_state = p_app_state,
         external_organization_id = coalesce(p_ext_org, external_organization_id),
         external_company_id = coalesce(p_ext_company, external_company_id),
         detail = coalesce(p_detail, '{}'::jsonb)
   where fingerprint = p_fingerprint and status in ('OPEN', 'DISMISSED')
  returning id into v_id;
  if v_id is not null then
    return false;
  end if;

  insert into platform.tenant_sync_findings (
    kind, fingerprint, saas_product_id, deployment_target_id, tenant_id, mapping_id,
    external_tenant_id, external_organization_id, external_company_id,
    app_code, app_name, app_status, masteradmin_state, app_state, detail, first_run_id, last_run_id)
  values (
    p_kind, p_fingerprint, p_product_id, p_target_id, p_tenant_id, p_mapping_id,
    left(p_ext_tenant, 200), left(p_ext_org, 200), left(p_ext_company, 200),
    left(p_app_code, 200), left(p_app_name, 300), p_app_status, p_ma_state, p_app_state,
    coalesce(p_detail, '{}'::jsonb), p_run_id, p_run_id)
  on conflict (fingerprint) where status in ('OPEN', 'DISMISSED') do nothing;
  return found;
end;
$$;

revoke all on function platform._upsert_tenant_sync_finding(uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;

/*
 * Resultado de un destino. La Edge Function manda lo que OBSERVÓ:
 *
 *   { "verify_methods": ["GET_STATUS" | "LIFECYCLE" | "INVENTORY"],
 *     "error_code": null | "CODIGO",
 *     "links": [ { "mapping_id", "exists": "FOUND" | "NOT_FOUND" | "UNKNOWN",
 *                  "app_state": "ACTIVE" | "SUSPENDED" | null,
 *                  "ids_match": bool | null, "http_status": int | null, "error_code": text | null } ],
 *     "inventory": { "status": "AVAILABLE" | "NOT_AVAILABLE" | "FAILED", "complete": bool,
 *                    "error_code": text | null,
 *                    "items": [ { "externalTenantId", "externalOrganizationId", "externalCompanyId",
 *                                 "controlPlaneTenantId", "code", "name", "status" } ] } }
 *
 * La base decide: qué es un hallazgo (con el estado ACTUAL del tenant, no con
 * lo que diga el cuerpo), lo deduplica por huella y cierra lo que ya no se ve.
 * Solo cierra lo que esta corrida pudo comprobar: un inventario incompleto o un
 * vínculo sin verificar no cierran nada.
 */
create or replace function platform.record_tenant_sync_target_result(
  p_run_id               uuid,
  p_deployment_target_id uuid,
  p_result               jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  c_uuid      constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_code      constant text := '^[A-Z][A-Z0-9_]{1,63}$';
  v_run       record;
  v_target    record;
  v_methods   text[];
  v_error     text := nullif(p_result ->> 'error_code', '');
  v_inv       jsonb := coalesce(p_result -> 'inventory', '{}'::jsonb);
  v_inv_status text := coalesce(nullif(p_result -> 'inventory' ->> 'status', ''), 'NOT_AVAILABLE');
  v_inv_complete boolean := false;
  v_link      jsonb;
  v_map       record;
  v_item      record;
  v_exists    text;
  v_app_state text;
  v_expected  text;
  v_pending   boolean;
  v_fp        text;
  v_found     uuid[] := '{}';
  v_broken    uuid[] := '{}';
  v_mismatch  uuid[] := '{}';
  v_unknown   uuid[] := '{}';
  v_checked   uuid[] := '{}';
  v_live      text[] := '{}';
  v_opened    integer := 0;
  v_closed    integer := 0;
  v_closed_n  integer;
  v_inv_items integer := 0;
  v_inv_unknown integer := 0;
  v_total     integer;
  v_outcome   text;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: los resultados los registra el job o la Edge Function' using errcode = '42501';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 4194304 then
    raise exception 'PETICION_INVALIDA: resultado' using errcode = '22023';
  end if;
  if v_error is not null and v_error !~ c_code then
    v_error := 'ERROR';
  end if;
  if v_inv_status not in ('AVAILABLE', 'NOT_AVAILABLE', 'FAILED') then
    raise exception 'PETICION_INVALIDA: inventory.status' using errcode = '22023';
  end if;
  -- Sin error propio del destino, el del inventario explica una revisión parcial.
  if v_error is null and coalesce(v_inv ->> 'error_code', '') ~ c_code then
    v_error := v_inv ->> 'error_code';
  end if;
  v_inv_complete := v_inv_status = 'AVAILABLE' and coalesce(v_inv ->> 'complete', 'false') = 'true'
                    and jsonb_typeof(v_inv -> 'items') = 'array';

  select * into v_run from platform.tenant_sync_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'RUNNING' then
    raise exception 'CORRIDA_NO_ABIERTA' using errcode = '55000';
  end if;
  select d.id, d.code, d.saas_product_id, d.product_integration_id into v_target
    from platform.deployment_targets d where d.id = p_deployment_target_id;
  if v_target.id is null then
    raise exception 'DESTINO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if exists (select 1 from platform.tenant_sync_target_results r
              where r.run_id = p_run_id and r.deployment_target_id = p_deployment_target_id) then
    raise exception 'RESULTADO_DUPLICADO: este destino ya se registró en la corrida' using errcode = '23505';
  end if;

  select coalesce(array_agg(distinct m order by m), '{}') into v_methods
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_result -> 'verify_methods') = 'array' then p_result -> 'verify_methods'
                else '[]'::jsonb end) m
   where m in ('GET_STATUS', 'LIFECYCLE', 'INVENTORY');

  -- ---- Vínculos verificados uno a uno (GET_STATUS / lifecycle) -------------
  for v_link in
    select value from jsonb_array_elements(
      case when jsonb_typeof(p_result -> 'links') = 'array' then p_result -> 'links' else '[]'::jsonb end)
  loop
    continue when coalesce(v_link ->> 'mapping_id', '') !~ c_uuid;
    select m.id, m.tenant_id, m.external_tenant_id, m.external_organization_id, m.external_company_id,
           t.status as tenant_status
      into v_map
      from platform.tenant_product_mappings m
      join platform.tenants t on t.id = m.tenant_id
     where m.id = (v_link ->> 'mapping_id')::uuid
       and m.deployment_target_id = p_deployment_target_id and m.status = 'ACTIVE';
    -- Un vínculo de otro destino o ya inactivo no se cuenta (el cuerpo no manda).
    continue when v_map.id is null or v_map.id = any (v_checked);
    v_checked := v_checked || v_map.id;

    v_exists := coalesce(v_link ->> 'exists', 'UNKNOWN');
    v_app_state := case when v_link ->> 'app_state' in ('ACTIVE', 'SUSPENDED') then v_link ->> 'app_state' end;
    v_expected := platform.tenant_sync_expected_state(v_map.tenant_status);

    if v_exists = 'NOT_FOUND' then
      v_broken := v_broken || v_map.id;
      v_fp := 'BROKEN_LINK:' || v_map.id;
      v_live := v_live || v_fp;
      if platform._upsert_tenant_sync_finding(
           p_run_id, 'BROKEN_LINK', v_fp, v_target.saas_product_id, p_deployment_target_id, v_map.tenant_id, v_map.id,
           v_map.external_tenant_id, v_map.external_organization_id, v_map.external_company_id,
           null, null, null, v_map.tenant_status::text, null,
           jsonb_build_object('source', case when 'GET_STATUS' = any (v_methods) then 'GET_STATUS' else 'LIFECYCLE' end,
                              'http_status', case when jsonb_typeof(v_link -> 'http_status') = 'number'
                                                  then (v_link ->> 'http_status')::int end)) then
        v_opened := v_opened + 1;
      end if;
    elsif v_exists = 'FOUND' then
      v_found := v_found || v_map.id;
      -- Una entrega lifecycle.v1 pendiente explica la diferencia: no es un hallazgo todavía.
      v_pending := exists (select 1 from platform.tenant_lifecycle_delivery ld
                            where ld.tenant_id = v_map.tenant_id
                              and ld.applied_version is distinct from ld.desired_version);
      if v_app_state is not null and v_expected is not null and v_app_state <> v_expected and not v_pending then
        v_mismatch := v_mismatch || v_map.id;
        v_fp := 'STATE_MISMATCH:' || v_map.id;
        v_live := v_live || v_fp;
        if platform._upsert_tenant_sync_finding(
             p_run_id, 'STATE_MISMATCH', v_fp, v_target.saas_product_id, p_deployment_target_id, v_map.tenant_id,
             v_map.id, v_map.external_tenant_id, v_map.external_organization_id, v_map.external_company_id,
             null, null, null, v_expected, v_app_state,
             jsonb_build_object('source', 'LIFECYCLE', 'tenant_status', v_map.tenant_status::text)) then
          v_opened := v_opened + 1;
        end if;
      end if;
    else
      v_unknown := v_unknown || v_map.id;
    end if;
  end loop;

  -- ---- Inventario (solo si la app lo anuncia y llegó completo) -------------
  if v_inv_status = 'AVAILABLE' and jsonb_typeof(v_inv -> 'items') = 'array' then
    for v_item in
      -- Un mismo cliente repetido (en la misma página o entre páginas) cuenta una vez.
      select distinct on (lower(btrim(x."externalTenantId")))
             btrim(x."externalTenantId") as ext_tenant,
             nullif(btrim(coalesce(x."externalOrganizationId", '')), '') as ext_org,
             nullif(btrim(coalesce(x."externalCompanyId", '')), '') as ext_company,
             case when coalesce(x."controlPlaneTenantId", '') ~ c_uuid then lower(x."controlPlaneTenantId") end as cp_tenant,
             left(nullif(btrim(coalesce(x.code, '')), ''), 200) as code,
             left(nullif(btrim(coalesce(x.name, '')), ''), 300) as name,
             case when x.status in ('ACTIVE', 'SUSPENDED', 'INACTIVE') then x.status else 'UNKNOWN' end as status
        from jsonb_to_recordset(
               (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_inv -> 'items') e
                 where jsonb_typeof(e) = 'object'))
          as x("externalTenantId" text, "externalOrganizationId" text, "externalCompanyId" text,
               "controlPlaneTenantId" text, code text, name text, status text)
       where nullif(btrim(coalesce(x."externalTenantId", '')), '') is not null
         and length(btrim(x."externalTenantId")) <= 200
       order by lower(btrim(x."externalTenantId"))
    loop
      v_inv_items := v_inv_items + 1;
      -- Conocido = un vínculo ACTIVO de este destino con ese id externo, o que la
      -- app apunta (controlPlaneTenantId) a un tenant vinculado aquí.
      if exists (select 1 from platform.tenant_product_mappings m
                  where m.deployment_target_id = p_deployment_target_id and m.status = 'ACTIVE'
                    and (lower(m.external_tenant_id) = lower(v_item.ext_tenant)
                         or m.tenant_id::text = v_item.cp_tenant)) then
        continue;
      end if;
      v_inv_unknown := v_inv_unknown + 1;
      v_fp := 'APP_ONLY:' || p_deployment_target_id || ':' || lower(v_item.ext_tenant);
      continue when v_fp = any (v_live);
      v_live := v_live || v_fp;
      if platform._upsert_tenant_sync_finding(
           p_run_id, 'APP_ONLY', v_fp, v_target.saas_product_id, p_deployment_target_id,
           -- Si la app dice a qué tenant de MasterAdmin pertenece y existe, se anota (sin vínculo).
           (select t.id from platform.tenants t
             where t.id::text = v_item.cp_tenant and t.saas_product_id = v_target.saas_product_id),
           null, v_item.ext_tenant, v_item.ext_org, v_item.ext_company, v_item.code, v_item.name, v_item.status,
           null, v_item.status,
           jsonb_build_object('source', 'INVENTORY', 'control_plane_tenant_id', v_item.cp_tenant)) then
        v_opened := v_opened + 1;
      end if;
    end loop;

    -- Con el inventario COMPLETO, un vínculo activo que no aparece está roto.
    if v_inv_complete then
      for v_map in
        select m.id, m.tenant_id, m.external_tenant_id, m.external_organization_id, m.external_company_id,
               t.status as tenant_status
          from platform.tenant_product_mappings m
          join platform.tenants t on t.id = m.tenant_id
         where m.deployment_target_id = p_deployment_target_id and m.status = 'ACTIVE'
           and not exists (
             select 1 from jsonb_array_elements(v_inv -> 'items') e
              where jsonb_typeof(e) = 'object'
                and (lower(btrim(coalesce(e ->> 'externalTenantId', ''))) = lower(m.external_tenant_id)
                     or lower(coalesce(e ->> 'controlPlaneTenantId', '')) = m.tenant_id::text))
      loop
        v_fp := 'BROKEN_LINK:' || v_map.id;
        if not (v_map.id = any (v_broken)) then
          v_broken := v_broken || v_map.id;
          v_found := array_remove(v_found, v_map.id);
          v_unknown := array_remove(v_unknown, v_map.id);
          v_mismatch := array_remove(v_mismatch, v_map.id);
          v_live := array_remove(v_live, 'STATE_MISMATCH:' || v_map.id);
          v_live := v_live || v_fp;
          if platform._upsert_tenant_sync_finding(
               p_run_id, 'BROKEN_LINK', v_fp, v_target.saas_product_id, p_deployment_target_id, v_map.tenant_id,
               v_map.id, v_map.external_tenant_id, v_map.external_organization_id, v_map.external_company_id,
               null, null, null, v_map.tenant_status::text, null, jsonb_build_object('source', 'INVENTORY')) then
            v_opened := v_opened + 1;
          end if;
        end if;
      end loop;
      -- Los que sí aparecen en el inventario completo existen.
      select coalesce(array_agg(m.id), '{}') into v_checked
        from platform.tenant_product_mappings m
       where m.deployment_target_id = p_deployment_target_id and m.status = 'ACTIVE'
         and not (m.id = any (v_broken));
      v_found := array(select distinct x from unnest(v_found || v_checked) x);
      v_unknown := array(select x from unnest(v_unknown) x where not (x = any (v_found)));
    end if;
  end if;

  -- ---- Cierre automático de lo que ya no se ve -----------------------------
  -- Vínculos que esta corrida comprobó que existen: su «vínculo roto» se cerró solo.
  update platform.tenant_sync_findings f
     set status = 'RESOLVED', resolution = 'NO_LONGER_DETECTED', resolved_at = now(), last_run_id = p_run_id
   where f.deployment_target_id = p_deployment_target_id and f.status = 'OPEN'
     and ((f.kind = 'BROKEN_LINK' and f.mapping_id = any (v_found))
          or (f.kind = 'STATE_MISMATCH' and f.mapping_id = any (v_found) and not (f.fingerprint = any (v_live))));
  get diagnostics v_closed_n = row_count;
  v_closed := v_closed + v_closed_n;

  -- Vínculos que ya no están activos (o desaparecieron): nada que revisar.
  update platform.tenant_sync_findings f
     set status = 'RESOLVED', resolution = 'NO_LONGER_DETECTED', resolved_at = now(), last_run_id = p_run_id
   where f.deployment_target_id = p_deployment_target_id and f.status = 'OPEN'
     and f.kind in ('BROKEN_LINK', 'STATE_MISMATCH')
     and not exists (select 1 from platform.tenant_product_mappings m
                      where m.id = f.mapping_id and m.status = 'ACTIVE'
                        and m.deployment_target_id = p_deployment_target_id);
  get diagnostics v_closed_n = row_count;
  v_closed := v_closed + v_closed_n;

  -- Clientes «solo en la app» que el inventario COMPLETO ya no trae como desconocidos.
  if v_inv_complete then
    update platform.tenant_sync_findings f
       set status = 'RESOLVED', resolution = 'NO_LONGER_DETECTED', resolved_at = now(), last_run_id = p_run_id
     where f.deployment_target_id = p_deployment_target_id and f.status = 'OPEN'
       and f.kind = 'APP_ONLY' and not (f.fingerprint = any (v_live));
    get diagnostics v_closed_n = row_count;
    v_closed := v_closed + v_closed_n;
  end if;

  v_total := (select count(*)::int from platform.tenant_product_mappings m
               where m.deployment_target_id = p_deployment_target_id and m.status = 'ACTIVE');

  v_outcome := case
    when v_error is not null and cardinality(v_found) + cardinality(v_broken) = 0 and v_inv_status <> 'AVAILABLE'
      then 'FAILED'
    when cardinality(v_methods) = 0 and v_inv_status = 'NOT_AVAILABLE' and v_error is null
      then 'NOT_VERIFIABLE'
    when cardinality(v_broken) + cardinality(v_mismatch) + v_inv_unknown > 0
      then 'WITH_FINDINGS'
    when v_error is not null or v_inv_status = 'FAILED'
         or (v_inv_status = 'AVAILABLE' and not v_inv_complete)
         or cardinality(v_found) + cardinality(v_broken) < v_total
      then 'PARTIAL'
    else 'OK'
  end;

  insert into platform.tenant_sync_target_results (
    run_id, deployment_target_id, saas_product_id, product_integration_id, verify_methods,
    links_total, links_ok, links_broken, links_state_mismatch, links_unverified,
    inventory_status, inventory_items, inventory_unknown, findings_opened, findings_closed, outcome, error_code)
  values (
    p_run_id, p_deployment_target_id, v_target.saas_product_id, v_target.product_integration_id, v_methods,
    v_total, cardinality(v_found) - cardinality(v_mismatch), cardinality(v_broken), cardinality(v_mismatch),
    greatest(v_total - cardinality(v_found) - cardinality(v_broken), 0),
    v_inv_status, v_inv_items, v_inv_unknown, v_opened, v_closed, v_outcome, v_error);

  return jsonb_build_object(
    'deployment_target_id', p_deployment_target_id, 'outcome', v_outcome,
    'links_total', v_total, 'links_broken', cardinality(v_broken), 'links_state_mismatch', cardinality(v_mismatch),
    'inventory_status', v_inv_status, 'inventory_unknown', v_inv_unknown,
    'findings_opened', v_opened, 'findings_closed', v_closed);
end;
$$;

comment on function platform.record_tenant_sync_target_result(uuid, uuid, jsonb) is
  'Registra lo observado en un destino y abre/refresca/cierra hallazgos. La base decide con el estado actual '
  'del tenant; solo cierra lo que la corrida pudo comprobar. Solo el canal servidor.';

revoke all on function platform.record_tenant_sync_target_result(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function platform.record_tenant_sync_target_result(uuid, uuid, jsonb) to service_role;

create or replace function platform.finish_tenant_sync_run(
  p_run_id     uuid,
  p_error_code text default null,
  p_targets_total integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_run    record;
  v_agg    record;
  v_error  text := nullif(p_error_code, '');
  v_status text;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: las corridas las cierra el job o la Edge Function' using errcode = '42501';
  end if;
  select * into v_run from platform.tenant_sync_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'RUNNING' then
    raise exception 'CORRIDA_NO_ABIERTA' using errcode = '55000';
  end if;
  if v_error is not null and v_error !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    v_error := 'ERROR';
  end if;

  select count(*)::int as checked,
         coalesce(sum(findings_opened), 0)::int as opened,
         coalesce(sum(findings_closed), 0)::int as closed,
         count(*) filter (where outcome in ('FAILED', 'PARTIAL'))::int as degraded
    into v_agg
    from platform.tenant_sync_target_results where run_id = p_run_id;

  v_status := case
    when v_error is not null and v_agg.checked = 0 then 'FAILED'
    when v_error is not null or v_agg.degraded > 0
         or v_agg.checked < coalesce(p_targets_total, v_agg.checked) then 'PARTIAL'
    else 'COMPLETED'
  end;

  update platform.tenant_sync_runs
     set status = v_status, finished_at = now(), error_code = v_error,
         targets_total = greatest(coalesce(p_targets_total, v_agg.checked), v_agg.checked),
         targets_checked = v_agg.checked, findings_opened = v_agg.opened, findings_closed = v_agg.closed
   where id = p_run_id;

  -- Historial de 180 días; los hallazgos sobreviven (first/last_run_id quedan en NULL).
  delete from platform.tenant_sync_runs where started_at < now() - interval '180 days' and status <> 'RUNNING';

  return jsonb_build_object('run_id', p_run_id, 'status', v_status, 'targets_checked', v_agg.checked,
                            'findings_opened', v_agg.opened, 'findings_closed', v_agg.closed);
end;
$$;

revoke all on function platform.finish_tenant_sync_run(uuid, text, integer) from public, anon, authenticated;
grant execute on function platform.finish_tenant_sync_run(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Read models (SECURITY INVOKER: la RLS de cada tabla decide)
-- ---------------------------------------------------------------------------
create or replace view platform.v_tenant_sync_targets
with (security_invoker = true) as
select d.id                         as deployment_target_id,
       d.code                       as deployment_code,
       d.name                       as deployment_name,
       d.provisioning_environment::text as environment,
       d.provisioning_enabled,
       p.id                         as saas_product_id,
       p.code                       as product_code,
       p.short_name                 as product_short_name,
       p.accent_color               as product_accent_color,
       p.sort_order                 as product_sort_order,
       i.id                         as integration_id,
       i.code                       as integration_code,
       ('GET_STATUS' = any (platform.integration_capabilities(i.adapter_key, i.status_path_template, i.read_scope)))
                                    as can_check_existence,
       (i.integration_type = 'HTTP_M2M' and i.lifecycle_path is not null and i.lifecycle_read_scope is not null)
                                    as can_check_state,
       (i.integration_type = 'HTTP_M2M' and i.inventory_path is not null and i.inventory_read_scope is not null)
                                    as inventory_available,
       (select count(*)::int from platform.tenant_product_mappings m
         where m.deployment_target_id = d.id and m.status = 'ACTIVE') as active_links,
       (select count(*)::int from platform.tenant_sync_findings f
         where f.deployment_target_id = d.id and f.status = 'OPEN') as open_findings,
       r.run_id                     as last_run_id,
       r.checked_at                 as last_checked_at,
       r.outcome                    as last_outcome,
       r.error_code                 as last_error_code,
       r.verify_methods             as last_verify_methods,
       r.links_total                as last_links_total,
       r.links_ok                   as last_links_ok,
       r.links_broken               as last_links_broken,
       r.links_state_mismatch       as last_links_state_mismatch,
       r.links_unverified           as last_links_unverified,
       r.inventory_status           as last_inventory_status,
       r.inventory_items            as last_inventory_items,
       r.inventory_unknown          as last_inventory_unknown
  from platform.deployment_targets d
  join platform.saas_products p on p.id = d.saas_product_id
  join platform.product_integrations i on i.id = d.product_integration_id
  left join lateral (
    select x.* from platform.tenant_sync_target_results x
     where x.deployment_target_id = d.id
     order by x.checked_at desc
     limit 1
  ) r on true
 where d.status = 'ACTIVE'
   and (d.provisioning_enabled
        or exists (select 1 from platform.tenant_product_mappings m
                    where m.deployment_target_id = d.id and m.status = 'ACTIVE'));

comment on view platform.v_tenant_sync_targets is
  'Una fila por destino que revisa la sincronización: qué se puede comprobar hoy y la última revisión. SECURITY INVOKER.';

create or replace view platform.v_tenant_sync_findings
with (security_invoker = true) as
select f.id,
       f.kind,
       f.status,
       f.saas_product_id,
       p.code                       as product_code,
       p.short_name                 as product_short_name,
       p.accent_color               as product_accent_color,
       f.deployment_target_id,
       d.code                       as deployment_code,
       d.provisioning_environment::text as environment,
       f.tenant_id,
       t.name                       as tenant_name,
       t.slug                       as tenant_slug,
       f.mapping_id,
       f.external_tenant_id,
       f.external_organization_id,
       f.external_company_id,
       f.app_code,
       f.app_name,
       f.app_status,
       f.masteradmin_state,
       f.app_state,
       f.detail,
       f.first_seen_at,
       f.last_seen_at,
       f.times_seen,
       f.resolution,
       f.resolution_reason,
       f.resolved_at,
       f.resolved_by,
       pr.full_name                 as resolved_by_name,
       f.registered_tenant_id,
       rt.name                      as registered_tenant_name
  from platform.tenant_sync_findings f
  join platform.saas_products p on p.id = f.saas_product_id
  join platform.deployment_targets d on d.id = f.deployment_target_id
  left join platform.tenants t on t.id = f.tenant_id
  left join platform.tenants rt on rt.id = f.registered_tenant_id
  left join platform.profiles pr on pr.id = f.resolved_by;

comment on view platform.v_tenant_sync_findings is
  'Hallazgos de la sincronización con nombres de app, entorno, tenant y quién los cerró. SECURITY INVOKER.';

create or replace view platform.v_tenant_sync_runs
with (security_invoker = true) as
select r.id,
       r.trigger_kind,
       r.status,
       r.started_at,
       r.finished_at,
       r.targets_total,
       r.targets_checked,
       r.findings_opened,
       r.findings_closed,
       r.error_code,
       r.requested_by,
       pr.full_name as requested_by_name
  from platform.tenant_sync_runs r
  left join platform.profiles pr on pr.id = r.requested_by;

comment on view platform.v_tenant_sync_runs is 'Historial de sincronizaciones. SECURITY INVOKER.';

revoke all on platform.v_tenant_sync_targets, platform.v_tenant_sync_findings, platform.v_tenant_sync_runs
  from public, anon;
grant select on platform.v_tenant_sync_targets, platform.v_tenant_sync_findings, platform.v_tenant_sync_runs
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Consola: listar, resolver/descartar y registrar
-- ---------------------------------------------------------------------------
create or replace function platform.list_tenant_sync_findings(
  p_status          text default 'OPEN',
  p_saas_product_id uuid default null,
  p_limit           integer default 200
)
returns setof platform.v_tenant_sync_findings
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select *
    from platform.v_tenant_sync_findings f
   where (p_status is null or f.status = p_status)
     and (p_saas_product_id is null or f.saas_product_id = p_saas_product_id)
   order by f.last_seen_at desc, f.id
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

comment on function platform.list_tenant_sync_findings(text, uuid, integer) is
  'Hallazgos por estado y app. SECURITY INVOKER: la RLS de tenant_sync_findings decide qué filas ve el usuario.';

revoke all on function platform.list_tenant_sync_findings(text, uuid, integer) from public, anon;
grant execute on function platform.list_tenant_sync_findings(text, uuid, integer) to authenticated, service_role;

create or replace function platform.resolve_tenant_sync_finding(
  p_finding_id uuid,
  p_action     text,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_f      record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not platform.can_manage_tenant_sync() then
    raise exception 'NO_AUTORIZADO: resolver hallazgos de sincronización exige gestión de plataforma' using errcode = '42501';
  end if;
  if p_action not in ('RESOLVE', 'DISMISS') then
    raise exception 'PETICION_INVALIDA: acción RESOLVE o DISMISS' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'MOTIVO_REQUERIDO: explique en una frase por qué se cierra el hallazgo' using errcode = '23502';
  end if;

  select * into v_f from platform.tenant_sync_findings where id = p_finding_id for update;
  if v_f.id is null then
    raise exception 'HALLAZGO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if v_f.status <> 'OPEN' then
    raise exception 'HALLAZGO_CERRADO: el hallazgo ya está %', lower(v_f.status) using errcode = '55000';
  end if;

  update platform.tenant_sync_findings
     set status = case p_action when 'RESOLVE' then 'RESOLVED' else 'DISMISSED' end,
         resolution = case p_action when 'RESOLVE' then 'MARKED_RESOLVED' else 'DISMISSED' end,
         resolution_reason = left(v_reason, 1000),
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = p_finding_id;

  perform platform.log_audit(
    case p_action when 'RESOLVE' then 'TENANT_SYNC_FINDING_RESOLVED' else 'TENANT_SYNC_FINDING_DISMISSED' end,
    'tenant_sync_finding', p_finding_id::text, null, v_f.tenant_id,
    jsonb_build_object('kind', v_f.kind, 'reason', left(v_reason, 1000),
                       'deployment_target_id', v_f.deployment_target_id,
                       'external_tenant_id', v_f.external_tenant_id));
  return p_finding_id;
end;
$$;

comment on function platform.resolve_tenant_sync_finding(uuid, text, text) is
  'Marca un hallazgo como resuelto (RESOLVE) o lo descarta (DISMISS) con motivo auditado. Super admin o EBIM_PRODUCT_ADMIN.';

revoke all on function platform.resolve_tenant_sync_finding(uuid, text, text) from public, anon;
grant execute on function platform.resolve_tenant_sync_finding(uuid, text, text) to authenticated;

/*
 * «Registrar en el Admin Maestro» un cliente que existe solo en la app. NO
 * llama a la app: el cliente ya opera allí. Reutiliza las RPC de siempre, con
 * sus propias guardias y auditoría (cuenta → tenant → solicitud → alta manual),
 * en una sola transacción: si algo falla no queda un tenant huérfano.
 *
 * Tres caminos para la cuenta y el tenant:
 *   · p_existing_tenant_id: vincula un tenant que ya existe en MasterAdmin
 *     (p. ej. «GRUPASA · EWM» sin alta) — sin crear nada más;
 *   · p_organization_id: crea el tenant en una cuenta existente;
 *   · si no: crea la cuenta (p_org_*) y el tenant.
 */
create or replace function platform.register_tenant_sync_finding(
  p_finding_id         uuid,
  p_tenant_slug        text default null,
  p_tenant_name        text default null,
  p_admin_email        text default null,
  p_organization_id    uuid default null,
  p_org_slug           text default null,
  p_org_legal_name     text default null,
  p_org_display_name   text default null,
  p_org_country_code   text default null,
  p_org_tax_id         text default null,
  p_tenant_type        platform.tenant_type default 'PRODUCTION',
  p_existing_tenant_id uuid default null,
  p_note               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_f         record;
  v_target    record;
  v_tenant    record;
  v_org_id    uuid;
  v_tenant_id uuid;
  v_req_id    uuid;
  v_req_target uuid;
  v_map_id    uuid;
  v_managing  uuid;
  v_source    jsonb;
begin
  if not platform.can_manage_tenant_sync() then
    raise exception 'NO_AUTORIZADO: registrar clientes desde la sincronización exige gestión de plataforma'
      using errcode = '42501';
  end if;

  select * into v_f from platform.tenant_sync_findings where id = p_finding_id for update;
  if v_f.id is null then
    raise exception 'HALLAZGO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if v_f.status <> 'OPEN' or v_f.kind <> 'APP_ONLY' then
    raise exception 'HALLAZGO_NO_REGISTRABLE: solo se registra un cliente «solo en la app» abierto' using errcode = '55000';
  end if;

  select d.id, d.deployment_mode, d.owner_organization_id, d.provisioning_environment, p.code as product_code
    into v_target
    from platform.deployment_targets d join platform.saas_products p on p.id = d.saas_product_id
   where d.id = v_f.deployment_target_id;
  if v_target.provisioning_environment is null then
    raise exception 'DESTINO_SIN_AMBIENTE: el destino no tiene ambiente de provisioning' using errcode = '23514';
  end if;

  if exists (select 1 from platform.tenant_product_mappings m
              where m.deployment_target_id = v_f.deployment_target_id and m.status = 'ACTIVE'
                and lower(m.external_tenant_id) = lower(v_f.external_tenant_id)) then
    raise exception 'YA_VINCULADO: otro tenant de MasterAdmin ya está vinculado a este cliente de la app'
      using errcode = '23505';
  end if;

  v_source := jsonb_build_object('source', 'TENANT_SYNC', 'finding_id', p_finding_id);

  if p_existing_tenant_id is not null then
    select * into v_tenant from platform.tenants where id = p_existing_tenant_id;
    if v_tenant.id is null then
      raise exception 'TENANT_NO_ENCONTRADO' using errcode = 'P0002';
    end if;
    if v_tenant.saas_product_id <> v_f.saas_product_id then
      raise exception 'PRODUCTO_DISTINTO: el tenant es de otra app' using errcode = '23514';
    end if;
    if exists (select 1 from platform.tenant_product_mappings m
                where m.tenant_id = v_tenant.id and m.status = 'ACTIVE') then
      raise exception 'TENANT_YA_VINCULADO: ese tenant ya tiene alta en la app' using errcode = '23505';
    end if;
    v_tenant_id := v_tenant.id;
    v_org_id := v_tenant.customer_organization_id;
  else
    if p_organization_id is not null then
      if not exists (select 1 from platform.organizations o where o.id = p_organization_id) then
        raise exception 'CUENTA_NO_ENCONTRADA' using errcode = 'P0002';
      end if;
      v_org_id := p_organization_id;
    else
      if nullif(btrim(coalesce(p_org_legal_name, '')), '') is null then
        raise exception 'CUENTA_REQUERIDA: elija una cuenta o indique la razón social de la nueva' using errcode = '23502';
      end if;
      v_org_id := platform.upsert_organization(
        p_slug => p_org_slug, p_legal_name => p_org_legal_name,
        p_display_name => coalesce(nullif(btrim(coalesce(p_org_display_name, '')), ''), p_org_legal_name),
        p_country_code => p_org_country_code, p_tax_id => p_org_tax_id,
        p_capabilities => array['CUSTOMER']::platform.org_capability[], p_metadata => v_source);
    end if;

    if v_target.deployment_mode = 'TENANT_DEDICATED' and v_target.owner_organization_id is distinct from v_org_id then
      raise exception 'DESTINO_DE_OTRA_CUENTA: el entorno exclusivo pertenece a otra cuenta' using errcode = '23514';
    end if;
    v_managing := case when v_target.deployment_mode = 'PARTNER_DEDICATED' then v_target.owner_organization_id end;

    v_tenant_id := platform.create_tenant(
      p_saas_product_code => v_target.product_code, p_customer_organization_id => v_org_id,
      p_slug => coalesce(nullif(btrim(coalesce(p_tenant_slug, '')), ''), v_f.app_code),
      p_name => coalesce(nullif(btrim(coalesce(p_tenant_name, '')), ''), v_f.app_name),
      p_admin_email => p_admin_email, p_tenant_type => coalesce(p_tenant_type, 'PRODUCTION'),
      p_deployment_mode => v_target.deployment_mode, p_managing_organization_id => v_managing,
      p_metadata => v_source);
  end if;

  v_req_id := platform.create_saas_provisioning_request(v_tenant_id, v_target.provisioning_environment);
  select r.deployment_target_id into v_req_target from platform.saas_provisioning_requests r where r.id = v_req_id;
  if v_req_target is distinct from v_f.deployment_target_id then
    raise exception 'DESTINO_DISTINTO: MasterAdmin resolvería otro entorno para este tenant; revise los destinos de la app'
      using errcode = '23514';
  end if;

  v_map_id := platform.register_manual_provisioning(
    v_req_id, v_f.external_tenant_id, v_f.external_organization_id, v_f.external_company_id, v_source);

  -- El cliente ya opera en la app: si allí está activo, aquí también.
  if (select t.status from platform.tenants t where t.id = v_tenant_id) = 'PENDING'
     and coalesce(v_f.app_status, 'ACTIVE') = 'ACTIVE' then
    perform platform.set_tenant_status(v_tenant_id, 'ACTIVE',
      'Registrado desde la sincronización con las apps: ya operaba en la app');
  end if;

  update platform.tenant_sync_findings
     set status = 'RESOLVED', resolution = 'REGISTERED', registered_tenant_id = v_tenant_id,
         resolution_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Registrado en el Admin Maestro'), 1000),
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_finding_id;

  perform platform.log_audit(
    'TENANT_SYNC_FINDING_REGISTERED', 'tenant_sync_finding', p_finding_id::text, v_org_id, v_tenant_id,
    jsonb_build_object('external_tenant_id', v_f.external_tenant_id, 'mapping_id', v_map_id,
                       'request_id', v_req_id, 'linked_existing_tenant', p_existing_tenant_id is not null));

  return jsonb_build_object('finding_id', p_finding_id, 'organization_id', v_org_id, 'tenant_id', v_tenant_id,
                            'request_id', v_req_id, 'mapping_id', v_map_id);
end;
$$;

comment on function platform.register_tenant_sync_finding(uuid, text, text, text, uuid, text, text, text, text, text,
  platform.tenant_type, uuid, text) is
  'Registra en MasterAdmin un cliente que existe solo en la app (cuenta, tenant, solicitud y alta manual) sin llamar '
  'a la app. Reutiliza upsert_organization, create_tenant, create_saas_provisioning_request y register_manual_provisioning.';

revoke all on function platform.register_tenant_sync_finding(uuid, text, text, text, uuid, text, text, text, text, text,
  platform.tenant_type, uuid, text) from public, anon;
grant execute on function platform.register_tenant_sync_finding(uuid, text, text, text, uuid, text, text, text, text, text,
  platform.tenant_type, uuid, text) to authenticated;

create or replace function platform.set_tenant_sync_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin enciende o apaga la sincronización diaria' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'PETICION_INVALIDA: p_enabled' using errcode = '22023';
  end if;
  update platform.tenant_lifecycle_settings
     set tenant_sync_enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
   where id;
  perform platform.log_audit('TENANT_SYNC_SETTINGS_CHANGED', 'tenant_lifecycle_settings', 'singleton', null, null,
                             jsonb_build_object('tenant_sync_enabled', p_enabled));
  return p_enabled;
end;
$$;

revoke all on function platform.set_tenant_sync_enabled(boolean) from public, anon;
grant execute on function platform.set_tenant_sync_enabled(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Job programado: invoke_scheduled_function gana TENANT_SYNC
--    (copia literal de 20261020000100 §16 con una rama más)
-- ---------------------------------------------------------------------------
create or replace function platform.invoke_scheduled_function(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settings platform.tenant_lifecycle_settings;
  v_function text;
  v_body     jsonb;
  v_enabled  boolean;
  v_url      text;
  v_key      text;
  v_request  bigint;
  v_outcome  text;
  v_detail   jsonb := '{}'::jsonb;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SISTEMA: los jobs programados los dispara pg_cron' using errcode = '42501';
  end if;

  select * into v_settings from platform.tenant_lifecycle_settings where id;

  case p_job
    when 'ENTITLEMENT_SYNC' then
      v_function := 'entitlement-sync'; v_body := '{"job":"all","limit":20}'::jsonb;
      v_enabled := v_settings.entitlement_sync_enabled;
    when 'ENTITLEMENT_SWEEP' then
      v_function := 'entitlement-sync'; v_body := '{"job":"issue","sweep":true,"limit":100}'::jsonb;
      v_enabled := v_settings.entitlement_sync_enabled;
    when 'AUTOCHARGE' then
      v_function := 'payment-autocharge'; v_body := '{"run":true}'::jsonb;
      v_enabled := v_settings.autocharge_enabled;
    when 'TENANT_SYNC' then
      v_function := 'tenant-sync'; v_body := '{"trigger":"SCHEDULED"}'::jsonb;
      v_enabled := v_settings.tenant_sync_enabled;
    else
      raise exception 'JOB_DESCONOCIDO: %', p_job using errcode = '22023';
  end case;

  if not v_enabled then
    v_outcome := 'SKIPPED_DISABLED';
  elsif to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    v_outcome := 'SKIPPED_NOT_CONFIGURED';
    v_detail := jsonb_build_object('missing', 'vault/pg_net');
  else
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       into v_url using 'masteradmin_project_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       into v_key using 'masteradmin_service_role_key';
    if nullif(v_url, '') is null or nullif(v_key, '') is null then
      v_outcome := 'SKIPPED_NOT_CONFIGURED';
      v_detail := jsonb_build_object('missing', 'masteradmin_project_url/masteradmin_service_role_key');
    else
      begin
        execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
           into v_request
          using rtrim(v_url, '/') || '/functions/v1/' || v_function, v_body,
                jsonb_build_object('content-type', 'application/json',
                                   'authorization', 'Bearer ' || v_key,
                                   'x-provisioning-secret', v_key),
                -- La sincronización recorre las 8 apps: más margen que un push.
                case when p_job = 'TENANT_SYNC' then 150000 else 30000 end;
        v_outcome := 'DISPATCHED';
        v_detail := jsonb_build_object('function', v_function, 'net_request_id', v_request);
      exception when others then
        v_outcome := 'FAILED';
        v_detail := jsonb_build_object('function', v_function, 'error', sqlerrm);
      end;
    end if;
  end if;

  -- Un «no hice nada» se anota una vez al día por job, no en cada disparo.
  if v_outcome not like 'SKIPPED%'
     or not exists (select 1 from platform.lifecycle_job_runs j
                     where j.job = p_job and j.outcome = v_outcome and j.ran_at > now() - interval '1 day') then
    insert into platform.lifecycle_job_runs (job, outcome, detail) values (p_job, v_outcome, v_detail);
  end if;

  return jsonb_build_object('job', p_job, 'outcome', v_outcome) || v_detail;
end;
$$;

comment on function platform.invoke_scheduled_function(text) is
  'Dispara una Edge Function desde pg_cron con pg_net y los secretos de Vault del entorno. '
  'Sin secretos o con el interruptor apagado no hace nada. Solo el job del sistema.';

revoke all on function platform.invoke_scheduled_function(text) from public, anon, authenticated, service_role;

-- 05:30 Lima (10:30 UTC): antes de la jornada y del ciclo de vida de las 06:00.
-- cron.schedule con el mismo nombre reemplaza el job: idempotente.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('ebim-tenant-sync', '30 10 * * *',
      $job$select platform.invoke_scheduled_function('TENANT_SYNC')$job$);
  else
    raise notice 'pg_cron no disponible: la sincronización de tenants se programa a mano (docs/runbooks/tenant-sync.md)';
  end if;
end;
$$;
