-- ============================================================================
-- Ciclo de vida del tenant · entrega a las apps (contrato lifecycle.v1)
-- ----------------------------------------------------------------------------
-- Contrato: docs/platform-provisioning/LIFECYCLE_CONTRACT.md
-- Test:     supabase/tests/57_tenant_lifecycle_delivery.test.sql
--
-- La enmienda D-14 deja `appActive=false` solo para lo comercial. El apagado
-- operativo es esta política aparte: MasterAdmin le dice a cada app, con un PUT
-- declarativo y versionado, si el tenant está ACTIVE o SUSPENDED.
--
--   · product_integrations gana ruta y scopes lifecycle (distintos de alta y de
--     entitlements). Sin ellos la integración no recibe el canal.
--   · tenant_lifecycle_delivery: estado deseado (versión creciente) y lo último
--     que la app confirmó. Solo existe fila cuando hay algo que entregar: un
--     tenant que nunca se suspendió no genera tráfico.
--   · El cambio de estado del tenant (trigger de 20261020000100) sube la versión.
--   · El job `lifecycle` de entitlement-sync reclama, hace el PUT y registra.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ruta y scopes del contrato en la integración
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column lifecycle_path        text,
  add column lifecycle_write_scope text,
  add column lifecycle_read_scope  text;

alter table platform.product_integrations
  add constraint product_integrations_lifecycle_path_ck check (
    lifecycle_path is null or platform.is_safe_url_path(lifecycle_path)),
  add constraint product_integrations_lifecycle_scopes_ck check (
    (lifecycle_write_scope is null or lifecycle_write_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$')
    and (lifecycle_read_scope is null or lifecycle_read_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$')
    -- Una credencial de alta o de entitlements no suspende a nadie.
    and (lifecycle_write_scope is null
         or (lifecycle_write_scope is distinct from create_scope
             and lifecycle_write_scope is distinct from read_scope
             and lifecycle_write_scope is distinct from entitlements_write_scope
             and lifecycle_write_scope is distinct from entitlements_read_scope
             and not (lifecycle_write_scope = any (additional_scopes))))),
  add constraint product_integrations_lifecycle_all_or_none_ck check (
    (lifecycle_path is null) = (lifecycle_write_scope is null)
    and (lifecycle_path is null) = (lifecycle_read_scope is null));

comment on column platform.product_integrations.lifecycle_path is
  'Plantilla relativa de PUT/GET /tenants/{controlPlaneTenantId}/lifecycle (contrato lifecycle.v1). NULL = sin canal.';

create or replace function platform.configure_lifecycle_integration(
  p_integration_id uuid,
  p_lifecycle_path text,
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
    raise exception 'NO_AUTORIZADO: configurar lifecycle exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;
  if v_int.integration_type <> 'HTTP_M2M' then
    raise exception 'TIPO_NO_SOPORTADO: el contrato lifecycle.v1 solo viaja por HTTP_M2M' using errcode = '23514';
  end if;

  update platform.product_integrations
     set lifecycle_path = nullif(btrim(p_lifecycle_path), ''),
         lifecycle_write_scope = nullif(btrim(p_write_scope), ''),
         lifecycle_read_scope = nullif(btrim(p_read_scope), '')
   where id = p_integration_id;

  insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LIFECYCLE_INTEGRATION_CONFIGURED', 'product_integration', p_integration_id::text,
          jsonb_build_object('lifecycle_path', p_lifecycle_path, 'write_scope', p_write_scope,
                             'read_scope', p_read_scope));
  return p_integration_id;
end;
$$;

comment on function platform.configure_lifecycle_integration(uuid, text, text, text) is
  'Ruta y scopes del contrato lifecycle.v1 de una integración HTTP_M2M (los tres o ninguno). platform.integration.manage.';

revoke all on function platform.configure_lifecycle_integration(uuid, text, text, text) from public, anon;
grant execute on function platform.configure_lifecycle_integration(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Estado deseado y aplicado por tenant (un tenant = una app)
-- ---------------------------------------------------------------------------
create table platform.tenant_lifecycle_delivery (
  tenant_id        uuid primary key references platform.tenants (id) on delete restrict,
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  desired_state    text not null,
  desired_reason   text,
  desired_version  integer not null default 1,
  desired_at       timestamptz not null default now(),
  applied_version  integer,
  applied_state    text,
  applied_at       timestamptz,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  lease_owner      text,
  lease_until      timestamptz,
  last_attempt_at  timestamptz,
  last_result      text,
  last_http_status integer,
  last_error_code  text,
  updated_at       timestamptz not null default now(),
  constraint tenant_lifecycle_delivery_state_ck check (desired_state in ('ACTIVE', 'SUSPENDED')),
  constraint tenant_lifecycle_delivery_reason_ck check (
    (desired_state = 'ACTIVE' and desired_reason is null)
    or (desired_state = 'SUSPENDED' and desired_reason in ('NON_PAYMENT', 'MANUAL', 'TERMINATED'))),
  constraint tenant_lifecycle_delivery_version_ck check (desired_version >= 1
    and (applied_version is null or applied_version >= 1)),
  constraint tenant_lifecycle_delivery_applied_ck check (
    (applied_version is null) = (applied_state is null)
    and (applied_state is null or applied_state in ('ACTIVE', 'SUSPENDED'))),
  constraint tenant_lifecycle_delivery_result_ck check (last_result is null or last_result in (
    'APPLIED', 'REPLAYED', 'STALE', 'CONFLICT', 'RETRYABLE', 'REJECTED', 'NOT_CONFIGURED')),
  constraint tenant_lifecycle_delivery_error_ck check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

create index tenant_lifecycle_delivery_product_idx on platform.tenant_lifecycle_delivery (saas_product_id);
create index tenant_lifecycle_delivery_pending_idx on platform.tenant_lifecycle_delivery (next_attempt_at)
  where applied_version is distinct from desired_version;

comment on table platform.tenant_lifecycle_delivery is
  'Contrato lifecycle.v1: lo que MasterAdmin quiere (desired_*) y lo que la app confirmó (applied_*). Escribe solo el servidor.';

alter table platform.tenant_lifecycle_delivery enable row level security;
alter table platform.tenant_lifecycle_delivery force row level security;

create policy tenant_lifecycle_delivery_select on platform.tenant_lifecycle_delivery
  for select to authenticated
  using (tenant_id in (select t.id from platform.tenants t));

revoke all on platform.tenant_lifecycle_delivery from public, anon, authenticated;
grant select on platform.tenant_lifecycle_delivery to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Núcleo: recalcular el estado deseado de un tenant (sin guardia, sin grants)
-- ---------------------------------------------------------------------------
create or replace function platform._mark_lifecycle_desired(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_state  text;
  v_reason text;
  v_row    record;
begin
  select t.id, t.status, t.saas_product_id into v_tenant from platform.tenants t where t.id = p_tenant_id;
  if v_tenant.id is null then
    return;
  end if;

  -- Solo hay algo que decir a la app si el tenant existe allí.
  if not exists (select 1 from platform.tenant_product_mappings m
                  where m.tenant_id = p_tenant_id and m.status = 'ACTIVE') then
    return;
  end if;

  if v_tenant.status = 'ACTIVE' then
    v_state := 'ACTIVE';
    v_reason := null;
  elsif v_tenant.status = 'SUSPENDED' then
    v_state := 'SUSPENDED';
    select su.cause into v_reason from platform.tenant_suspensions su
     where su.tenant_id = p_tenant_id and su.resumed_at is null;
    v_reason := coalesce(v_reason, 'MANUAL');
  elsif v_tenant.status in ('CHURNED', 'ARCHIVED') then
    v_state := 'SUSPENDED';
    v_reason := 'TERMINATED';
  else
    -- PENDING: aún no opera; nada que entregar.
    return;
  end if;

  select * into v_row from platform.tenant_lifecycle_delivery where tenant_id = p_tenant_id for update;
  if v_row.tenant_id is null then
    -- Un tenant activo que nunca se suspendió no genera tráfico: la app ya lo
    -- considera ACTIVE sin ningún PUT previo (contrato §4).
    if v_state = 'ACTIVE' then
      return;
    end if;
    insert into platform.tenant_lifecycle_delivery (tenant_id, saas_product_id, desired_state, desired_reason)
    values (p_tenant_id, v_tenant.saas_product_id, v_state, v_reason);
    return;
  end if;

  if v_row.desired_state = v_state and v_row.desired_reason is not distinct from v_reason then
    return;
  end if;

  update platform.tenant_lifecycle_delivery
     set desired_state = v_state,
         desired_reason = v_reason,
         desired_version = greatest(desired_version, coalesce(applied_version, 0)) + 1,
         desired_at = now(),
         attempts = 0,
         next_attempt_at = now(),
         updated_at = now()
   where tenant_id = p_tenant_id;
end;
$$;

revoke all on function platform._mark_lifecycle_desired(uuid) from public, anon, authenticated, service_role;

-- El trigger de estado (20261020000100) suma la entrega lifecycle.
create or replace function platform.on_tenant_status_changed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  -- appActive del snapshot depende del estado: la app se entera en el próximo push.
  perform platform.mark_entitlements_dirty(new.id, new.saas_product_id, 'TENANT_STATUS_' || new.status::text);
  -- Y el estado operativo viaja por lifecycle.v1 (D-14: appActive no bloquea la operación).
  perform platform._mark_lifecycle_desired(new.id);
  return null;
end;
$$;

revoke all on function platform.on_tenant_status_changed() from public, anon, authenticated, service_role;

-- La suspensión manual se registra después de cambiar el estado: si su causa
-- llega más tarde, la entrega se recalcula (misma versión si nada cambia).
create or replace function platform.on_tenant_suspension_changed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  perform platform._mark_lifecycle_desired(new.tenant_id);
  return null;
end;
$$;

revoke all on function platform.on_tenant_suspension_changed() from public, anon, authenticated, service_role;

create trigger tenant_suspensions_marks_lifecycle
  after insert on platform.tenant_suspensions
  for each row
  execute function platform.on_tenant_suspension_changed();

-- Un alta que llega cuando el tenant ya no está activo también se entrega.
create or replace function platform.on_tenant_mapping_activated()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  perform platform._mark_lifecycle_desired(new.tenant_id);
  return null;
end;
$$;

revoke all on function platform.on_tenant_mapping_activated() from public, anon, authenticated, service_role;

create trigger tenant_product_mappings_marks_lifecycle
  after insert or update of status on platform.tenant_product_mappings
  for each row
  when (new.status = 'ACTIVE')
  execute function platform.on_tenant_mapping_activated();

-- ---------------------------------------------------------------------------
-- 4. Canal servidor: reclamar, contexto de entrega y registrar el resultado
-- ---------------------------------------------------------------------------
create or replace function platform.lifecycle_channel_of(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select i.id
    from platform.tenant_product_mappings m
    join platform.deployment_targets dt on dt.id = m.deployment_target_id
    join platform.product_integrations i on i.id = dt.product_integration_id
   where m.tenant_id = p_tenant_id
     and m.status = 'ACTIVE'
     and i.integration_type = 'HTTP_M2M'
     and i.lifecycle_path is not null
     and i.lifecycle_write_scope is not null
   limit 1
$$;

revoke all on function platform.lifecycle_channel_of(uuid) from public, anon, authenticated, service_role;

create or replace function platform.claim_lifecycle_deliveries(
  p_worker        text,
  p_limit         integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  tenant_id       uuid,
  saas_product_id uuid,
  desired_version integer,
  desired_state   text,
  desired_reason  text,
  desired_at      timestamptz
)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: claim_lifecycle_deliveries() es del canal servidor' using errcode = '42501';
  end if;
  if p_worker is null or length(p_worker) not between 1 and 200 then
    raise exception 'PETICION_INVALIDA: worker' using errcode = '22023';
  end if;

  return query
  with c as (
    select d.tenant_id
      from platform.tenant_lifecycle_delivery d
     where d.applied_version is distinct from d.desired_version
       and d.next_attempt_at <= now()
       and (d.lease_until is null or d.lease_until < now())
       and platform.lifecycle_channel_of(d.tenant_id) is not null
     order by d.next_attempt_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
  )
  update platform.tenant_lifecycle_delivery d
     set lease_owner = p_worker,
         lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 10), 900)),
         attempts = d.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
    from c
   where d.tenant_id = c.tenant_id
  returning d.tenant_id, d.saas_product_id, d.desired_version, d.desired_state, d.desired_reason, d.desired_at;
end;
$$;

comment on function platform.claim_lifecycle_deliveries(text, integer, integer) is
  'Reclama entregas lifecycle.v1 pendientes (FOR UPDATE SKIP LOCKED) con lease. Solo service_role.';

revoke all on function platform.claim_lifecycle_deliveries(text, integer, integer) from public, anon, authenticated;
grant execute on function platform.claim_lifecycle_deliveries(text, integer, integer) to service_role;

-- Espejo acotado de entitlement_delivery_context: SOLO lo que necesita
-- lifecycle.v1. `secret_ref` es el NOMBRE; el valor lo resuelve la Edge Function.
create or replace function platform.lifecycle_delivery_context(p_tenant_id uuid)
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
    raise exception 'SOLO_SERVIDOR: lifecycle_delivery_context() resuelve configuración sensible' using errcode = '42501';
  end if;

  select m.* into v_map from platform.tenant_product_mappings m
   where m.tenant_id = p_tenant_id and m.status = 'ACTIVE';
  if v_map.id is null then
    raise exception 'TENANT_NO_APROVISIONADO' using errcode = 'P0002';
  end if;
  select * into v_dep from platform.deployment_targets where id = v_map.deployment_target_id;
  select * into v_int from platform.product_integrations where id = v_dep.product_integration_id;
  select * into v_cred from platform.credential_profiles where id = v_dep.credential_profile_id;
  select * into v_prod from platform.saas_products where id = v_map.saas_product_id;

  return jsonb_build_object(
    'tenant', jsonb_build_object('controlPlaneTenantId', p_tenant_id, 'productCode', v_prod.code),
    'deployment', case when v_dep.id is null then null else jsonb_build_object(
      'id', v_dep.id, 'environment', v_dep.provisioning_environment::text, 'base_url', v_dep.base_url,
      'timeout_ms', v_dep.timeout_ms, 'retry_count', v_dep.retry_count) end,
    'integration', case when v_int.id is null then null else jsonb_build_object(
      'id', v_int.id, 'type', v_int.integration_type::text, 'issuer', v_int.issuer, 'audience', v_int.audience,
      'subject', v_int.subject, 'algorithm', v_int.algorithm::text, 'token_ttl_seconds', v_int.token_ttl_seconds,
      'lifecycle_path', v_int.lifecycle_path, 'lifecycle_write_scope', v_int.lifecycle_write_scope,
      'lifecycle_read_scope', v_int.lifecycle_read_scope,
      'allowed_hosts', to_jsonb(v_int.allowed_hosts)) end,
    'credential', case when v_cred.id is null then null else jsonb_build_object(
      'id', v_cred.id, 'type', v_cred.type::text, 'enabled', v_cred.enabled, 'algorithm', v_cred.algorithm::text,
      'token_ttl_seconds', v_cred.token_ttl_seconds, 'secret_ref', v_cred.secret_ref) end
  );
end;
$$;

comment on function platform.lifecycle_delivery_context(uuid) is
  'Destino, ruta y scopes lifecycle.v1 y NOMBRE del secreto para el PUT. Solo service_role.';

revoke all on function platform.lifecycle_delivery_context(uuid) from public, anon, authenticated;
grant execute on function platform.lifecycle_delivery_context(uuid) to service_role;

create or replace function platform.record_lifecycle_delivery_result(
  p_tenant_id       uuid,
  p_worker          text,
  p_version         integer,
  p_state           text,
  p_result          text,
  p_http_status     integer default null,
  p_error_code      text default null,
  p_applied_version integer default null
)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row  record;
  v_code text := case when p_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$' then p_error_code
                      when p_error_code is null then null else 'ERROR' end;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: record_lifecycle_delivery_result() es del canal servidor' using errcode = '42501';
  end if;
  if p_result not in ('APPLIED', 'REPLAYED', 'STALE', 'CONFLICT', 'RETRYABLE', 'REJECTED', 'NOT_CONFIGURED') then
    raise exception 'PETICION_INVALIDA: result' using errcode = '22023';
  end if;

  select * into v_row from platform.tenant_lifecycle_delivery where tenant_id = p_tenant_id for update;
  if v_row.tenant_id is null then
    raise exception 'ENTREGA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_row.lease_owner is distinct from p_worker then
    -- El lease venció y otro worker la tomó: su resultado manda.
    return 'LEASE_PERDIDO';
  end if;

  if p_result in ('APPLIED', 'REPLAYED') then
    if p_state not in ('ACTIVE', 'SUSPENDED') or p_version is null or p_version < 1 then
      raise exception 'PETICION_INVALIDA: versión o estado aplicado' using errcode = '22023';
    end if;
    update platform.tenant_lifecycle_delivery
       set applied_version = p_version,
           applied_state = p_state,
           applied_at = now(),
           attempts = 0,
           next_attempt_at = now()
     where tenant_id = p_tenant_id;
    if p_result = 'APPLIED' then
      insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
      values (null, 'TENANT_LIFECYCLE_APPLIED', 'tenant', p_tenant_id::text,
              jsonb_build_object('source', 'SYSTEM', 'version', p_version, 'state', p_state,
                                 'reason', case when p_version = v_row.desired_version then v_row.desired_reason end));
    end if;
  elsif p_result in ('STALE', 'CONFLICT') then
    -- La app ya vio una versión igual o mayor: se re-emite por encima de ella.
    update platform.tenant_lifecycle_delivery
       set desired_version = greatest(desired_version, coalesce(p_applied_version, 0)) + 1,
           desired_at = now(),
           next_attempt_at = now()
     where tenant_id = p_tenant_id;
  elsif p_result = 'RETRYABLE' then
    update platform.tenant_lifecycle_delivery
       set next_attempt_at = now() + make_interval(mins => power(2, least(greatest(attempts, 1) - 1, 5))::int)
     where tenant_id = p_tenant_id;
  else
    -- REJECTED / NOT_CONFIGURED: requiere a una persona; se reintenta cada hora.
    update platform.tenant_lifecycle_delivery
       set next_attempt_at = now() + interval '1 hour'
     where tenant_id = p_tenant_id;
  end if;

  update platform.tenant_lifecycle_delivery
     set lease_owner = null,
         lease_until = null,
         last_result = p_result,
         last_http_status = p_http_status,
         last_error_code = v_code,
         updated_at = now()
   where tenant_id = p_tenant_id;

  return p_result;
end;
$$;

comment on function platform.record_lifecycle_delivery_result(uuid, text, integer, text, text, integer, text, integer) is
  'Registra el resultado de un PUT lifecycle.v1 (libera el lease, backoff, re-emisión ante STALE/CONFLICT). Solo service_role.';

revoke all on function platform.record_lifecycle_delivery_result(uuid, text, integer, text, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function platform.record_lifecycle_delivery_result(uuid, text, integer, text, text, integer, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Read model: v_tenant_lifecycle suma la entrega operativa (columnas al final)
-- ---------------------------------------------------------------------------
create or replace view platform.v_tenant_lifecycle
with (security_invoker = true) as
with debt as (
  select d.tenant_id,
         count(*)::int                                          as overdue_invoices,
         case when count(distinct d.currency) = 1 then sum(d.balance) end as overdue_balance,
         case when count(distinct d.currency) = 1 then min(d.currency) end as overdue_currency,
         min(d.due_date)                                        as oldest_due_date,
         max(d.days_past_due)                                   as days_past_due,
         min(d.grace_ends_on)                                   as grace_ends_on,
         bool_or(current_date > d.grace_ends_on)                as grace_expired,
         bool_or(current_date > d.grace_ends_on and d.auto_suspend) as auto_suspend_due
    from platform.tenant_overdue_invoices(current_date) d
   group by d.tenant_id
)
select t.id                          as tenant_id,
       t.name                        as tenant_name,
       t.slug                        as tenant_slug,
       t.status                      as tenant_status,
       t.environment,
       t.deployment_mode,
       t.customer_organization_id,
       o.display_name                as organization_name,
       t.managing_organization_id,
       mo.display_name               as managing_organization_name,
       t.saas_product_id,
       p.code                        as product_code,
       p.short_name                  as product_short_name,
       p.accent_color                as product_accent_color,
       p.sort_order                  as product_sort_order,
       coalesce(debt.overdue_invoices, 0) as overdue_invoices,
       debt.overdue_balance,
       debt.overdue_currency,
       debt.oldest_due_date,
       debt.days_past_due,
       debt.grace_ends_on,
       coalesce(debt.grace_expired, false)    as grace_expired,
       coalesce(debt.auto_suspend_due, false) as auto_suspend_due,
       su.id                         as open_suspension_id,
       su.cause                      as suspension_cause,
       su.reason                     as suspension_reason,
       su.suspended_at,
       case
         when t.status = 'SUSPENDED' and su.cause = 'NON_PAYMENT' then 'SUSPENDED_NON_PAYMENT'
         when t.status = 'SUSPENDED'                              then 'SUSPENDED_MANUAL'
         when t.status <> 'ACTIVE'                                then 'INACTIVE'
         when coalesce(debt.auto_suspend_due, false)              then 'SUSPENSION_SCHEDULED'
         when coalesce(debt.grace_expired, false)                 then 'SUSPENSION_SUGGESTED'
         when coalesce(debt.overdue_invoices, 0) > 0              then 'IN_GRACE'
         else 'CURRENT'
       end                           as lifecycle_stage,
       es.state                      as sync_state,
       es.cohort_state,
       es.desired_version,
       es.applied_version,
       es.last_push_at,
       es.last_verified_at,
       coalesce(ds.desired_dirty, false) as desired_dirty,
       ds.last_change_reason,
       ds.last_change_at,
       ig.code                       as integration_code,
       coalesce(ig.entitlements_push_enabled, false) as push_enabled,
       coalesce(ig.lifecycle_channel, false) as lifecycle_channel,
       ld.desired_state              as lifecycle_desired_state,
       ld.desired_reason             as lifecycle_desired_reason,
       ld.desired_version            as lifecycle_desired_version,
       ld.applied_version            as lifecycle_applied_version,
       ld.applied_state              as lifecycle_applied_state,
       ld.applied_at                 as lifecycle_applied_at,
       ld.last_result                as lifecycle_last_result,
       ld.last_error_code            as lifecycle_last_error,
       ld.attempts                   as lifecycle_attempts,
       ld.next_attempt_at            as lifecycle_next_attempt_at
  from platform.tenants t
  join platform.organizations o on o.id = t.customer_organization_id
  join platform.saas_products p on p.id = t.saas_product_id
  left join platform.organizations mo on mo.id = t.managing_organization_id
  left join debt on debt.tenant_id = t.id
  left join platform.tenant_suspensions su on su.tenant_id = t.id and su.resumed_at is null
  left join platform.entitlement_sync_state es
    on es.tenant_id = t.id and es.saas_product_id = t.saas_product_id
  left join platform.entitlement_desired_state ds
    on ds.tenant_id = t.id and ds.saas_product_id = t.saas_product_id
  left join platform.tenant_lifecycle_delivery ld on ld.tenant_id = t.id
  left join lateral (
    select i.code, i.entitlements_push_enabled,
           (i.integration_type = 'HTTP_M2M' and i.lifecycle_path is not null
            and i.lifecycle_write_scope is not null) as lifecycle_channel
      from platform.tenant_product_mappings m
      join platform.deployment_targets dt on dt.id = m.deployment_target_id
      join platform.product_integrations i on i.id = dt.product_integration_id
     where m.tenant_id = t.id and m.saas_product_id = t.saas_product_id and m.status = 'ACTIVE'
     limit 1
  ) ig on true;

comment on view platform.v_tenant_lifecycle is
  'Matriz de la suite: tenant × app con estado, deuda, etapa de ciclo de vida, entrega de entitlements y de lifecycle.v1. SECURITY INVOKER.';

revoke all on platform.v_tenant_lifecycle from public, anon;
grant select on platform.v_tenant_lifecycle to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill: los tenants hoy no activos con alta en su app
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select t.id from platform.tenants t where t.status in ('SUSPENDED', 'CHURNED', 'ARCHIVED') loop
    perform platform._mark_lifecycle_desired(r.id);
  end loop;
end;
$$;
