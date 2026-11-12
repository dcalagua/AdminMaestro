-- ============================================================================
-- EBIM Commercial Control Plane · Fase 03 · cierre del autootorgamiento comercial
-- ----------------------------------------------------------------------------
-- Plan: docs/superpowers/plans/2026-09-27-ebim-commercial-control-plane-implementation.md
--       §5 Task MA-03 (P0-MA-1). Test: supabase/tests/28_ccp_commercial_self_grant.test.sql
--
-- Hallazgo (20260902000900_rls_policies.sql, secciones tenant_features y
-- tenant_addons): `authenticated` tenía INSERT/UPDATE/DELETE con políticas
-- can_manage_tenant(). Eso deja que un TENANT_ADMIN, el ORG_ADMIN del cliente o
-- el PARTNER_ADMIN que gestiona el tenant se enciendan add-ons y features: un
-- autootorgamiento comercial. set_tenant_feature usaba el mismo gate.
--
-- La premisa de 0900 («el ADDON lo enciende el cliente») se retira: encender un
-- add-on ES el acto comercial (spec §2, comercial ≠ acceso operativo). Desde
-- aquí:
--   · ningún rol de la API escribe tenant_addons / tenant_features directamente
--     (tampoco la plataforma: todo pasa por RPC auditada);
--   · la lectura no cambia (can_read_tenant);
--   · set_tenant_feature y la nueva set_tenant_addon_active exigen
--     can_manage_commercial() (EBIM_FINANCE, EBIM_PRODUCT_ADMIN, super admin) y
--     escriben audit_logs;
--   · service_role (workers) conserva sus privilegios.
--
-- set_tenant_addon_active es TEMPORAL: la fase 07 (migración
-- 20260929000600_ccp_tenant_addons_lifecycle) la sustituye por el ciclo de vida
-- request/approve/…/cancel. La configuración de una capacidad YA otorgada vive
-- en cada SaaS (spec §2); MasterAdmin no expone ninguna hoy.
--
-- Rollback: docs/runbooks/ccp-rollback/03.sql (parte B). Sin datos que migrar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sin escritura directa desde la API.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_features_write  on platform.tenant_features;
drop policy if exists tenant_features_update on platform.tenant_features;
drop policy if exists tenant_features_delete on platform.tenant_features;

drop policy if exists tenant_addons_write  on platform.tenant_addons;
drop policy if exists tenant_addons_update on platform.tenant_addons;
drop policy if exists tenant_addons_delete on platform.tenant_addons;

revoke insert, update, delete, truncate on platform.tenant_features from authenticated, anon, public;
revoke insert, update, delete, truncate on platform.tenant_addons   from authenticated, anon, public;

-- La lectura se mantiene tal cual (políticas *_select de 0900).
grant select on platform.tenant_features, platform.tenant_addons to authenticated;

-- ---------------------------------------------------------------------------
-- 2. set_tenant_feature: mismo cuerpo que 20260907000100 salvo el gate.
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_feature(
  p_tenant_id   uuid,
  p_feature_key text,
  p_enabled     boolean,
  p_value       jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
begin
  -- CCP P0-MA-1: otorgar un feature es comercial. can_manage_tenant() dejaba
  -- que el propio tenant (o su partner) se lo otorgara.
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN otorgan features'
      using errcode = '42501';
  end if;

  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  if nullif(trim(coalesce(p_feature_key, '')), '') is null then
    raise exception 'FEATURE_KEY_REQUERIDA' using errcode = '23502';
  end if;

  insert into platform.tenant_features (tenant_id, feature_key, enabled, source, value, updated_by)
  values (p_tenant_id, trim(p_feature_key), p_enabled, 'MANUAL', coalesce(p_value, '{}'::jsonb), auth.uid())
  on conflict (tenant_id, feature_key) do update
    set enabled = excluded.enabled,
        source = 'MANUAL',
        value = excluded.value,
        updated_by = excluded.updated_by;

  perform platform.log_audit(
    'TENANT_FEATURE_SET', 'tenant_feature', p_tenant_id::text || ':' || trim(p_feature_key),
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('feature_key', trim(p_feature_key), 'enabled', p_enabled)
  );
end;
$$;

comment on function platform.set_tenant_feature(uuid, text, boolean, jsonb) is
  'Otorga/revoca un feature flag de tenant. Solo can_manage_commercial() (CCP P0-MA-1). Auditado.';

revoke all on function platform.set_tenant_feature(uuid, text, boolean, jsonb) from public, anon;
grant execute on function platform.set_tenant_feature(uuid, text, boolean, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. set_tenant_addon_active — única vía (temporal) de otorgar/revocar un add-on.
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_addon_active(
  p_tenant_id  uuid,
  p_addon_code text,
  p_active     boolean,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant   record;
  v_item     record;
  v_previous boolean;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN otorgan o revocan add-ons'
      using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'ESTADO_REQUERIDO: p_active no puede ser null' using errcode = '23502';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: todo cambio comercial de add-on lleva motivo' using errcode = '23502';
  end if;

  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;

  select * into v_item from platform.catalog_items where code = p_addon_code;
  if v_item is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_addon_code using errcode = '23503';
  end if;
  -- Revocar siempre es posible; otorgar exige un item vendible.
  if p_active and not v_item.available then
    raise exception 'ADDON_NO_DISPONIBLE: % no está disponible en el catálogo', p_addon_code
      using errcode = '23514';
  end if;

  select a.active into v_previous
    from platform.tenant_addons a
   where a.tenant_id = p_tenant_id and a.addon_code = p_addon_code
   for update;

  if not found then
    if not p_active then
      -- Revocar algo que nunca se otorgó: no hay fila que crear, pero se audita.
      null;
    else
      insert into platform.tenant_addons (tenant_id, addon_code, active, activated_at)
      values (p_tenant_id, p_addon_code, true, now());
    end if;
  elsif v_previous is distinct from p_active then
    update platform.tenant_addons
       set active = p_active,
           activated_at = case when p_active then now() else activated_at end,
           updated_at = now()
     where tenant_id = p_tenant_id and addon_code = p_addon_code;
  end if;

  perform platform.log_audit(
    'TENANT_ADDON_SET', 'tenant_addon', p_tenant_id::text || ':' || p_addon_code,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('addon_code', p_addon_code, 'previous_active', v_previous,
                       'active', p_active, 'reason', trim(p_reason))
  );
end;
$$;

comment on function platform.set_tenant_addon_active(uuid, text, boolean, text) is
  'Otorga o revoca un add-on de tenant. Solo can_manage_commercial(); exige motivo y un item '
  'disponible para otorgar; auditado (TENANT_ADDON_SET). Temporal: la fase 07 la sustituye por '
  'el ciclo de vida de tenant_addons. CCP P0-MA-1.';

revoke all on function platform.set_tenant_addon_active(uuid, text, boolean, text) from public, anon;
grant execute on function platform.set_tenant_addon_active(uuid, text, boolean, text) to authenticated, service_role;
