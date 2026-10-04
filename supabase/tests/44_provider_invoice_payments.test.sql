-- ============================================================================
-- M1 · register_provider_invoice_payment (migración 20261010000200)
-- ----------------------------------------------------------------------------
-- Spec §2.2. Un cargo de pasarela imputado a una FACTURA:
--   · solo lo afirma el servidor (ni finanzas ni el super admin);
--   · idempotente por reference 'culqi:'||chr → {duplicate:true}, un solo pago;
--   · moneda = factura, factura emitida, sin sobrecobro, cuenta que la cobra;
--   · comisiones por el trigger existente, una sola vez; auditoría.
-- ============================================================================
begin;
select plan(34);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;
create or replace function pg_temp.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;
create or replace function pg_temp.manual_acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'ebim-manual' $$;
create or replace function pg_temp.foreign_acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-grupasa-qa44' $$;

-- Factura abierta de Alpha · eSupplier (perfil CULQI_CARD en el seed, con comisión).
create temp table qa as
select i.id as inv, i.number, i.total, i.currency
  from platform.invoices i
  join platform.subscriptions s on s.id = i.subscription_id
 where s.code = 'SUB-ALPHA-ESUP' and i.status in ('ISSUED', 'PARTIALLY_PAID')
 order by i.issue_date desc limit 1;
grant all on qa to public;
create or replace function pg_temp.inv() returns uuid language sql as $$ select inv from qa $$;
create or replace function pg_temp.total() returns numeric language sql as $$ select total from qa $$;

create or replace function pg_temp.reg(p_event text, p_chr text, p_inv uuid, p_amount numeric,
                                       p_currency text default 'USD', p_acc uuid default null)
returns jsonb language sql as $$
  select platform.register_provider_invoice_payment(
    coalesce(p_acc, pg_temp.acc()), p_event, p_chr, p_inv, p_amount, p_currency::char(3), now(),
    jsonb_build_object('origin', 'pgtap'))
$$;

-- Escenarios auxiliares (mantenimiento local, se revierte):
--   · cuenta Culqi PROPIA de GRUPASA: no puede cobrar facturas de Alpha;
--   · factura de partner SIN suscripción (Andina, PE) y otra de Pacífico (CL).
select pg_temp.act_as_postgres();
insert into platform.payment_provider_accounts (code, name, provider_kind, environment, country_code, currency,
                                                market_id, owner_organization_id)
select 'culqi-grupasa-qa44', 'Culqi GRUPASA QA', 'CULQI', 'TEST', 'PE', 'PEN', m.id, '30000000-0000-4000-a000-00000000000b'
  from platform.markets m where m.code = 'PE';
insert into platform.payment_provider_account_currencies (provider_account_id, currency_code)
values (pg_temp.foreign_acc(), 'USD') on conflict do nothing;

insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date)
values ('INV-QA44-PARTNER-PE', '30000000-0000-4000-a000-000000000002', 'ISSUED', 'USD', current_date, current_date + 15),
       ('INV-QA44-PARTNER-CL', '30000000-0000-4000-a000-000000000003', 'ISSUED', 'USD', current_date, current_date + 15);
insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, is_recurring)
select i.id, 'LICENSE', 'Tarifa QA', 1, 300, 'USD', false
  from platform.invoices i where i.number in ('INV-QA44-PARTNER-PE', 'INV-QA44-PARTNER-CL');
create or replace function pg_temp.partner_pe() returns uuid language sql as
  $$ select id from platform.invoices where number = 'INV-QA44-PARTNER-PE' $$;
create or replace function pg_temp.partner_cl() returns uuid language sql as
  $$ select id from platform.invoices where number = 'INV-QA44-PARTNER-CL' $$;

-- ---------------------------------------------------------------------------
-- Permisos: SERVER-ONLY
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated',
    'platform.register_provider_invoice_payment(uuid, text, text, uuid, numeric, character, timestamp with time zone, jsonb)',
    'EXECUTE')
  and not has_function_privilege('anon',
    'platform.register_provider_invoice_payment(uuid, text, text, uuid, numeric, character, timestamp with time zone, jsonb)',
    'EXECUTE'),
  '01 ni authenticated ni anon pueden ejecutarla');
select ok(has_function_privilege('service_role',
    'platform.register_provider_invoice_payment(uuid, text, text, uuid, numeric, character, timestamp with time zone, jsonb)',
    'EXECUTE'),
  '02 service_role sí');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance
select throws_ok($$ select pg_temp.reg('evt_fin', 'chr_qa_fin', pg_temp.inv(), 10) $$, '42501', null,
  '03 EBIM_FINANCE no puede AFIRMAR un cargo de pasarela');
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin
select throws_ok($$ select pg_temp.reg('evt_sa', 'chr_qa_sa', pg_temp.inv(), 10) $$, '42501', null,
  '04 ni el super admin');

-- ---------------------------------------------------------------------------
-- Cobro parcial + idempotencia
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table qa_r (k text primary key, r jsonb);
grant all on qa_r to public;
insert into qa_r values ('p1', pg_temp.reg('portal:chr_qa_1', 'chr_qa_1', pg_temp.inv(), 100));

select is((select r ->> 'duplicate' from qa_r where k = 'p1'), 'false', '05 el primer registro no es duplicado');

select pg_temp.act_as_postgres();
select is((select status::text from platform.payments where reference = 'culqi:chr_qa_1'), 'CONFIRMED',
  '06 inserta un pago CONFIRMED con reference culqi:<chr>');
select is((select method from platform.payments where reference = 'culqi:chr_qa_1'), 'CULQI_CARD',
  '07 método CULQI_CARD');
select is((select status::text from platform.invoices where id = pg_temp.inv()), 'PARTIALLY_PAID',
  '08 la factura pasa a PARTIALLY_PAID (trigger existente)');

create temp table qa_c as
select count(*)::int as n from platform.commission_events
 where payment_id = (select (r ->> 'payment_id')::uuid from qa_r where k = 'p1');
grant all on qa_c to public;
select ok((select n from qa_c) > 0, '09 el trigger existente generó la comisión del pago');
select is((select (r ->> 'commission_events')::int from qa_r where k = 'p1'), (select n from qa_c),
  '10 la respuesta informa las comisiones generadas');

select pg_temp.act_as_service();
insert into qa_r values ('dup_ref', pg_temp.reg('webhook:evt_qa_1', 'chr_qa_1', pg_temp.inv(), 100));
select is((select r ->> 'duplicate' from qa_r where k = 'dup_ref'), 'true',
  '11 el MISMO cargo por otro camino (webhook) → duplicate:true');
select is((select r ->> 'payment_id' from qa_r where k = 'dup_ref'), (select r ->> 'payment_id' from qa_r where k = 'p1'),
  '12 ... y devuelve el pago ya existente');

insert into qa_r values ('dup_evt', pg_temp.reg('portal:chr_qa_1', 'chr_qa_otro', pg_temp.inv(), 50));
select is((select r ->> 'duplicate' from qa_r where k = 'dup_evt'), 'true',
  '13 la misma clave de evento también es duplicado');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.payments where reference in ('culqi:chr_qa_1', 'culqi:chr_qa_otro')), 1,
  '14 tres entregas → UN solo pago');
select is((select count(*)::int from platform.commission_events
            where payment_id = (select (r ->> 'payment_id')::uuid from qa_r where k = 'p1')),
  (select n from qa_c), '15 las comisiones no se duplican');
select is((select status::text from platform.provider_webhook_events
            where external_event_key = 'webhook:evt_qa_1'), 'IGNORED',
  '16 la entrega duplicada queda en el ledger como IGNORED');
select is((select status::text from platform.provider_webhook_events
            where external_event_key = 'portal:chr_qa_1'), 'PROCESSED',
  '17 la primera, PROCESSED');

-- ---------------------------------------------------------------------------
-- Rechazos
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select throws_like($$ select pg_temp.reg('evt_over', 'chr_qa_over', pg_temp.inv(), pg_temp.total()) $$,
  '%SOBRECOBRO%', '18 un cargo que excede el saldo se rechaza (SOBRECOBRO)');
select throws_like($$ select pg_temp.reg('evt_pen', 'chr_qa_pen', pg_temp.inv(), 10, 'PEN') $$,
  '%MONEDA_INCOHERENTE%', '19 moneda distinta a la de la factura se rechaza');
select throws_like(
  $$ select pg_temp.reg('evt_void', 'chr_qa_void', (select id from platform.invoices where number = 'INV-VOID-0001'), 10) $$,
  '%FACTURA_NO_PAGABLE%', '20 factura VOID se rechaza');
select throws_like(
  $$ select pg_temp.reg('evt_draft', 'chr_qa_draft', (select id from platform.invoices where number = 'INV-DRAFT-0001'), 10) $$,
  '%FACTURA_NO_PAGABLE%', '21 factura DRAFT se rechaza');
select throws_like($$ select pg_temp.reg('evt_zero', 'chr_qa_zero', pg_temp.inv(), 0) $$,
  '%IMPORTE_INVALIDO%', '22 importe cero se rechaza');
select throws_like($$ select pg_temp.reg('evt_tkn', 'tkn_test_algo', pg_temp.inv(), 10) $$,
  '%CARGO_INVALIDO%', '23 un token de tarjeta no es un id de cargo');
select throws_like($$ select pg_temp.reg('evt_manual', 'chr_qa_manual', pg_temp.inv(), 10, 'USD', pg_temp.manual_acc()) $$,
  '%CUENTA_PROVEEDOR_NO_ENCONTRADA%', '24 una cuenta que no es Culqi no registra cargos de tarjeta');
select throws_like($$ select pg_temp.reg('evt_foreign', 'chr_qa_foreign', pg_temp.inv(), 10, 'USD', pg_temp.foreign_acc()) $$,
  '%CUENTA_PROVEEDOR_NO_COINCIDE%', '25 la cuenta propia de OTRA organización no cobra la factura');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.payments where reference like 'culqi:chr_qa_%'), 1,
  '26 ningún rechazo dejó pagos');

-- ---------------------------------------------------------------------------
-- Saldo exacto → PAID; replay después de pagada sigue siendo duplicado
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(pg_temp.reg('portal:chr_qa_2', 'chr_qa_2', pg_temp.inv(), pg_temp.total() - 100) ->> 'duplicate', 'false',
  '27 el resto del saldo se acepta');
select pg_temp.act_as_postgres();
select is((select status::text from platform.invoices where id = pg_temp.inv()), 'PAID', '28 la factura queda PAID');
select pg_temp.act_as_service();
select is(pg_temp.reg('webhook:evt_qa_2', 'chr_qa_2', pg_temp.inv(), pg_temp.total() - 100) ->> 'duplicate', 'true',
  '29 el webhook del mismo cargo tras quedar PAID responde duplicado (no FACTURA_NO_PAGABLE)');

-- ---------------------------------------------------------------------------
-- Facturas sin suscripción (partner)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.resolve_invoice_card_account(pg_temp.partner_pe()), pg_temp.acc(),
  '30 factura de partner PE sin suscripción → cuenta Culqi del país');
select is(pg_temp.reg('portal:chr_qa_partner', 'chr_qa_partner', pg_temp.partner_pe(), 300) ->> 'duplicate', 'false',
  '31 y se cobra con esa cuenta');
select is(platform.resolve_invoice_card_account(pg_temp.partner_cl()), null::uuid,
  '32 partner de Chile: no hay cuenta Culqi → no pagable con tarjeta');
select throws_like($$ select pg_temp.reg('evt_cl', 'chr_qa_cl', pg_temp.partner_cl(), 10) $$,
  '%CUENTA_PROVEEDOR_NO_COINCIDE%', '33 un cargo para esa factura se rechaza');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.audit_logs
            where action = 'PROVIDER_INVOICE_PAYMENT_REGISTERED' and metadata ->> 'external_charge_id' like 'chr_qa_%'), 3,
  '34 un registro de auditoría por pago (3), ninguno por duplicados ni rechazos');

select * from finish();
rollback;
