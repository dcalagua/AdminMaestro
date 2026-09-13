-- ============================================================================
-- V3 · Fase 11 — Comisiones multimoneda (G-23..G-26). Fechas 2031, datos QA.
-- ============================================================================
begin;
select plan(20);

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

-- Carla (comercial independiente) y su plan: 10% de licencia cobrada.
create or replace function pg_temp.carla() returns uuid language sql as
  $$ select '80000000-0000-4000-a000-000000000001'::uuid $$;

select hasnt_function(
  'platform', 'settle_commissions', array['uuid', 'date', 'date'],
  'Ya no existe una liquidación que asuma USD cuando no se indica moneda'
);

-- ---------------------------------------------------------------------------
-- Fixture: reglas en moneda propia + contratos BOB y PEN atribuidos a Carla.
-- ---------------------------------------------------------------------------
insert into platform.commission_rules (commission_plan_id, name, basis, fixed_amount, currency, is_recurring, priority, valid_from)
values ('90000000-0000-4000-a000-000000000001', 'QA bono fijo USD 50', 'FIXED_AMOUNT', 50, 'USD', true, 90, '2030-01-01'),
       ('90000000-0000-4000-a000-000000000001', 'QA bono fijo PEN 30', 'FIXED_AMOUNT', 30, 'PEN', true, 91, '2030-01-01');
insert into platform.commission_rules (commission_plan_id, name, basis, rate, currency, is_recurring, max_total_amount, priority, valid_from)
values ('90000000-0000-4000-a000-000000000001', 'QA 2% con tope USD 5', 'COLLECTED_ANY', 0.02, 'USD', true, 5, 92, '2030-01-01');

insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id, billing_interval, currency)
values ('7a200000-0000-4000-a000-000000000001', 'SUB-QA-COM-BOB', '30000000-0000-4000-a000-000000000004',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('BO'), 'MONTHLY', 'BOB'),
       ('7a200000-0000-4000-a000-000000000002', 'SUB-QA-COM-PEN', '30000000-0000-4000-a000-000000000004',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), 'MONTHLY', 'PEN');

insert into platform.sales_attributions (sales_agent_id, saas_product_id, subscription_id, customer_organization_id,
                                         attribution_pct, commission_plan_id, valid_from)
values (pg_temp.carla(), '20000000-0000-4000-a000-000000000001', '7a200000-0000-4000-a000-000000000001',
        '30000000-0000-4000-a000-000000000004', 1, '90000000-0000-4000-a000-000000000001', '2031-01-01'),
       (pg_temp.carla(), '20000000-0000-4000-a000-000000000001', '7a200000-0000-4000-a000-000000000002',
        '30000000-0000-4000-a000-000000000004', 1, '90000000-0000-4000-a000-000000000001', '2031-01-01');

insert into platform.invoices (id, number, customer_organization_id, subscription_id, status, issue_date)
values ('7b200000-0000-4000-a000-000000000001', 'INV-QA-COM-BOB', '30000000-0000-4000-a000-000000000004', '7a200000-0000-4000-a000-000000000001', 'ISSUED', '2031-05-01'),
       ('7b200000-0000-4000-a000-000000000002', 'INV-QA-COM-PEN', '30000000-0000-4000-a000-000000000004', '7a200000-0000-4000-a000-000000000002', 'ISSUED', '2031-05-01');

insert into platform.invoice_lines (invoice_id, charge_kind, description, saas_product_id, unit_amount)
values ('7b200000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia BOB', '20000000-0000-4000-a000-000000000001', 1000),
       ('7b200000-0000-4000-a000-000000000002', 'LICENSE', 'Licencia PEN', '20000000-0000-4000-a000-000000000001', 2000);

-- Confirmar los cobros dispara el devengo (trigger del baseline).
insert into platform.payments (id, invoice_id, reference, status, amount, paid_at)
values ('7f200000-0000-4000-a000-000000000001', '7b200000-0000-4000-a000-000000000001', 'PAY-QA-COM-BOB', 'CONFIRMED', 1000, '2031-05-15'),
       ('7f200000-0000-4000-a000-000000000002', '7b200000-0000-4000-a000-000000000002', 'PAY-QA-COM-PEN', 'CONFIRMED', 2000, '2031-05-15');

create or replace function pg_temp.events(p_payment uuid) returns text language sql as $$
  select coalesce(string_agg(r.name || '=' || e.currency || ' ' || e.amount || ' (base ' || e.base_amount || ')', ' | ' order by r.name), '—')
    from platform.commission_events e join platform.commission_rules r on r.id = e.commission_rule_id
   where e.payment_id = p_payment
$$;

-- ---------------------------------------------------------------------------
-- Devengo en moneda de origen
-- ---------------------------------------------------------------------------
select is(
  pg_temp.events('7f200000-0000-4000-a000-000000000001'),
  '10% licencia cobrada (12 meses)=BOB 100.00 (base 1000.00)',
  'Cobro BOB: 10% sobre el importe ORIGINAL en BOB; ni el fijo USD/PEN ni la regla con tope USD aplican'
);

select is(
  pg_temp.events('7f200000-0000-4000-a000-000000000002'),
  '10% licencia cobrada (12 meses)=PEN 200.00 (base 2000.00) | QA bono fijo PEN 30=PEN 30.00 (base 2000.00)',
  'Cobro PEN: 10% en PEN y el bono fijo PEN 30; el bono USD 50 NO se registra como «PEN 50»'
);

select is(
  (select count(*)::int from platform.commission_events e
     join platform.commission_rules r on r.id = e.commission_rule_id
    where r.name in ('QA bono fijo USD 50', 'QA 2% con tope USD 5')
      and e.payment_id in ('7f200000-0000-4000-a000-000000000001', '7f200000-0000-4000-a000-000000000002')),
  0,
  'Importes fijos y topes en USD no se aplican a cobros en otra moneda (G-25)'
);

-- ---------------------------------------------------------------------------
-- Liquidación mono-moneda
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select throws_like(
  $$ select platform.settle_commissions(pg_temp.carla(), '2031-05-01', '2031-05-31', null) $$,
  'MONEDA_REQUERIDA%',
  'Liquidar sin moneda se rechaza (G-26)'
);

select lives_ok(
  $$ select platform.settle_commissions(pg_temp.carla(), '2031-05-01', '2031-05-31', 'USD') $$,
  'Liquidación USD de mayo'
);

select is(
  (select count(*)::int from platform.commission_events e
     join platform.commission_settlements s on s.id = e.settlement_id
    where s.code = 'STL-carla-independiente-203105-USD'),
  0,
  'La liquidación USD NO toma eventos BOB ni PEN'
);

select lives_ok(
  $$ select platform.settle_commissions(pg_temp.carla(), '2031-05-01', '2031-05-31', 'BOB') $$,
  'Liquidación BOB de mayo'
);

select is(
  (select string_agg(distinct e.currency, ',') || ' ' || count(*) from platform.commission_events e
     join platform.commission_settlements s on s.id = e.settlement_id
    where s.code = 'STL-carla-independiente-203105-BOB'),
  'BOB 1',
  'La liquidación BOB solo contiene el evento BOB: no toma PEN'
);

select lives_ok(
  $$ select platform.settle_commissions(pg_temp.carla(), '2031-05-01', '2031-05-31', 'PEN') $$,
  'Liquidación PEN del mismo mes'
);

select is(
  (select string_agg(s.code || ':' || s.currency || ':' || s.total_amount, ' ' order by s.code)
     from platform.commission_settlements s where s.code like 'STL-carla-independiente-203105-%'),
  'STL-carla-independiente-203105-BOB:BOB:100.00 STL-carla-independiente-203105-PEN:PEN:230.00 STL-carla-independiente-203105-USD:USD:0.00',
  'R-4: BOB y PEN del mismo mes son liquidaciones distintas; ninguna reutiliza la otra'
);

select pg_temp.act_as_postgres();

select throws_like(
  $$ update platform.commission_events set settlement_id =
       (select id from platform.commission_settlements where code = 'STL-carla-independiente-203105-BOB')
      where payment_id = '7f200000-0000-4000-a000-000000000002' $$,
  'LIQUIDACION_MULTIMONEDA%',
  'Liquidación con monedas mezcladas: DENIED (G-24)'
);

select throws_like(
  $$ update platform.commission_settlements set currency = 'USD'
      where code = 'STL-carla-independiente-203105-BOB' $$,
  'MONEDA_DOCUMENTO_INMUTABLE%',
  'La moneda de una liquidación con eventos no se cambia'
);

update platform.commission_settlements
   set status = 'PAID', approved_at = now(), paid_at = now(), payment_reference = 'TRF-QA-BOB'
 where code = 'STL-carla-independiente-203105-BOB';

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select throws_like(
  $$ select platform.settle_commissions(pg_temp.carla(), '2031-05-01', '2031-05-31', 'BOB') $$,
  'LIQUIDACION_CERRADA%',
  'Una liquidación PAGADA no recibe eventos nuevos (V2 la reabría por on conflict)'
);

-- ---------------------------------------------------------------------------
-- Reverso en la misma moneda
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.reverse_payment('7f200000-0000-4000-a000-000000000001', 'Contracargo QA') $$,
  'Finanzas revierte el cobro BOB'
);

select is(
  (select string_agg(currency || ' ' || amount, ',') from platform.commission_events
    where payment_id = '7f200000-0000-4000-a000-000000000001' and reversal_of_event_id is not null),
  'BOB -100.00',
  'El contra-evento conserva la moneda BOB del evento que compensa'
);

select lives_ok(
  $$ select platform.settle_commissions(pg_temp.carla(), current_date, current_date, 'BOB') $$,
  'El reverso BOB (devengado hoy) se liquida en una liquidación BOB posterior'
);

select is(
  (select s.currency || ' ' || s.total_amount from platform.commission_events e
     join platform.commission_settlements s on s.id = e.settlement_id
    where e.payment_id = '7f200000-0000-4000-a000-000000000001' and e.reversal_of_event_id is not null),
  'BOB -100.00',
  'El reverso netea dentro de su moneda'
);

-- ---------------------------------------------------------------------------
-- Reglas sin USD por defecto
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select platform.upsert_commission_rule('90000000-0000-4000-a000-000000000001', 'Sin moneda', 'COLLECTED_ANY', 0.01) $$,
  'MONEDA_REQUERIDA%',
  'Una regla de comisión ya no asume USD'
);

select lives_ok(
  $$ select platform.upsert_commission_rule('90000000-0000-4000-a000-000000000001', 'QA fijo BOB', 'FIXED_AMOUNT',
       p_fixed_amount => 40, p_currency => 'BOB') $$,
  'Una regla con moneda explícita se crea'
);

select * from finish();
rollback;
