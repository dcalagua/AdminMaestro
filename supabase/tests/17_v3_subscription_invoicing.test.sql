-- ============================================================================
-- V3 · Fase 17 — Factura gerencial del periodo y cobro manual en moneda local
-- ============================================================================
begin;
select plan(9);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin: vende

select lives_ok(
  $$ select platform.onboard_customer_subscription(
       'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa-bo-invoice', 'Illimani QA',
       'admin@illimani-qa.example.com', '60000000-0000-4000-a000-000000000001', 'BO',
       p_sales_agent_id => '80000000-0000-4000-a000-000000000002',
       p_commission_plan_id => '90000000-0000-4000-a000-000000000002',
       p_activate => true) $$,
  'Venta regional BO/BOB activada con atribución comercial'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance: factura y cobra

create temp table qa_inv as
select platform.issue_subscription_invoice(s.id) as r
  from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
 where t.slug = 'qa-bo-invoice';
grant select on qa_inv to authenticated;

select is(
  (select (r ->> 'currency') || ' ' || (r ->> 'total') || ' ' || (r ->> 'created') from qa_inv),
  'BOB 5900.00 true',
  'La factura del mes nace en la moneda del contrato con la tarifa regional'
);

select is(
  (select (platform.issue_subscription_invoice(s.id) ->> 'created')
     from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id where t.slug = 'qa-bo-invoice'),
  'false',
  'Emitir de nuevo el mismo periodo devuelve la factura existente (idempotente)'
);

select lives_ok(
  $$ select platform.confirm_manual_payment(
       (select (r ->> 'invoice_id')::uuid from qa_inv), 5900, 'TRF-QA-BO-001', 'BANK_TRANSFER', now()) $$,
  'Cobro manual por transferencia'
);

select is(
  (select i.status::text || ' ' || p.currency from platform.invoices i
     join platform.payments p on p.invoice_id = i.id
    where i.id = (select (r ->> 'invoice_id')::uuid from qa_inv)),
  'PAID BOB',
  'La factura queda PAGADA y el cobro en BOB'
);

select is(
  (select e.currency || ' ' || e.amount from platform.commission_events e
     join platform.payments p on p.id = e.payment_id where p.reference = 'TRF-QA-BO-001'),
  'BOB 354.00',
  'La comisión del comercial de partner (6%) se devenga en BOB sobre el importe original'
);

select throws_like(
  $$ select platform.issue_subscription_invoice(
       (select id from platform.subscriptions where code = 'SUB-V3-EC-USD-GUAYAS'), '2020-01-01') $$,
  'SIN_LINEAS_FACTURABLES%',
  'Un periodo sin cargos vigentes no genera una factura vacía'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner
select throws_ok(
  $$ select platform.issue_subscription_invoice((select id from platform.subscriptions where code = 'SUB-V3-BO-BOB-ILLIMANI')) $$,
  '42501', null,
  'Un partner no emite facturas'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin
select throws_ok(
  $$ select platform.issue_subscription_invoice((select id from platform.subscriptions where code = 'SUB-V3-BO-BOB-ILLIMANI')) $$,
  '42501', null,
  'EBIM_PRODUCT_ADMIN no emite facturas (es finanzas)'
);

select * from finish();
rollback;
