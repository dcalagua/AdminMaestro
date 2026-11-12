-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · catálogo extendido (MA-12)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (catalog_items). Plan §4 fila 5.
-- Test: supabase/tests/30_ccp_catalog_item_prices.test.sql (parte MA-12).
--
--   · saas_product_id YA existe en el baseline (0300, null = transversal): se
--     reutiliza, no se duplica.
--   · lifecycle_status DRAFT/AVAILABLE/COMING_SOON/RETIRED. `available` se
--     conserva para los lectores existentes y pasa a ser DERIVADO
--     (available = lifecycle_status = 'AVAILABLE'). La RPC legacy
--     upsert_catalog_item sigue funcionando: si cambia `available`, el trigger
--     traduce a lifecycle.
--   · billing_model FLAT/PER_COMPANY/PER_UNIT, derivado de scope salvo PER_UNIT
--     (que solo se declara explícitamente: se cobra desde agregados de uso).
--   · price_month queda como dato legacy informativo; la migración …0400 lo
--     congela en cuanto el item tiene tarifa en catalog_item_prices.
--
-- Backfill: available=true → AVAILABLE; available=false → COMING_SOON (las
-- filas no disponibles del seed son conectores anunciados). Ninguna columna de
-- precio se toca (INV-4).
-- ============================================================================

alter table platform.catalog_items
  add column lifecycle_status text,
  add column billing_model    text;

update platform.catalog_items
   set lifecycle_status = case when available then 'AVAILABLE' else 'COMING_SOON' end,
       billing_model    = case when scope = 'per-company' then 'PER_COMPANY' else 'FLAT' end;

alter table platform.catalog_items
  alter column lifecycle_status set not null,
  alter column billing_model set not null,
  add constraint catalog_items_lifecycle_ck
    check (lifecycle_status in ('DRAFT', 'AVAILABLE', 'COMING_SOON', 'RETIRED')),
  add constraint catalog_items_billing_model_ck
    check (billing_model in ('FLAT', 'PER_COMPANY', 'PER_UNIT')),
  add constraint catalog_items_available_derived_ck
    check (available = (lifecycle_status = 'AVAILABLE'));

comment on column platform.catalog_items.lifecycle_status is
  'Ciclo de vida comercial (spec §3.2). Solo AVAILABLE se puede activar en un tenant. '
  '`available` es derivado y se mantiene por compatibilidad.';
comment on column platform.catalog_items.billing_model is
  'FLAT: cantidad 1 · PER_COMPANY: una unidad por compañía con el add-on activo · '
  'PER_UNIT: cantidad desde agregados de uso (spec §5.3).';
comment on column platform.catalog_items.price_month is
  'LEGACY informativo. Ninguna ruta de facturación nueva lo usa; congelado cuando existe '
  'tarifa en catalog_item_prices (spec §5.6).';

create or replace function platform.derive_catalog_item_state()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.lifecycle_status := coalesce(new.lifecycle_status,
                                     case when new.available then 'AVAILABLE' else 'DRAFT' end);
    new.billing_model := coalesce(new.billing_model,
                                  case when new.scope = 'per-company' then 'PER_COMPANY' else 'FLAT' end);
  else
    if new.lifecycle_status is distinct from old.lifecycle_status then
      null; -- manda lifecycle; available se recalcula abajo
    elsif new.available is distinct from old.available then
      -- Compatibilidad con upsert_catalog_item (solo conoce `available`).
      new.lifecycle_status := case
        when new.available then 'AVAILABLE'
        when old.lifecycle_status = 'AVAILABLE' then 'DRAFT'
        else old.lifecycle_status
      end;
    end if;
    if new.scope is distinct from old.scope
       and new.billing_model is not distinct from old.billing_model
       and new.billing_model <> 'PER_UNIT' then
      new.billing_model := case when new.scope = 'per-company' then 'PER_COMPANY' else 'FLAT' end;
    end if;
  end if;
  new.available := (new.lifecycle_status = 'AVAILABLE');
  return new;
end;
$$;

revoke all on function platform.derive_catalog_item_state() from public, anon, authenticated;

create trigger catalog_items_derive_state
  before insert or update on platform.catalog_items
  for each row execute function platform.derive_catalog_item_state();

-- ---------------------------------------------------------------------------
-- set_catalog_item_lifecycle — autoridad de producto (spec §14.1).
-- ---------------------------------------------------------------------------
create or replace function platform.set_catalog_item_lifecycle(
  p_code   text,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_item record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin cambian el ciclo de vida del catálogo'
      using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('DRAFT', 'AVAILABLE', 'COMING_SOON', 'RETIRED') then
    raise exception 'LIFECYCLE_INVALIDO: % (DRAFT, AVAILABLE, COMING_SOON o RETIRED)', p_status
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: todo cambio de ciclo de vida lleva motivo' using errcode = '23502';
  end if;

  select * into v_item from platform.catalog_items where code = p_code for update;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_code using errcode = '23503';
  end if;
  if v_item.lifecycle_status = p_status then
    return;
  end if;

  update platform.catalog_items set lifecycle_status = p_status where id = v_item.id;

  perform platform.log_audit(
    'CATALOG_ITEM_LIFECYCLE_SET', 'catalog_item', p_code, null, null,
    jsonb_build_object('previous', v_item.lifecycle_status, 'status', p_status, 'reason', trim(p_reason)));
end;
$$;

comment on function platform.set_catalog_item_lifecycle(text, text, text) is
  'Cambia el ciclo de vida de un item de catálogo (DRAFT/AVAILABLE/COMING_SOON/RETIRED). '
  'Solo can_manage_platform_entities(); motivo obligatorio; auditado. Los tenants que ya lo '
  'tienen no se tocan: retirar un item solo impide nuevas activaciones.';

revoke all on function platform.set_catalog_item_lifecycle(text, text, text) from public, anon;
grant execute on function platform.set_catalog_item_lifecycle(text, text, text) to authenticated, service_role;
