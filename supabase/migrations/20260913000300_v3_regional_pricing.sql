-- ============================================================================
-- EBIM Control Plane V3 — 26 · Pricing regional
-- ----------------------------------------------------------------------------
-- Fase 04 de `.claude-prompts-v3-multicurrency`. Cierra G-04, G-05, G-06 y la
-- parte de base de datos de G-07 y G-33.
--
-- EL PROBLEMA: `plan_prices` no tenía mercado. Una tarifa eSupplier USD 850 en
-- Perú y una USD 700 en Ecuador eran LA MISMA fila, porque la clave vigente era
-- (plan, charge_kind, interval, currency). Y el onboarding tomaba «la tarifa USD
-- del plan» sin saber de qué país era.
--
-- AHORA una tarifa se identifica por
--   plan + market + charge_kind + billing_interval + currency + vigencia
-- y ninguna consulta de precio se hace sin mercado.
--
-- ESTRATEGIA DE COMPATIBILIDAD (explícita, DV3-006)
--
--   · `plan_prices.market_id` es NULLABLE solo para la historia previa a V3.
--   · Backfill: una tarifa existente cuya moneda la admite UN solo mercado activo
--     recibe ese mercado (PEN -> PE, BOB -> BO). Una tarifa USD —admitida por PE,
--     BO y EC— queda NULL: asignarla a un país sería inventar.
--   · Una tarifa NULL es «legacy sin mercado»: se conserva, se lista como tal y
--     NO la devuelve `current_plan_price()`, que exige mercado. Para vender en un
--     mercado hay que publicar su tarifa regional con `set_plan_price`.
--   · Toda tarifa NUEVA exige mercado (trigger). No hay forma de crear otra legacy.
--
-- Una tarifa es un hecho histórico: salvo cerrar su vigencia (`valid_to`), nada
-- de una fila de `plan_prices` se modifica después de insertarla.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Helpers de mercado reutilizables por todas las RPCs regionales.
--    Centralizan los mensajes: una RPC no redacta su propio «mercado inválido».
-- ---------------------------------------------------------------------------
create or replace function platform.require_active_market(p_market_code text)
returns platform.markets
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market platform.markets;
begin
  if nullif(trim(coalesce(p_market_code, '')), '') is null then
    raise exception 'MERCADO_REQUERIDO: indica el mercado (PE, BO, EC...) de la operación'
      using errcode = '23502';
  end if;

  select * into v_market from platform.markets where code = upper(trim(p_market_code));
  if v_market.id is null then
    raise exception 'MERCADO_NO_ENCONTRADO: "%" no es un mercado del catálogo', p_market_code
      using errcode = '23503';
  end if;
  if v_market.status <> 'ACTIVE' then
    raise exception 'MERCADO_INACTIVO: el mercado % no admite operaciones nuevas', v_market.code
      using errcode = '23514';
  end if;

  return v_market;
end;
$$;

comment on function platform.require_active_market(text) is
  'Resuelve un mercado ACTIVO por código o lanza MERCADO_REQUERIDO / MERCADO_NO_ENCONTRADO / MERCADO_INACTIVO.';

-- Moneda de la operación dentro de un mercado: la indicada o, si no se indica,
-- la sugerida por el mercado. En ambos casos debe estar admitida.
create or replace function platform.resolve_market_currency(p_market_id uuid, p_currency char(3))
returns char(3)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market   platform.markets;
  v_currency char(3);
begin
  select * into v_market from platform.markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'MERCADO_NO_ENCONTRADO: %', p_market_id using errcode = '23503';
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), v_market.default_currency_code));

  if not platform.is_currency_allowed_in_market(v_market.id, v_currency) then
    raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: % no está admitida en el mercado %', v_currency, v_market.code
      using errcode = '23514';
  end if;

  return v_currency;
end;
$$;

comment on function platform.resolve_market_currency(uuid, char) is
  'Moneda indicada o la sugerida del mercado; lanza MONEDA_NO_PERMITIDA_EN_MERCADO si no está admitida.';

-- ---------------------------------------------------------------------------
-- 2. plan_prices.market_id
-- ---------------------------------------------------------------------------
alter table platform.plan_prices
  add column market_id uuid references platform.markets (id) on delete restrict;

create index plan_prices_market_ix on platform.plan_prices (market_id);

comment on column platform.plan_prices.market_id is
  'Mercado de la tarifa. NULL = tarifa legacy anterior a V3 sin mercado inferible: se conserva '
  'como historia pero current_plan_price() nunca la devuelve. Toda tarifa nueva lo exige.';

-- Backfill: solo donde la moneda identifica un único mercado activo.
update platform.plan_prices pp
   set market_id = (select mc.market_id
                      from platform.market_currencies mc
                      join platform.markets m on m.id = mc.market_id
                     where mc.currency_code = pp.currency
                       and mc.status = 'ACTIVE' and m.status = 'ACTIVE')
 where pp.market_id is null
   and (select count(*)
          from platform.market_currencies mc
          join platform.markets m on m.id = mc.market_id
         where mc.currency_code = pp.currency
           and mc.status = 'ACTIVE' and m.status = 'ACTIVE') = 1;

-- ---------------------------------------------------------------------------
-- 3. Unicidad y no-solapamiento.
--
-- (a) Una sola tarifa ABIERTA por combinación, ahora con mercado. NULLS NOT
--     DISTINCT: dos tarifas legacy abiertas de la misma combinación también
--     chocan, como antes.
-- (b) G-05: el baseline solo impedía dos tarifas abiertas; dos vigencias
--     cerradas que se pisan (enero-marzo y febrero-abril) pasaban. La exclusión
--     GiST lo impide para toda tarifa con mercado.
-- ---------------------------------------------------------------------------
do $$
declare
  v_overlaps text;
begin
  select string_agg(a.id::text || '~' || b.id::text, ', ') into v_overlaps
    from platform.plan_prices a
    join platform.plan_prices b
      on a.id < b.id
     and a.plan_id = b.plan_id
     and a.market_id = b.market_id
     and a.charge_kind = b.charge_kind
     and a.billing_interval = b.billing_interval
     and a.currency = b.currency
     and daterange(a.valid_from, a.valid_to, '[]') && daterange(b.valid_from, b.valid_to, '[]');
  if v_overlaps is not null then
    raise exception 'MIGRACION_BLOQUEADA: tarifas con vigencias solapadas en el mismo mercado: %. Ciérralas antes de aplicar V3.', v_overlaps;
  end if;
end;
$$;

drop index if exists platform.plan_prices_current_uk;

create unique index plan_prices_current_uk
  on platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, currency)
  nulls not distinct
  where valid_to is null;

alter table platform.plan_prices
  add constraint plan_prices_no_overlap_ex
  exclude using gist (
    plan_id with =,
    market_id with =,
    charge_kind with =,
    billing_interval with =,
    currency with =,
    daterange(valid_from, valid_to, '[]') with &&
  );

comment on constraint plan_prices_no_overlap_ex on platform.plan_prices is
  'Dos tarifas del mismo plan, mercado, cargo, intervalo y moneda no pueden tener vigencias que se pisen.';

-- ---------------------------------------------------------------------------
-- 4. Guard: mercado obligatorio, moneda admitida, historia inmutable.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_plan_price_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market_code text;
begin
  if tg_op = 'INSERT' then
    if new.market_id is null then
      raise exception 'MERCADO_REQUERIDO: toda tarifa nueva pertenece a un mercado (plan %)', new.plan_id
        using errcode = '23502';
    end if;

    if not platform.is_currency_allowed_in_market(new.market_id, new.currency) then
      select code into v_market_code from platform.markets where id = new.market_id;
      raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: % no está admitida en el mercado %', new.currency, v_market_code
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: solo se cierra (o reabre) la vigencia. Todo lo demás es historia.
  if new.plan_id is distinct from old.plan_id
     or new.market_id is distinct from old.market_id
     or new.charge_kind is distinct from old.charge_kind
     or new.billing_interval is distinct from old.billing_interval
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.valid_from is distinct from old.valid_from then
    raise exception 'PRECIO_HISTORICO_INMUTABLE: una tarifa no se edita; versiónala con set_plan_price (tarifa %)', old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger plan_prices_rules_guard
  before insert or update on platform.plan_prices
  for each row execute function platform.enforce_plan_price_rules();

-- ---------------------------------------------------------------------------
-- 5. current_plan_price — SIEMPRE con mercado.
--
-- Se elimina la firma V2 sin mercado: dejarla viva sería exactamente el
-- accidente que esta fase existe para impedir (resolver el precio de otro país).
--
-- G-33: pasa a SECURITY INVOKER. La tarifa la filtra `plan_prices_select`
-- (finanzas, admin de plataforma o quien contrata el plan). Llamada desde una
-- RPC SECURITY DEFINER —onboarding— corre con los permisos de esa RPC, que ya
-- autorizó al usuario en su primera línea.
-- ---------------------------------------------------------------------------
drop function if exists platform.current_plan_price(uuid, platform.charge_kind, platform.billing_interval, character, date);

create or replace function platform.current_plan_price(
  p_plan_id          uuid,
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
  select pp.amount
    from platform.plan_prices pp
   where pp.plan_id = p_plan_id
     and pp.market_id = p_market_id
     and pp.charge_kind = p_charge_kind
     and pp.billing_interval = p_billing_interval
     and pp.currency = p_currency
     and pp.valid_from <= p_as_of
     and (pp.valid_to is null or pp.valid_to >= p_as_of)
   order by pp.valid_from desc
   limit 1;
$$;

comment on function platform.current_plan_price(uuid, uuid, platform.charge_kind, platform.billing_interval, char, date) is
  'Tarifa vigente de un plan EN UN MERCADO. NULL si no hay: quien llama decide si es error. '
  'Nunca devuelve una tarifa legacy sin mercado ni la de otro mercado con la misma moneda.';

-- ¿Se puede vender este plan en este mercado y moneda en esta fecha? Cualquier
-- tarifa vigente (licencia, fee...) cuenta: un plan DEMO solo tiene licencia 0.
create or replace function platform.plan_has_regional_price(
  p_plan_id   uuid,
  p_market_id uuid,
  p_currency  char(3),
  p_as_of     date default current_date
)
returns boolean
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.plan_prices pp
     where pp.plan_id = p_plan_id
       and pp.market_id = p_market_id
       and pp.currency = p_currency
       and pp.valid_from <= p_as_of
       and (pp.valid_to is null or pp.valid_to >= p_as_of)
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. set_plan_price — versiona la tarifa DE UN MERCADO.
-- ---------------------------------------------------------------------------
drop function if exists platform.set_plan_price(uuid, platform.charge_kind, platform.billing_interval, numeric, character, date);

create or replace function platform.set_plan_price(
  p_plan_id          uuid,
  p_market_code      text,
  p_charge_kind      platform.charge_kind,
  p_billing_interval platform.billing_interval,
  p_amount           numeric,
  p_currency         char(3),
  p_valid_from       date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_current  record;
  v_market   platform.markets;
  v_currency char(3);
  v_clash    record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin fijan tarifas'
      using errcode = '42501';
  end if;

  if not exists (select 1 from platform.plans where id = p_plan_id) then
    raise exception 'PLAN_NO_ENCONTRADO: %', p_plan_id using errcode = '23503';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'IMPORTE_INVALIDO: la tarifa no puede ser negativa' using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_currency, '')), '') is null then
    -- Una tarifa no hereda la moneda sugerida: el precio y su moneda se deciden juntos.
    raise exception 'MONEDA_REQUERIDA: una tarifa declara su moneda explícitamente' using errcode = '23502';
  end if;
  if p_valid_from is null then
    raise exception 'VIGENCIA_INVALIDA: la tarifa necesita fecha de inicio' using errcode = '23502';
  end if;

  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  select * into v_current
    from platform.plan_prices
   where plan_id = p_plan_id
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
      -- Nada que versionar: no se crea ruido histórico por un «guardar» sin cambio.
      return v_current.id;
    end if;
  end if;

  -- Una tarifa CERRADA posterior también choca (se versionó hacia atrás antes).
  -- La exclusión GiST lo impediría igual; aquí se explica en lenguaje de negocio.
  select pp.id, pp.valid_from, pp.valid_to into v_clash
    from platform.plan_prices pp
   where pp.plan_id = p_plan_id
     and pp.market_id = v_market.id
     and pp.charge_kind = p_charge_kind
     and pp.billing_interval = p_billing_interval
     and pp.currency = v_currency
     and pp.valid_to is not null
     and pp.valid_to >= p_valid_from
   limit 1;
  if v_clash.id is not null then
    raise exception 'TARIFA_SOLAPADA: ya existe una tarifa % del % al % en ese mercado y moneda',
      p_charge_kind, v_clash.valid_from, v_clash.valid_to
      using errcode = '23514';
  end if;

  if v_current.id is not null then
    update platform.plan_prices set valid_to = p_valid_from - 1 where id = v_current.id;
  end if;

  insert into platform.plan_prices (
    plan_id, market_id, charge_kind, billing_interval, amount, currency, valid_from
  ) values (
    p_plan_id, v_market.id, p_charge_kind, p_billing_interval, p_amount, v_currency, p_valid_from
  )
  returning id into v_id;

  perform platform.log_audit(
    'PLAN_PRICE_VERSIONED', 'plan_price', v_id::text, null, null,
    jsonb_build_object(
      'plan_id', p_plan_id, 'market', v_market.code, 'charge_kind', p_charge_kind,
      'billing_interval', p_billing_interval, 'amount', p_amount, 'currency', v_currency,
      'valid_from', p_valid_from, 'closed_price_id', v_current.id, 'previous_amount', v_current.amount
    )
  );

  return v_id;
end;
$$;

comment on function platform.set_plan_price(uuid, text, platform.charge_kind, platform.billing_interval, numeric, char, date) is
  'Versiona la tarifa de un plan en un mercado cerrando la anterior. Moneda explícita y admitida '
  'por el mercado. Una tarifa histórica NUNCA se edita.';

-- ---------------------------------------------------------------------------
-- 7. Vista de catálogo de tarifas para la UI.
--    security_invoker: la fila la filtra `plan_prices_select`, no la vista.
-- ---------------------------------------------------------------------------
create or replace view platform.v_plan_price_catalog
with (security_invoker = true) as
select
  pp.id               as price_id,
  pp.plan_id,
  pl.code             as plan_code,
  pl.name             as plan_name,
  pl.saas_product_id,
  pl.deployment_mode,
  pp.market_id,
  m.code              as market_code,
  m.name              as market_name,
  pp.charge_kind,
  pp.billing_interval,
  pp.amount,
  pp.currency,
  pp.valid_from,
  pp.valid_to,
  (pp.valid_from <= current_date and (pp.valid_to is null or pp.valid_to >= current_date)) as is_current,
  (pp.valid_from > current_date) as is_scheduled,
  (pp.market_id is null)        as is_legacy
from platform.plan_prices pp
join platform.plans pl on pl.id = pp.plan_id
left join platform.markets m on m.id = pp.market_id;

comment on view platform.v_plan_price_catalog is
  'Tarifas con su mercado. is_legacy = tarifa previa a V3 sin mercado: no se usa para vender.';

grant select on platform.v_plan_price_catalog to authenticated, service_role;
revoke all on platform.v_plan_price_catalog from anon, public;

-- ---------------------------------------------------------------------------
-- 8. subscriptions.market_id — dónde se vendió el contrato.
--
-- La tarifa se resolvió en un mercado; el contrato recuerda cuál. Sin esto el
-- dashboard regional (fase 13) tendría que adivinar el país por la organización.
-- Misma regla que las sociedades (DV3-005): si no se indica y el país de quien
-- paga tiene un único mercado activo que admite la moneda, se asigna; si no,
-- queda NULL (contrato fuera del modelo regional, p. ej. un cliente de Chile).
-- ---------------------------------------------------------------------------
alter table platform.subscriptions
  add column market_id uuid references platform.markets (id) on delete restrict;

create index subscriptions_market_ix on platform.subscriptions (market_id);

comment on column platform.subscriptions.market_id is
  'Mercado en el que se vendió el contrato. Inmutable una vez fijado. NULL = contrato fuera '
  'de los mercados regionales (historia o país sin mercado). La moneda debe estar admitida.';

create or replace function platform.enforce_subscription_market()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_country     char(2);
  v_candidate   uuid;
  v_candidates  integer;
  v_market_code text;
begin
  if tg_op = 'UPDATE' and old.market_id is not null
     and new.market_id is distinct from old.market_id then
    raise exception 'MERCADO_INMUTABLE: la suscripción % se vendió en otro mercado; crea un contrato nuevo', old.code
      using errcode = '23514';
  end if;

  if new.market_id is null and tg_op = 'INSERT' then
    select o.country_code into v_country from platform.organizations o where o.id = new.billed_organization_id;
    select count(*), min(m.id::text)::uuid into v_candidates, v_candidate
      from platform.markets m where m.country_code = v_country and m.status = 'ACTIVE';
    if v_candidates = 1 and platform.is_currency_allowed_in_market(v_candidate, new.currency) then
      new.market_id := v_candidate;
    end if;
    return new;
  end if;

  if new.market_id is not null
     and (tg_op = 'INSERT'
          or new.currency is distinct from old.currency
          or new.market_id is distinct from old.market_id)
     and not platform.is_currency_allowed_in_market(new.market_id, new.currency) then
    select code into v_market_code from platform.markets where id = new.market_id;
    raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: % no está admitida en el mercado % (suscripción %)',
      new.currency, v_market_code, new.code
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger subscriptions_market_guard
  before insert or update of market_id, currency on platform.subscriptions
  for each row execute function platform.enforce_subscription_market();

-- Backfill con la misma regla que el trigger.
update platform.subscriptions s
   set market_id = m.id
  from platform.organizations o, platform.markets m
 where s.market_id is null
   and o.id = s.billed_organization_id
   and m.country_code = o.country_code
   and m.status = 'ACTIVE'
   and (select count(*) from platform.markets m2
         where m2.country_code = o.country_code and m2.status = 'ACTIVE') = 1
   and platform.is_currency_allowed_in_market(m.id, s.currency);

-- ---------------------------------------------------------------------------
-- 9. create_subscription — con mercado y tarifa regional obligatorios.
-- ---------------------------------------------------------------------------
drop function if exists platform.create_subscription(
  uuid, uuid, uuid, platform.billing_interval, character, uuid, text, integer, date, date,
  numeric, platform.subscription_status, text, jsonb
);

create or replace function platform.create_subscription(
  p_billed_organization_id uuid,
  p_saas_product_id        uuid,
  p_plan_id                uuid,
  p_billing_interval       platform.billing_interval,
  p_market_code            text,
  -- NULL = moneda sugerida por el mercado. Si se indica, debe estar admitida.
  p_currency               char(3) default null,
  p_tenant_id              uuid default null,
  p_code                   text default null,
  p_quantity               integer default 1,
  p_started_on             date default current_date,
  p_ends_on                date default null,
  p_channel_margin_rate    numeric default null,
  p_status                 platform.subscription_status default 'DRAFT',
  p_notes                  text default null,
  p_metadata               jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_code     text;
  v_product  text;
  v_plan     record;
  v_market   platform.markets;
  v_currency char(3);
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN crean suscripciones'
      using errcode = '42501';
  end if;

  select code into v_product from platform.saas_products where id = p_saas_product_id;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_id using errcode = '23503';
  end if;
  select * into v_plan from platform.plans where id = p_plan_id and saas_product_id = p_saas_product_id;
  if v_plan.id is null then
    raise exception 'PLAN_INCOMPATIBLE: el plan % no pertenece al producto %', p_plan_id, v_product
      using errcode = '23514';
  end if;
  if p_tenant_id is not null
     and not exists (select 1 from platform.tenants where id = p_tenant_id and saas_product_id = p_saas_product_id) then
    raise exception 'TENANT_INCOMPATIBLE: el tenant no pertenece al producto %', v_product using errcode = '23514';
  end if;
  if coalesce(p_channel_margin_rate, 0) < 0 or coalesce(p_channel_margin_rate, 0) > 1 then
    raise exception 'MARGEN_INVALIDO: channel_margin_rate debe estar en [0, 1]' using errcode = '23514';
  end if;

  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  -- Sin tarifa regional no hay contrato: el importe saldría de ninguna parte.
  if not platform.plan_has_regional_price(p_plan_id, v_market.id, v_currency, coalesce(p_started_on, current_date)) then
    raise exception 'TARIFA_REGIONAL_NO_DEFINIDA: el plan "%" no tiene tarifa vigente en % para el mercado % al %',
      v_plan.code, v_currency, v_market.code, coalesce(p_started_on, current_date)
      using errcode = '23502';
  end if;

  v_code := coalesce(
    nullif(trim(coalesce(p_code, '')), ''),
    'SUB-' || upper(v_product) || '-' || lpad((
      select coalesce(count(*), 0) + 1 from platform.subscriptions where saas_product_id = p_saas_product_id
    )::text, 4, '0')
  );

  insert into platform.subscriptions (
    code, billed_organization_id, saas_product_id, tenant_id, plan_id, market_id, status,
    billing_interval, currency, quantity, started_on, ends_on, channel_margin_rate, notes, metadata
  ) values (
    v_code, p_billed_organization_id, p_saas_product_id, p_tenant_id, p_plan_id, v_market.id, p_status,
    p_billing_interval, v_currency, coalesce(p_quantity, 1), coalesce(p_started_on, current_date), p_ends_on,
    p_channel_margin_rate, p_notes, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  perform platform.log_audit(
    'SUBSCRIPTION_CREATED', 'subscription', v_id::text, p_billed_organization_id, p_tenant_id,
    jsonb_build_object('code', v_code, 'product', v_product, 'plan_id', p_plan_id,
                       'market', v_market.code, 'currency', v_currency,
                       'billing_interval', p_billing_interval, 'status', p_status)
  );

  return v_id;
end;
$$;

comment on function platform.create_subscription(uuid, uuid, uuid, platform.billing_interval, text, char, uuid, text, integer, date, date, numeric, platform.subscription_status, text, jsonb) is
  'Contrato en un mercado. Moneda = la indicada (admitida) o la sugerida del mercado. Exige '
  'tarifa regional vigente para plan + mercado + moneda.';

-- ---------------------------------------------------------------------------
-- 10. onboard_customer_subscription — la venta ES regional.
--
-- Cambios frente a V2 (G-07):
--   · `p_market_code` obligatorio; se elimina `p_currency default 'USD'`.
--   · moneda = la indicada si el mercado la admite, o la sugerida del mercado.
--   · la licencia se resuelve con la tarifa DEL MERCADO. Si no existe, la venta
--     se rechaza aunque se pase `p_license_amount`: V2 creaba el contrato con un
--     importe tecleado y sin tarifa detrás.
--   · `p_license_amount` sigue permitiendo un precio negociado, pero solo sobre
--     una tarifa regional existente; ambos quedan en la auditoría.
-- ---------------------------------------------------------------------------
drop function if exists platform.onboard_customer_subscription(
  text, uuid, text, text, text, uuid, platform.billing_interval, character, platform.tenant_type,
  platform.deployment_mode, uuid, uuid, date, integer, numeric, numeric, numeric, numeric, numeric,
  uuid, uuid, numeric, platform.attribution_source, text, uuid, boolean, text
);

create or replace function platform.onboard_customer_subscription(
  p_saas_product_code        text,
  p_customer_organization_id uuid,
  p_tenant_slug              text,
  p_tenant_name              text,
  p_admin_email              text,
  p_plan_id                  uuid,
  p_market_code              text,
  p_billing_interval         platform.billing_interval default 'MONTHLY',
  p_currency                 char(3) default null,
  p_tenant_type              platform.tenant_type default 'PRODUCTION',
  p_deployment_mode          platform.deployment_mode default 'SHARED',
  p_managing_organization_id uuid default null,
  p_company_id               uuid default null,
  p_started_on               date default current_date,
  p_quantity                 integer default 1,
  p_license_amount           numeric default null,
  p_implementation_fee       numeric default null,
  p_infrastructure_fee       numeric default null,
  p_support_fee              numeric default null,
  p_channel_margin_rate      numeric default null,
  p_sales_agent_id           uuid default null,
  p_commission_plan_id       uuid default null,
  p_attribution_pct          numeric default 1.0,
  p_attribution_source       platform.attribution_source default 'DIRECT',
  p_provisioning_mode        text default 'DRY_RUN',
  p_deployment_target_id     uuid default null,
  p_activate                 boolean default false,
  p_notes                    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant_id       uuid;
  v_subscription_id uuid;
  v_attribution_id  uuid;
  v_provisioning_id uuid;
  v_product_id      uuid;
  v_plan            record;
  v_market          platform.markets;
  v_currency        char(3);
  v_started_on      date := coalesce(p_started_on, current_date);
  v_list_license    numeric(14,2);
  v_license_amount  numeric(14,2);
  v_is_demo         boolean := p_tenant_type = 'DEMO';
  v_recurring       boolean;
  v_needs_contract  boolean;
  v_items           jsonb := '[]'::jsonb;
  v_item_id         uuid;
  v_sub_interval    platform.billing_interval;
begin
  -- ---- Autorización ANTES de revelar nada del catálogo ------------------
  -- create_tenant y create_subscription vuelven a autorizar; esta línea evita
  -- que un usuario sin rol aprenda por el mensaje de error si una tarifa existe.
  if not (platform.can_manage_platform_entities() or platform.can_manage_commercial()) then
    raise exception 'NO_AUTORIZADO: el alta de clientes requiere un rol de plataforma o de finanzas de EBIM'
      using errcode = '42501';
  end if;

  -- ---- Validaciones previas ---------------------------------------------
  select id into v_product_id from platform.saas_products where code = p_saas_product_code;
  if v_product_id is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: no existe el SaaS con código "%"', p_saas_product_code
      using errcode = '23503';
  end if;

  select * into v_plan from platform.plans where id = p_plan_id;
  if v_plan is null then
    raise exception 'PLAN_NO_ENCONTRADO: %', p_plan_id using errcode = '23503';
  end if;
  if v_plan.saas_product_id <> v_product_id then
    raise exception 'PLAN_INCOMPATIBLE: el plan "%" no pertenece al producto %', v_plan.code, p_saas_product_code
      using errcode = '23514';
  end if;
  if v_plan.deployment_mode is not null and v_plan.deployment_mode <> p_deployment_mode then
    raise exception 'PLAN_MODO_INCOMPATIBLE: el plan "%" es para % y la venta es %',
      v_plan.code, v_plan.deployment_mode, p_deployment_mode
      using errcode = '23514';
  end if;

  if p_provisioning_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: provisioning_mode debe ser DRY_RUN o LIVE' using errcode = '23514';
  end if;

  -- ---- Mercado, moneda y tarifa: se resuelven ANTES de crear nada --------
  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  v_recurring := not v_is_demo and p_billing_interval <> 'ONE_TIME';
  v_needs_contract := v_recurring
     or coalesce(p_implementation_fee, 0) > 0
     or coalesce(p_infrastructure_fee, 0) > 0
     or coalesce(p_support_fee, 0) > 0;

  if v_recurring then
    v_list_license := coalesce(
      platform.current_plan_price(p_plan_id, v_market.id, 'LICENSE', p_billing_interval, v_currency, v_started_on),
      platform.current_plan_price(p_plan_id, v_market.id, 'TENANT_LICENSE', p_billing_interval, v_currency, v_started_on)
    );
    if v_list_license is null then
      raise exception 'TARIFA_REGIONAL_NO_DEFINIDA: el plan "%" no tiene licencia % vigente en % para el mercado %',
        v_plan.code, p_billing_interval, v_currency, v_market.code
        using errcode = '23502';
    end if;
    v_license_amount := coalesce(p_license_amount, v_list_license);
    if v_license_amount <= 0 then
      raise exception 'TARIFA_NO_DEFINIDA: la licencia recurrente del plan "%" en % no puede ser 0',
        v_plan.code, v_market.code
        using errcode = '23502';
    end if;
  elsif v_needs_contract
        and not platform.plan_has_regional_price(p_plan_id, v_market.id, v_currency, v_started_on) then
    raise exception 'TARIFA_REGIONAL_NO_DEFINIDA: el plan "%" no tiene tarifas vigentes en % para el mercado %',
      v_plan.code, v_currency, v_market.code
      using errcode = '23502';
  end if;

  -- ---- 1) Tenant. Se REUTILIZA create_tenant().
  v_tenant_id := platform.create_tenant(
    p_saas_product_code,
    p_customer_organization_id,
    p_tenant_slug,
    p_tenant_name,
    p_admin_email,
    p_tenant_type,
    p_deployment_mode,
    p_managing_organization_id,
    p_company_id,
    jsonb_build_object('onboarded_at', now(), 'plan_code', v_plan.code, 'market', v_market.code)
  );

  -- ---- 2-4) Suscripción y líneas, todas en la moneda contractual.
  v_sub_interval := case when v_recurring then p_billing_interval else 'ONE_TIME' end;

  if v_needs_contract then
    v_subscription_id := platform.create_subscription(
      p_customer_organization_id,
      v_product_id,
      p_plan_id,
      v_sub_interval,
      v_market.code,
      v_currency,
      v_tenant_id,
      null,
      coalesce(p_quantity, 1),
      v_started_on,
      null,
      p_channel_margin_rate,
      'DRAFT',
      p_notes,
      jsonb_build_object('origin', 'onboarding', 'demo', v_is_demo,
                         'list_license_amount', v_list_license)
    );

    if v_recurring then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'LICENSE',
        'Licencia ' || v_plan.name,
        coalesce(p_quantity, 1), v_license_amount, p_billing_interval,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'LICENSE', 'id', v_item_id,
                                               'amount', v_license_amount, 'currency', v_currency);
    end if;

    if coalesce(p_implementation_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'IMPLEMENTATION_FEE',
        'Implementación y puesta en marcha',
        1, p_implementation_fee, 'ONE_TIME',
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'IMPLEMENTATION_FEE', 'id', v_item_id,
                                               'amount', p_implementation_fee, 'currency', v_currency);
    end if;

    if coalesce(p_infrastructure_fee, 0) > 0 then
      if p_deployment_mode = 'SHARED' then
        raise exception 'INFRA_FEE_EN_SHARED: un fee de infraestructura dedicada no aplica a un tenant compartido'
          using errcode = '23514';
      end if;
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'INFRASTRUCTURE_FEE',
        'Infraestructura dedicada',
        1, p_infrastructure_fee,
        case when v_recurring then p_billing_interval else 'ONE_TIME' end,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'INFRASTRUCTURE_FEE', 'id', v_item_id,
                                               'amount', p_infrastructure_fee, 'currency', v_currency);
    end if;

    if coalesce(p_support_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'SUPPORT_FEE',
        'Soporte y SLA',
        1, p_support_fee,
        case when v_recurring then p_billing_interval else 'ONE_TIME' end,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'SUPPORT_FEE', 'id', v_item_id,
                                               'amount', p_support_fee, 'currency', v_currency);
    end if;

    if p_activate then
      perform platform.set_subscription_status(v_subscription_id, 'ACTIVE', 'Alta de cliente');
    end if;
  end if;

  -- ---- 5) Atribución comercial (opcional). NO crea tenant_membership.
  if p_sales_agent_id is not null then
    v_attribution_id := platform.create_sales_attribution(
      p_sales_agent_id,
      v_product_id,
      p_customer_organization_id,
      coalesce(p_attribution_pct, 1.0),
      v_tenant_id,
      v_subscription_id,
      p_managing_organization_id,
      p_attribution_source,
      p_commission_plan_id,
      v_started_on,
      null,
      'Atribución creada en el alta del cliente'
    );
  end if;

  -- ---- 6) Provisioning. DRY_RUN por defecto; LIVE lo rechaza la RPC salvo super admin.
  v_provisioning_id := platform.enqueue_provisioning_request(
    (case when p_deployment_mode = 'SHARED' then 'CREATE_TENANT_SPACE'
          else 'CREATE_DEDICATED_TARGET' end)::platform.provisioning_action,
    v_tenant_id,
    p_deployment_target_id,
    v_product_id,
    p_provisioning_mode,
    jsonb_build_object(
      'slug', p_tenant_slug,
      'deployment_mode', p_deployment_mode,
      'plan_code', v_plan.code,
      'origin', 'onboarding'
    ),
    null
  );

  perform platform.log_audit(
    'CUSTOMER_ONBOARDED', 'tenant', v_tenant_id::text,
    p_customer_organization_id, v_tenant_id,
    jsonb_build_object(
      'product', p_saas_product_code,
      'plan', v_plan.code,
      'market', v_market.code,
      'currency', v_currency,
      'list_license_amount', v_list_license,
      'license_amount', v_license_amount,
      'deployment_mode', p_deployment_mode,
      'tenant_type', p_tenant_type,
      'subscription_id', v_subscription_id,
      'recurring', v_recurring,
      'items', v_items,
      'attribution_id', v_attribution_id,
      'provisioning_id', v_provisioning_id,
      'provisioning_mode', p_provisioning_mode,
      'managing_organization_id', p_managing_organization_id
    )
  );

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'subscription_id', v_subscription_id,
    'attribution_id', v_attribution_id,
    'provisioning_request_id', v_provisioning_id,
    'market_code', v_market.code,
    'currency', v_currency,
    'recurring', v_recurring,
    'list_license_amount', v_list_license,
    'license_amount', v_license_amount,
    'items', v_items
  );
end;
$$;

comment on function platform.onboard_customer_subscription is
  'Venta regional atómica: tenant + suscripción + líneas + atribución + provisioning DRY_RUN. '
  'Mercado obligatorio, moneda admitida por el mercado y tarifa regional vigente obligatoria.';

-- ---------------------------------------------------------------------------
-- 11. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in (
         'require_active_market', 'resolve_market_currency', 'enforce_plan_price_rules',
         'current_plan_price', 'plan_has_regional_price', 'set_plan_price',
         'enforce_subscription_market', 'create_subscription', 'onboard_customer_subscription'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
