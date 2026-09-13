-- ============================================================================
-- V3 · Fase 08 — Motor FX para reporting (G-17)
-- Fechas fijas y tasas QA: no son cotizaciones reales.
-- ============================================================================
begin;
select plan(24);

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

create or replace function pg_temp.fx(p_base text, p_quote text, p_as_of date, p_age int default 0)
returns text language sql as $$
  select l.status || coalesce(':' || l.rate::text, '')
    from platform.fx_rate_lookup(p_base::char(3), p_quote::char(3), p_as_of, p_age) l
$$;

-- ---------------------------------------------------------------------------
-- Publicación (finanzas)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select lives_ok(
  $$ select platform.set_exchange_rate('2031-01-15', 'USD', 'PEN', 3.75, 'QA fase 08');
     select platform.set_exchange_rate('2031-01-15', 'USD', 'BOB', 6.96, 'QA fase 08') $$,
  'EBIM_FINANCE publica tasas MANUAL USD/PEN y USD/BOB'
);

select is(
  (select source::text || '/' || status::text from platform.exchange_rates
    where rate_date = '2031-01-15' and base_currency = 'USD' and quote_currency = 'PEN'),
  'MANUAL/ACTIVE',
  'La fuente inicial es MANUAL'
);

-- ---------------------------------------------------------------------------
-- Búsqueda
-- ---------------------------------------------------------------------------
select is(pg_temp.fx('USD', 'PEN', '2031-01-15'), 'DIRECT:3.7500000000',
  'Tasa directa válida: 1 USD = 3.75 PEN');

select is(pg_temp.fx('PEN', 'USD', '2031-01-15'), 'RECIPROCAL:0.2666666667',
  'Recíproca documentada: 1 PEN = 1/3.75 USD');

select is(pg_temp.fx('USD', 'USD', '2031-01-15'), 'IDENTITY:1',
  'Misma moneda: identidad, sin tasa');

select is(pg_temp.fx('BOB', 'PEN', '2031-01-15'), 'MISSING',
  'Sin tasa BOB/PEN no se triangula por USD de forma implícita');

select is(pg_temp.fx('USD', 'PEN', '2031-01-16'), 'MISSING',
  'Con antigüedad 0 solo vale la fecha exacta: no se inventa la del día siguiente');

select is(pg_temp.fx('USD', 'PEN', '2031-01-20', 5), 'DIRECT:3.7500000000',
  'Con una tolerancia declarada de 5 días se usa la última tasa dentro de la ventana');

select is(pg_temp.fx('USD', 'PEN', '2031-01-21', 5), 'MISSING',
  'Fuera de la ventana declarada la tasa ya no se usa');

select is(pg_temp.fx('USD', 'PEN', '2031-01-14', 30), 'MISSING',
  'Una tasa posterior a la fecha consultada nunca se usa');

-- ---------------------------------------------------------------------------
-- Conversión
-- ---------------------------------------------------------------------------
select is(
  (select c.status || ':' || c.amount::text from platform.fx_convert(5000, 'PEN', 'USD', '2031-01-15') c),
  'RECIPROCAL:1333.33',
  'PEN 5000 ≈ USD 1333.33, redondeado a los decimales ISO del USD'
);

select is(
  (select c.status || ':' || coalesce(c.amount::text, 'NULL') from platform.fx_convert(890, 'BOB', 'PEN', '2031-01-15') c),
  'MISSING:NULL',
  'Sin tasa la conversión devuelve NULL con estado MISSING, nunca 0'
);

-- ---------------------------------------------------------------------------
-- Validaciones
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select platform.set_exchange_rate('2031-01-15', 'USD', 'PEN', 0) $$,
  'TASA_INVALIDA%',
  'FX rate = 0: DENIED'
);

select throws_like(
  $$ select platform.set_exchange_rate('2031-01-15', 'USD', 'PEN', -3.75) $$,
  'TASA_INVALIDA%',
  'FX rate negativo: DENIED'
);

select throws_like(
  $$ select platform.set_exchange_rate('2031-01-15', 'USD', 'USD', 1) $$,
  'PAR_INVALIDO%',
  'Base = cotizada: DENIED'
);

-- ---------------------------------------------------------------------------
-- Sustitución, anulación e inmutabilidad
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.set_exchange_rate('2031-01-15', 'USD', 'PEN', 3.80, 'Corrección QA') $$,
  'Republicar la misma fecha con otro valor sustituye la tasa'
);

select is(
  (select string_agg(rate::text || '=' || status::text, ',' order by rate)
     from platform.exchange_rates
    where rate_date = '2031-01-15' and base_currency = 'USD' and quote_currency = 'PEN')
  || ' ' || pg_temp.fx('USD', 'PEN', '2031-01-15'),
  '3.7500000000=SUPERSEDED,3.8000000000=ACTIVE DIRECT:3.8000000000',
  'La tasa anterior queda SUPERSEDED (historia conservada) y la búsqueda usa la nueva'
);

select lives_ok(
  $$ select platform.void_exchange_rate(
       (select id from platform.exchange_rates where rate_date = '2031-01-15'
           and base_currency = 'USD' and quote_currency = 'BOB' and status = 'ACTIVE'),
       'Cargada por error en QA') $$,
  'Finanzas anula una tasa con motivo'
);

select is(pg_temp.fx('BOB', 'USD', '2031-01-15'), 'MISSING',
  'Una tasa anulada deja de usarse');

select pg_temp.act_as_postgres();

select throws_like(
  $$ update platform.exchange_rates set rate = 9 where rate_date = '2031-01-15' and status = 'ACTIVE' $$,
  'TIPO_CAMBIO_INMUTABLE%',
  'El valor de una tasa no se edita en sitio'
);

select throws_ok(
  $$ insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate)
     values ('2031-01-15', 'USD', 'PEN', 4) $$,
  '23505', null,
  'Dos tasas ACTIVE para la misma fecha, par y fuente: DENIED'
);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin
select throws_ok(
  $$ select platform.set_exchange_rate('2031-02-01', 'USD', 'PEN', 3.7) $$,
  '42501', null,
  'EBIM_PRODUCT_ADMIN no publica tipos de cambio'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner admin
select throws_ok(
  $$ select platform.set_exchange_rate('2031-02-01', 'USD', 'PEN', 3.7) $$,
  '42501', null,
  'Un partner no manipula tipos de cambio'
);

select is(
  pg_temp.fx('USD', 'PEN', '2031-01-15'),
  'MISSING',
  'Un partner no lee tasas: la búsqueda le devuelve MISSING, no una conversión'
);

select * from finish();
rollback;
