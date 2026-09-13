-- ============================================================================
-- V3 · Fase 06 — Moneda transaccional (G-09..G-15) y regresión de cobro
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

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'platform' and column_name = 'currency' and column_default is not null
      and table_name <> 'payment_provider_accounts'
      and table_name in (select table_name from information_schema.tables
                          where table_schema = 'platform' and table_type = 'BASE TABLE')),
  0,
  'Ninguna columna `currency` de un documento conserva un default (USD/PEN implícito)'
);

select is(
  (select count(*)::int from platform.v_currency_integrity_issues),
  0,
  'El seed no tiene ninguna fila con moneda distinta a la de su padre'
);

-- ---------------------------------------------------------------------------
-- Fixture: contrato BOB en Bolivia, factura PEN suelta.
-- ---------------------------------------------------------------------------
insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id,
                                    billing_interval, currency)
values ('7a000000-0000-4000-a000-000000000001', 'SUB-QA-BOB', '30000000-0000-4000-a000-000000000004',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
        platform.market_id_by_code('BO'), 'MONTHLY', 'BOB');

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date)
values ('7b000000-0000-4000-a000-000000000001', 'INV-QA-PEN', '30000000-0000-4000-a000-000000000004',
        'ISSUED', 'PEN', current_date);

-- ---------------------------------------------------------------------------
-- Cadena de moneda
-- ---------------------------------------------------------------------------
select throws_like(
  $$ insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount, currency)
     values ('7a000000-0000-4000-a000-000000000001', 'LICENSE', 'Línea USD', 100, 'USD') $$,
  'MONEDA_INCOHERENTE%',
  'Suscripción BOB + línea USD: DENIED'
);

insert into platform.subscription_items (id, subscription_id, charge_kind, description, unit_amount)
values ('7c000000-0000-4000-a000-000000000001', '7a000000-0000-4000-a000-000000000001', 'LICENSE',
        'Línea sin moneda', 5900);

select is(
  (select currency::text from platform.subscription_items where id = '7c000000-0000-4000-a000-000000000001'),
  'BOB',
  'Una línea sin moneda hereda la del contrato (BOB), no un USD por defecto'
);

select throws_like(
  $$ insert into platform.invoices (number, customer_organization_id, subscription_id, status, currency)
     values ('INV-QA-SUB-PEN', '30000000-0000-4000-a000-000000000004',
             '7a000000-0000-4000-a000-000000000001', 'DRAFT', 'PEN') $$,
  'MONEDA_INCOHERENTE%',
  'Factura PEN sobre un contrato BOB: DENIED'
);

insert into platform.invoices (number, customer_organization_id, subscription_id, status)
values ('INV-QA-SUB-HEREDA', '30000000-0000-4000-a000-000000000004',
        '7a000000-0000-4000-a000-000000000001', 'DRAFT');

select is(
  (select currency::text from platform.invoices where number = 'INV-QA-SUB-HEREDA'),
  'BOB',
  'Una factura de un contrato hereda su moneda'
);

select throws_like(
  $$ insert into platform.invoice_lines (invoice_id, charge_kind, description, unit_amount, currency)
     values ('7b000000-0000-4000-a000-000000000001', 'LICENSE', 'Línea USD', 10, 'USD') $$,
  'MONEDA_INCOHERENTE%',
  'Factura PEN + línea USD: DENIED (recalc_invoice_totals no suma monedas)'
);

select throws_like(
  $$ insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
     values ('7b000000-0000-4000-a000-000000000001', 'PAY-QA-USD', 'CONFIRMED', 10, 'USD', now()) $$,
  'MONEDA_INCOHERENTE%',
  'Factura PEN + pago USD: DENIED'
);

select throws_like(
  $$ update platform.commission_events set currency = 'PEN'
      where id = (select id from platform.commission_events where currency = 'USD' limit 1) $$,
  'MONEDA_INCOHERENTE%',
  'Un evento de comisión no puede quedar en una moneda distinta a la de su cobro'
);

select throws_ok(
  $$ insert into platform.subscriptions (code, billed_organization_id, saas_product_id, plan_id, billing_interval)
     values ('SUB-QA-SIN-MONEDA', '30000000-0000-4000-a000-000000000004',
             '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', 'MONTHLY') $$,
  '23502', null,
  'Un contrato sin moneda ya no nace en USD: NOT NULL sin default lo rechaza'
);

select throws_ok(
  $$ insert into platform.cost_entries (category, description, amount, period_start, period_end)
     values ('ADMIN_MANUAL', 'Costo sin moneda', 10, current_date, current_date) $$,
  '23502', null,
  'Un costo sin moneda se rechaza (los costos pueden estar en otra moneda, pero explícita)'
);

select lives_ok(
  $$ insert into platform.cost_entries (category, description, amount, currency, period_start, period_end)
     values ('ADMIN_MANUAL', 'Costo USD sobre producto que cobra BOB', 10, 'USD', current_date, current_date) $$,
  'Un costo en USD es legítimo aunque el ingreso sea BOB: no pertenece a la cadena del contrato'
);

-- ---------------------------------------------------------------------------
-- Inmutabilidad (T-6)
-- ---------------------------------------------------------------------------
select throws_like(
  $$ update platform.subscriptions set currency = 'PEN' where code = 'SUB-ALPHA-ESUP' $$,
  'MONEDA_CONTRACTUAL_INMUTABLE%',
  'La moneda de un contrato con líneas y facturas no se cambia'
);

select throws_like(
  $$ update platform.invoices set currency = 'PEN' where number = 'INV-VOID-0001' $$,
  'MONEDA_DOCUMENTO_INMUTABLE%',
  'La moneda de una factura (suelta) con líneas no se cambia'
);

select throws_ok(
  $$ update platform.payments set currency = 'PEN'
      where id = (select payment_id from platform.commission_events limit 1) $$,
  '23514', null,
  'La moneda de un cobro con comisiones no se cambia'
);

insert into platform.subscriptions (code, billed_organization_id, saas_product_id, plan_id, market_id,
                                    billing_interval, currency)
values ('SUB-QA-BORRADOR', '30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001',
        '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('BO'), 'MONTHLY', 'BOB');

select lives_ok(
  $$ update platform.subscriptions set currency = 'USD' where code = 'SUB-QA-BORRADOR' $$,
  'Un borrador SIN líneas ni facturas puede corregir su moneda (a otra admitida por el mercado)'
);

-- ---------------------------------------------------------------------------
-- RPCs: una moneda explícita distinta se rechaza (G-15)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin

select throws_like(
  $$ select platform.upsert_subscription_item(
       '70000000-0000-4000-a000-000000000001', 'ADDON', 'Addon en PEN', 1, 100, 'MONTHLY', 'PEN') $$,
  'MONEDA_INCOHERENTE%',
  'upsert_subscription_item con PEN sobre un contrato USD: DENIED'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       '70000000-0000-4000-a000-000000000001', 'BANK_TRANSFER', p_currency => 'PEN') $$,
  'MONEDA_INCOHERENTE%',
  'set_subscription_collection_profile con PEN sobre un contrato USD: DENIED'
);

select throws_like(
  $$ select platform.request_commercial_document(
       '70000000-0000-4000-a000-000000000001', 'PURCHASE_ORDER', p_amount => 100, p_currency => 'PEN') $$,
  'MONEDA_INCOHERENTE%',
  'request_commercial_document con PEN sobre un contrato USD: DENIED'
);

select throws_like(
  $$ select platform.upsert_catalog_item('addon_qa_sin_moneda', 'Addon QA', p_price_month => 10) $$,
  'MONEDA_REQUERIDA%',
  'upsert_catalog_item ya no asume USD'
);

-- ---------------------------------------------------------------------------
-- Regresión de cobro: manual y de pasarela siguen funcionando.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select lives_ok(
  $$ select platform.confirm_manual_payment(
       (select i.id from platform.invoices i
          join platform.sales_attributions a on a.subscription_id = i.subscription_id and a.status = 'ACTIVE'
         where i.status in ('ISSUED', 'PARTIALLY_PAID') order by i.number limit 1),
       50, 'REF-QA-V3-06', 'BANK_TRANSFER', now()) $$,
  'El cobro manual sigue operativo con los guards de moneda'
);

select pg_temp.act_as_postgres();

select is(
  (select p.currency::text || '=' || i.currency::text from platform.payments p
     join platform.invoices i on i.id = p.invoice_id where p.reference = 'REF-QA-V3-06'),
  'USD=USD',
  'El cobro manual toma la moneda de su factura'
);

select is(
  (select count(*)::int from platform.commission_events e
     join platform.payments p on p.id = e.payment_id
    where p.reference = 'REF-QA-V3-06' and e.currency <> p.currency),
  0,
  'Las comisiones devengadas por ese cobro están en la moneda del cobro'
);

select is(
  (select r ->> 'error' from platform.register_provider_payment(
     (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
     'evt_qa_v3_moneda', 'charge.succeeded', 'chr_qa_v3_moneda',
     'sxn_mock_grupasa01', 100, 'BOB') r),
  'MONEDA_INCOHERENTE',
  'Culqi: un cobro de pasarela en moneda distinta al contrato se rechaza (regresión V2.1)'
);

select * from finish();
rollback;
