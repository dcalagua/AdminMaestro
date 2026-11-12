-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · acciones SYNC_ENTITLEMENTS y
-- GET_ENTITLEMENTS del orquestador (MA-36)
-- ----------------------------------------------------------------------------
-- Spec §3.2, §9, §14. Plan §4 fila 16, §10.1 MA-36.
-- Test: supabase/tests/37_ccp_sync_actions.test.sql.
--
-- ADITIVO. provisioning_execution_context, integration_capabilities y las RPCs
-- de PROVISION / CHECK_HEALTH / GET_STATUS / REPLAY_CERTIFICATION no cambian:
-- el canal de entitlements tiene su propio contexto (entitlement_delivery_context,
-- migración …0300) y sus propios booleanos de autorización, con el mismo patrón
-- (el orquestador pregunta ANTES de asumir service_role).
--
--   · can_sync_entitlements(tenant)     → platform.provisioning.execute del producto
--   · can_read_entitlement_sync(tenant) → platform.provisioning.read del producto
--     (comercial ≠ operativo: un admin de tenant o un partner no dispara sync).
--   · claim_entitlement_push_for / claim_entitlement_verification_for: el
--     "sincronizar ahora" de un tenant. Ignora el backoff y permite reintentar un
--     REJECTED (tras corregir configuración), pero NUNCA pisa un push en vuelo ni
--     fuerza DRIFT_AHEAD / DRIFT_CHECKSUM (spec §18: incidente + versión nueva).
--   · v_entitlement_sync_status: read model SECURITY INVOKER.
--
-- Rollback: docs/runbooks/ccp-rollback/08.sql.
-- ============================================================================

create or replace function platform.can_sync_entitlements(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce((select platform.has_product_permission('platform.provisioning.execute', t.saas_product_id)
                     from platform.tenants t where t.id = p_tenant_id), false);
$$;

create or replace function platform.can_read_entitlement_sync(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce((select platform.has_product_permission('platform.provisioning.read', t.saas_product_id)
                     from platform.tenants t where t.id = p_tenant_id), false);
$$;

comment on function platform.can_sync_entitlements(uuid) is
  'Booleano del orquestador para SYNC_ENTITLEMENTS: platform.provisioning.execute sobre el producto del tenant.';
comment on function platform.can_read_entitlement_sync(uuid) is
  'Booleano del orquestador para GET_ENTITLEMENTS: platform.provisioning.read sobre el producto del tenant.';

revoke all on function platform.can_sync_entitlements(uuid) from public, anon;
revoke all on function platform.can_read_entitlement_sync(uuid) from public, anon;
grant execute on function platform.can_sync_entitlements(uuid) to authenticated, service_role;
grant execute on function platform.can_read_entitlement_sync(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claims dirigidos (solo service_role)
-- ---------------------------------------------------------------------------
create or replace function platform.claim_entitlement_push_for(
  p_tenant_id     uuid,
  p_product_id    uuid,
  p_worker        text,
  p_lease_seconds integer default 60
)
returns table (
  tenant_id        uuid,
  saas_product_id  uuid,
  snapshot_version bigint,
  checksum         text,
  document         jsonb,
  attempt          integer
)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row platform.entitlement_sync_state;
begin
  perform platform.assert_entitlement_sync_service();
  if coalesce(trim(p_worker), '') = '' or p_lease_seconds not between 10 and 900 then
    raise exception 'PARAMETROS_INVALIDOS' using errcode = '22023';
  end if;

  select * into v_row from platform.entitlement_sync_state s
   where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id
     for update of s skip locked;
  if v_row.tenant_id is null
     or v_row.desired_version is null
     or not (v_row.state in ('PENDING_PUSH', 'DRIFT_BEHIND', 'UNREACHABLE', 'REJECTED')
             or (v_row.state = 'PUSHING' and v_row.lease_until < now()))
     or platform.entitlement_gate_state(p_tenant_id, p_product_id) is not null
     or not platform.entitlements_push_enabled(p_tenant_id, p_product_id) then
    return;
  end if;

  update platform.entitlement_sync_state s
     set state = 'PUSHING', pushing_version = s.desired_version, state_changed_at = now(),
         lease_owner = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds)
   where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id;

  return query
    select es.tenant_id, es.saas_product_id, es.snapshot_version, es.checksum, es.document, v_row.consecutive_failures + 1
      from platform.entitlement_snapshots es
     where es.tenant_id = p_tenant_id and es.saas_product_id = p_product_id
       and es.snapshot_version = v_row.desired_version;
end;
$$;

comment on function platform.claim_entitlement_push_for(uuid, uuid, text, integer) is
  'Sync manual de un tenant: ignora el backoff y admite REJECTED; nunca pisa un push en vuelo ni fuerza '
  'DRIFT_AHEAD/DRIFT_CHECKSUM; respeta puertas y kill-switch. Solo service_role.';

create or replace function platform.claim_entitlement_verification_for(
  p_tenant_id     uuid,
  p_product_id    uuid,
  p_worker        text,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row platform.entitlement_sync_state;
begin
  perform platform.assert_entitlement_sync_service();
  if coalesce(trim(p_worker), '') = '' or p_lease_seconds not between 10 and 900 then
    raise exception 'PARAMETROS_INVALIDOS' using errcode = '22023';
  end if;

  select * into v_row from platform.entitlement_sync_state s
   where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id
     for update of s skip locked;
  if v_row.tenant_id is null
     or v_row.state in ('PUSHING', 'NOT_PROVISIONED', 'NOT_ENROLLED')
     or (v_row.lease_until is not null and v_row.lease_until >= now())
     or platform.entitlement_gate_state(p_tenant_id, p_product_id) is not null then
    return false;
  end if;

  update platform.entitlement_sync_state s
     set lease_owner = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds)
   where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id;
  return true;
end;
$$;

comment on function platform.claim_entitlement_verification_for(uuid, uuid, text, integer) is
  'GET_ENTITLEMENTS de un tenant: reserva la verificación si no hay push en vuelo. Solo service_role.';

revoke all on function platform.claim_entitlement_push_for(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function platform.claim_entitlement_verification_for(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function platform.claim_entitlement_push_for(uuid, uuid, text, integer) to service_role;
grant execute on function platform.claim_entitlement_verification_for(uuid, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Read model de la consola (SECURITY INVOKER: la RLS del llamante manda)
-- ---------------------------------------------------------------------------
create or replace view platform.v_entitlement_sync_status
with (security_invoker = true) as
select s.tenant_id,
       t.name                       as tenant_name,
       t.slug                       as tenant_slug,
       s.saas_product_id,
       p.code                       as product_code,
       p.name                       as product_name,
       s.state,
       s.state_reason,
       s.state_changed_at,
       s.desired_version,
       s.desired_checksum,
       coalesce(d.desired_dirty, false) as desired_dirty,
       s.last_pushed_version,
       s.last_push_at,
       s.last_push_result,
       s.applied_version,
       s.applied_checksum,
       s.applied_status,
       s.unknown_capabilities,
       s.last_verified_at,
       s.consecutive_failures,
       s.next_attempt_at,
       s.cohort_state,
       i.code                       as integration_code,
       i.cutover_state_entitlements,
       i.entitlements_push_enabled  as push_enabled
  from platform.entitlement_sync_state s
  join platform.tenants t on t.id = s.tenant_id
  join platform.saas_products p on p.id = s.saas_product_id
  left join platform.entitlement_desired_state d
    on d.tenant_id = s.tenant_id and d.saas_product_id = s.saas_product_id
  left join platform.tenant_product_mappings m
    on m.tenant_id = s.tenant_id and m.saas_product_id = s.saas_product_id and m.status = 'ACTIVE'
  left join platform.deployment_targets dt on dt.id = m.deployment_target_id
  left join platform.product_integrations i on i.id = dt.product_integration_id;

comment on view platform.v_entitlement_sync_status is
  'Deseado frente a aplicado por tenant×producto para la consola (spec §9). SECURITY INVOKER.';

revoke all on platform.v_entitlement_sync_status from public, anon;
grant select on platform.v_entitlement_sync_status to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Selección de trabajo para el job entitlement-sync (solo service_role)
-- ---------------------------------------------------------------------------
-- Tenants enrolados cuyo snapshot hay que (re)emitir: dirty, sin snapshot aún
-- o, en un barrido, todos (cambios por paso del tiempo: grants que entran en
-- vigor, bajas programadas, cambio de período de las asignaciones). Emitir es
-- idempotente: sin cambio de contenido no hay versión nueva.
create or replace function platform.entitlement_issue_candidates(p_limit integer default 100, p_sweep boolean default false)
returns table (tenant_id uuid, saas_product_id uuid)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  perform platform.assert_entitlement_sync_service();
  if p_limit not between 1 and 1000 then
    raise exception 'PARAMETROS_INVALIDOS' using errcode = '22023';
  end if;
  return query
    select m.tenant_id, m.saas_product_id
      from platform.tenant_product_mappings m
      left join platform.entitlement_desired_state d
        on d.tenant_id = m.tenant_id and d.saas_product_id = m.saas_product_id
     where m.status = 'ACTIVE'
       and platform.entitlement_gate_state(m.tenant_id, m.saas_product_id) is null
       and (p_sweep
            or coalesce(d.desired_dirty, false)
            or not exists (select 1 from platform.entitlement_snapshots es
                            where es.tenant_id = m.tenant_id and es.saas_product_id = m.saas_product_id))
     order by coalesce(d.desired_dirty, false) desc, d.dirty_since nulls last, m.tenant_id
     limit p_limit;
end;
$$;

-- Un tenant representativo por integración enrolada: el manifiesto no es por
-- tenant, pero el contexto de entrega (destino + credencial) sí.
create or replace function platform.entitlement_registry_targets()
returns table (saas_product_id uuid, product_integration_id uuid, tenant_id uuid)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  perform platform.assert_entitlement_sync_service();
  return query
    select distinct on (d.product_integration_id) m.saas_product_id, d.product_integration_id, m.tenant_id
      from platform.tenant_product_mappings m
      join platform.deployment_targets d on d.id = m.deployment_target_id
      join platform.product_integrations i on i.id = d.product_integration_id
     where m.status = 'ACTIVE'
       and i.cutover_state_entitlements <> 'LEGACY_ONLY'
       and i.entitlements_manifest_path is not null
     order by d.product_integration_id, m.tenant_id;
end;
$$;

revoke all on function platform.entitlement_issue_candidates(integer, boolean) from public, anon, authenticated;
revoke all on function platform.entitlement_registry_targets() from public, anon, authenticated;
grant execute on function platform.entitlement_issue_candidates(integer, boolean) to service_role;
grant execute on function platform.entitlement_registry_targets() to service_role;
