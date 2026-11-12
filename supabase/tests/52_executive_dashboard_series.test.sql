-- ============================================================================
-- Series del Resumen Ejecutivo (20261016000100_executive_dashboard_series)
-- ----------------------------------------------------------------------------
-- Escenario aislado en 2020 con tasas QA (USD/PEN 4 hasta marzo y 5 desde
-- abril; sin tasa BOB):
--   INV-1  Alpha     USD 1000  emitida 01-01, vence 01-16; pagos 400 (10-02) y 600 (20-04)
--   INV-2  Omega     PEN 4000  emitida 03-01, vence 03-31
--   INV-3  Alpha     USD  999  emitida 01-01 y ANULADA (no cuenta)
--   INV-4  Alpha     USD  500  emitida 04-01, vence 04-16
--   INV-7  Illimani  BOB  700  emitida 03-05, vence 04-04 (sin tasa → NULL)
-- Demuestra: facturado/cobrado/razón/vencida por mes con conversión, NULL por
-- tasa faltante (nunca 0), cuadre con collections_by_month y con
-- executive_receivables_aging sobre datos reales, puente mensual = puente
-- suelto, mix PARTNER que suma la serie, errores y alcance por rol (RLS).
-- Todo se revierte al final.
-- ============================================================================
begin;
select plan(18);

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

create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.partner() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;

-- Serie de cobranza 2020 (ene–abr) como «facturado|cobrado|razón|vencida|completo».
create or replace function pg_temp.billing_txt()
returns text language sql as $$
  select string_agg(concat_ws('|', coalesce(invoiced::text, 'NULL'), coalesce(collected::text, 'NULL'),
                              coalesce(collection_rate::text, 'NULL'), coalesce(overdue::text, 'NULL'),
                              complete::text), ' ' order by month)
    from platform.executive_billing_series('2020-01-01', '2020-04-30', 'USD')
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos de ejecución
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('executive_billing_series', 'executive_mrr_movements_series', 'executive_mrr_mix')
      and not p.prosecdef and p.provolatile = 's'),
  3, 'Las funciones del tablero existen, son SECURITY INVOKER y STABLE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('executive_billing_series', 'executive_mrr_movements_series', 'executive_mrr_mix')
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon no las ejecuta; authenticated sí');

-- ---------------------------------------------------------------------------
-- Fixture 2020
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', 'PEN', case when d < '2020-04-01' then 4 else 5 end, 'MANUAL', false, 'QA tablero ejecutivo'
  from generate_series('2020-01-01'::date, '2020-06-01'::date, interval '1 month') d;

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date)
values
  ('5e300000-0000-4000-a000-000000000001', 'QA-DSH-INV-1', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e300000-0000-4000-a000-000000000002', 'QA-DSH-INV-2', '30000000-0000-4000-a000-000000000005', 'ISSUED', 'PEN', '2020-03-01', '2020-03-31'),
  ('5e300000-0000-4000-a000-000000000003', 'QA-DSH-INV-3', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e300000-0000-4000-a000-000000000004', 'QA-DSH-INV-4', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-04-01', '2020-04-16'),
  ('5e300000-0000-4000-a000-000000000007', 'QA-DSH-INV-7', '30000000-0000-4000-a000-00000000000d', 'ISSUED', 'BOB', '2020-03-05', '2020-04-04');

insert into platform.invoice_lines (invoice_id, charge_kind, description, unit_amount)
values ('5e300000-0000-4000-a000-000000000001', 'LICENSE', 'QA', 1000),
       ('5e300000-0000-4000-a000-000000000002', 'LICENSE', 'QA', 4000),
       ('5e300000-0000-4000-a000-000000000003', 'LICENSE', 'QA', 999),
       ('5e300000-0000-4000-a000-000000000004', 'LICENSE', 'QA', 500),
       ('5e300000-0000-4000-a000-000000000007', 'LICENSE', 'QA', 700);

update platform.invoices set status = 'VOID' where id = '5e300000-0000-4000-a000-000000000003';

insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
values ('5e300000-0000-4000-a000-000000000001', 'QA-DSH-PAY-1', 'CONFIRMED', 400, 'USD', '2020-02-10'),
       ('5e300000-0000-4000-a000-000000000001', 'QA-DSH-PAY-2', 'CONFIRMED', 600, 'USD', '2020-04-20');

-- ---------------------------------------------------------------------------
-- Facturado, cobrado, razón y vencida por mes
-- ---------------------------------------------------------------------------
select is(pg_temp.billing_txt(),
  '1000.00|0|0.0000|1000.00|true 0|400.00|NULL|600.00|true NULL|0|NULL|600.00|false 500.00|600.00|1.2000|NULL|false',
  'ene: facturado sin cobro y vencida · feb: cobro sin facturación (razón NULL) · mar: BOB sin tasa → facturado NULL, '
  'nunca 0 · abr: razón 1.2 (cobro de atraso) y vencida NULL porque incluye BOB');

select is(
  (select string_agg(month || ':' || invoiced_native::text || ' ' || missing_currencies::text, ' ' order by month)
     from platform.executive_billing_series('2020-03-01', '2020-04-30', 'USD')),
  '2020-03-01:{"BOB": 700.00, "PEN": 4000.00} {BOB} 2020-04-01:{"USD": 500.00} {BOB}',
  'Los importes nativos se conservan y la moneda sin tasa se nombra');

select is(
  (select string_agg(concat_ws(' ', invoice_count, payment_count, overdue_invoice_count), ',' order by month)
     from platform.executive_billing_series('2020-01-01', '2020-04-30', 'USD')),
  '1 0 1,0 1 1,2 0 1,1 1 3',
  'Conteos de facturas emitidas, pagos y facturas vencidas al cierre');

select is(
  (select count(*)::int from platform.executive_billing_series(null, null, 'USD')),
  12, 'Por defecto: 12 meses hasta el mes en curso');

select throws_ok(
  $$ select * from platform.executive_billing_series('2020-05-01', '2020-01-01') $$,
  '22023', null, 'Rango invertido → error');

-- ---------------------------------------------------------------------------
-- Datos reales (seed y, si está cargada, demo): tasas QA para los últimos 13
-- meses de cada moneda; la serie debe cuadrar con las fuentes existentes.
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', c.currency, 3 + row_number() over (partition by c.currency order by d) / 10.0,
       'MANUAL', false, 'QA tablero ejecutivo'
  from generate_series(date_trunc('month', current_date) - interval '13 months',
                       date_trunc('month', current_date), interval '1 month') d
 cross join (select distinct currency from platform.invoices where currency <> 'USD'
             union select distinct currency from platform.subscriptions where currency <> 'USD') c
on conflict do nothing;

select is(
  (select count(*)::int
     from platform.executive_billing_series(null, null, 'USD') b
     full join (select month, jsonb_object_agg(currency, amount order by currency) as j
                  from platform.collections_by_month(
                         date_trunc('month', current_date - interval '11 months')::date, current_date)
                 group by month) c on c.month = b.month
    where b.collected_native is distinct from coalesce(c.j, '{}'::jsonb)),
  0, 'Cobrado nativo por mes = collections_by_month (la fuente de K02)');

select is(
  (select count(*)::int
     from platform.executive_billing_series(null, null, 'USD') b
     cross join lateral (select sum(a.balance) as amount, sum(a.invoice_count)::int as n
                           from platform.executive_receivables_aging(b.as_of, 'USD') a
                          where a.aging_bucket in ('D1_30', 'D31_60', 'D61_90', 'D90_MAS')) a
    where b.overdue is distinct from a.amount or b.overdue_invoice_count <> a.n),
  0, 'Vencida al cierre de cada mes = bandas D1_30…D90_MAS de executive_receivables_aging');

select is(
  (select count(*)::int from (
     (select * from platform.executive_mrr_movements_series(null, null, 'USD')
      except
      select m.* from generate_series(date_trunc('month', current_date) - interval '11 months',
                                      date_trunc('month', current_date), interval '1 month') g
      cross join lateral platform.executive_mrr_movements(g::date, 'USD') m)
     union all
     (select m.* from generate_series(date_trunc('month', current_date) - interval '11 months',
                                      date_trunc('month', current_date), interval '1 month') g
      cross join lateral platform.executive_mrr_movements(g::date, 'USD') m
      except
      select * from platform.executive_mrr_movements_series(null, null, 'USD'))) d),
  0, 'El puente mensual en serie es idéntico al puente de cada mes');

select throws_ok(
  $$ select * from platform.executive_mrr_movements_series('2015-01-01', null) $$,
  '22023', null, 'Puente en serie de más de 36 meses → error');

-- ---------------------------------------------------------------------------
-- Mix por partner
-- ---------------------------------------------------------------------------
select is(
  (select sum(mrr) from platform.executive_mrr_mix((current_date - interval '1 month')::date, 'PARTNER', 'USD')),
  (select mrr from platform.executive_mrr_series((current_date - interval '1 month')::date,
                                                 (current_date - interval '1 month')::date, 'USD')),
  'Σ del mix por partner = punto de la serie del mes');

select is(
  (select count(*)::int from platform.executive_mrr_mix((current_date - interval '1 month')::date, 'PARTNER', 'USD') x
    where x.group_key <> 'DIRECTO'
      and not exists (select 1 from platform.tenants t where t.managing_organization_id::text = x.group_key)),
  0, 'Cada grupo del mix por partner es un partner que gestiona tenants (o DIRECTO)');

select is(
  (select string_agg(dimension, ',' order by dimension)
     from (select distinct dimension from platform.executive_mrr_mix(null, 'product')
           union select distinct dimension from platform.executive_mrr_mix(null, 'MARKET')) x),
  'MARKET,PRODUCT', 'PRODUCT y MARKET siguen respondiendo igual');

select throws_ok(
  $$ select * from platform.executive_mrr_mix(null, 'PAIS') $$,
  '22023', null, 'Dimensión desconocida → error');

-- ---------------------------------------------------------------------------
-- Alcance por rol (RLS)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select is(pg_temp.billing_txt(),
  '1000.00|0|0.0000|1000.00|true 0|400.00|NULL|600.00|true NULL|0|NULL|600.00|false 500.00|600.00|1.2000|NULL|false',
  'Finanzas ve la misma serie global');

select pg_temp.act_as(pg_temp.alpha_admin());
select is(pg_temp.billing_txt(),
  '1000.00|0|0.0000|1000.00|true 0|400.00|NULL|600.00|true 0|0|NULL|600.00|true 500.00|600.00|1.2000|500.00|true',
  'Tenant admin de Alpha: sólo sus facturas y pagos (sin PEN ni BOB ajenos)');

select pg_temp.act_as(pg_temp.partner());
select is(
  (select sum(invoice_count)::int + sum(payment_count)::int
     from platform.executive_billing_series('2020-01-01', '2020-04-30', 'USD')),
  0, 'Partner: no ve la facturación ni los cobros de clientes ajenos');

select pg_temp.act_as_postgres();

select * from finish();
rollback;
