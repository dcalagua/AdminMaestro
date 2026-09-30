-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · cutover por integración (MA-34)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (product_integrations EXTEND), §8.1 (scopes nuevos, distintos de
-- provisioning), §15 (ejes de entitlements y facturación, un paso adelante o
-- atrás), §18 (kill-switch entitlements_push_enabled). Plan §4 fila 15.
-- Test: supabase/tests/36_ccp_entitlement_sync_state.test.sql (parte 2).
--
--   · Columnas nuevas: todas NULL / LEGACY_ONLY / BILLING_LEGACY / false por
--     defecto. Nada cambia para ninguna integración existente.
--   · El eje vive en la INTEGRACIÓN (la que usa el destino del mapping del
--     tenant): el mismo producto tiene MOCK en DEV y HTTP_M2M en QAS/PRD.
--     entitlement_sync_state.cohort_state lo sobreescribe por tenant (cohorte).
--   · Kill-switch apagado por defecto: enrolar no empuja hasta encenderlo.
--   · LEGACY_RETIRED / BILLING_RETIRED no se alcanzan en este programa.
--   · Redefine entitlements_enrollment() y entitlements_push_enabled() de
--     …0200 con la regla completa.
--
-- Rollback: docs/runbooks/ccp-rollback/08.sql (kill-switch off, ejes a LEGACY).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column entitlements_path          text,
  add column entitlements_manifest_path text,
  add column entitlements_write_scope   text,
  add column entitlements_read_scope    text,
  add column entitlements_push_enabled  boolean not null default false,
  add column usage_ingest_enabled       boolean not null default false,
  add column cutover_state_entitlements text not null default 'LEGACY_ONLY',
  add column cutover_state_billing      text not null default 'BILLING_LEGACY';

alter table platform.product_integrations
  add constraint product_integrations_entitlements_paths_ck check (
    (entitlements_path is null or platform.is_safe_url_path(entitlements_path))
    and (entitlements_manifest_path is null or platform.is_safe_url_path(entitlements_manifest_path))),
  add constraint product_integrations_entitlements_scopes_ck check (
    (entitlements_write_scope is null or entitlements_write_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$')
    and (entitlements_read_scope is null or entitlements_read_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$')
    -- Scopes separados (spec §8.1): una credencial de provisioning no escribe entitlements.
    and (entitlements_write_scope is null
         or (entitlements_write_scope is distinct from create_scope
             and entitlements_write_scope is distinct from read_scope
             and not (entitlements_write_scope = any (additional_scopes))))),
  add constraint product_integrations_cutover_entitlements_ck check (cutover_state_entitlements in (
    'LEGACY_ONLY', 'SHADOW', 'DUAL_READ', 'MASTERADMIN_PRIMARY', 'LEGACY_RETIRED')),
  add constraint product_integrations_cutover_billing_ck check (cutover_state_billing in (
    'BILLING_LEGACY', 'BILLING_SHADOW', 'BILLING_PRIMARY', 'BILLING_RETIRED'));

comment on column platform.product_integrations.entitlements_path is
  'Plantilla relativa de PUT/GET /tenants/{controlPlaneTenantId}/entitlements (contrato entitlements.v1).';
comment on column platform.product_integrations.entitlements_push_enabled is
  'Kill-switch (spec §18). false = el job no empuja snapshots por esta integración.';
comment on column platform.product_integrations.cutover_state_entitlements is
  'Eje de entitlements (spec §15.1). Solo cambia con set_commercial_cutover_state.';

-- ---------------------------------------------------------------------------
-- 2. Historial de cutover (append-only)
-- ---------------------------------------------------------------------------
create table platform.commercial_cutover_events (
  id                     bigint generated always as identity primary key,
  product_integration_id uuid not null references platform.product_integrations (id) on delete restrict,
  axis                   text not null,
  from_state             text not null,
  to_state               text not null,
  reason                 text not null,
  actor_user_id          uuid references platform.profiles (id) on delete set null,
  occurred_at            timestamptz not null default now(),
  constraint commercial_cutover_events_axis_ck check (axis in ('ENTITLEMENTS', 'BILLING', 'PUSH_KILL_SWITCH')),
  constraint commercial_cutover_events_reason_ck check (length(trim(reason)) > 0)
);

create index commercial_cutover_events_integration_ix
  on platform.commercial_cutover_events (product_integration_id, occurred_at desc);
create index commercial_cutover_events_actor_ix
  on platform.commercial_cutover_events (actor_user_id) where actor_user_id is not null;

comment on table platform.commercial_cutover_events is
  'Historial append-only de los ejes de cutover (spec §15) y del kill-switch (spec §18).';

create trigger commercial_cutover_events_append_only
  before update or delete on platform.commercial_cutover_events
  for each row execute function platform.entitlement_log_append_only();
create trigger commercial_cutover_events_no_truncate
  before truncate on platform.commercial_cutover_events
  for each statement execute function platform.entitlement_log_append_only();

alter table platform.commercial_cutover_events enable row level security;
alter table platform.commercial_cutover_events force row level security;
revoke all on platform.commercial_cutover_events from public, anon, authenticated;
grant select on platform.commercial_cutover_events to authenticated;
grant select, insert on platform.commercial_cutover_events to service_role;

create policy commercial_cutover_events_select on platform.commercial_cutover_events
  for select to authenticated using (
    exists (select 1 from platform.product_integrations i
             where i.id = product_integration_id
               and (platform.has_product_permission('platform.integration.manage', i.saas_product_id)
                    or platform.can_manage_commercial())));

-- ---------------------------------------------------------------------------
-- 3. Enrolamiento y kill-switch con la integración del mapping
-- ---------------------------------------------------------------------------
create or replace function platform.entitlement_integration_for(p_tenant_id uuid, p_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select d.product_integration_id
    from platform.tenant_product_mappings m
    join platform.deployment_targets d on d.id = m.deployment_target_id
   where m.tenant_id = p_tenant_id and m.saas_product_id = p_product_id and m.status = 'ACTIVE';
$$;

revoke all on function platform.entitlement_integration_for(uuid, uuid) from public, anon, authenticated;
grant execute on function platform.entitlement_integration_for(uuid, uuid) to service_role;

create or replace function platform.entitlements_enrollment(p_tenant_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce(
    (select s.cohort_state from platform.entitlement_sync_state s
      where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id),
    (select i.cutover_state_entitlements from platform.product_integrations i
      where i.id = platform.entitlement_integration_for(p_tenant_id, p_product_id)),
    'LEGACY_ONLY');
$$;

create or replace function platform.entitlements_push_enabled(p_tenant_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce((
    select i.entitlements_push_enabled
       and i.integration_type = 'HTTP_M2M'
       and i.entitlements_path is not null
       and i.entitlements_write_scope is not null
       and i.entitlements_read_scope is not null
       and d.base_url is not null
      from platform.tenant_product_mappings m
      join platform.deployment_targets d on d.id = m.deployment_target_id
      join platform.product_integrations i on i.id = d.product_integration_id
     where m.tenant_id = p_tenant_id and m.saas_product_id = p_product_id and m.status = 'ACTIVE'), false);
$$;

-- Reevalúa las puertas de los tenants de una integración tras un cambio de eje.
create or replace function platform.refresh_entitlement_gates_for_integration(p_integration_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_count integer := 0;
  r record;
  v_gate text;
begin
  for r in
    select s.tenant_id, s.saas_product_id, s.state
      from platform.entitlement_sync_state s
     where platform.entitlement_integration_for(s.tenant_id, s.saas_product_id) = p_integration_id
       and not (s.state = 'PUSHING' and s.lease_until > now())
       for update of s
  loop
    v_gate := platform.entitlement_gate_state(r.tenant_id, r.saas_product_id);
    if v_gate is not null and r.state is distinct from v_gate then
      update platform.entitlement_sync_state
         set state = v_gate, state_reason = v_gate, state_changed_at = now(),
             pushing_version = null, lease_owner = null, lease_until = null
       where tenant_id = r.tenant_id and saas_product_id = r.saas_product_id;
      v_count := v_count + 1;
    elsif v_gate is null and r.state in ('NOT_PROVISIONED', 'NOT_ENROLLED') then
      update platform.entitlement_sync_state
         set state = 'PENDING_PUSH', state_reason = 'ENROLADO', state_changed_at = now(), next_attempt_at = now()
       where tenant_id = r.tenant_id and saas_product_id = r.saas_product_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function platform.refresh_entitlement_gates_for_integration(uuid) from public, anon, authenticated;
grant execute on function platform.refresh_entitlement_gates_for_integration(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. RPCs humanas
-- ---------------------------------------------------------------------------
create or replace function platform.configure_entitlements_integration(
  p_integration_id uuid,
  p_entitlements_path text,
  p_manifest_path  text,
  p_write_scope    text,
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
    raise exception 'NO_AUTORIZADO: configurar entitlements exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;
  if v_int.integration_type <> 'HTTP_M2M' then
    raise exception 'TIPO_NO_SOPORTADO: el contrato entitlements.v1 solo viaja por HTTP_M2M' using errcode = '23514';
  end if;

  update platform.product_integrations
     set entitlements_path = p_entitlements_path,
         entitlements_manifest_path = p_manifest_path,
         entitlements_write_scope = p_write_scope,
         entitlements_read_scope = p_read_scope
   where id = p_integration_id;

  insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ENTITLEMENTS_INTEGRATION_CONFIGURED', 'product_integration', p_integration_id::text,
          jsonb_build_object('entitlements_path', p_entitlements_path, 'manifest_path', p_manifest_path,
                             'write_scope', p_write_scope, 'read_scope', p_read_scope));
  return p_integration_id;
end;
$$;

comment on function platform.configure_entitlements_integration(uuid, text, text, text, text) is
  'Rutas y scopes del contrato entitlements.v1 de una integración HTTP_M2M. platform.integration.manage.';

create or replace function platform.set_commercial_cutover_state(
  p_integration_id uuid,
  p_axis           text,
  p_to_state       text,
  p_reason         text
)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_int    record;
  v_order  text[];
  v_from   text;
  v_from_i integer;
  v_to_i   integer;
  v_open   integer;
begin
  select * into v_int from platform.product_integrations where id = p_integration_id for update;
  if v_int.id is null then
    raise exception 'INTEGRACION_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  if p_axis = 'ENTITLEMENTS' then
    if not platform.has_product_permission('platform.integration.manage', v_int.saas_product_id) then
      raise exception 'NO_AUTORIZADO: el eje de entitlements exige platform.integration.manage' using errcode = '42501';
    end if;
    v_order := array['LEGACY_ONLY', 'SHADOW', 'DUAL_READ', 'MASTERADMIN_PRIMARY', 'LEGACY_RETIRED'];
    v_from := v_int.cutover_state_entitlements;
  elsif p_axis = 'BILLING' then
    if not platform.can_manage_commercial() then
      raise exception 'NO_AUTORIZADO: el eje de facturación es de finanzas' using errcode = '42501';
    end if;
    v_order := array['BILLING_LEGACY', 'BILLING_SHADOW', 'BILLING_PRIMARY', 'BILLING_RETIRED'];
    v_from := v_int.cutover_state_billing;
  else
    raise exception 'EJE_DESCONOCIDO: %', p_axis using errcode = '22023';
  end if;

  if coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23514';
  end if;
  v_from_i := array_position(v_order, v_from);
  v_to_i := array_position(v_order, p_to_state);
  if v_to_i is null then
    raise exception 'ESTADO_DESCONOCIDO: %', p_to_state using errcode = '23514';
  end if;
  if abs(v_to_i - v_from_i) <> 1 then
    raise exception 'SALTO_NO_PERMITIDO: % → % (un paso adelante o uno atrás)', v_from, p_to_state using errcode = '23514';
  end if;
  if p_to_state in ('LEGACY_RETIRED', 'BILLING_RETIRED') then
    raise exception 'RETIRO_FUERA_DE_PROGRAMA: % exige un ciclo de facturación sin incidentes y no se alcanza en este programa',
      p_to_state using errcode = '23514';
  end if;

  if p_axis = 'ENTITLEMENTS' and v_to_i > v_from_i then
    if p_to_state = 'SHADOW' and (v_int.integration_type <> 'HTTP_M2M' or v_int.entitlements_path is null
        or v_int.entitlements_write_scope is null or v_int.entitlements_read_scope is null) then
      raise exception 'CONFIG_ENTITLEMENTS_INCOMPLETA: ruta y scopes de entitlements antes de enrolar' using errcode = '23514';
    end if;
    if p_to_state in ('DUAL_READ', 'MASTERADMIN_PRIMARY') then
      select count(*) filter (where coalesce(s.state, 'NONE') not in ('IN_SYNC', 'IN_SYNC_WITH_WARNINGS'))
        into v_open
        from platform.tenant_product_mappings m
        join platform.deployment_targets d on d.id = m.deployment_target_id
        left join platform.entitlement_sync_state s
          on s.tenant_id = m.tenant_id and s.saas_product_id = m.saas_product_id
       where d.product_integration_id = p_integration_id and m.status = 'ACTIVE'
         and (s.cohort_state is null);
      if v_open > 0 then
        raise exception 'COHORTE_NO_SINCRONIZADA: % tenants de la integración no están IN_SYNC', v_open
          using errcode = '23514';
      end if;
    end if;
  end if;

  if p_axis = 'ENTITLEMENTS' then
    update platform.product_integrations set cutover_state_entitlements = p_to_state where id = p_integration_id;
  else
    update platform.product_integrations set cutover_state_billing = p_to_state where id = p_integration_id;
  end if;

  insert into platform.commercial_cutover_events
    (product_integration_id, axis, from_state, to_state, reason, actor_user_id)
  values (p_integration_id, p_axis, v_from, p_to_state, trim(p_reason), auth.uid());

  if p_axis = 'ENTITLEMENTS' then
    perform platform.refresh_entitlement_gates_for_integration(p_integration_id);
  end if;
  return p_to_state;
end;
$$;

comment on function platform.set_commercial_cutover_state(uuid, text, text, text) is
  'Mueve un eje de cutover un paso (spec §15). Entitlements: platform.integration.manage; facturación: '
  'can_manage_commercial(). Avanzar a DUAL_READ/PRIMARY exige la cohorte IN_SYNC. Los *_RETIRED no se alcanzan.';

create or replace function platform.set_entitlements_push_enabled(
  p_integration_id uuid,
  p_enabled        boolean,
  p_reason         text
)
returns boolean
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
  -- Apagarlo tiene que estar al alcance de finanzas: es el freno ante una
  -- revocación masiva no deseada (spec §18).
  if not (platform.has_product_permission('platform.integration.manage', v_int.saas_product_id)
          or platform.can_manage_commercial()) then
    raise exception 'NO_AUTORIZADO: el kill-switch exige platform.integration.manage o finanzas' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 or p_enabled is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23514';
  end if;

  update platform.product_integrations set entitlements_push_enabled = p_enabled where id = p_integration_id;
  insert into platform.commercial_cutover_events
    (product_integration_id, axis, from_state, to_state, reason, actor_user_id)
  values (p_integration_id, 'PUSH_KILL_SWITCH',
          case when v_int.entitlements_push_enabled then 'ON' else 'OFF' end,
          case when p_enabled then 'ON' else 'OFF' end, trim(p_reason), auth.uid());
  return p_enabled;
end;
$$;

comment on function platform.set_entitlements_push_enabled(uuid, boolean, text) is
  'Kill-switch del push de snapshots por integración (spec §18). Auditado en commercial_cutover_events.';

revoke all on function platform.configure_entitlements_integration(uuid, text, text, text, text) from public, anon;
revoke all on function platform.set_commercial_cutover_state(uuid, text, text, text) from public, anon;
revoke all on function platform.set_entitlements_push_enabled(uuid, boolean, text) from public, anon;
grant execute on function platform.configure_entitlements_integration(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function platform.set_commercial_cutover_state(uuid, text, text, text) to authenticated, service_role;
grant execute on function platform.set_entitlements_push_enabled(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Contexto de entrega para el job y el orquestador (solo servidor)
-- ---------------------------------------------------------------------------
-- Espejo acotado de provisioning_execution_context: SOLO lo que necesita el
-- contrato entitlements.v1. No expone scopes de provisioning ni el payload de
-- alta. `secret_ref` es el NOMBRE; el valor lo resuelve la Edge Function.
create or replace function platform.entitlement_delivery_context(p_tenant_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_map  record;
  v_dep  record;
  v_int  record;
  v_cred record;
  v_prod record;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: entitlement_delivery_context() resuelve configuración sensible' using errcode = '42501';
  end if;

  select * into v_map from platform.tenant_product_mappings
   where tenant_id = p_tenant_id and saas_product_id = p_product_id and status = 'ACTIVE';
  if v_map.id is null then
    raise exception 'TENANT_NO_APROVISIONADO' using errcode = 'P0002';
  end if;
  select * into v_dep from platform.deployment_targets where id = v_map.deployment_target_id;
  select * into v_int from platform.product_integrations where id = v_dep.product_integration_id;
  select * into v_cred from platform.credential_profiles where id = v_dep.credential_profile_id;
  select * into v_prod from platform.saas_products where id = p_product_id;

  return jsonb_build_object(
    'tenant', jsonb_build_object('controlPlaneTenantId', p_tenant_id, 'productCode', v_prod.code),
    'push_enabled', platform.entitlements_push_enabled(p_tenant_id, p_product_id),
    'enrollment', platform.entitlements_enrollment(p_tenant_id, p_product_id),
    'deployment', case when v_dep.id is null then null else jsonb_build_object(
      'id', v_dep.id, 'environment', v_dep.provisioning_environment::text, 'base_url', v_dep.base_url,
      'timeout_ms', v_dep.timeout_ms, 'retry_count', v_dep.retry_count) end,
    'integration', case when v_int.id is null then null else jsonb_build_object(
      'id', v_int.id, 'type', v_int.integration_type::text, 'issuer', v_int.issuer, 'audience', v_int.audience,
      'subject', v_int.subject, 'algorithm', v_int.algorithm::text, 'token_ttl_seconds', v_int.token_ttl_seconds,
      'entitlements_path', v_int.entitlements_path, 'entitlements_manifest_path', v_int.entitlements_manifest_path,
      'entitlements_write_scope', v_int.entitlements_write_scope,
      'entitlements_read_scope', v_int.entitlements_read_scope,
      'allowed_hosts', to_jsonb(v_int.allowed_hosts)) end,
    'credential', case when v_cred.id is null then null else jsonb_build_object(
      'id', v_cred.id, 'type', v_cred.type::text, 'enabled', v_cred.enabled, 'algorithm', v_cred.algorithm::text,
      'token_ttl_seconds', v_cred.token_ttl_seconds, 'secret_ref', v_cred.secret_ref) end
  );
end;
$$;

comment on function platform.entitlement_delivery_context(uuid, uuid) is
  'Destino, rutas, scopes de entitlements y NOMBRE del secreto para empujar/leer el snapshot. Solo service_role.';

revoke all on function platform.entitlement_delivery_context(uuid, uuid) from public, anon, authenticated;
grant execute on function platform.entitlement_delivery_context(uuid, uuid) to service_role;
