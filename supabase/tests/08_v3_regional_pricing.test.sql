-- ============================================================================
-- V3 · Fase 04 — Pricing regional (G-04, G-05, G-06, G-07 parte DB, G-33)
-- ============================================================================
begin;
select plan(26);

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

-- Plan eSupplier Shared Standard: tarifa PE/USD 850 en el seed.
create or replace function pg_temp.plan() returns uuid language sql as
  $$ select '60000000-0000-4000-a000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select hasnt_function(
  'platform', 'current_plan_price',
  array['uuid', 'platform.charge_kind', 'platform.billing_interval', 'character', 'date'],
  'La firma V2 de current_plan_price SIN mercado ya no existe'
);

select is(
  (select count(*)::int from platform.v_plan_price_catalog where is_legacy),
  0,
  'El seed no deja tarifas legacy sin mercado'
);

-- ---------------------------------------------------------------------------
-- PE/USD ≠ EC/USD
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin

select lives_ok(
  $$ select platform.set_plan_price(pg_temp.plan(), 'EC', 'LICENSE', 'MONTHLY', 700, 'USD') $$,
  'EBIM_PRODUCT_ADMIN publica una tarifa EC/USD para un plan que ya tiene PE/USD'
);

select is(
  platform.current_plan_price(pg_temp.plan(), platform.market_id_by_code('PE'), 'LICENSE', 'MONTHLY', 'USD'),
  850.00::numeric,
  'La tarifa PE/USD sigue siendo 850'
);

select is(
  platform.current_plan_price(pg_temp.plan(), platform.market_id_by_code('EC'), 'LICENSE', 'MONTHLY', 'USD'),
  700.00::numeric,
  'La tarifa EC/USD es 700: misma moneda, distinto mercado, distinto precio'
);

-- EWM Shared Standard: tarifas USD en PE y EC, ninguna en BO (seed regional).
select is(
  platform.current_plan_price('60000000-0000-4000-a000-000000000005', platform.market_id_by_code('BO'), 'LICENSE', 'MONTHLY', 'USD'),
  null,
  'Bolivia no hereda la tarifa USD de Perú ni la de Ecuador: sin tarifa, NULL'
);

-- ---------------------------------------------------------------------------
-- Moneda no permitida por el mercado
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select platform.set_plan_price(pg_temp.plan(), 'EC', 'LICENSE', 'MONTHLY', 2600, 'PEN') $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'Una tarifa PEN en Ecuador se rechaza'
);

select throws_like(
  $$ select platform.set_plan_price(pg_temp.plan(), 'BO', 'LICENSE', 'MONTHLY', 2600, 'PEN') $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'Una tarifa PEN en Bolivia se rechaza'
);

select throws_like(
  $$ select platform.set_plan_price(pg_temp.plan(), null, 'LICENSE', 'MONTHLY', 850, 'USD') $$,
  'MERCADO_REQUERIDO%',
  'set_plan_price sin mercado se rechaza'
);

-- ---------------------------------------------------------------------------
-- Vigencias
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.set_plan_price(pg_temp.plan(), 'PE', 'LICENSE', 'MONTHLY', 900, 'USD', current_date + 30) $$,
  'Se programa una tarifa PE/USD 900 desde dentro de 30 días'
);

select is(
  platform.current_plan_price(pg_temp.plan(), platform.market_id_by_code('PE'), 'LICENSE', 'MONTHLY', 'USD'),
  850.00::numeric,
  'Hoy se sigue usando 850: una tarifa que aún no entra en vigencia no se usa'
);

select is(
  platform.current_plan_price(pg_temp.plan(), platform.market_id_by_code('PE'), 'LICENSE', 'MONTHLY', 'USD', current_date + 30),
  900.00::numeric,
  'Desde su fecha de inicio se usa la nueva tarifa'
);

select is(
  (select amount from platform.plan_prices
    where plan_id = pg_temp.plan() and market_id = platform.market_id_by_code('PE')
      and charge_kind = 'LICENSE' and valid_to = current_date + 29),
  850.00::numeric,
  'La tarifa anterior se CIERRA (valid_to), no se borra ni cambia de importe'
);

select throws_like(
  $$ select platform.set_plan_price(pg_temp.plan(), 'PE', 'LICENSE', 'MONTHLY', 950, 'USD', current_date + 10) $$,
  'VIGENCIA_INVALIDA%',
  'Una tarifa que empieza antes que la abierta se rechaza'
);

select pg_temp.act_as_postgres();

select throws_ok(
  $$ insert into platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, amount, currency, valid_from)
     values (pg_temp.plan(), platform.market_id_by_code('EC'), 'LICENSE', 'MONTHLY', 710, 'USD', current_date + 1) $$,
  '23505', null,
  'Dos tarifas abiertas para la misma combinación (plan+mercado+cargo+intervalo+moneda) se rechazan'
);

select throws_ok(
  $$ insert into platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, amount, currency, valid_from, valid_to)
     values (pg_temp.plan(), platform.market_id_by_code('PE'), 'LICENSE', 'MONTHLY', 800, 'USD',
             current_date - 5, current_date + 5) $$,
  '23P01', null,
  'Una vigencia cerrada que se solapa con otra de la misma combinación se rechaza (G-05)'
);

select throws_like(
  $$ insert into platform.plan_prices (plan_id, charge_kind, billing_interval, amount, currency)
     values (pg_temp.plan(), 'ADDON', 'MONTHLY', 10, 'USD') $$,
  'MERCADO_REQUERIDO%',
  'Una tarifa nueva sin mercado no se puede crear ni por inserción directa'
);

select throws_like(
  $$ update platform.plan_prices set amount = 1 where plan_id = pg_temp.plan() $$,
  'PRECIO_HISTORICO_INMUTABLE%',
  'El importe de una tarifa no se edita en sitio'
);

-- ---------------------------------------------------------------------------
-- Autorización y lectura (G-33)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner admin Andina

select throws_ok(
  $$ select platform.set_plan_price(pg_temp.plan(), 'PE', 'LICENSE', 'MONTHLY', 1, 'USD', current_date + 60) $$,
  '42501', null,
  'Un partner no fija tarifas'
);

select is(
  platform.current_plan_price('60000000-0000-4000-a000-000000000004', platform.market_id_by_code('PE'),
                              'LICENSE', 'MONTHLY', 'USD'),
  null,
  'Un partner no lee por RPC la tarifa de un plan que no contrata (G-33: RPC SECURITY INVOKER)'
);

-- ---------------------------------------------------------------------------
-- Onboarding regional
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin

select is(
  (select (r ->> 'license_amount')::numeric || ' ' || (r ->> 'currency') || ' ' || (r ->> 'market_code')
     from platform.onboard_customer_subscription(
       'esupplier', '30000000-0000-4000-a000-000000000004', 'v3-ec-alpha', 'Alpha Ecuador',
       'admin@alpha-ec.example.com', pg_temp.plan(), 'EC') r),
  '700.00 USD EC',
  'Onboarding en EC sin moneda usa USD (sugerida) y la tarifa de Ecuador, no la de Perú'
);

select is(
  (select m.code from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
     join platform.markets m on m.id = s.market_id where t.slug = 'v3-ec-alpha'),
  'EC',
  'La suscripción recuerda el mercado en que se vendió'
);

select throws_like(
  $$ select platform.onboard_customer_subscription(
       'ewm', '30000000-0000-4000-a000-000000000004', 'v3-bo-alpha', 'Alpha Bolivia',
       'admin@alpha-bo.example.com', '60000000-0000-4000-a000-000000000005', 'BO', 'MONTHLY', 'USD',
       p_license_amount => 500) $$,
  'TARIFA_REGIONAL_NO_DEFINIDA%',
  'Sin tarifa BO/USD la venta se rechaza AUNQUE se teclee un importe (G-07)'
);

select throws_like(
  $$ select platform.onboard_customer_subscription(
       'esupplier', '30000000-0000-4000-a000-000000000004', 'v3-bo-pen', 'Alpha Bolivia PEN',
       'admin@alpha-bo2.example.com', pg_temp.plan(), 'BO', 'MONTHLY', 'PEN') $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'Onboarding en Bolivia con PEN se rechaza'
);

select throws_like(
  $$ select platform.onboard_customer_subscription(
       'esupplier', '30000000-0000-4000-a000-000000000004', 'v3-sin-mercado', 'Sin mercado',
       'admin@sin-mercado.example.com', pg_temp.plan(), null) $$,
  'MERCADO_REQUERIDO%',
  'Onboarding sin mercado se rechaza: ya no hay USD por defecto'
);

select pg_temp.act_as_postgres();

select throws_like(
  $$ update platform.subscriptions set market_id = platform.market_id_by_code('PE')
      where code = (select s.code from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
                     where t.slug = 'v3-ec-alpha') $$,
  'MERCADO_INMUTABLE%',
  'El mercado de un contrato no se cambia después de venderlo'
);

select * from finish();
rollback;
