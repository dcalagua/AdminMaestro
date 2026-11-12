-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · subscription_items por origen (MA-15)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (subscription_items) y §5.4 (precio congelado + price_ref).
-- Plan §4 fila 9: timestamp …0550 para aplicarse ANTES del ciclo de vida de
-- tenant_addons (…0600), que crea ítems ADDON y añade la FK tenant_addon_id.
-- Test: supabase/tests/32_ccp_tenant_addon_lifecycle.test.sql (parte MA-15).
--
--   · source_type PLAN / ADDON / USAGE / MANUAL. Los ítems existentes y los
--     que siguen creando las RPCs actuales (onboarding, add item) quedan en
--     MANUAL: nada cambia para ellos.
--   · price_ref = id de la tarifa que fijó unit_amount (plan_prices para PLAN,
--     catalog_item_prices para ADDON/USAGE). Sin FK polimórfica: lo valida un
--     trigger según el origen.
--   · Ninguna columna de importe ni de periodicidad cambia: las líneas que
--     emite issue_subscription_invoice son idénticas (test "antes = después").
-- ============================================================================

alter table platform.subscription_items
  add column source_type     text not null default 'MANUAL',
  add column tenant_addon_id uuid,
  add column price_ref       uuid,
  add constraint subscription_items_source_ck
    check (source_type in ('PLAN', 'ADDON', 'USAGE', 'MANUAL')),
  add constraint subscription_items_addon_link_ck
    check (tenant_addon_id is null or source_type = 'ADDON'),
  add constraint subscription_items_price_ref_ck
    check (price_ref is null or source_type <> 'MANUAL');

create index subscription_items_price_ref_ix on platform.subscription_items (price_ref)
  where price_ref is not null;

comment on column platform.subscription_items.source_type is
  'Origen del ítem (spec §3.2). MANUAL = creado por un operador o por las RPCs previas a CCP.';
comment on column platform.subscription_items.price_ref is
  'Tarifa que fijó unit_amount al crear el ítem (plan_prices o catalog_item_prices). Un cambio '
  'de tarifa posterior no altera el ítem (spec §5.4).';

create or replace function platform.enforce_subscription_item_price_ref()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.price_ref is null then
    return new;
  end if;
  if new.source_type = 'PLAN'
     and not exists (select 1 from platform.plan_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de plan', new.price_ref using errcode = '23503';
  end if;
  if new.source_type in ('ADDON', 'USAGE')
     and not exists (select 1 from platform.catalog_item_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de add-on', new.price_ref using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function platform.enforce_subscription_item_price_ref() from public, anon, authenticated;

create trigger subscription_items_price_ref_guard
  before insert or update of source_type, price_ref on platform.subscription_items
  for each row execute function platform.enforce_subscription_item_price_ref();
