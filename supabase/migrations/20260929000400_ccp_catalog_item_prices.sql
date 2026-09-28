-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · precios de add-on con vigencia (MA-13)
-- ----------------------------------------------------------------------------
-- Spec §5. Plan §4 fila 6. Test: supabase/tests/30_ccp_catalog_item_prices.test.sql.
--
-- Réplica EXACTA de las reglas de plan_prices (20260913000300_v3_regional_pricing
-- §3-§7): mercado obligatorio, moneda admitida por el mercado, vigencia
-- inclusiva, una sola tarifa abierta por (item, mercado, cargo, intervalo,
-- moneda), exclusión GiST sin solapes, historia inmutable salvo valid_to.
-- Añade: la historia tampoco se BORRA (spec: "add-on price history is
-- immutable") y el cargo se limita a ADDON / IMPLEMENTATION_FEE / USAGE_OVERAGE.
--
-- Esta migración NO carga ningún precio: los importes de los documentos no se
-- cargan automáticamente (spec §5.5, D-01). Autoridad: EBIM_FINANCE
-- (can_manage_regional_catalog, spec §14.1).
-- ============================================================================

create table platform.catalog_item_prices (
  id               uuid primary key default gen_random_uuid(),
  catalog_item_id  uuid not null references platform.catalog_items (id) on delete restrict,
  market_id        uuid references platform.markets (id) on delete restrict,
  charge_kind      platform.charge_kind not null default 'ADDON',
  billing_interval platform.billing_interval not null default 'MONTHLY',
  amount           numeric(14,2) not null,
  currency         char(3) not null references platform.currencies (code) on delete restrict,
  valid_from       date not null default current_date,
  valid_to         date,
  created_by       uuid references platform.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint catalog_item_prices_amount_ck check (amount >= 0),
  constraint catalog_item_prices_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint catalog_item_prices_period_ck check (valid_to is null or valid_to >= valid_from),
  constraint catalog_item_prices_kind_ck
    check (charge_kind in ('ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE')),
  constraint catalog_item_prices_no_overlap_ex
    exclude using gist (
      catalog_item_id with =,
      market_id with =,
      charge_kind with =,
      billing_interval with =,
      currency with =,
      daterange(valid_from, valid_to, '[]') with &&
    )
);

create index catalog_item_prices_item_ix on platform.catalog_item_prices (catalog_item_id);
create index catalog_item_prices_market_ix on platform.catalog_item_prices (market_id);
create index catalog_item_prices_currency_ix on platform.catalog_item_prices (currency);
create index catalog_item_prices_created_by_ix on platform.catalog_item_prices (created_by);
create unique index catalog_item_prices_current_uk
  on platform.catalog_item_prices (catalog_item_id, market_id, charge_kind, billing_interval, currency)
  nulls not distinct
  where valid_to is null;
create trigger catalog_item_prices_set_updated_at before update on platform.catalog_item_prices
  for each row execute function platform.set_updated_at();

comment on table platform.catalog_item_prices is
  'Tarifa de un add-on por mercado con vigencia (spec §5). Nunca se edita ni se borra: se '
  'cierra y se abre otra con set_catalog_item_price. catalog_items.price_month es legacy.';

-- ---------------------------------------------------------------------------
-- Reglas: mercado y moneda al insertar; solo valid_to al actualizar; sin DELETE.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_catalog_item_price_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market_code text;
begin
  if tg_op = 'DELETE' then
    raise exception 'PRECIO_HISTORICO_INMUTABLE: una tarifa de add-on no se borra; se cierra su vigencia (tarifa %)', old.id
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.market_id is null then
      raise exception 'MERCADO_REQUERIDO: toda tarifa de add-on pertenece a un mercado (item %)', new.catalog_item_id
        using errcode = '23502';
    end if;
    if not platform.is_currency_allowed_in_market(new.market_id, new.currency) then
      select code into v_market_code from platform.markets where id = new.market_id;
      raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: % no está admitida en el mercado %', new.currency, v_market_code
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.catalog_item_id is distinct from old.catalog_item_id
     or new.market_id is distinct from old.market_id
     or new.charge_kind is distinct from old.charge_kind
     or new.billing_interval is distinct from old.billing_interval
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.valid_from is distinct from old.valid_from
     or new.created_by is distinct from old.created_by then
    raise exception 'PRECIO_HISTORICO_INMUTABLE: una tarifa de add-on no se edita; versiónala con set_catalog_item_price (tarifa %)', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function platform.enforce_catalog_item_price_rules() from public, anon, authenticated;

create trigger catalog_item_prices_rules_guard
  before insert or update or delete on platform.catalog_item_prices
  for each row execute function platform.enforce_catalog_item_price_rules();

-- price_month legacy: congelado en cuanto el item tiene tarifa (spec §5.6).
create or replace function platform.freeze_catalog_item_legacy_price()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if (new.price_month is distinct from old.price_month or new.currency is distinct from old.currency)
     and exists (select 1 from platform.catalog_item_prices p where p.catalog_item_id = old.id) then
    raise exception 'PRECIO_LEGACY_CONGELADO: % ya tiene tarifa en catalog_item_prices; price_month/currency no cambian (usa set_catalog_item_price)', old.code
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function platform.freeze_catalog_item_legacy_price() from public, anon, authenticated;

create trigger catalog_items_freeze_legacy_price
  before update of price_month, currency on platform.catalog_items
  for each row execute function platform.freeze_catalog_item_legacy_price();

-- ---------------------------------------------------------------------------
-- RLS: misma regla que plan_prices_select — finanzas, operador EBIM, o la
-- organización que ya paga ese add-on en una suscripción.
-- ---------------------------------------------------------------------------
alter table platform.catalog_item_prices enable row level security;
alter table platform.catalog_item_prices force row level security;

revoke all on platform.catalog_item_prices from public, anon, authenticated;
grant select on platform.catalog_item_prices to authenticated;
grant all on platform.catalog_item_prices to service_role;

create policy catalog_item_prices_select on platform.catalog_item_prices
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_platform_admin()
    or exists (
      select 1
        from platform.catalog_items ci
        join platform.subscription_items si on si.catalog_item_code = ci.code
        join platform.subscriptions s on s.id = si.subscription_id
       where ci.id = catalog_item_prices.catalog_item_id
         and s.billed_organization_id in (select platform.my_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- current_catalog_item_price — SIEMPRE con mercado. SECURITY INVOKER (G-33).
-- ---------------------------------------------------------------------------
create or replace function platform.current_catalog_item_price(
  p_catalog_item_id  uuid,
  p_market_id        uuid,
  p_charge_kind      platform.charge_kind,
  p_billing_interval platform.billing_interval,
  p_currency         char(3),
  p_as_of            date default current_date
)
returns numeric
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select p.amount
    from platform.catalog_item_prices p
   where p.catalog_item_id = p_catalog_item_id
     and p.market_id = p_market_id
     and p.charge_kind = p_charge_kind
     and p.billing_interval = p_billing_interval
     and p.currency = p_currency
     and p.valid_from <= p_as_of
     and (p.valid_to is null or p.valid_to >= p_as_of)
   order by p.valid_from desc
   limit 1;
$$;

comment on function platform.current_catalog_item_price(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) is
  'Tarifa vigente de un add-on EN UN MERCADO. NULL si no hay: quien llama decide (la activación '
  'de un add-on facturable falla con TARIFA_ADDON_NO_DEFINIDA).';

revoke all on function platform.current_catalog_item_price(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) from public, anon;
grant execute on function platform.current_catalog_item_price(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) to authenticated, service_role;

-- Id de la tarifa vigente (para subscription_items.price_ref). Mismo filtro.
create or replace function platform.current_catalog_item_price_id(
  p_catalog_item_id  uuid,
  p_market_id        uuid,
  p_charge_kind      platform.charge_kind,
  p_billing_interval platform.billing_interval,
  p_currency         char(3),
  p_as_of            date default current_date
)
returns uuid
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select p.id
    from platform.catalog_item_prices p
   where p.catalog_item_id = p_catalog_item_id
     and p.market_id = p_market_id
     and p.charge_kind = p_charge_kind
     and p.billing_interval = p_billing_interval
     and p.currency = p_currency
     and p.valid_from <= p_as_of
     and (p.valid_to is null or p.valid_to >= p_as_of)
   order by p.valid_from desc
   limit 1;
$$;

revoke all on function platform.current_catalog_item_price_id(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) from public, anon;
grant execute on function platform.current_catalog_item_price_id(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_catalog_item_price — versiona la tarifa DE UN MERCADO (espejo de
-- set_plan_price, con gate de finanzas).
-- ---------------------------------------------------------------------------
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
  if p_charge_kind is null or p_charge_kind not in ('ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE') then
    raise exception 'CARGO_INVALIDO: un add-on se tarifa como ADDON, IMPLEMENTATION_FEE o USAGE_OVERAGE (no %)', p_charge_kind
      using errcode = '23514';
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

comment on function platform.set_catalog_item_price(text, text, platform.charge_kind, platform.billing_interval, numeric, char, date) is
  'Versiona la tarifa de un add-on en un mercado cerrando la anterior (réplica de set_plan_price). '
  'Solo can_manage_regional_catalog() (EBIM_FINANCE, super admin). Auditado.';

revoke all on function platform.set_catalog_item_price(text, text, platform.charge_kind, platform.billing_interval, numeric, char, date) from public, anon;
grant execute on function platform.set_catalog_item_price(text, text, platform.charge_kind, platform.billing_interval, numeric, char, date) to authenticated, service_role;
