-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · vínculos de facturación (MA-60)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (invoice_lines), §5.3 (PER_UNIT), §12.5, §13.1, §13.2, §20.
-- Plan §4 fila 20, §13 MA-60. Test: supabase/tests/41_ccp_billing_usage.test.sql.
--
--   · invoice_lines + usage_aggregate_id / meter_code (línea de uso de un
--     agregado FINALIZED, nunca de un evento crudo), ai_credit_pool_key +
--     usage_period_start (exceso de créditos por pool × período),
--     usage_source_hash (evidencia de los agregados), usage_basis
--     (USAGE / OVERAGE / AI_CREDIT_OVERAGE), catalog_item_id + price_ref (ítem
--     y tarifa que fijaron el importe), corrects_line_id (DISCOUNT correctivo)
--     y ai_credit_entry_id (CREDIT_PURCHASE ↔ GRANT_PURCHASE). Nulos para
--     todas las líneas existentes.
--   · Guard de línea: un agregado o un pool × período se reclama en UNA sola
--     factura no anulada (bloqueo de fila / advisory + comprobación); solo
--     agregados FINALIZED y facturables (DEMO/SANDBOX y medidores no
--     facturables nunca); un correctivo no supera la línea corregida
--     (DESCUENTO_EXCEDE_LINEA) y solo corrige líneas emitidas del mismo
--     contrato y moneda, en otra factura.
--   · Una factura con cobros CONFIRMED no se anula (spec §13.2.3).
--   · catalog_items: per_unit_source (METER | AI_CREDIT) + usage_meter_id
--     dicen QUÉ ítem PER_UNIT tarifa el exceso de un medidor o de créditos;
--     credit_pack_credits = créditos por paquete (D-03). Nulos = no decidido.
--   · catalog_item_prices y set_catalog_item_price admiten CREDIT_PURCHASE
--     (siempre ONE_TIME).
--   · subscription_items: source_type CREDIT_PURCHASE, corrects_line_id y
--     ai_credit_entry_id; los ítems vinculados son inmutables.
--   · RPCs (DEFINER, search_path fijo, sin anon; gate interno):
--       set_catalog_item_usage_binding / set_catalog_item_credit_pack
--         (can_manage_regional_catalog, motivo obligatorio);
--       purchase_ai_credits (finanzas): ítem ONE_TIME con la tarifa vigente
--         congelada + GRANT_PURCHASE, idempotente por clave;
--       schedule_corrective_discount (finanzas): ítem DISCOUNT ONE_TIME que
--         entra en la SIGUIENTE factura del contrato.
--   · generate_commission_events: USAGE_OVERAGE y CREDIT_PURCHASE solo
--     comisionan con una regla que los nombre en charge_kind (spec §13.1,
--     D-11). Sigue generándose solo desde pagos CONFIRMED.
--
-- Nada se siembra: ni tarifas, ni créditos por paquete, ni vínculos.
-- Sin impuestos nuevos (D-13): tax_amount como hoy.
-- Rollback: docs/runbooks/ccp-rollback/18.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. catalog_items: ítem que tarifa el uso y paquete de créditos
-- ---------------------------------------------------------------------------
alter table platform.catalog_items
  add column per_unit_source     text,
  add column usage_meter_id      uuid references platform.usage_meters (id) on delete restrict,
  add column credit_pack_credits numeric(15, 6),
  add constraint catalog_items_per_unit_source_ck
    check (per_unit_source is null or (per_unit_source in ('METER', 'AI_CREDIT') and billing_model = 'PER_UNIT')),
  add constraint catalog_items_usage_meter_ck
    check ((usage_meter_id is null or per_unit_source = 'METER')
           and (per_unit_source is distinct from 'METER' or usage_meter_id is not null)),
  add constraint catalog_items_credit_pack_ck
    check (credit_pack_credits is null
           or (credit_pack_credits > 0 and credit_pack_credits < 1000000000 and billing_model <> 'PER_UNIT'));

create index catalog_items_usage_meter_ix on platform.catalog_items (usage_meter_id) where usage_meter_id is not null;
-- Un medidor (o un pool de créditos) tiene UN solo ítem de tarifa vivo: sin doble cobro por diseño.
create unique index catalog_items_usage_meter_uk on platform.catalog_items (usage_meter_id)
  where usage_meter_id is not null and lifecycle_status <> 'RETIRED';
create unique index catalog_items_ai_credit_uk on platform.catalog_items (saas_product_id) nulls not distinct
  where per_unit_source = 'AI_CREDIT' and lifecycle_status <> 'RETIRED';

comment on column platform.catalog_items.per_unit_source is
  'Qué tarifa un ítem PER_UNIT: METER (el uso de usage_meter_id) o AI_CREDIT (el exceso de créditos del pool; '
  'saas_product_id null = pool TENANT). Null = no decidido: el uso no se factura (spec §5.3, §12.5).';
comment on column platform.catalog_items.credit_pack_credits is
  'Créditos EBIM que acredita un paquete (D-03). Null = no decidido: el ítem no se vende como créditos.';

-- ---------------------------------------------------------------------------
-- 2. catalog_item_prices: CREDIT_PURCHASE (siempre ONE_TIME)
-- ---------------------------------------------------------------------------
alter table platform.catalog_item_prices
  drop constraint catalog_item_prices_kind_ck,
  add constraint catalog_item_prices_kind_ck
    check (charge_kind in ('ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE', 'CREDIT_PURCHASE')),
  add constraint catalog_item_prices_credit_purchase_ck
    check (charge_kind <> 'CREDIT_PURCHASE' or billing_interval = 'ONE_TIME');

-- Copia EXACTA de 20260929000400 con el cambio marcado «CCP fase 18». Misma firma y GRANT.
create or replace function platform.set_catalog_item_price(
  p_catalog_item_code text,
  p_market_code       text,
  p_charge_kind       platform.charge_kind,
  p_billing_interval  platform.billing_interval,
  p_amount            numeric,
  p_currency          char(3),
  p_valid_from        date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_item     record;
  v_current  record;
  v_market   platform.markets;
  v_currency char(3);
  v_clash    record;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin fijan tarifas de add-on'
      using errcode = '42501';
  end if;

  select id, code into v_item from platform.catalog_items where code = p_catalog_item_code;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'IMPORTE_INVALIDO: la tarifa no puede ser negativa' using errcode = '23514';
  end if;
  -- CCP fase 18: + CREDIT_PURCHASE (paquete de créditos IA, siempre ONE_TIME).
  if p_charge_kind is null or p_charge_kind not in ('ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE', 'CREDIT_PURCHASE') then
    raise exception 'CARGO_INVALIDO: un add-on se tarifa como ADDON, IMPLEMENTATION_FEE, USAGE_OVERAGE o CREDIT_PURCHASE (no %)', p_charge_kind
      using errcode = '23514';
  end if;
  if p_charge_kind = 'CREDIT_PURCHASE' and p_billing_interval <> 'ONE_TIME' then
    raise exception 'PERIODICIDAD_INVALIDA: una compra de créditos se tarifa ONE_TIME' using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_currency, '')), '') is null then
    raise exception 'MONEDA_REQUERIDA: una tarifa declara su moneda explícitamente' using errcode = '23502';
  end if;
  if p_valid_from is null then
    raise exception 'VIGENCIA_INVALIDA: la tarifa necesita fecha de inicio' using errcode = '23502';
  end if;

  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  select * into v_current
    from platform.catalog_item_prices
   where catalog_item_id = v_item.id
     and market_id = v_market.id
     and charge_kind = p_charge_kind
     and billing_interval = p_billing_interval
     and currency = v_currency
     and valid_to is null;

  if v_current.id is not null then
    if v_current.valid_from >= p_valid_from then
      raise exception 'VIGENCIA_INVALIDA: la tarifa abierta empieza el % y la nueva pretende empezar el %; una tarifa nueva no puede solapar hacia atrás',
        v_current.valid_from, p_valid_from
        using errcode = '23514';
    end if;
    if v_current.amount = p_amount then
      return v_current.id;
    end if;
  end if;

  select p.id, p.valid_from, p.valid_to into v_clash
    from platform.catalog_item_prices p
   where p.catalog_item_id = v_item.id
     and p.market_id = v_market.id
     and p.charge_kind = p_charge_kind
     and p.billing_interval = p_billing_interval
     and p.currency = v_currency
     and p.valid_to is not null
     and p.valid_to >= p_valid_from
   limit 1;
  if v_clash.id is not null then
    raise exception 'TARIFA_SOLAPADA: ya existe una tarifa % del % al % en ese mercado y moneda',
      p_charge_kind, v_clash.valid_from, v_clash.valid_to
      using errcode = '23514';
  end if;

  if v_current.id is not null then
    update platform.catalog_item_prices set valid_to = p_valid_from - 1 where id = v_current.id;
  end if;

  insert into platform.catalog_item_prices (
    catalog_item_id, market_id, charge_kind, billing_interval, amount, currency, valid_from
  ) values (
    v_item.id, v_market.id, p_charge_kind, p_billing_interval, p_amount, v_currency, p_valid_from
  )
  returning id into v_id;

  perform platform.log_audit(
    'ADDON_PRICE_VERSIONED', 'catalog_item_price', v_id::text, null, null,
    jsonb_build_object(
      'catalog_item', v_item.code, 'market', v_market.code, 'charge_kind', p_charge_kind,
      'billing_interval', p_billing_interval, 'amount', p_amount, 'currency', v_currency,
      'valid_from', p_valid_from, 'closed_price_id', v_current.id, 'previous_amount', v_current.amount
    )
  );

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. subscription_items: compra de créditos y correctivos
-- ---------------------------------------------------------------------------
alter table platform.subscription_items
  drop constraint subscription_items_source_ck,
  add constraint subscription_items_source_ck
    check (source_type in ('PLAN', 'ADDON', 'USAGE', 'MANUAL', 'CREDIT_PURCHASE')),
  add column corrects_line_id   uuid references platform.invoice_lines (id) on delete restrict,
  -- Sin FK hacia ai_credit_ledger a propósito: una FK entrante cambiaría el error de su guard de
  -- TRUNCATE (55000, fase 17) por 0A000. El vínculo lo valida enforce_subscription_item_price_ref.
  add column ai_credit_entry_id uuid,
  add constraint subscription_items_correction_ck
    check (corrects_line_id is null or (charge_kind = 'DISCOUNT' and billing_interval = 'ONE_TIME')),
  add constraint subscription_items_credit_purchase_ck
    check ((source_type = 'CREDIT_PURCHASE')
           = (ai_credit_entry_id is not null and charge_kind = 'CREDIT_PURCHASE' and billing_interval = 'ONE_TIME'));

create index subscription_items_corrects_line_ix on platform.subscription_items (corrects_line_id) where corrects_line_id is not null;
create unique index subscription_items_ai_credit_entry_uk on platform.subscription_items (ai_credit_entry_id) where ai_credit_entry_id is not null;

create or replace function platform.enforce_subscription_item_price_ref()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  -- CCP fase 18: la compra apunta a una entrada GRANT_PURCHASE real del mismo tenant.
  if new.ai_credit_entry_id is not null
     and not exists (select 1 from platform.ai_credit_ledger e
                      where e.id = new.ai_credit_entry_id and e.entry_type = 'GRANT_PURCHASE'
                        and e.tenant_id is not distinct from new.tenant_id) then
    raise exception 'COMPRA_DE_CREDITOS_INVALIDA: % no es una compra de créditos del tenant', new.ai_credit_entry_id
      using errcode = '23503';
  end if;
  if new.price_ref is null then
    return new;
  end if;
  if new.source_type = 'PLAN'
     and not exists (select 1 from platform.plan_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de plan', new.price_ref using errcode = '23503';
  end if;
  -- CCP fase 18: una compra de créditos también congela una tarifa de catálogo.
  if new.source_type in ('ADDON', 'USAGE', 'CREDIT_PURCHASE')
     and not exists (select 1 from platform.catalog_item_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de add-on', new.price_ref using errcode = '23503';
  end if;
  return new;
end;
$$;

-- Un ítem vinculado a una compra o a una corrección no se edita: se anula su
-- efecto con un movimiento nuevo (REVERSAL del crédito, otro correctivo).
create or replace function platform.enforce_linked_subscription_item()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.ai_credit_entry_id is not null then
      raise exception 'ITEM_VINCULADO_INMUTABLE: la compra de créditos % no se borra; revierte la entrada del ledger', old.id
        using errcode = '23514';
    end if;
    return old;
  end if;
  if (old.ai_credit_entry_id is not null or old.corrects_line_id is not null)
     and (new.charge_kind, new.quantity, new.unit_amount, new.currency, new.billing_interval, new.valid_from,
          new.corrects_line_id, new.ai_credit_entry_id, new.source_type, new.price_ref, new.subscription_id)
         is distinct from
         (old.charge_kind, old.quantity, old.unit_amount, old.currency, old.billing_interval, old.valid_from,
          old.corrects_line_id, old.ai_credit_entry_id, old.source_type, old.price_ref, old.subscription_id) then
    raise exception 'ITEM_VINCULADO_INMUTABLE: el ítem % está ligado a una compra o una corrección', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function platform.enforce_linked_subscription_item() from public, anon, authenticated;

-- El vínculo con el ledger se valida también cuando cambia (el trigger original solo miraba el origen y la tarifa).
drop trigger subscription_items_price_ref_guard on platform.subscription_items;
create trigger subscription_items_price_ref_guard
  before insert or update of source_type, price_ref, ai_credit_entry_id, tenant_id on platform.subscription_items
  for each row execute function platform.enforce_subscription_item_price_ref();

create trigger subscription_items_linked_guard
  before update or delete on platform.subscription_items
  for each row execute function platform.enforce_linked_subscription_item();

-- ---------------------------------------------------------------------------
-- 4. invoice_lines: vínculos de uso, créditos, catálogo y corrección
-- ---------------------------------------------------------------------------
alter table platform.invoice_lines
  add column usage_aggregate_id uuid references platform.usage_period_aggregates (id) on delete restrict,
  add column meter_code         text,
  add column corrects_line_id   uuid references platform.invoice_lines (id) on delete restrict,
  add column catalog_item_id    uuid references platform.catalog_items (id) on delete restrict,
  add column price_ref          uuid,
  add column usage_basis        text,
  add column ai_credit_pool_key text,
  add column usage_period_start date,
  add column usage_source_hash  text,
  -- Sin FK hacia ai_credit_ledger (ver subscription_items); lo valida el guard de línea.
  add column ai_credit_entry_id uuid,
  add constraint invoice_lines_usage_basis_ck
    check (usage_basis is null or usage_basis in ('USAGE', 'OVERAGE', 'AI_CREDIT_OVERAGE')),
  -- USAGE_OVERAGE ⇔ la línea sale de un agregado o de un pool (nunca manual, nunca de un evento).
  add constraint invoice_lines_usage_kind_ck
    check ((charge_kind = 'USAGE_OVERAGE') = (usage_basis is not null)),
  add constraint invoice_lines_usage_link_ck
    check (usage_basis is null
           or (usage_basis in ('USAGE', 'OVERAGE') and usage_aggregate_id is not null and meter_code is not null
               and ai_credit_pool_key is null)
           or (usage_basis = 'AI_CREDIT_OVERAGE' and usage_aggregate_id is null and meter_code is null
               and ai_credit_pool_key is not null and tenant_id is not null)),
  add constraint invoice_lines_usage_evidence_ck
    check (usage_basis is null
           or (usage_period_start is not null and usage_source_hash ~ '^sha256:[0-9a-f]{64}$'
               and quantity > 0 and unit_amount >= 0 and not is_recurring)),
  add constraint invoice_lines_usage_fields_ck
    check (usage_basis is not null
           or (usage_aggregate_id is null and meter_code is null and ai_credit_pool_key is null
               and usage_period_start is null and usage_source_hash is null)),
  add constraint invoice_lines_correction_ck
    check (corrects_line_id is null or (charge_kind = 'DISCOUNT' and quantity * unit_amount < 0)),
  add constraint invoice_lines_credit_entry_ck
    check ((ai_credit_entry_id is not null) = (charge_kind = 'CREDIT_PURCHASE'));

create index invoice_lines_usage_aggregate_ix on platform.invoice_lines (usage_aggregate_id) where usage_aggregate_id is not null;
create index invoice_lines_ai_credit_pool_ix on platform.invoice_lines (tenant_id, ai_credit_pool_key, usage_period_start)
  where ai_credit_pool_key is not null;
create index invoice_lines_corrects_line_ix on platform.invoice_lines (corrects_line_id) where corrects_line_id is not null;
create index invoice_lines_catalog_item_ix on platform.invoice_lines (catalog_item_id) where catalog_item_id is not null;
create index invoice_lines_price_ref_ix on platform.invoice_lines (price_ref) where price_ref is not null;
create index invoice_lines_ai_credit_entry_ix on platform.invoice_lines (ai_credit_entry_id) where ai_credit_entry_id is not null;

comment on column platform.invoice_lines.usage_aggregate_id is
  'Agregado FINALIZED que respalda la línea de uso (spec §13.1). Nunca un evento crudo. Un agregado se '
  'reclama en una sola factura no anulada (enforce_invoice_line_billing_links).';
comment on column platform.invoice_lines.ai_credit_pool_key is
  'Pool de créditos IA cuyo saldo negativo del período usage_period_start se factura (spec §12.5). '
  'Una sola vez por tenant × pool × período entre facturas no anuladas.';
comment on column platform.invoice_lines.usage_source_hash is
  'Evidencia: source_hash del agregado (uso) o sha256 de los agregados FINALIZED del pool × período (créditos).';
comment on column platform.invoice_lines.corrects_line_id is
  'Línea emitida que corrige este DISCOUNT negativo (spec §13.2). Σ correcciones ≤ |línea corregida|.';

create or replace function platform.enforce_invoice_line_billing_links()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agg   platform.usage_period_aggregates;
  v_orig  record;
  v_inv   platform.invoices;
  v_prev  numeric(14,2);
  v_this  numeric(14,2);
begin
  if new.usage_aggregate_id is not null then
    -- El bloqueo de la fila serializa dos emisiones que reclaman el mismo agregado.
    select * into v_agg from platform.usage_period_aggregates where id = new.usage_aggregate_id for update;
    if v_agg.status is distinct from 'FINALIZED' then
      raise exception 'AGREGADO_NO_FINALIZADO: el agregado % está %; solo se factura uso FINALIZED', new.usage_aggregate_id, v_agg.status
        using errcode = '55000';
    end if;
    if not v_agg.is_billable then
      raise exception 'AGREGADO_NO_FACTURABLE: el agregado % no es facturable (medidor no facturable o tenant DEMO/SANDBOX)', new.usage_aggregate_id
        using errcode = '23514';
    end if;
    if new.meter_code is distinct from v_agg.meter_code
       or new.usage_period_start is distinct from v_agg.period_start
       or new.usage_source_hash is distinct from v_agg.source_hash
       or (new.tenant_id is not null and new.tenant_id <> v_agg.tenant_id) then
      raise exception 'AGREGADO_INCONSISTENTE: la línea no coincide con el agregado % (medidor, período, hash o tenant)', new.usage_aggregate_id
        using errcode = '23514';
    end if;
    if exists (select 1 from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
                where l.usage_aggregate_id = new.usage_aggregate_id and l.id <> new.id and i.status <> 'VOID') then
      raise exception 'AGREGADO_YA_FACTURADO: el agregado % ya está en una factura vigente', new.usage_aggregate_id
        using errcode = '23505';
    end if;
  end if;

  if new.ai_credit_pool_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'platform.ai_credit_overage:' || new.tenant_id::text || ':' || new.ai_credit_pool_key || ':' || new.usage_period_start::text, 0));
    if exists (select 1 from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
                where l.tenant_id = new.tenant_id and l.ai_credit_pool_key = new.ai_credit_pool_key
                  and l.usage_period_start = new.usage_period_start and l.id <> new.id and i.status <> 'VOID') then
      raise exception 'CREDITOS_YA_FACTURADOS: el exceso del pool % en % ya está en una factura vigente',
        new.ai_credit_pool_key, to_char(new.usage_period_start, 'MM/YYYY')
        using errcode = '23505';
    end if;
  end if;

  if new.ai_credit_entry_id is not null
     and not exists (select 1 from platform.ai_credit_ledger e
                      where e.id = new.ai_credit_entry_id and e.entry_type = 'GRANT_PURCHASE'
                        and e.tenant_id is not distinct from new.tenant_id) then
    raise exception 'COMPRA_DE_CREDITOS_INVALIDA: % no es una compra de créditos del tenant de la línea', new.ai_credit_entry_id
      using errcode = '23503';
  end if;

  if new.corrects_line_id is not null then
    select l.id, l.invoice_id, l.charge_kind, l.amount, i.status as invoice_status, i.subscription_id, i.currency
      into v_orig
      from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
     where l.id = new.corrects_line_id
       for update of l;
    select * into v_inv from platform.invoices where id = new.invoice_id;
    if v_orig.charge_kind = 'DISCOUNT' then
      raise exception 'CORRECCION_INVALIDA: un descuento no se corrige con otro descuento' using errcode = '23514';
    end if;
    if v_orig.invoice_status not in ('ISSUED', 'PAID', 'PARTIALLY_PAID') then
      raise exception 'FACTURA_NO_EMITIDA: la línea % está en una factura %; solo se corrigen facturas emitidas',
        new.corrects_line_id, v_orig.invoice_status
        using errcode = '23514';
    end if;
    if new.invoice_id = v_orig.invoice_id
       or v_inv.subscription_id is distinct from v_orig.subscription_id
       or v_inv.currency is distinct from v_orig.currency then
      raise exception 'CORRECCION_FUERA_DE_CONTRATO: el correctivo va en otra factura del mismo contrato y moneda'
        using errcode = '23514';
    end if;
    select coalesce(sum(abs(l.amount)), 0) into v_prev
      from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
     where l.corrects_line_id = new.corrects_line_id and l.id <> new.id and i.status <> 'VOID';
    v_this := abs(round(new.quantity * new.unit_amount, 2));
    if v_prev + v_this > abs(v_orig.amount) then
      raise exception 'DESCUENTO_EXCEDE_LINEA: % ya corregido + % supera el importe % de la línea', v_prev, v_this, abs(v_orig.amount)
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function platform.enforce_invoice_line_billing_links() from public, anon, authenticated;

create trigger invoice_lines_billing_links_guard
  before insert or update of usage_aggregate_id, ai_credit_pool_key, usage_period_start, usage_source_hash, meter_code,
                             corrects_line_id, ai_credit_entry_id, quantity, unit_amount, tenant_id, invoice_id
  on platform.invoice_lines
  for each row execute function platform.enforce_invoice_line_billing_links();

-- ---------------------------------------------------------------------------
-- 5. Nunca VOID sobre cobros CONFIRMED (spec §13.2.3)
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_invoice_void_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if exists (select 1 from platform.payments p where p.invoice_id = old.id and p.status = 'CONFIRMED') then
    raise exception 'FACTURA_CON_PAGOS_CONFIRMADOS: la factura % tiene cobros CONFIRMED; se corrige con un DISCOUNT en la siguiente, nunca con VOID',
      old.number
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function platform.enforce_invoice_void_rules() from public, anon, authenticated;

create trigger invoices_void_guard
  before update of status on platform.invoices
  for each row when (new.status = 'VOID' and old.status is distinct from 'VOID')
  execute function platform.enforce_invoice_void_rules();

-- ---------------------------------------------------------------------------
-- 6. Alertas de facturación de uso (una por agregado y código)
-- ---------------------------------------------------------------------------
create or replace function platform.usage_billing_alert_once(
  p_tenant_id uuid, p_product_id uuid, p_aggregate_id uuid, p_code text, p_detail jsonb
)
returns void
language sql
security definer
set search_path = platform, pg_catalog
as $$
  insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
  select p_tenant_id, p_product_id, p_aggregate_id, p_code, coalesce(p_detail, '{}'::jsonb)
   where not exists (select 1 from platform.usage_alerts a where a.aggregate_id = p_aggregate_id and a.code = p_code);
$$;
revoke all on function platform.usage_billing_alert_once(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Configuración de tarifa por uso y de paquetes (catálogo regional)
-- ---------------------------------------------------------------------------
create or replace function platform.set_catalog_item_usage_binding(
  p_catalog_item_code text, p_source text, p_meter_code text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_item  platform.catalog_items;
  v_meter platform.usage_meters;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin deciden cómo se tarifa el uso' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  select * into v_item from platform.catalog_items where code = p_catalog_item_code for update;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;
  if v_item.billing_model <> 'PER_UNIT' then
    raise exception 'MODELO_NO_POR_USO: % es %; solo un ítem PER_UNIT tarifa uso', v_item.code, v_item.billing_model
      using errcode = '23514';
  end if;
  if p_source = 'METER' then
    if v_item.saas_product_id is null then
      raise exception 'PRODUCTO_REQUERIDO: un ítem que tarifa un medidor pertenece a su producto' using errcode = '23514';
    end if;
    select * into v_meter from platform.usage_meters
     where saas_product_id = v_item.saas_product_id and code = p_meter_code;
    if v_meter.id is null then
      raise exception 'MEDIDOR_NO_ENCONTRADO: %', p_meter_code using errcode = '23503';
    end if;
  elsif p_source = 'AI_CREDIT' then
    if p_meter_code is not null then
      raise exception 'MEDIDOR_NO_APLICA: el exceso de créditos se tarifa por pool, no por medidor' using errcode = '22023';
    end if;
  else
    raise exception 'ORIGEN_INVALIDO: % (METER o AI_CREDIT)', p_source using errcode = '22023';
  end if;

  update platform.catalog_items
     set per_unit_source = p_source, usage_meter_id = v_meter.id
   where id = v_item.id;

  perform platform.log_audit('CATALOG_ITEM_USAGE_BINDING_SET', 'catalog_item', v_item.id::text, null, null,
    jsonb_build_object('code', v_item.code, 'source', p_source, 'meter', p_meter_code,
                       'previous_source', v_item.per_unit_source, 'previous_meter', v_item.usage_meter_id,
                       'reason', trim(p_reason)));
  return jsonb_build_object('catalog_item', v_item.code, 'source', p_source, 'meter', p_meter_code);
end;
$$;
revoke all on function platform.set_catalog_item_usage_binding(text, text, text, text) from public, anon;
grant execute on function platform.set_catalog_item_usage_binding(text, text, text, text) to authenticated;

create or replace function platform.set_catalog_item_credit_pack(
  p_catalog_item_code text, p_credits numeric, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_item platform.catalog_items;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: los créditos por paquete son una decisión comercial (D-03)' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'CREDITOS_INVALIDOS: un paquete acredita > 0 créditos' using errcode = '23514';
  end if;
  select * into v_item from platform.catalog_items where code = p_catalog_item_code for update;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;

  update platform.catalog_items set credit_pack_credits = p_credits where id = v_item.id;

  perform platform.log_audit('CATALOG_ITEM_CREDIT_PACK_SET', 'catalog_item', v_item.id::text, null, null,
    jsonb_build_object('code', v_item.code, 'credits', p_credits, 'previous', v_item.credit_pack_credits,
                       'reason', trim(p_reason)));
  return jsonb_build_object('catalog_item', v_item.code, 'credits', p_credits);
end;
$$;
revoke all on function platform.set_catalog_item_credit_pack(text, numeric, text) from public, anon;
grant execute on function platform.set_catalog_item_credit_pack(text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Compra de créditos IA (CREDIT_PURCHASE + GRANT_PURCHASE)
-- ---------------------------------------------------------------------------
create or replace function platform.purchase_ai_credits(
  p_subscription_id uuid, p_catalog_item_code text, p_packs integer, p_pool_key text,
  p_period_start date, p_reason text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub      record;
  v_item     platform.catalog_items;
  v_period   date := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_key      text;
  v_product  uuid;
  v_scopes   text[];
  v_price    numeric;
  v_price_id uuid;
  v_credits  numeric;
  v_prev     platform.ai_credit_ledger;
  v_entry    uuid;
  v_si       uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE registra compras de créditos' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'MOTIVO_Y_CLAVE_REQUERIDOS' using errcode = '23502';
  end if;
  if p_packs is null or p_packs <= 0 then
    raise exception 'CANTIDAD_INVALIDA: se compran 1 o más paquetes' using errcode = '23514';
  end if;

  select s.*, t.tenant_type into v_sub
    from platform.subscriptions s left join platform.tenants t on t.id = s.tenant_id
   where s.id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if v_sub.status not in ('ACTIVE', 'PAST_DUE') or v_sub.tenant_id is null then
    raise exception 'SUSCRIPCION_NO_FACTURABLE: la compra de créditos requiere un contrato activo de un tenant' using errcode = '23514';
  end if;
  if v_sub.tenant_type in ('DEMO', 'SANDBOX') then
    raise exception 'TENANT_NO_FACTURABLE: un tenant % no compra créditos (usa GRANT_BONUS)', v_sub.tenant_type using errcode = '23514';
  end if;

  select * into v_item from platform.catalog_items where code = p_catalog_item_code;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;
  if v_item.credit_pack_credits is null then
    raise exception 'CREDITOS_POR_PAQUETE_NO_DEFINIDOS: % no declara créditos por paquete (D-03)', v_item.code
      using errcode = '23514';
  end if;
  if v_item.lifecycle_status <> 'AVAILABLE'
     or (v_item.saas_product_id is not null and v_item.saas_product_id <> v_sub.saas_product_id) then
    raise exception 'ADDON_NO_DISPONIBLE: % no se vende en este contrato', v_item.code using errcode = '23514';
  end if;

  -- El pool debe ser el que usa la política vigente del período (nunca créditos huérfanos).
  v_product := platform.ai_credit_assert_pool(v_sub.tenant_id, p_pool_key);
  select array_agg(distinct pool_scope) filter (where pool_scope is not null) into v_scopes
    from platform.ai_credit_applicable_policies(v_sub.tenant_id, v_period);
  if coalesce(cardinality(v_scopes), 0) <> 1
     or platform.ai_credit_pool_key(v_scopes[1], v_product) is distinct from p_pool_key then
    raise exception 'POOL_INVALIDO: la política vigente en % no usa el pool %', to_char(v_period, 'MM/YYYY'), p_pool_key
      using errcode = '22023';
  end if;

  v_price := platform.current_catalog_item_price(v_item.id, v_sub.market_id, 'CREDIT_PURCHASE', 'ONE_TIME', v_sub.currency, current_date);
  v_price_id := platform.current_catalog_item_price_id(v_item.id, v_sub.market_id, 'CREDIT_PURCHASE', 'ONE_TIME', v_sub.currency, current_date);
  if v_price is null then
    raise exception 'TARIFA_ADDON_NO_DEFINIDA: % no tiene tarifa CREDIT_PURCHASE vigente en el mercado y moneda del contrato %',
      v_item.code, v_sub.code
      using errcode = '23514';
  end if;

  v_key := 'purchase:' || trim(p_idempotency_key);
  v_credits := p_packs * v_item.credit_pack_credits;

  select * into v_prev from platform.ai_credit_ledger
   where tenant_id = v_sub.tenant_id and entry_idempotency_key = v_key;
  if v_prev.id is not null then
    if v_prev.entry_type = 'GRANT_PURCHASE' and v_prev.quantity = p_packs and v_prev.pool_key = p_pool_key
       and v_prev.period_start = v_period then
      select id into v_si from platform.subscription_items where ai_credit_entry_id = v_prev.id;
      return jsonb_build_object('ledger_entry_id', v_prev.id, 'subscription_item_id', v_si, 'credits', v_prev.credits,
                                'created', false);
    end if;
    raise exception 'CLAVE_EN_CONFLICTO: % ya existe con otro contenido', p_idempotency_key using errcode = '23505';
  end if;

  insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                         entry_idempotency_key, quantity, reason, created_by)
  values (v_sub.tenant_id, v_product, p_pool_key, v_period, 'GRANT_PURCHASE', v_credits, v_key, p_packs,
          trim(p_reason), auth.uid())
  returning id into v_entry;

  insert into platform.subscription_items (
    subscription_id, charge_kind, description, quantity, unit_amount, currency, billing_interval,
    tenant_id, catalog_item_code, valid_from, source_type, price_ref, ai_credit_entry_id
  ) values (
    v_sub.id, 'CREDIT_PURCHASE', 'Créditos IA · ' || v_item.name, p_packs, v_price, v_sub.currency, 'ONE_TIME',
    v_sub.tenant_id, v_item.code, v_period, 'CREDIT_PURCHASE', v_price_id, v_entry
  )
  returning id into v_si;

  perform platform.log_audit('AI_CREDITS_PURCHASED', 'ai_credit_ledger', v_entry::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('subscription', v_sub.code, 'item', v_item.code, 'packs', p_packs, 'credits', v_credits,
                       'pool', p_pool_key, 'period', v_period, 'unit_amount', v_price, 'currency', v_sub.currency,
                       'price_ref', v_price_id, 'subscription_item_id', v_si, 'reason', trim(p_reason)));
  return jsonb_build_object('ledger_entry_id', v_entry, 'subscription_item_id', v_si, 'credits', v_credits,
                            'unit_amount', v_price, 'currency', v_sub.currency, 'created', true);
end;
$$;
revoke all on function platform.purchase_ai_credits(uuid, text, integer, text, date, text, text) from public, anon;
grant execute on function platform.purchase_ai_credits(uuid, text, integer, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. DISCOUNT correctivo sobre una factura emitida (spec §13.2)
-- ---------------------------------------------------------------------------
create or replace function platform.schedule_corrective_discount(
  p_invoice_line_id uuid, p_amount numeric, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_line   record;
  v_prev   numeric(14,2);
  v_amount numeric(14,2) := round(p_amount, 2);
  v_from   date;
  v_si     uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE corrige facturas emitidas' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'IMPORTE_INVALIDO: el importe a corregir es > 0' using errcode = '23514';
  end if;

  select l.id, l.charge_kind, l.description, l.amount, l.currency, l.tenant_id,
         i.id as invoice_id, i.number, i.status, i.subscription_id, i.period_start
    into v_line
    from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
   where l.id = p_invoice_line_id
     for update of l;
  if v_line.id is null then
    raise exception 'LINEA_NO_ENCONTRADA: %', p_invoice_line_id using errcode = '23503';
  end if;
  if v_line.charge_kind = 'DISCOUNT' then
    raise exception 'CORRECCION_INVALIDA: un descuento no se corrige con otro descuento' using errcode = '23514';
  end if;
  if v_line.status not in ('ISSUED', 'PAID', 'PARTIALLY_PAID') then
    raise exception 'FACTURA_NO_EMITIDA: la factura % está %; una DRAFT se edita y una VOID no se corrige', v_line.number, v_line.status
      using errcode = '23514';
  end if;
  if v_line.subscription_id is null then
    raise exception 'CORRECCION_FUERA_DE_CONTRATO: la factura % no pertenece a un contrato', v_line.number using errcode = '23514';
  end if;

  -- Ya corregido = correctivos facturados (no anulados) + correctivos pendientes de facturar.
  select coalesce(sum(abs(l.amount)), 0) into v_prev
    from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
   where l.corrects_line_id = v_line.id and i.status <> 'VOID';
  v_prev := v_prev + coalesce((
    select sum(abs(si.amount)) from platform.subscription_items si
     where si.corrects_line_id = v_line.id
       and not exists (select 1 from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
                        where l.subscription_item_id = si.id and i.status <> 'VOID')), 0);
  if v_prev + v_amount > abs(v_line.amount) then
    raise exception 'DESCUENTO_EXCEDE_LINEA: % ya corregido + % supera el importe % de la línea', v_prev, v_amount, abs(v_line.amount)
      using errcode = '23514';
  end if;

  -- Va en la SIGUIENTE factura del contrato: nunca en el período ya emitido.
  v_from := greatest(date_trunc('month', current_date)::date,
                     coalesce((v_line.period_start + interval '1 month')::date, date_trunc('month', current_date)::date));

  insert into platform.subscription_items (
    subscription_id, charge_kind, description, quantity, unit_amount, currency, billing_interval,
    tenant_id, valid_from, source_type, corrects_line_id
  ) values (
    v_line.subscription_id, 'DISCOUNT', 'Corrección · ' || v_line.description || ' (' || v_line.number || ')', 1, v_amount,
    v_line.currency, 'ONE_TIME', v_line.tenant_id, v_from, 'MANUAL', v_line.id
  )
  returning id into v_si;

  perform platform.log_audit('CORRECTIVE_DISCOUNT_SCHEDULED', 'invoice_line', v_line.id::text, null, v_line.tenant_id,
    jsonb_build_object('invoice', v_line.number, 'amount', v_amount, 'already_corrected', v_prev,
                       'subscription_item_id', v_si, 'valid_from', v_from, 'reason', trim(p_reason)));
  return jsonb_build_object('subscription_item_id', v_si, 'amount', v_amount, 'valid_from', v_from,
                            'already_corrected', v_prev);
end;
$$;
revoke all on function platform.schedule_corrective_discount(uuid, numeric, text) from public, anon;
grant execute on function platform.schedule_corrective_discount(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Comisiones: uso y compra de créditos solo con regla explícita (D-11)
--     Copia EXACTA de 20260928000100 con el cambio marcado «CCP fase 18».
-- ---------------------------------------------------------------------------
create or replace function platform.generate_commission_events(p_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_payment      record;
  v_invoice      record;
  v_line         record;
  v_attr         record;
  v_rule         record;
  v_paid_ratio   numeric(12,8);
  v_base         numeric(14,2);
  v_amount       numeric(14,2);
  v_accrued      numeric(14,2);
  v_months       integer;
  v_prior_events integer;
  v_created      integer := 0;
begin
  select * into v_payment from platform.payments where id = p_payment_id;
  if v_payment is null then
    raise exception 'PAGO_NO_ENCONTRADO: %', p_payment_id using errcode = '23503';
  end if;

  if v_payment.status <> 'CONFIRMED' then
    return 0;
  end if;

  select * into v_invoice from platform.invoices where id = v_payment.invoice_id;
  if v_invoice.status in ('DRAFT', 'VOID') then
    return 0;
  end if;
  if coalesce(v_invoice.total, 0) <= 0 then
    return 0;
  end if;

  v_paid_ratio := least(v_payment.amount / v_invoice.total, 1.0);

  for v_line in
    select l.* from platform.invoice_lines l
     where l.invoice_id = v_invoice.id and l.amount > 0
       -- CCP P-01: un DISCOUNT no es base de comisión (ni suma ni resta; D-11 abierto).
       and l.charge_kind <> 'DISCOUNT'
  loop
    for v_attr in
      select a.*
        from platform.sales_attributions a
       where a.status = 'ACTIVE'
         and a.commission_plan_id is not null
         and a.saas_product_id = coalesce(v_line.saas_product_id, a.saas_product_id)
         and (
           (v_line.tenant_id is not null and a.tenant_id = v_line.tenant_id)
           or (v_invoice.subscription_id is not null and a.subscription_id = v_invoice.subscription_id)
           or (v_line.tenant_id is not null and a.subscription_id is not null and exists (
                 select 1 from platform.subscriptions s
                  where s.id = a.subscription_id and s.tenant_id = v_line.tenant_id))
         )
         and a.valid_from <= coalesce(v_payment.paid_at::date, current_date)
         and (a.valid_to is null or a.valid_to >= coalesce(v_payment.paid_at::date, current_date))
    loop
      for v_rule in
        select r.*
          from platform.commission_rules r
         where r.commission_plan_id = v_attr.commission_plan_id
           and r.status = 'ACTIVE'
           and r.valid_from <= coalesce(v_payment.paid_at::date, current_date)
           and (r.valid_to is null or r.valid_to >= coalesce(v_payment.paid_at::date, current_date))
           and (
             (r.basis = 'COLLECTED_LICENSE' and v_line.charge_kind in
                ('LICENSE', 'TENANT_LICENSE', 'PARTNER_BASE_LICENSE'))
             or (r.basis = 'COLLECTED_IMPLEMENTATION' and v_line.charge_kind = 'IMPLEMENTATION_FEE')
             or (r.basis = 'COLLECTED_ANY')
             or (r.basis = 'FIXED_AMOUNT')
           )
           and (r.charge_kind is null or r.charge_kind = v_line.charge_kind)
           -- CCP fase 18 (spec §13.1, D-11): uso y compra de créditos solo comisionan con una
           -- regla que los nombre explícitamente; COLLECTED_ANY/FIXED_AMOUNT genéricos no los incluyen.
           and (v_line.charge_kind not in ('USAGE_OVERAGE', 'CREDIT_PURCHASE') or r.charge_kind = v_line.charge_kind)
         order by r.priority, r.created_at
      loop
        -- V3: un importe fijo o un tope solo tienen sentido en la moneda de la regla.
        if (v_rule.basis = 'FIXED_AMOUNT' or v_rule.max_total_amount is not null)
           and v_rule.currency <> v_line.currency then
          continue;
        end if;

        select count(*) into v_prior_events
          from platform.commission_events e
         where e.sales_attribution_id = v_attr.id
           and e.commission_rule_id = v_rule.id
           and e.status <> 'VOID';

        if not v_rule.is_recurring and v_prior_events > 0 then
          continue;
        end if;

        if v_rule.max_months is not null then
          v_months := (extract(year from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)) * 12
                     + extract(month from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)))::integer;
          if v_months >= v_rule.max_months then
            continue;
          end if;
        end if;

        -- Base = porción COBRADA de la línea, en la moneda ORIGINAL del cobro.
        v_base := round(v_line.amount * v_paid_ratio, 2);

        if v_rule.basis = 'FIXED_AMOUNT' then
          v_amount := round(v_rule.fixed_amount * v_attr.attribution_pct, 2);
        else
          v_amount := round(v_base * v_rule.rate * v_attr.attribution_pct, 2);
        end if;

        if v_amount <= 0 then
          continue;
        end if;

        if v_rule.max_total_amount is not null then
          select coalesce(sum(e.amount), 0) into v_accrued
            from platform.commission_events e
           where e.sales_attribution_id = v_attr.id
             and e.commission_rule_id = v_rule.id
             and e.currency = v_rule.currency
             and e.status <> 'VOID';

          if v_accrued >= v_rule.max_total_amount then
            continue;
          end if;
          v_amount := least(v_amount, v_rule.max_total_amount - v_accrued);
        end if;

        insert into platform.commission_events (
          sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
          invoice_line_id, saas_product_id, tenant_id, status,
          base_amount, applied_rate, attribution_pct, amount, currency, earned_on, calculation
        )
        values (
          v_attr.sales_agent_id, v_attr.id, v_rule.id, v_payment.id,
          v_line.id, v_attr.saas_product_id, coalesce(v_line.tenant_id, v_attr.tenant_id), 'ELIGIBLE',
          v_base, v_rule.rate, v_attr.attribution_pct, v_amount, v_line.currency,
          coalesce(v_payment.paid_at::date, current_date),
          jsonb_build_object(
            'rule_name', v_rule.name,
            'basis', v_rule.basis,
            'charge_kind', v_line.charge_kind,
            'rate', v_rule.rate,
            'fixed_amount', v_rule.fixed_amount,
            'rule_currency', v_rule.currency,
            'payment_currency', v_line.currency,
            'invoice_line_amount', v_line.amount,
            'payment_ratio', round(v_paid_ratio, 6),
            'base_amount', v_base,
            'attribution_pct', v_attr.attribution_pct,
            'max_months', v_rule.max_months,
            'max_total_amount', v_rule.max_total_amount,
            'formula', case when v_rule.basis = 'FIXED_AMOUNT'
                            then 'fixed_amount * attribution_pct'
                            else 'invoice_line_amount * payment_ratio * rate * attribution_pct' end
          )
        )
        on conflict do nothing;

        if found then
          v_created := v_created + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;

