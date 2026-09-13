-- ============================================================================
-- V3 · Fase 02 — Catálogo de monedas y mercados
-- ----------------------------------------------------------------------------
-- Cada prueba nombra la regla que protege: si alguien la revierte, el nombre
-- dice qué se rompió.
-- ============================================================================
begin;
select plan(22);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Datos de referencia
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from platform.currencies
    where code in ('PEN', 'BOB', 'USD') and status = 'ACTIVE' and decimals = 2),
  3,
  'PEN, BOB y USD existen, activas y con 2 decimales'
);

select is(
  (select count(*)::int from platform.markets
    where (code, country_code, default_currency_code) in
          (('PE', 'PE', 'PEN'), ('BO', 'BO', 'BOB'), ('EC', 'EC', 'USD'))),
  3,
  'Mercados PE/PEN, BO/BOB y EC/USD con su moneda por defecto'
);

select is(
  (select array_agg(mc.currency_code::text order by mc.currency_code)
     from platform.market_currencies mc join platform.markets m on m.id = mc.market_id
    where m.code = 'PE' and mc.status = 'ACTIVE'),
  array['PEN', 'USD'],
  'Perú admite PEN y USD'
);

select is(
  (select array_agg(mc.currency_code::text order by mc.currency_code)
     from platform.market_currencies mc join platform.markets m on m.id = mc.market_id
    where m.code = 'BO' and mc.status = 'ACTIVE'),
  array['BOB', 'USD'],
  'Bolivia admite BOB y USD'
);

select is(
  (select array_agg(mc.currency_code::text order by mc.currency_code)
     from platform.market_currencies mc join platform.markets m on m.id = mc.market_id
    where m.code = 'EC' and mc.status = 'ACTIVE'),
  array['USD'],
  'Ecuador admite solo USD'
);

select ok(
  platform.is_currency_allowed_in_market(platform.market_id_by_code('PE'), 'PEN'),
  'PEN está permitida en Perú'
);

select ok(
  not platform.is_currency_allowed_in_market(platform.market_id_by_code('BO'), 'PEN'),
  'PEN NO está permitida en Bolivia: país no implica moneda'
);

select ok(
  not platform.is_currency_allowed_in_market(platform.market_id_by_code('EC'), 'PEN'),
  'PEN NO está permitida en Ecuador'
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.currencies (code, name, decimals) values ('pen', 'minúsculas', 2) $$,
  '23514', null,
  'Un código de moneda en minúsculas se rechaza'
);

select throws_ok(
  $$ insert into platform.currencies (code, name, decimals) values ('XTS', 'Prueba', 7) $$,
  '23514', null,
  'Más de 4 decimales se rechaza'
);

select throws_ok(
  $$ insert into platform.cost_entries (category, description, amount, currency, period_start, period_end)
     values ('ADMIN_MANUAL', 'Moneda inventada', 10, 'XYZ', current_date, current_date) $$,
  '23503', null,
  'Una moneda fuera del catálogo ya no se puede escribir: la FK lo impide'
);

select is(
  (select count(*)::int
     from information_schema.columns c
     join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'platform' and c.column_name = 'currency'
      and not exists (
        select 1 from pg_constraint con
         where con.contype = 'f'
           and con.conrelid = format('platform.%I', c.table_name)::regclass
           and con.confrelid = 'platform.currencies'::regclass
      )),
  0,
  'Toda columna `currency` de una tabla de platform tiene FK al catálogo'
);

select throws_ok(
  $$ insert into platform.market_currencies (market_id, currency_code)
     values (platform.market_id_by_code('PE'), 'COP') $$,
  '23514', null,
  'Una moneda inactiva del catálogo no puede admitirse en un mercado'
);

-- ---------------------------------------------------------------------------
-- RPCs de mantenimiento y autorización
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select throws_ok(
  $$ select platform.upsert_market('QA', 'Mercado QA', 'CO', 'BOB', array['USD']::char(3)[]) $$,
  '23514', null,
  'La moneda por defecto de un mercado debe estar entre las admitidas'
);

select lives_ok(
  $$ select platform.upsert_market('QA', 'Mercado QA', 'CO', 'USD', array['USD']::char(3)[]) $$,
  'EBIM_FINANCE da de alta un mercado con sus monedas admitidas'
);

select throws_ok(
  $$ select platform.upsert_currency('BOB', 'Boliviano', 2::smallint, 'Bs', 'INACTIVE') $$,
  '23514', null,
  'No se desactiva una moneda mientras un mercado la admite'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner admin
select throws_ok(
  $$ select platform.upsert_currency('EUR', 'Euro', 2::smallint) $$,
  '42501', null,
  'Un partner no mantiene el catálogo de monedas'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin
select throws_ok(
  $$ select platform.upsert_market('QB', 'Otro', 'CO', 'USD', array['USD']::char(3)[]) $$,
  '42501', null,
  'EBIM_PRODUCT_ADMIN no mantiene mercados: es catálogo financiero'
);

select pg_temp.act_as('10000000-0000-4000-a000-00000000000b');  -- tenant user
select ok(
  (select count(*) from platform.currencies) >= 3
    and (select count(*) from platform.markets) >= 3,
  'La lectura del catálogo es amplia: la necesitan los selectores de la UI'
);

select throws_ok(
  $$ insert into platform.currencies (code, name, decimals) values ('EUR', 'Euro', 2) $$,
  '42501', null,
  'Un autenticado no escribe el catálogo directamente por PostgREST'
);

select pg_temp.act_as_postgres();

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('currencies', 'markets', 'market_currencies')
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'authenticated no tiene INSERT/UPDATE/DELETE sobre el catálogo regional'
);

-- El invariante de la moneda por defecto es diferido (alta en dos inserts);
-- se fuerza aquí para comprobarlo dentro de la transacción de test.
set constraints platform.markets_currency_consistency_guard immediate;
select throws_ok(
  $$ insert into platform.markets (code, name, country_code, default_currency_code)
     values ('ZZ', 'Sin monedas', 'ZZ', 'PEN') $$,
  '23514', null,
  'Un mercado cuya moneda por defecto no está admitida no llega a existir'
);
set constraints all deferred;

select * from finish();
rollback;
