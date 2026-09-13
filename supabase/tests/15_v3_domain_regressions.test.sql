-- ============================================================================
-- V3 · Fase 15 — Regresiones de dominio multicurrency
-- ----------------------------------------------------------------------------
-- Una prueba por regla mínima de `15_DOMAIN_TESTS.md`, con el MISMO nombre, para
-- que un fallo señale la regla rota. Corre sobre el seed regional (fase 14):
-- contratos PE/PEN, BO/BOB, BO/USD, EC/USD y tasas DEMO del 2026-09-01.
-- Las fases 04-11 prueban cada mecanismo en detalle; este archivo es el contrato.
-- ============================================================================
begin;
select plan(16);

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

select set_config('ebim.native_snapshot',
  (select md5(string_agg(id::text || ':' || total || ':' || currency, ',' order by id)) from platform.invoices)
  || '|' ||
  (select md5(string_agg(id::text || ':' || amount || ':' || currency, ',' order by id)) from platform.payments)
  || '|' ||
  (select md5(string_agg(id::text || ':' || amount || ':' || currency, ',' order by id)) from platform.commission_events),
  true);

-- Totales nativos calculados DIRECTAMENTE de las tablas, sin las vistas de reporte.
create temp table qa_collected_native as
select i.currency, round(sum(round(l.amount * (p.amount / nullif(i.total, 0)), 2)), 2) as amount
  from platform.invoices i
  join platform.invoice_lines l on l.invoice_id = i.id
  join platform.payments p on p.invoice_id = i.id
 where p.status = 'CONFIRMED' and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID') and i.total > 0
 group by i.currency;
-- Fixture de test: la leen también las comprobaciones que corren como finanzas.
grant select on qa_collected_native to authenticated;

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

-- ---------------------------------------------------------------------------
-- 1-2. No se suman monedas distintas
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_object_keys_count from (
     select count(*)::int as jsonb_object_keys_count
       from jsonb_object_keys(platform.finance_consolidated(p_as_of => '2026-09-01') -> 'groups' -> 0 -> 'metrics' -> 'COLLECTED' -> 'native')
      where jsonb_object_keys in ('PEN', 'USD')) x),
  2,
  'PEN + USD no se suma directamente: el cobrado nativo trae PEN y USD por separado'
);

select ok(
  (select (platform.finance_consolidated(p_as_of => '2026-09-01', p_market_code => 'BO') -> 'groups' -> 0 -> 'metrics' -> 'COLLECTED' -> 'native')
          ?& array['BOB', 'USD'])
  and not exists (
    select 1 from jsonb_each_text(platform.finance_consolidated(p_as_of => '2026-09-01', p_market_code => 'BO') -> 'groups' -> 0 -> 'metrics' -> 'COLLECTED' -> 'native') e
     where e.value::numeric = (select sum(amount) from qa_collected_native where currency in ('BOB', 'USD'))
  ),
  'BOB + USD no se suma directamente: Bolivia reporta BOB y USD como importes separados'
);

-- ---------------------------------------------------------------------------
-- 3-5. Coherencia transaccional
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date)
values ('7e900000-0000-4000-a000-000000000001', 'INV-QA-REG-PEN', '30000000-0000-4000-a000-00000000000c', 'ISSUED', 'PEN', current_date);

select throws_like(
  $$ insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
     values ('7e900000-0000-4000-a000-000000000001', 'PAY-QA-REG-USD', 'CONFIRMED', 100, 'USD', now()) $$,
  'MONEDA_INCOHERENTE%',
  'invoice PEN + payment USD -> DENIED'
);

select throws_like(
  $$ insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount, currency)
     values ((select id from platform.subscriptions where code = 'SUB-V3-BO-BOB-ILLIMANI'),
             'ADDON', 'Addon en USD', 50, 'USD') $$,
  'MONEDA_INCOHERENTE%',
  'subscription BOB + item USD -> DENIED'
);

select throws_like(
  $$ update platform.commission_events
        set settlement_id = (select id from platform.commission_settlements where currency = 'USD' limit 1)
      where id = (select id from platform.commission_events where currency = 'BOB' limit 1) $$,
  'LIQUIDACION_MULTIMONEDA%',
  'settlement con currencies mixtas -> DENIED'
);

-- ---------------------------------------------------------------------------
-- 6-7. Pricing y mercado
-- ---------------------------------------------------------------------------
select isnt(
  platform.current_plan_price('60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), 'LICENSE', 'MONTHLY', 'USD'),
  platform.current_plan_price('60000000-0000-4000-a000-000000000001', platform.market_id_by_code('EC'), 'LICENSE', 'MONTHLY', 'USD'),
  'PE/USD price puede diferir de EC/USD'
);

select throws_like(
  $$ insert into platform.subscriptions (code, billed_organization_id, saas_product_id, plan_id, market_id, billing_interval, currency)
     values ('SUB-QA-REG-EC-PEN', '30000000-0000-4000-a000-00000000000f', '20000000-0000-4000-a000-000000000001',
             '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('EC'), 'MONTHLY', 'PEN') $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'currency no permitida por market -> DENIED'
);

-- ---------------------------------------------------------------------------
-- 8-9. FX
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select is(
  (select r.conversion_status || ':' || coalesce(r.reporting_amount::text, 'NULL')
     from platform.to_reporting_amount(5900, 'BOB', '2020-01-01') r),
  'MISSING_FX:NULL',
  'FX faltante -> no conversion inventada'
);

select throws_like(
  $$ select platform.set_exchange_rate('2026-09-02', 'USD', 'BOB', 0) $$,
  'TASA_INVALIDA%',
  'FX rate <= 0 -> DENIED'
);

select pg_temp.act_as_postgres();
select throws_ok(
  $$ insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate)
     values ('2026-09-02', 'USD', 'BOB', -7) $$,
  '23514', null,
  'FX rate <= 0 -> DENIED también por inserción directa (CHECK)'
);

-- ---------------------------------------------------------------------------
-- 10. El valor nativo no cambia tras convertir
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok(
  $$ select platform.finance_consolidated(p_as_of => '2026-09-01', p_group_by => g)
       from unnest(array['TOTAL', 'MARKET', 'PRODUCT', 'PARTNER']) g;
     select platform.set_reporting_settings('PEN');
     select platform.finance_consolidated(p_as_of => '2026-09-01');
     select platform.set_reporting_settings('USD') $$,
  'Se consolida en USD y en PEN, con todos los agrupados'
);

select pg_temp.act_as_postgres();
select is(
  (select md5(string_agg(id::text || ':' || total || ':' || currency, ',' order by id)) from platform.invoices
    where number <> 'INV-QA-REG-PEN')
  || '|' ||
  (select md5(string_agg(id::text || ':' || amount || ':' || currency, ',' order by id)) from platform.payments)
  || '|' ||
  (select md5(string_agg(id::text || ':' || amount || ':' || currency, ',' order by id)) from platform.commission_events),
  current_setting('ebim.native_snapshot'),
  'native amount no cambia tras reporting conversion (facturas, cobros y comisiones idénticos)'
);

-- ---------------------------------------------------------------------------
-- 11. Routing
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin
select throws_like(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-V3-BO-BOB-ILLIMANI'),
       'CULQI_CARD', (select id from platform.payment_provider_accounts where code = 'culqi-pe-test')) $$,
  'CUENTA_PROVEEDOR_OTRO_MERCADO%',
  'provider account incompatible -> DENIED (cuenta PE/PEN sobre contrato BO/BOB)'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-V3-EC-USD-GUAYAS'),
       'CULQI_CARD', (select id from platform.payment_provider_accounts where code = 'banco-ec-demo')) $$,
  'PROVEEDOR_INCOMPATIBLE%',
  'provider account incompatible -> DENIED (cuenta bancaria para tarjeta)'
);

-- ---------------------------------------------------------------------------
-- 12. Totales de reporting correctos con FX disponible
--
-- Cálculo independiente: cobrado nativo por moneda desde las tablas base,
-- convertido con las tasas DEMO del seed (1 USD = 3.50 PEN = 7.00 BOB) y
-- redondeado por moneda antes de sumar, igual que la regla documentada.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');

select is(
  (platform.finance_consolidated(p_as_of => '2026-09-01') -> 'groups' -> 0 -> 'metrics' -> 'COLLECTED' ->> 'reporting_amount')::numeric,
  (select round(sum(case currency
                      when 'USD' then amount
                      when 'PEN' then round(amount * round(1 / 3.5, 10), 2)
                      when 'BOB' then round(amount * round(1 / 7.0, 10), 2)
                    end), 2)
     from qa_collected_native),
  'reporting totals correctos con FX disponible (cobrado USD recalculado de forma independiente)'
);

select is(
  (platform.finance_consolidated(p_as_of => '2026-09-01') -> 'completeness' ->> 'complete'),
  'true',
  'Con las tasas DEMO del 2026-09-01 el consolidado del seed está completo'
);

select * from finish();
rollback;
