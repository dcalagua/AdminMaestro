-- ============================================================================
-- EBIM Commercial Control Plane · Fase 03 · DISCOUNT resta exactamente una vez
-- (Task MA-02, decisión P-01/P-02 del plan)
-- ----------------------------------------------------------------------------
-- Representación: magnitud positiva en subscription_items; en invoice_lines se
-- aceptan la forma histórica positiva y la correctiva negativa. El signo
-- contable sale SOLO de platform.signed_line_amount(charge_kind, amount), así
-- que ninguna de las dos formas resta dos veces.
--
-- Fixture: una venta BO/BOB (atribución al comercial de partner) cuyos ítems se
-- sustituyen por LICENSE 100 MONTHLY + DISCOUNT 10 MONTHLY. Una regla
-- COLLECTED_ANY de prueba hace visible la base de comisión de CADA línea.
-- Todo se revierte al final (rollback).
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

-- ---------------------------------------------------------------------------
-- Función de signo
-- ---------------------------------------------------------------------------
select has_function('platform', 'signed_line_amount', array['platform.charge_kind', 'numeric'],
  'Existe platform.signed_line_amount(charge_kind, numeric)');
select is(platform.signed_line_amount('DISCOUNT', 10), -10::numeric, 'DISCOUNT positivo (histórico) resta');
select is(platform.signed_line_amount('DISCOUNT', -10), -10::numeric, 'DISCOUNT negativo (correctivo) resta lo mismo: no hay doble negación');
select is(platform.signed_line_amount('LICENSE', 100), 100::numeric, 'Un cargo no-DISCOUNT conserva su importe');

-- ---------------------------------------------------------------------------
-- Fixture comercial
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin: vende
select platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa-ccp-discount', 'Descuento QA',
  'admin@qa-ccp-discount.example.com', '60000000-0000-4000-a000-000000000001', 'BO',
  p_sales_agent_id => '80000000-0000-4000-a000-000000000002',
  p_commission_plan_id => '90000000-0000-4000-a000-000000000002',
  p_activate => true);

select pg_temp.act_as_postgres();
create temp table qa_sub as
select s.id, s.billed_organization_id as org_id, s.currency
  from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
 where t.slug = 'qa-ccp-discount';
grant select on qa_sub to authenticated;

delete from platform.subscription_items where subscription_id = (select id from qa_sub);

-- Regla de prueba: base = cualquier línea cobrada. Hoy incluye DISCOUNT.
insert into platform.commission_rules (commission_plan_id, name, basis, rate, currency, is_recurring, priority)
values ('90000000-0000-4000-a000-000000000002', 'QA · cualquier línea', 'COLLECTED_ANY', 0.10, 'USD', true, 1);

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance
select platform.upsert_subscription_item((select id from qa_sub), 'LICENSE', 'Licencia QA', 1, 100,
  'MONTHLY', p_valid_from => date_trunc('month', current_date)::date);
select platform.upsert_subscription_item((select id from qa_sub), 'DISCOUNT', 'Descuento QA', 1, 10,
  'MONTHLY', p_valid_from => date_trunc('month', current_date)::date);

-- ---------------------------------------------------------------------------
-- MRR
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is((select mrr from platform.v_subscription_mrr where subscription_id = (select id from qa_sub)),
  90.00::numeric, 'MRR = LICENSE 100 − DISCOUNT 10 recurrente = 90');

-- ---------------------------------------------------------------------------
-- Estado de facturación y emisión
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is((platform.get_subscription_billing_status((select id from qa_sub)) ->> 'estimated_total')::numeric,
  90.00::numeric, 'El total estimado del periodo descuenta el DISCOUNT');

create temp table qa_inv as select platform.issue_subscription_invoice((select id from qa_sub)) as r;
grant select on qa_inv to authenticated;
select is((select (r ->> 'total')::numeric from qa_inv), 90.00::numeric,
  'issue_subscription_invoice emite total 90 (no 110)');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.invoice_lines
            where invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv) and charge_kind = 'DISCOUNT'),
  1, 'La factura conserva la línea DISCOUNT (magnitud positiva de la suscripción)');

-- ---------------------------------------------------------------------------
-- Facturas DRAFT con las dos formas de línea
-- ---------------------------------------------------------------------------
insert into platform.invoices (number, customer_organization_id, subscription_id, status, currency)
select 'INV-QA-CCP-DRAFT-POS', org_id, id, 'DRAFT', currency from qa_sub;
insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency)
select i.id, v.k::platform.charge_kind, v.d, 1, v.a, i.currency
  from platform.invoices i,
       (values ('LICENSE', 'Licencia', 100.00), ('DISCOUNT', 'Descuento', 10.00)) v(k, d, a)
 where i.number = 'INV-QA-CCP-DRAFT-POS';
select is((select total from platform.invoices where number = 'INV-QA-CCP-DRAFT-POS'), 90.00::numeric,
  'DRAFT con LICENSE 100 + DISCOUNT 10 (positivo) → total 90');

insert into platform.invoices (number, customer_organization_id, subscription_id, status, currency)
select 'INV-QA-CCP-DRAFT-NEG', org_id, id, 'DRAFT', currency from qa_sub;
insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency)
select i.id, v.k::platform.charge_kind, v.d, 1, v.a, i.currency
  from platform.invoices i,
       (values ('LICENSE', 'Licencia', 100.00), ('DISCOUNT', 'Descuento correctivo', -10.00)) v(k, d, a)
 where i.number = 'INV-QA-CCP-DRAFT-NEG';
select is((select total from platform.invoices where number = 'INV-QA-CCP-DRAFT-NEG'), 90.00::numeric,
  'DRAFT con DISCOUNT −10 (correctivo) → total 90 (ni 80 ni 110)');

-- ---------------------------------------------------------------------------
-- Cobro y comisiones (solo desde pagos CONFIRMED)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok(
  $$ select platform.confirm_manual_payment((select (r ->> 'invoice_id')::uuid from qa_inv), 90,
       'TRF-QA-CCP-DISC-001', 'BANK_TRANSFER', now()) $$,
  'Cobro CONFIRMED por el total con descuento');

select pg_temp.act_as_postgres();
select is((select i.status::text from platform.invoices i where i.id = (select (r ->> 'invoice_id')::uuid from qa_inv)),
  'PAID', 'Pagar 90 salda la factura (el descuento no deja saldo)');

select is(
  (select sum(e.base_amount) from platform.commission_events e
     join platform.commission_rules cr on cr.id = e.commission_rule_id
     join platform.payments p on p.id = e.payment_id
    where p.reference = 'TRF-QA-CCP-DISC-001' and cr.basis = 'COLLECTED_ANY'),
  100.00::numeric, 'Base COLLECTED_ANY = 100: DISCOUNT no suma a la base (hoy sumaba 110)');

select is(
  (select count(*)::int from platform.commission_events e
     join platform.invoice_lines l on l.id = e.invoice_line_id
     join platform.payments p on p.id = e.payment_id
    where p.reference = 'TRF-QA-CCP-DISC-001' and l.charge_kind = 'DISCOUNT'),
  0, 'Ningún evento de comisión se devenga sobre una línea DISCOUNT');

-- ---------------------------------------------------------------------------
-- Ingreso cobrado
-- ---------------------------------------------------------------------------
select is(
  (select sum(collected_amount) from platform.v_collected_revenue
    where invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv) and charge_kind = 'DISCOUNT'),
  -10.00::numeric, 'v_collected_revenue trata DISCOUNT como contra-ingreso (−10), no como ingreso');

select is(
  (select sum(collected_amount) from platform.v_collected_revenue
    where invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv)),
  90.00::numeric, 'Σ v_collected_revenue de la factura = importe cobrado (90)');

select is(
  (select collected_amount from platform.v_collected_payments where reference = 'TRF-QA-CCP-DISC-001'),
  90.00::numeric, 'v_collected_payments concilia con el pago (90)');

-- DISCOUNT ≠ reembolso ≠ nota de crédito: no nace ningún pago negativo ni revertido.
select is(
  (select string_agg(p.status::text || ' ' || p.amount, ',') from platform.payments p
    where p.invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv)),
  'CONFIRMED 90.00', 'El descuento no crea reembolsos ni cambia el estado de ningún pago');

-- ---------------------------------------------------------------------------
-- Filas históricas: factura emitida con el total ANTERIOR (DISCOUNT sumado)
-- ---------------------------------------------------------------------------
-- Se reproduce el estado heredado: líneas positivas y total persistido 110.
insert into platform.invoices (number, customer_organization_id, subscription_id, status, currency,
                               period_start, period_end, issue_date)
select 'INV-QA-CCP-LEGACY', org_id, id, 'ISSUED', currency,
       (date_trunc('month', current_date) - interval '2 months')::date,
       (date_trunc('month', current_date) - interval '1 month' - interval '1 day')::date,
       (current_date - 45)
  from qa_sub;
insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency)
select i.id, v.k::platform.charge_kind, v.d, 1, v.a, i.currency
  from platform.invoices i,
       (values ('LICENSE', 'Licencia', 100.00), ('DISCOUNT', 'Descuento', 10.00)) v(k, d, a)
 where i.number = 'INV-QA-CCP-LEGACY';
update platform.invoices set subtotal = 110.00, total = 110.00 where number = 'INV-QA-CCP-LEGACY';

select is(
  (select legacy_total::text || ' ' || signed_total::text from platform.v_discount_sign_legacy_invoices
    where number = 'INV-QA-CCP-LEGACY'),
  '110.00 90.00',
  'La factura histórica se conserva (110) y queda visible con su total firmado (90) — no se corrige en silencio');

select is(
  (select count(*)::int from platform.v_discount_sign_legacy_invoices
    where invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv)),
  0, 'Una factura emitida con la regla nueva no aparece como histórica');

select * from finish();
rollback;
