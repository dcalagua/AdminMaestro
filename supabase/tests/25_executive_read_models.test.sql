-- ============================================================================
-- Experiencia ejecutiva · modelos de lectura (20260925100000_executive_read_models)
-- ----------------------------------------------------------------------------
-- Demuestra, con datos del seed + fixtures dentro de la transacción:
--   · estructura: security_invoker, sin SECURITY DEFINER, sin acceso anon;
--   · conciliación: Σ v_collected_payments = Σ v_collected_revenue (por moneda);
--   · universo completo: >200 facturas, >200 costos, >300 comisiones sin truncar;
--   · semántica: anulada fuera de cartera, sin vencimiento → SIN_FECHA,
--     sobrepago negativo conservado, pago revertido no cuenta;
--   · alcance: un partner / un usuario de tenant ven sólo lo que RLS ya les daba.
-- Todo se revierte al final (rollback).
-- ============================================================================
begin;
select plan(37);

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

create or replace function pg_temp.super()   returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.partner() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.tenant_user() returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000b'::uuid $$;
create or replace function pg_temp.product() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'platform'::regnamespace and c.relkind = 'v'
      and c.relname in ('v_invoice_balances', 'v_collected_payments', 'v_renewal_pipeline', 'v_cost_entry_list')
      and (select option_value from pg_options_to_table(c.reloptions)
            where option_name = 'security_invoker') = 'true'),
  4, 'Las 4 vistas nuevas son security_invoker');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('invoice_summary', 'receivables_aging', 'collections_by_month',
                        'cost_summary', 'commission_summary')
      and not p.prosecdef and p.provolatile = 's'),
  5, 'Las 5 funciones nuevas son SECURITY INVOKER y STABLE');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('v_invoice_balances', 'v_collected_payments', 'v_renewal_pipeline', 'v_cost_entry_list')
      and grantee in ('anon', 'PUBLIC')),
  0, 'anon/PUBLIC sin privilegios sobre las vistas nuevas');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('v_invoice_balances', 'v_collected_payments', 'v_renewal_pipeline', 'v_cost_entry_list')
      and grantee = 'authenticated' and privilege_type <> 'SELECT'),
  0, 'authenticated sólo tiene SELECT sobre las vistas nuevas');

select ok(
  not has_function_privilege('anon', 'platform.invoice_summary(text, text, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'platform.cost_summary(text, text)', 'execute')
  and not has_function_privilege('anon', 'platform.commission_summary(text, text)', 'execute')
  and not has_function_privilege('anon', 'platform.receivables_aging(uuid)', 'execute')
  and not has_function_privilege('anon', 'platform.collections_by_month(date, date, uuid)', 'execute'),
  'anon no ejecuta ninguna de las funciones nuevas');

-- ---------------------------------------------------------------------------
-- Conciliación con la fórmula existente (seed)
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_object_agg(currency, total) from
     (select currency, sum(collected_amount) as total from platform.v_collected_payments group by currency) x),
  (select jsonb_object_agg(currency, total) from
     (select currency, sum(collected_amount) as total from platform.v_collected_revenue group by currency) x),
  'Σ v_collected_payments = Σ v_collected_revenue por moneda (misma fórmula, al céntimo)');

select is(
  (select jsonb_object_agg(currency, total) from
     (select currency, sum(amount) as total from platform.collections_by_month() group by currency) x),
  (select jsonb_object_agg(currency, total) from
     (select currency, sum(collected_amount) as total from platform.v_collected_revenue group by currency) x),
  'La serie mensual suma exactamente el cobrado total');

select is(
  (select count(*)::int from platform.v_collected_payments),
  (select count(*)::int from platform.payments p join platform.invoices i on i.id = p.invoice_id
    where p.status = 'CONFIRMED' and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID') and i.total > 0
      and exists (select 1 from platform.invoice_lines l where l.invoice_id = i.id)),
  'Una fila por pago confirmado computable: no se repite la factura por cada pago');

-- ---------------------------------------------------------------------------
-- Fixtures: >200 facturas, >200 costos, >300 comisiones, casos de borde
-- ---------------------------------------------------------------------------
-- Organización cliente del seed con facturas.
create temp table fx_org on commit drop as
  select customer_organization_id as id from platform.invoices group by 1 order by count(*) desc limit 1;

-- 230 facturas emitidas de 100.00 USD, vencidas hace 45 días, sin pagos.
insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date, subtotal, total)
select 'FX-BULK-' || g, (select id from fx_org), 'ISSUED', 'USD',
       current_date - 75, current_date - 45, 100, 100
  from generate_series(1, 230) g;
insert into platform.invoice_lines (invoice_id, description, charge_kind, is_recurring, quantity, unit_amount, currency)
select i.id, 'Línea fixture', 'LICENSE', true, 1, 100, 'USD'
  from platform.invoices i where i.number like 'FX-BULK-%';

-- Casos de borde (USD): sin vencimiento, anulada, sobrepago, pago revertido.
insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date, subtotal, total) values
  ('FX-NODUE', (select id from fx_org), 'ISSUED', 'USD', current_date - 10, null,              50, 50),
  ('FX-VOID',  (select id from fx_org), 'VOID',   'USD', current_date - 10, current_date - 5, 70, 70),
  ('FX-OVER',  (select id from fx_org), 'ISSUED', 'USD', current_date - 10, current_date + 20, 40, 40),
  ('FX-REV',   (select id from fx_org), 'ISSUED', 'USD', current_date - 10, current_date + 20, 60, 60),
  ('FX-OVERDUE-PAID', (select id from fx_org), 'ISSUED', 'USD', current_date - 130, current_date - 100, 100, 100),
  ('FX-UNCOL', (select id from fx_org), 'ISSUED', 'USD', current_date - 10, current_date + 20, 80, 80);
insert into platform.invoice_lines (invoice_id, description, charge_kind, is_recurring, quantity, unit_amount, currency)
select i.id, 'Línea fixture', 'LICENSE', true, 1, i.total, 'USD'
  from platform.invoices i where i.number in ('FX-NODUE', 'FX-VOID', 'FX-OVER', 'FX-REV', 'FX-OVERDUE-PAID', 'FX-UNCOL');
insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at) values
  ((select id from platform.invoices where number = 'FX-OVER'), 'FX-PAY-OVER-1', 'CONFIRMED', 30, 'USD', now()),
  ((select id from platform.invoices where number = 'FX-OVER'), 'FX-PAY-OVER-2', 'CONFIRMED', 25, 'USD', now()),
  ((select id from platform.invoices where number = 'FX-REV'),  'FX-PAY-REV',    'CONFIRMED', 60, 'USD', now());
update platform.payments set status = 'REVERSED' where reference = 'FX-PAY-REV';
-- Sobrepago de una factura vencida hace 100 días; y un cobro sobre una factura
-- luego declarada incobrable.
insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at) values
  ((select id from platform.invoices where number = 'FX-OVERDUE-PAID'), 'FX-PAY-ODP', 'CONFIRMED', 110, 'USD', now()),
  ((select id from platform.invoices where number = 'FX-UNCOL'), 'FX-PAY-UNCOL', 'CONFIRMED', 20, 'USD', now());
update platform.invoices set status = 'UNCOLLECTIBLE' where number = 'FX-UNCOL';

select is(
  (select (platform.invoice_summary('FX-BULK-', 'ALL') ->> 'row_count')::int),
  230, 'invoice_summary cuenta las 230 facturas fixture (más que el lote antiguo de 200)');

select is(
  (select (platform.invoice_summary('FX-BULK-', 'ALL') -> 'receivable' ->> 'USD')::numeric),
  23000.00::numeric, 'Saldo por cobrar de las 230 facturas = 23.000,00 USD, sin truncar');

select is(
  (select (platform.invoice_summary('FX-BULK-', 'OPEN') -> 'overdue' ->> 'USD')::numeric),
  23000.00::numeric, 'Todas vencidas hace 45 días: cartera vencida = saldo');

select is(
  (select (platform.invoice_summary('FX-BULK-', 'ALL', null, 'D31_60') ->> 'row_count')::int),
  230, 'El filtro de antigüedad del resumen coincide con la banda del detalle');

select is(
  (select balance from platform.receivables_aging((select id from fx_org))
    where aging_bucket = 'D31_60' and currency = 'USD'),
  (select sum(balance) from platform.v_invoice_balances
    where customer_organization_id = (select id from fx_org) and aging_bucket = 'D31_60' and currency = 'USD'),
  'receivables_aging concilia con el detalle de v_invoice_balances');

select is(
  (select aging_bucket from platform.v_invoice_balances where number = 'FX-NODUE'),
  'SIN_FECHA', 'Factura sin vencimiento va a SIN_FECHA, no a vigente ni vencida');

select ok(
  (select balance is null and not is_receivable and aging_bucket = 'NO_COMPUTABLE'
     from platform.v_invoice_balances where number = 'FX-VOID'),
  'Factura anulada: sin saldo de cartera (NULL, no cero) y fuera de la antigüedad');

select is(
  (select balance from platform.v_invoice_balances where number = 'FX-OVER'),
  -15.00::numeric, 'Sobrepago: saldo negativo conservado, sin recortar a cero');

select is(
  (select aging_bucket from platform.v_invoice_balances where number = 'FX-OVERDUE-PAID'),
  'A_FAVOR', 'Sobrepago vencido: banda «a favor», nunca una banda vencida');

select is(
  (select (platform.invoice_summary('FX-OVERDUE-PAID', 'ALL') -> 'overdue' ->> 'USD')), null,
  'Un saldo a favor no reduce la cartera vencida');

select is(
  (select (platform.invoice_summary('FX-UNCOL', 'ALL') -> 'collected' ->> 'USD')), null,
  'Cobrado del resumen: sólo facturas computables (como v_collected_revenue), no incobrables');

select is(
  (select (confirmed_paid, balance, reversed_amount)::text from platform.v_invoice_balances where number = 'FX-REV'),
  '(0,60.00,60.00)', 'Pago revertido: no cuenta como cobrado y deja el saldo completo');

select is(
  (select count(*)::int from platform.v_collected_payments where reference = 'FX-PAY-REV'),
  0, 'Pago revertido fuera de la serie de cobros');

select is(
  (select (platform.invoice_summary('FX-VOID', 'EXCLUDED') ->> 'row_count')::int),
  1, 'El tab Borrador/anuladas encuentra la anulada con el mismo criterio que la tabla');

select is(
  (select (platform.invoice_summary('FX-BULK-229', 'ALL') ->> 'row_count')::int),
  1, 'La búsqueda encuentra una factura que el lote antiguo (200 más recientes) podía dejar fuera');

-- Costos: 210 entradas USD 10.00 asignadas 100 % a PLATFORM.
insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
select 'COMPUTE', 'FX-COST-' || g, 'Proveedor fixture', 10, 'USD', current_date - 30, current_date
  from generate_series(1, 210) g;
insert into platform.cost_allocations (cost_entry_id, scope, weight, allocation_rule)
select ce.id, 'PLATFORM', 1, 'FIXTURE'
  from platform.cost_entries ce where ce.description like 'FX-COST-%';

select is(
  (select (platform.cost_summary('FX-COST-', 'ALL') ->> 'row_count')::int),
  210, 'cost_summary cuenta los 210 costos fixture');

select is(
  (select (platform.cost_summary('FX-COST-', 'ALL') -> 'registered' ->> 'USD')::numeric),
  2100.00::numeric, 'Costo registrado de los 210 = 2.100,00 USD');

select is(
  (select (platform.cost_summary('FX-COST-', 'PLATFORM') -> 'platform' ->> 'USD')::numeric),
  2100.00::numeric, 'Costo de plataforma identificado como tal, no repartido');

select is(
  (select count(*)::int from platform.v_cost_entry_list where description like 'FX-COST-%' and 'PLATFORM' = any (scopes)),
  210, 'La lista paginable de costos ve el mismo universo que el resumen');

select is(
  (select (platform.cost_summary('FX-COST-', 'ALL') -> 'allocated' ->> 'USD')::numeric),
  0::numeric, 'Nada del costo de plataforma aparece como asignado a producto/tenant');

-- Comisiones: 320 eventos fixture, cada uno sobre un pago CONFIRMED propio
-- (regla del modelo: sólo se comisiona lo cobrado; la clave de idempotencia
-- incluye el pago). La factura no tiene suscripción, así que el generador
-- automático no crea eventos: se copian agente/atribución/regla de un evento USD.
insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date, subtotal, total)
values ('FX-COMM', (select id from fx_org), 'ISSUED', 'USD', current_date - 5, current_date + 25, 100000, 100000);
insert into platform.invoice_lines (invoice_id, description, charge_kind, is_recurring, quantity, unit_amount, currency)
select id, 'Línea fixture', 'LICENSE', true, 1, 100000, 'USD' from platform.invoices where number = 'FX-COMM';
insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
select (select id from platform.invoices where number = 'FX-COMM'), 'FX-COMM-PAY-' || g, 'CONFIRMED', 1, 'USD', now()
  from generate_series(1, 320) g;
insert into platform.commission_events
  (sales_agent_id, sales_attribution_id, commission_rule_id, payment_id, saas_product_id,
   status, base_amount, applied_rate, attribution_pct, amount, currency, earned_on, calculation)
select e.sales_agent_id, e.sales_attribution_id, e.commission_rule_id, p.id, e.saas_product_id,
       'ELIGIBLE', 1, e.applied_rate, e.attribution_pct, 0.10, 'USD', current_date, '{"fixture":true}'::jsonb
  from platform.payments p
  cross join lateral (select * from platform.commission_events ce
                       where ce.currency = 'USD' and ce.reversal_of_event_id is null
                       order by ce.created_at limit 1) e
 where p.reference like 'FX-COMM-PAY-%';

select ok(
  (select (platform.commission_summary(null, 'ALL') ->> 'row_count')::int) > 300,
  'commission_summary cuenta más de 300 eventos');

select is(
  (select (platform.commission_summary(null, 'ALL') ->> 'row_count')::int),
  (select count(*)::int from platform.v_commission_detail),
  'row_count de comisiones = filas del detalle (mismo universo)');

select is(
  (select platform.commission_summary(null, 'ALL') -> 'pending'),
  (select coalesce(jsonb_object_agg(currency, amount), '{}'::jsonb) from
     (select currency, sum(amount) as amount from platform.commission_events
       where status in ('ELIGIBLE', 'ACCRUED') group by currency) x),
  'Comisión pendiente = ELIGIBLE + ACCRUED (definición de finance_reporting_rows)');

-- ---------------------------------------------------------------------------
-- Alcance por rol (las funciones no amplían lo que RLS ya daba)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.partner());
create temp table partner_view on commit drop as
  select (platform.invoice_summary(null, 'ALL') ->> 'row_count')::int as summary_rows,
         (select count(*)::int from platform.invoices) as rls_rows,
         (select count(*)::int from platform.v_collected_payments) as collected_rows,
         (select count(*)::int from platform.payments where status = 'CONFIRMED') as rls_payments;
select pg_temp.act_as_postgres();

select is((select summary_rows from partner_view), (select rls_rows from partner_view),
  'Partner: invoice_summary cuenta exactamente las facturas que RLS le deja ver');
select ok((select summary_rows from partner_view) < (select count(*)::int from platform.invoices),
  'Partner: no obtiene el universo EBIM completo');
select ok((select collected_rows from partner_view) <= (select rls_payments from partner_view),
  'Partner: la serie de cobros no excede sus pagos visibles');

select pg_temp.act_as(pg_temp.tenant_user());
create temp table tenant_view on commit drop as
  select (platform.invoice_summary(null, 'ALL') ->> 'row_count')::int as invoices,
         (platform.cost_summary(null, 'ALL') ->> 'row_count')::int as costs,
         (select count(*)::int from platform.receivables_aging()) as aging_rows;
select pg_temp.act_as_postgres();

select is((select costs from tenant_view), 0, 'Usuario de tenant: cero costos (RLS de cost_entries)');
select is((select invoices from tenant_view),
  (select count(*)::int from platform.invoices where false), 'Usuario de tenant: sin facturas corporativas');

select pg_temp.act_as(pg_temp.product());
create temp table product_view on commit drop as
  select (platform.cost_summary(null, 'ALL') ->> 'row_count')::int as costs,
         (select count(*)::int from platform.cost_entries) as rls_costs;
select pg_temp.act_as_postgres();
select is((select costs from product_view), (select rls_costs from product_view),
  'Administrador de producto: cost_summary no amplía lo que RLS de cost_entries ya le daba');

select * from finish();
rollback;
