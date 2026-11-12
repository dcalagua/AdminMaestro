-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · tenant_features como read model
-- derivado de entitlements (MA-18)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (tenant_features "pasa a read-model derivado"). Plan §4 fila 11.
-- Test: supabase/tests/33_ccp_compute_entitlements.test.sql (parte MA-18).
--
--   · source gana ENTITLEMENT: filas materializadas desde compute_entitlements
--     (feature_key = código canónico; value = límite/asignación/compañías/fuentes).
--   · Las filas PLAN/ADDON (legacy) y MANUAL (set_tenant_feature, auditado)
--     NO se tocan: una fila ENTITLEMENT nunca pisa otra de distinto origen.
--   · Se refresca sola: mark_entitlements_dirty (llamado por cada RPC
--     comercial) re-materializa el tenant. Los cambios por paso del tiempo
--     (grant futuro, fin de baja programada, vencimiento de override) los
--     refresca el job con refresh_tenant_features (fase 08 lo agenda).
--   · authenticated sigue sin escritura (fase 03). refresh_tenant_features es
--     DEFINER: service_role o can_manage_commercial().
-- ============================================================================

alter table platform.tenant_features drop constraint tenant_features_source_ck;
alter table platform.tenant_features
  add constraint tenant_features_source_ck check (source in ('PLAN', 'ADDON', 'MANUAL', 'ENTITLEMENT'));

comment on column platform.tenant_features.source is
  'ENTITLEMENT = materializado desde compute_entitlements (read model, no se edita). '
  'MANUAL = set_tenant_feature (auditado). PLAN/ADDON = filas legacy previas a CCP.';

-- ---------------------------------------------------------------------------
-- Materialización (interna, sin gate: la llaman RPCs DEFINER ya autorizadas).
-- ---------------------------------------------------------------------------
create or replace function platform.materialize_tenant_features(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_count   integer;
begin
  select saas_product_id into v_product from platform.tenants where id = p_tenant_id;
  if v_product is null then
    return 0;
  end if;

  with effective as (
    select e.capability_code as feature_key,
           jsonb_strip_nulls(jsonb_build_object(
             'kind', e.kind, 'value', e.value, 'enforcement', e.enforcement,
             'included', e.included, 'period', e.period, 'unit', e.unit,
             'scope', e.scope_level, 'companyIds', to_jsonb(e.company_ids), 'sources', to_jsonb(e.sources))) as value
      from platform.compute_entitlements(p_tenant_id, v_product, now()) e
  ),
  removed as (
    delete from platform.tenant_features f
     where f.tenant_id = p_tenant_id and f.source = 'ENTITLEMENT'
       and not exists (select 1 from effective x where x.feature_key = f.feature_key)
    returning 1
  ),
  upserted as (
    insert into platform.tenant_features (tenant_id, feature_key, enabled, source, value, updated_by)
    select p_tenant_id, x.feature_key, true, 'ENTITLEMENT', x.value, null
      from effective x
    on conflict (tenant_id, feature_key) do update
      set enabled = true, value = excluded.value, updated_by = null
      where platform.tenant_features.source = 'ENTITLEMENT'
        and (platform.tenant_features.value is distinct from excluded.value or not platform.tenant_features.enabled)
    returning 1
  )
  select count(*) into v_count from effective;
  return v_count;
end;
$$;

comment on function platform.materialize_tenant_features(uuid) is
  'Interna. Re-materializa las filas ENTITLEMENT de tenant_features desde compute_entitlements; '
  'no toca filas PLAN/ADDON/MANUAL.';

revoke all on function platform.materialize_tenant_features(uuid) from public, anon, authenticated;
grant execute on function platform.materialize_tenant_features(uuid) to service_role;

create or replace function platform.refresh_tenant_features(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not (platform.is_service_request() or platform.can_manage_commercial()) then
    raise exception 'NO_AUTORIZADO: solo el job de servicio o la plataforma comercial refrescan features'
      using errcode = '42501';
  end if;
  if not exists (select 1 from platform.tenants where id = p_tenant_id) then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  return platform.materialize_tenant_features(p_tenant_id);
end;
$$;

comment on function platform.refresh_tenant_features(uuid) is
  'Refresca el read model tenant_features (source=ENTITLEMENT) de un tenant. service_role o '
  'can_manage_commercial(). Lo usa el job para cambios por paso del tiempo.';

revoke all on function platform.refresh_tenant_features(uuid) from public, anon;
grant execute on function platform.refresh_tenant_features(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cada cambio comercial re-materializa el tenant.
-- ---------------------------------------------------------------------------
create or replace function platform.mark_entitlements_dirty(
  p_tenant_id uuid,
  p_product_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if p_tenant_id is null or p_product_id is null then
    return;
  end if;
  insert into platform.entitlement_desired_state as s (
    tenant_id, saas_product_id, desired_revision, desired_dirty, dirty_since, last_change_reason, last_change_at
  ) values (
    p_tenant_id, p_product_id, 1, true, now(), p_reason, now()
  )
  on conflict (tenant_id, saas_product_id) do update
    set desired_revision   = s.desired_revision + 1,
        desired_dirty      = true,
        dirty_since        = coalesce(s.dirty_since, now()),
        last_change_reason = excluded.last_change_reason,
        last_change_at     = now();

  perform platform.materialize_tenant_features(p_tenant_id);
end;
$$;

revoke all on function platform.mark_entitlements_dirty(uuid, uuid, text) from public, anon, authenticated;
grant execute on function platform.mark_entitlements_dirty(uuid, uuid, text) to service_role;

-- Materialización inicial (entornos migrados): sin grants cargados no produce filas.
do $$
declare
  r record;
begin
  for r in select id from platform.tenants loop
    perform platform.materialize_tenant_features(r.id);
  end loop;
end;
$$;
