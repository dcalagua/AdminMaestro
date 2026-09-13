-- ============================================================================
-- V3 · Fase 03 — Sociedades regionales EBIM
-- ============================================================================
begin;
select plan(13);

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

select is(
  (select count(*)::int from platform.v_company_markets
    where organization_kind = 'PLATFORM'
      and (market_code, currency) in (('PE', 'PEN'), ('BO', 'BOB'), ('EC', 'USD'))),
  3,
  'EBIM Perú (PE/PEN), EBIM Bolivia (BO/BOB) y EBIM Ecuador (EC/USD) existen como sociedades'
);

select is(
  (select count(*)::int from platform.organizations where kind = 'PLATFORM'),
  1,
  'Las tres sociedades cuelgan de UNA sola organización EBIM, no de tres'
);

select is(
  (select m.code from platform.companies c join platform.markets m on m.id = c.market_id
    where c.name = 'Alpha Perú'),
  'PE',
  'Una sociedad PE/PEN existente queda asignada al mercado PE'
);

select is(
  (select market_id from platform.companies where name = 'Omega Colombia'),
  null,
  'Una sociedad CO/COP queda fuera del modelo regional sin inventarle mercado'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin

select lives_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'EBIM Perú USD', 'PE', null, 'USD') $$,
  'PE/USD está permitido: Perú admite dólares'
);

select throws_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'Bolivia en soles', 'BO', null, 'PEN') $$,
  '23514', null,
  'BO/PEN se rechaza: Bolivia no admite soles'
);

select throws_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'Ecuador en soles', 'EC', null, 'PEN') $$,
  '23514', null,
  'EC/PEN se rechaza: Ecuador opera solo en USD'
);

select throws_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'Sin datos', null, null, null) $$,
  '23502', null,
  'Sin mercado, país y moneda son obligatorios: ya no hay default PE/PEN'
);

select throws_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'País cruzado', 'PE', 'BO', 'PEN') $$,
  '23514', null,
  'El país de la sociedad no puede contradecir al mercado'
);

create temp table _co as
  select platform.upsert_company('30000000-0000-4000-a000-000000000001', 'EBIM Bolivia 2', 'BO') as id;
select is(
  (select c.currency::text from platform.companies c join _co on _co.id = c.id),
  'BOB',
  'Con mercado y sin moneda, la sociedad toma la moneda sugerida del mercado'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner admin Andina
select throws_ok(
  $$ select platform.upsert_company('30000000-0000-4000-a000-000000000001',
       'Intrusa', 'PE', null, 'PEN') $$,
  '42501', null,
  'Un partner no crea sociedades dentro de la organización EBIM'
);

select pg_temp.act_as_postgres();
select throws_ok(
  $$ insert into platform.companies (organization_id, name, market_id, country_code, currency)
     values ('30000000-0000-4000-a000-000000000002', 'Directa incoherente',
             platform.market_id_by_code('PE'), 'BO', 'BOB') $$,
  '23514', null,
  'Ni por inserción directa: país BO con mercado PE es incoherente'
);

select throws_ok(
  $$ update platform.companies set currency = 'BOB' where name = 'Alpha Perú' $$,
  '23514', null,
  'Cambiar la moneda de una sociedad PE a BOB se rechaza'
);

select * from finish();
rollback;
