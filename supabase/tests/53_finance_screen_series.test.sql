-- ============================================================================
-- Series de las pantallas de Finanzas (20261017000100_finance_screen_series)
-- ----------------------------------------------------------------------------
-- Escenario aislado en 2020 con tasas QA (USD/PEN 4 hasta marzo y 5 desde
-- abril; sin tasa BOB):
--   INV-1  Alpha     USD 1000  emitida 01-01; pagos 400 (10-02) y 600 (20-04)
--   INV-2  Omega     PEN 4000  emitida 03-01; pago 400 (15-03)
--   INV-7  Illimani  BOB  700  emitida 03-05; pago 700 (10-04)  → sin tasa
--   COST-1 USD 200 de enero (plataforma) · COST-2 PEN 800 de marzo (Alpha)
-- Demuestra: cobrado/costo/comisión/margen por mes con conversión, NULL por
-- tasa faltante (nunca 0), cuadre con finance_reporting_rows (la base de
-- finance_consolidated) y de la serie semanal con v_collected_payments sobre
-- datos reales, errores y alcance por rol (RLS). Todo se revierte al final.
-- ============================================================================
begin;
select plan(15);

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

-- Serie 2020 (ene–abr) como «cobrado|costo|comisión|margen|completo».
create or replace function pg_temp.monthly_txt()
returns text language sql as $$
  select string_agg(concat_ws('|', coalesce(collected::text, 'NULL'), coalesce(cost::text, 'NULL'),
                              coalesce(commission::text, 'NULL'), coalesce(margin::text, 'NULL'),
                              complete::text), ' ' order by month)
    from platform.finance_monthly_series('2020-01-01', '2020-04-30', 'USD')
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos de ejecución
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('finance_monthly_series', 'collections_by_week')
      and not p.prosecdef and p.provolatile = 's'),
  2, 'Las funciones de Finanzas existen, son SECURITY INVOKER y STABLE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('finance_monthly_series', 'collections_by_week')
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon no las ejecuta; authenticated sí');

-- ---------------------------------------------------------------------------
-- Fixture 2020
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', 'PEN', case when d < '2020-04-01' then 4 else 5 end, 'MANUAL', false, 'QA pantallas de finanzas'
  from generate_series('2020-01-01'::date, '2020-06-01'::date, interval '1 month') d;

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date)
values
  ('5e400000-0000-4000-a000-000000000001', 'QA-FIN-INV-1', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e400000-0000-4000-a000-000000000002', 'QA-FIN-INV-2', '30000000-0000-4000-a000-000000000005', 'ISSUED', 'PEN', '2020-03-01', '2020-03-31'),
  ('5e400000-0000-4000-a000-000000000007', 'QA-FIN-INV-7', '30000000-0000-4000-a000-00000000000d', 'ISSUED', 'BOB', '2020-03-05', '2020-04-04');

insert into platform.invoice_lines (invoice_id, charge_kind, description, unit_amount)
values ('5e400000-0000-4000-a000-000000000001', 'LICENSE', 'QA', 1000),
       ('5e400000-0000-4000-a000-000000000002', 'LICENSE', 'QA', 4000),
       ('5e400000-0000-4000-a000-000000000007', 'LICENSE', 'QA', 700);

insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
values ('5e400000-0000-4000-a000-000000000001', 'QA-FIN-PAY-1', 'CONFIRMED', 400, 'USD', '2020-02-10'),
       ('5e400000-0000-4000-a000-000000000001', 'QA-FIN-PAY-2', 'CONFIRMED', 600, 'USD', '2020-04-20'),
       ('5e400000-0000-4000-a000-000000000002', 'QA-FIN-PAY-3', 'CONFIRMED', 400, 'PEN', '2020-03-15'),
       ('5e400000-0000-4000-a000-000000000007', 'QA-FIN-PAY-7', 'CONFIRMED', 700, 'BOB', '2020-04-10');

insert into platform.cost_entries (id, category, description, amount, currency, period_start, period_end)
values ('5e400000-0000-4000-a000-0000000000c1', 'DATABASE', 'QA costo plataforma', 200, 'USD', '2020-01-01', '2020-01-31'),
       ('5e400000-0000-4000-a000-0000000000c2', 'SUPPORT', 'QA costo Alpha', 800, 'PEN', '2020-03-01', '2020-03-31');

insert into platform.cost_allocations (cost_entry_id, scope, organization_id, weight)
values ('5e400000-0000-4000-a000-0000000000c1', 'PLATFORM', null, 1),
       ('5e400000-0000-4000-a000-0000000000c2', 'ORGANIZATION', '30000000-0000-4000-a000-000000000004', 1);

-- ---------------------------------------------------------------------------
-- Componentes del margen por mes
-- ---------------------------------------------------------------------------
select is(pg_temp.monthly_txt(),
  '0|200.00|0|-200.00|true 400.00|0|0|400.00|true 100.00|200.00|0|-100.00|true NULL|0|0|NULL|false',
  'ene: costo sin cobro (margen negativo) · feb: cobro · mar: PEN convertido a 4 (400→100, 800→200) · '
  'abr: cobro en BOB sin tasa → cobrado y margen NULL, nunca 0');

select is(
  (select string_agg(month || ':' || collected_native::text || ' ' || missing_currencies::text, ' ' order by month)
     from platform.finance_monthly_series('2020-03-01', '2020-04-30', 'USD')),
  '2020-03-01:{"PEN": 400.00} {} 2020-04-01:{"BOB": 700.00, "USD": 600.00} {BOB}',
  'Los importes nativos se conservan y la moneda sin tasa se nombra');

select is(
  (select count(*)::int from platform.finance_monthly_series(null, null, 'USD')),
  12, 'Por defecto: 12 meses hasta el mes en curso');

select throws_ok(
  $$ select * from platform.finance_monthly_series('2020-05-01', '2020-01-01') $$,
  '22023', null, 'Rango invertido → error');

-- ---------------------------------------------------------------------------
-- Datos reales (seed y, si está cargada, demo)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
     from platform.finance_monthly_series(null, null, 'USD') s
     cross join lateral (
       select coalesce(jsonb_object_agg(r.native_currency, r.native_amount order by r.native_currency)
                         filter (where r.metric = 'COLLECTED'), '{}'::jsonb) as col,
              coalesce(jsonb_object_agg(r.native_currency, r.native_amount order by r.native_currency)
                         filter (where r.metric = 'COST'), '{}'::jsonb) as cost,
              coalesce(jsonb_object_agg(r.native_currency, r.native_amount order by r.native_currency)
                         filter (where r.metric = 'COMMISSION'), '{}'::jsonb) as com
         from platform.finance_reporting_rows(s.as_of, 'USD', 'TOTAL', null, null, null, null, s.month, s.as_of) r) r
    where s.collected_native is distinct from r.col
       or s.cost_native is distinct from r.cost
       or s.commission_native is distinct from r.com),
  0, 'Cobrado, costo y comisión nativos de cada mes = finance_reporting_rows del período (base de K05)');

select is(
  (select count(*)::int from platform.finance_monthly_series(null, null, 'USD')
    where margin is distinct from case when complete then collected - cost - commission end),
  0, 'Margen = cobrado − costo − comisión, sólo con las tres completas');

select is(
  (select count(*)::int
     from platform.collections_by_week(12, 'USD') w
     cross join lateral (
       select coalesce(jsonb_object_agg(x.currency, x.amount order by x.currency), '{}'::jsonb) as j,
              coalesce(sum(x.n), 0)::int as n
         from (select c.currency, sum(c.collected_amount) as amount, count(*) as n
                 from platform.v_collected_payments c
                where c.collected_on between w.week_start and w.as_of
                group by c.currency) x) c
    where w.collected_native is distinct from c.j or w.payment_count <> c.n),
  0, 'Cobrado nativo por semana = v_collected_payments (la fórmula de K02)');

select is(
  (select string_agg(distinct extract(isodow from week_start)::text || '/' || (week_end - week_start)::text, ',')
     || ' ' || count(*)::text || ' ' || bool_or(is_partial and week_start = date_trunc('week', current_date))::text
     from platform.collections_by_week(8, 'USD')),
  '1/6 8 true',
  'Semanas de lunes a domingo, la cantidad pedida y la actual marcada como parcial');

select throws_ok(
  $$ select * from platform.collections_by_week(0) $$,
  '22023', null, 'Cero semanas → error');

-- ---------------------------------------------------------------------------
-- Alcance por rol (RLS)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select is(pg_temp.monthly_txt(),
  '0|200.00|0|-200.00|true 400.00|0|0|400.00|true 100.00|200.00|0|-100.00|true NULL|0|0|NULL|false',
  'Finanzas ve la misma serie global');

select pg_temp.act_as(pg_temp.alpha_admin());
select is(
  (select string_agg(coalesce(collected::text, 'NULL'), ' ' order by month)
     from platform.finance_monthly_series('2020-01-01', '2020-04-30', 'USD')),
  '0 400.00 0 600.00',
  'Tenant admin de Alpha: sólo sus cobros (sin PEN ni BOB ajenos)');

select pg_temp.act_as(pg_temp.partner());
select is(
  (select coalesce(sum(collected), 0)
     from platform.finance_monthly_series('2020-01-01', '2020-04-30', 'USD')),
  0::numeric, 'Partner: no ve los cobros de clientes ajenos');

select pg_temp.act_as_postgres();

select throws_ok(
  $$ select * from platform.finance_monthly_series(null, null, 'XXX') $$,
  '22023', null, 'Moneda de reporte inexistente → error, nunca un número');

select * from finish();
rollback;
