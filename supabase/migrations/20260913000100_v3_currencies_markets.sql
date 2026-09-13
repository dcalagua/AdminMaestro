-- ============================================================================
-- EBIM Control Plane V3 — 24 · Catálogo de monedas y mercados
-- ----------------------------------------------------------------------------
-- Fase 02 de `.claude-prompts-v3-multicurrency`. Cierra G-01 y G-02.
--
-- HASTA AQUÍ la moneda era un `char(3)` que solo debía cumplir `^[A-Z]{3}$`:
-- `XYZ` era una moneda válida y nada decía que Bolivia opera en BOB y en USD
-- pero no en PEN. Esta migración introduce el catálogo y ata a él TODAS las
-- columnas `currency` existentes con una FK.
--
-- TRES TABLAS, TRES RESPONSABILIDADES
--
--   currencies        · qué monedas existen (ISO 4217) y con cuántos decimales.
--   markets           · dónde se vende (PE, BO, EC) y qué moneda se sugiere.
--   market_currencies · qué monedas admite cada mercado.
--
-- Un mercado NO es un país ni una moneda: Ecuador vende en USD, Perú vende en
-- PEN y en USD. Por eso la moneda admitida es una relación, no un atributo.
--
-- DECISIÓN DV3-001: `currencies` usa el código ISO como clave primaria. Todas las
-- columnas `currency char(3)` del baseline ya guardan ese código, así que la FK
-- se añade sin reescribir un solo dato. `markets` sí usa uuid (convención C-02):
-- su código es un identificador de negocio que podría cambiar de significado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. currencies
-- ---------------------------------------------------------------------------
create table platform.currencies (
  code        char(3) primary key,
  name        text not null,
  -- Símbolo para mostrar SOLO cuando no es ambiguo. La UI muestra siempre el
  -- código ISO: «$» es a la vez dólar estadounidense, peso chileno y colombiano.
  symbol      text,
  -- Decimales ISO 4217. Decide el redondeo de las conversiones de reporte.
  decimals    smallint not null,
  status      platform.entity_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint currencies_code_ck check (code ~ '^[A-Z]{3}$'),
  constraint currencies_name_ck check (length(trim(name)) > 0),
  constraint currencies_decimals_ck check (decimals between 0 and 4)
);

create trigger currencies_set_updated_at before update on platform.currencies
  for each row execute function platform.set_updated_at();

comment on table platform.currencies is
  'Catálogo ISO 4217. Toda columna `currency` de platform tiene FK aquí (V3). Una moneda '
  'INACTIVE conserva los documentos históricos que la usan, pero no admite datos nuevos.';
comment on column platform.currencies.symbol is
  'Solo para presentación cuando no es ambiguo. La UI muestra siempre el código ISO.';

-- ---------------------------------------------------------------------------
-- 2. markets
-- ---------------------------------------------------------------------------
create table platform.markets (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  name                  text not null,
  country_code          char(2) not null,
  -- Moneda SUGERIDA al vender en este mercado. Debe estar admitida y activa:
  -- lo verifica `enforce_market_currency_consistency`.
  default_currency_code char(3) not null references platform.currencies (code) on delete restrict,
  status                platform.entity_status not null default 'ACTIVE',
  sort_order            integer not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint markets_code_ck check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  constraint markets_country_ck check (country_code ~ '^[A-Z]{2}$'),
  constraint markets_name_ck check (length(trim(name)) > 0)
);

create unique index markets_code_uk on platform.markets (code);
create index markets_default_currency_ix on platform.markets (default_currency_code);
create index markets_country_ix on platform.markets (country_code);
create trigger markets_set_updated_at before update on platform.markets
  for each row execute function platform.set_updated_at();

comment on table platform.markets is
  'Mercado comercial. NO es un país ni una moneda: country_code dice dónde está, '
  'market_currencies dice en qué se puede vender, default_currency_code qué se sugiere.';

-- ---------------------------------------------------------------------------
-- 3. market_currencies
-- ---------------------------------------------------------------------------
create table platform.market_currencies (
  market_id     uuid not null references platform.markets (id) on delete cascade,
  currency_code char(3) not null references platform.currencies (code) on delete restrict,
  status        platform.entity_status not null default 'ACTIVE',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (market_id, currency_code)
);

create index market_currencies_currency_ix on platform.market_currencies (currency_code);
create trigger market_currencies_set_updated_at before update on platform.market_currencies
  for each row execute function platform.set_updated_at();

comment on table platform.market_currencies is
  'Monedas admitidas por mercado. Una fila INACTIVE deja de admitir ventas nuevas en '
  'esa moneda, pero no altera los contratos que ya existen en ella.';

-- ---------------------------------------------------------------------------
-- 4. Coherencia del catálogo
--
-- Constraint triggers DIFERIDOS: dar de alta un mercado exige insertar la fila
-- del mercado y la de su moneda por defecto en la misma transacción, y en medio
-- el invariante está roto por definición. Se comprueba al COMMIT.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_market_currency_consistency()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market_id  uuid;
  v_market     record;
  v_mc_status  platform.entity_status;
  v_cur_status platform.entity_status;
begin
  if tg_table_name = 'markets' then
    v_market_id := new.id;
  else
    v_market_id := coalesce(new.market_id, old.market_id);
  end if;

  select * into v_market from platform.markets where id = v_market_id;
  if v_market.id is null then
    return null;  -- mercado borrado en la misma transacción
  end if;

  select mc.status into v_mc_status
    from platform.market_currencies mc
   where mc.market_id = v_market_id and mc.currency_code = v_market.default_currency_code;

  if v_mc_status is distinct from 'ACTIVE' then
    raise exception 'MONEDA_DEFAULT_NO_ADMITIDA: la moneda por defecto % del mercado % no está entre sus monedas admitidas activas',
      v_market.default_currency_code, v_market.code
      using errcode = '23514';
  end if;

  select c.status into v_cur_status from platform.currencies c where c.code = v_market.default_currency_code;
  if v_cur_status is distinct from 'ACTIVE' then
    raise exception 'MONEDA_INACTIVA: la moneda por defecto % del mercado % está inactiva',
      v_market.default_currency_code, v_market.code
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger markets_currency_consistency_guard
  after insert or update on platform.markets
  deferrable initially deferred
  for each row execute function platform.enforce_market_currency_consistency();

create constraint trigger market_currencies_consistency_guard
  after insert or update or delete on platform.market_currencies
  deferrable initially deferred
  for each row execute function platform.enforce_market_currency_consistency();

-- Una moneda admitida ACTIVA exige una moneda de catálogo ACTIVA, y una moneda
-- no se desactiva mientras un mercado la admita.
create or replace function platform.enforce_currency_activity()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_markets text;
begin
  if tg_table_name = 'market_currencies' then
    if new.status = 'ACTIVE' and exists (
      select 1 from platform.currencies c where c.code = new.currency_code and c.status <> 'ACTIVE'
    ) then
      raise exception 'MONEDA_INACTIVA: % está inactiva en el catálogo y no puede admitirse en un mercado', new.currency_code
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- currencies
  if new.status <> 'ACTIVE' and old.status = 'ACTIVE' then
    select string_agg(m.code, ', ' order by m.code) into v_markets
      from platform.market_currencies mc
      join platform.markets m on m.id = mc.market_id
     where mc.currency_code = new.code and mc.status = 'ACTIVE';
    if v_markets is not null then
      raise exception 'MONEDA_EN_USO: % sigue admitida en los mercados %; retírala de ellos antes de desactivarla', new.code, v_markets
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger currencies_activity_guard
  before update of status on platform.currencies
  for each row execute function platform.enforce_currency_activity();

create trigger market_currencies_activity_guard
  before insert or update on platform.market_currencies
  for each row execute function platform.enforce_currency_activity();

-- ---------------------------------------------------------------------------
-- 5. Helpers de lectura para triggers y RPCs.
--    SECURITY DEFINER + search_path fijo: los llaman triggers de tablas con RLS.
-- ---------------------------------------------------------------------------
create or replace function platform.is_currency_active(p_currency char(3))
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (select 1 from platform.currencies c where c.code = p_currency and c.status = 'ACTIVE');
$$;

create or replace function platform.is_currency_allowed_in_market(p_market_id uuid, p_currency char(3))
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1
      from platform.market_currencies mc
      join platform.markets m on m.id = mc.market_id
      join platform.currencies c on c.code = mc.currency_code
     where mc.market_id = p_market_id
       and mc.currency_code = p_currency
       and mc.status = 'ACTIVE'
       and m.status = 'ACTIVE'
       and c.status = 'ACTIVE'
  );
$$;

comment on function platform.is_currency_allowed_in_market(uuid, char) is
  'true si el mercado está activo y admite esa moneda activa. Es la única fuente de la '
  'regla «moneda permitida por mercado»: triggers, RPCs y UI la consultan, no la repiten.';

create or replace function platform.market_id_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select m.id from platform.markets m where m.code = upper(trim(p_code));
$$;

-- Autoridad del catálogo regional: dinero de la plataforma, no configuración de
-- producto. EBIM_FINANCE o el super admin.
create or replace function platform.can_manage_regional_catalog()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.can_read_finance();
$$;

comment on function platform.can_manage_regional_catalog() is
  'EBIM_FINANCE o EBIM_SUPER_ADMIN. Mantienen monedas, mercados, tipos de cambio y la '
  'moneda de reporte. Un partner o un tenant nunca.';

-- ---------------------------------------------------------------------------
-- 6. RLS. Lectura amplia (los selectores de la UI la necesitan y el catálogo no
--    contiene nada sensible); escritura solo por RPC.
-- ---------------------------------------------------------------------------
alter table platform.currencies enable row level security;
alter table platform.currencies force row level security;
alter table platform.markets enable row level security;
alter table platform.markets force row level security;
alter table platform.market_currencies enable row level security;
alter table platform.market_currencies force row level security;

grant select on platform.currencies, platform.markets, platform.market_currencies to authenticated;
revoke insert, update, delete on platform.currencies, platform.markets, platform.market_currencies
  from authenticated;
revoke all on platform.currencies, platform.markets, platform.market_currencies from anon, public;
grant all on platform.currencies, platform.markets, platform.market_currencies to service_role;

create policy currencies_select on platform.currencies
  for select to authenticated using (true);
create policy markets_select on platform.markets
  for select to authenticated using (true);
create policy market_currencies_select on platform.market_currencies
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 7. RPCs de mantenimiento
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_currency(
  p_code     char(3),
  p_name     text,
  p_decimals smallint,
  p_symbol   text default null,
  p_status   platform.entity_status default 'ACTIVE'
)
returns char(3)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_code   char(3) := upper(trim(coalesce(p_code, '')));
  v_is_new boolean;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin mantienen el catálogo de monedas'
      using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z]{3}$' then
    raise exception 'MONEDA_INVALIDA: "%" no es un código ISO 4217 de tres letras', p_code
      using errcode = '23514';
  end if;
  if p_decimals is null or p_decimals not between 0 and 4 then
    raise exception 'DECIMALES_INVALIDOS: % debe estar entre 0 y 4', p_decimals using errcode = '23514';
  end if;

  v_is_new := not exists (select 1 from platform.currencies where code = v_code);

  insert into platform.currencies (code, name, symbol, decimals, status)
  values (v_code, trim(p_name), nullif(trim(coalesce(p_symbol, '')), ''), p_decimals, p_status)
  on conflict (code) do update
    set name = excluded.name, symbol = excluded.symbol,
        decimals = excluded.decimals, status = excluded.status;

  perform platform.log_audit(
    case when v_is_new then 'CURRENCY_CREATED' else 'CURRENCY_UPDATED' end,
    'currency', v_code, null, null,
    jsonb_build_object('name', p_name, 'decimals', p_decimals, 'status', p_status)
  );

  return v_code;
end;
$$;

-- Alta/edición de mercado con su conjunto de monedas admitidas, en una sola
-- transacción. Las monedas que dejan de admitirse se DESACTIVAN, no se borran:
-- una tarifa histórica en esa moneda sigue siendo explicable.
create or replace function platform.upsert_market(
  p_code                  text,
  p_name                  text,
  p_country_code          char(2),
  p_default_currency_code char(3),
  p_allowed_currency_codes char(3)[],
  p_status                platform.entity_status default 'ACTIVE',
  p_sort_order            integer default 100
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_default char(3) := upper(trim(coalesce(p_default_currency_code, '')));
  v_allowed char(3)[];
  v_id      uuid;
  v_is_new  boolean;
  v_bad     text;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin mantienen los mercados'
      using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,15}$' then
    raise exception 'MERCADO_INVALIDO: "%" debe ser un código en mayúsculas (ej. PE)', p_code
      using errcode = '23514';
  end if;

  select array_agg(distinct upper(trim(c))) into v_allowed
    from unnest(coalesce(p_allowed_currency_codes, array[]::char(3)[])) c;

  if v_allowed is null or not (v_default = any (v_allowed)) then
    raise exception 'MONEDA_DEFAULT_NO_ADMITIDA: la moneda por defecto % debe estar entre las admitidas', v_default
      using errcode = '23514';
  end if;

  select string_agg(c, ', ') into v_bad
    from unnest(v_allowed) c
   where not platform.is_currency_active(c);
  if v_bad is not null then
    raise exception 'MONEDA_INACTIVA: % no existe o está inactiva en el catálogo', v_bad
      using errcode = '23514';
  end if;

  select id into v_id from platform.markets where code = v_code;
  v_is_new := v_id is null;

  if v_is_new then
    insert into platform.markets (code, name, country_code, default_currency_code, status, sort_order)
    values (v_code, trim(p_name), upper(p_country_code), v_default, p_status, coalesce(p_sort_order, 100))
    returning id into v_id;
  else
    update platform.markets
       set name = trim(p_name), country_code = upper(p_country_code),
           default_currency_code = v_default, status = p_status,
           sort_order = coalesce(p_sort_order, sort_order)
     where id = v_id;
  end if;

  insert into platform.market_currencies (market_id, currency_code, status)
  select v_id, c, 'ACTIVE' from unnest(v_allowed) c
  on conflict (market_id, currency_code) do update set status = 'ACTIVE';

  update platform.market_currencies
     set status = 'INACTIVE'
   where market_id = v_id and currency_code <> all (v_allowed) and status = 'ACTIVE';

  perform platform.log_audit(
    case when v_is_new then 'MARKET_CREATED' else 'MARKET_UPDATED' end,
    'market', v_id::text, null, null,
    jsonb_build_object('code', v_code, 'country', p_country_code, 'default_currency', v_default,
                       'allowed_currencies', to_jsonb(v_allowed), 'status', p_status)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_market is
  'Mercado + monedas admitidas en una transacción. Las monedas retiradas se desactivan, '
  'no se borran. La moneda por defecto debe estar admitida.';

-- ---------------------------------------------------------------------------
-- 8. Datos de referencia iniciales.
--
-- Son CATÁLOGO, no demo: tienen que existir en cualquier entorno porque las
-- FKs de abajo y las reglas de venta dependen de ellos.
-- ---------------------------------------------------------------------------
insert into platform.currencies (code, name, symbol, decimals, status) values
  ('PEN', 'Sol peruano',          'S/',  2, 'ACTIVE'),
  ('BOB', 'Boliviano',            'Bs',  2, 'ACTIVE'),
  ('USD', 'Dólar estadounidense', 'US$', 2, 'ACTIVE')
on conflict (code) do nothing;

insert into platform.markets (code, name, country_code, default_currency_code, sort_order) values
  ('PE', 'Perú',    'PE', 'PEN', 10),
  ('BO', 'Bolivia', 'BO', 'BOB', 20),
  ('EC', 'Ecuador', 'EC', 'USD', 30)
on conflict (code) do nothing;

insert into platform.market_currencies (market_id, currency_code)
select m.id, x.currency_code
  from (values ('PE', 'PEN'), ('PE', 'USD'), ('BO', 'BOB'), ('BO', 'USD'), ('EC', 'USD'))
       as x (market_code, currency_code)
  join platform.markets m on m.code = x.market_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. FK de todas las columnas `currency` del baseline al catálogo.
--
-- ESTRATEGIA DE BACKFILL (explícita): antes de crear las FKs se registran como
-- INACTIVE las monedas que ya existan en datos y no estén en el catálogo (en un
-- entorno con historia, p. ej. COP o CLP de sociedades existentes). No se
-- reescribe ni un importe ni una moneda: se da de alta lo que ya estaba.
-- Una moneda INACTIVE sostiene la historia pero no admite ventas nuevas.
-- ---------------------------------------------------------------------------
insert into platform.currencies (code, name, symbol, decimals, status)
select distinct x.code, x.code, null::text, 2::smallint, 'INACTIVE'::platform.entity_status
  from (
    select currency as code from platform.companies
    union select currency from platform.catalog_items
    union select currency from platform.plan_prices
    union select currency from platform.subscriptions
    union select currency from platform.subscription_items
    union select currency from platform.invoices
    union select currency from platform.invoice_lines
    union select currency from platform.payments
    union select currency from platform.cost_entries
    union select currency from platform.commission_rules
    union select currency from platform.commission_events
    union select currency from platform.commission_settlements
    union select currency from platform.payment_provider_accounts
    union select currency from platform.subscription_collection_profiles
    union select currency from platform.subscription_commercial_documents
    union select currency from platform.provider_plans
  ) x
 where x.code is not null
on conflict (code) do nothing;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('companies'),
      ('catalog_items'),
      ('plan_prices'),
      ('subscriptions'),
      ('subscription_items'),
      ('invoices'),
      ('invoice_lines'),
      ('payments'),
      ('cost_entries'),
      ('commission_rules'),
      ('commission_events'),
      ('commission_settlements'),
      ('payment_provider_accounts'),
      ('subscription_collection_profiles'),
      ('subscription_commercial_documents'),
      ('provider_plans')
    ) as t (table_name)
  loop
    execute format(
      'alter table platform.%I add constraint %I foreign key (currency) references platform.currencies (code) on delete restrict',
      r.table_name, r.table_name || '_currency_fk'
    );
    -- Test 12 de 00_structure: toda FK con índice de apoyo.
    execute format(
      'create index if not exists %I on platform.%I (currency)',
      r.table_name || '_currency_ix', r.table_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. GRANTS de funciones
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
         'enforce_market_currency_consistency', 'enforce_currency_activity',
         'is_currency_active', 'is_currency_allowed_in_market', 'market_id_by_code',
         'can_manage_regional_catalog', 'upsert_currency', 'upsert_market'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
