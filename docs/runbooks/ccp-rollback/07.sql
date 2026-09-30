-- ============================================================================
-- Rollback de la fase 07 (EBIM Commercial Control Plane) — NO es una migración.
-- ----------------------------------------------------------------------------
-- Plan §15: las migraciones 20260929000100…001000 son aditivas; el rollback
-- DESACTIVA, nunca borra datos comerciales (registro, grants, overrides, precios
-- de add-on, historia de tenant_addons y el estado deseado se conservan).
-- Se aplica a mano, solo con decisión humana registrada en el ledger, primero
-- sobre una base LOCAL/desechable. El valor de enum USAGE_OVERAGE no se elimina
-- (no existe DROP VALUE) y queda sin uso.
--
-- Efecto:
--   A. La API deja de poder ejecutar las RPCs nuevas (solo service_role y el
--      propietario las conservan para diagnóstico).
--   B. Las vistas comerciales nuevas dejan de ser legibles por authenticated.
--   C. Vuelve la vía de la fase 03 para otorgar/revocar un add-on
--      (set_tenant_addon_active, can_manage_commercial + motivo + auditoría),
--      adaptada a las columnas nuevas de tenant_addons (status/PK id), para que
--      la operación comercial no quede sin camino. NO reabre el autootorgamiento.
--   D. tenant_features: las filas ENTITLEMENT se conservan como dato; nada las
--      vuelve a materializar mientras las RPCs estén revocadas.
-- ============================================================================
begin;

-- ---- A · RPCs nuevas sin EXECUTE para la API --------------------------------
revoke execute on function
  platform.import_capability_manifest(text, jsonb),
  platform.upsert_capability_alias(text, text, text, text),
  platform.set_catalog_item_lifecycle(text, text, text),
  platform.set_catalog_item_price(text, text, platform.charge_kind, platform.billing_interval, numeric, char, date),
  platform.create_entitlement_grant(text, text, text, jsonb, date, text),
  platform.close_entitlement_grant(uuid, date, text),
  platform.create_entitlement_override(uuid, text, text, jsonb, timestamptz, text, timestamptz),
  platform.revoke_entitlement_override(uuid, text),
  platform.request_tenant_addon(uuid, text, uuid, text),
  platform.approve_tenant_addon(uuid, text),
  platform.reject_tenant_addon(uuid, text),
  platform.schedule_cancel_tenant_addon(uuid, text, timestamptz),
  platform.reactivate_tenant_addon(uuid, text),
  platform.suspend_tenant_addon(uuid, text),
  platform.resume_tenant_addon(uuid, text),
  platform.cancel_tenant_addon(uuid, text),
  platform.complete_scheduled_addon_cancellations(timestamptz),
  platform.refresh_tenant_features(uuid)
from authenticated;

-- ---- B · Vistas comerciales nuevas sin lectura para la API -----------------
revoke select on platform.v_tenant_entitlements, platform.v_catalog_item_current_prices,
                 platform.v_tenant_addon_history, platform.v_commercial_audit_log from authenticated;

-- ---- C · Vía comercial de la fase 03, sobre las columnas nuevas ------------
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
  v_tenant record;
  v_item   record;
  v_open   record;
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
  if p_active and not v_item.available then
    raise exception 'ADDON_NO_DISPONIBLE: % no está disponible en el catálogo', p_addon_code using errcode = '23514';
  end if;

  select * into v_open from platform.tenant_addons
   where tenant_id = p_tenant_id and addon_code = p_addon_code and company_id is null
     and status in ('REQUESTED', 'ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED')
   for update;

  if p_active then
    if v_open.id is null then
      insert into platform.tenant_addons (tenant_id, addon_code, status, request_source, effective_from, activated_at)
      values (p_tenant_id, p_addon_code, 'ACTIVE', 'CONSOLE', now(), now());
    elsif v_open.status in ('REQUESTED', 'CANCEL_SCHEDULED', 'SUSPENDED') then
      update platform.tenant_addons
         set status = 'ACTIVE', effective_from = coalesce(effective_from, now()), effective_to = null,
             activated_at = now(), status_reason = trim(p_reason)
       where id = v_open.id;
    end if;
  elsif v_open.id is not null then
    update platform.tenant_addons
       set status = case when v_open.status = 'REQUESTED' then 'REJECTED' else 'CANCELLED' end,
           effective_to = case when v_open.status = 'REQUESTED' then effective_to else now() end,
           status_reason = trim(p_reason)
     where id = v_open.id;
  end if;

  perform platform.log_audit(
    'TENANT_ADDON_SET', 'tenant_addon', p_tenant_id::text || ':' || p_addon_code,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('addon_code', p_addon_code, 'previous_status', v_open.status,
                       'active', p_active, 'reason', trim(p_reason), 'rollback', '07'));
end;
$$;

revoke all on function platform.set_tenant_addon_active(uuid, text, boolean, text) from public, anon;
grant execute on function platform.set_tenant_addon_active(uuid, text, boolean, text) to authenticated, service_role;

commit;
