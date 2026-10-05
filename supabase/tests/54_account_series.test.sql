-- ============================================================================
-- Serie mensual de una cuenta para las fichas 360 (20261018000100_account_series)
-- ----------------------------------------------------------------------------
-- Escenario aislado en 2020 con tasas QA (USD/PEN 4) sobre Alpha (USD) y
-- Omega (PEN):
--   INV-1  Alpha  USD 1000  emitida 01-01; pagos 400 (10-02) y 600 (20-03)
--   INV-2  Omega  PEN 4000  emitida 03-01; pago 400 (15-03)
-- Demuestra: facturado/cobrado por mes de UNA organización con conversión,
-- cuadre con las series globales sobre datos reales (Σ cuentas = S01 / S06),
-- modo tenant, errores de parámetros y alcance por rol (RLS). Todo se revierte.
-- ============================================================================
begin;
select plan(12);

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

create or replace function pg_temp.partner() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.omega() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000005'::uuid $$;

-- Serie 2020 (ene–mar) de una organización como «facturado|cobrado».
create or replace function pg_temp.org_txt(p_org uuid)
returns text language sql as $$
  select string_agg(concat_ws('|', coalesce(invoiced::text, 'NULL'), coalesce(collected::text, 'NULL')), ' ' order by month)
    from platform.executive_account_series(p_org, null, '2020-01-01', '2020-03-31', 'USD')
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos de ejecución
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname = 'executive_account_series'
      and not p.prosecdef and p.provolatile = 's'),
  1, 'executive_account_series existe, es SECURITY INVOKER y STABLE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname = 'executive_account_series'
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon no la ejecuta; authenticated sí');

-- ---------------------------------------------------------------------------
-- Fixture 2020
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', 'PEN', 4, 'MANUAL', false, 'QA serie por cuenta'
  from generate_series('2020-01-01'::date, '2020-04-01'::date, interval '1 month') d;

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date)
values
  ('5e500000-0000-4000-a000-000000000001', 'QA-ACC-INV-1', pg_temp.alpha(), 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e500000-0000-4000-a000-000000000002', 'QA-ACC-INV-2', pg_temp.omega(), 'ISSUED', 'PEN', '2020-03-01', '2020-03-31');

insert into platform.invoice_lines (invoice_id, charge_kind, description, unit_amount)
values ('5e500000-0000-4000-a000-000000000001', 'LICENSE', 'QA', 1000),
       ('5e500000-0000-4000-a000-000000000002', 'LICENSE', 'QA', 4000);

insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
values ('5e500000-0000-4000-a000-000000000001', 'QA-ACC-PAY-1', 'CONFIRMED', 400, 'USD', '2020-02-10'),
       ('5e500000-0000-4000-a000-000000000001', 'QA-ACC-PAY-2', 'CONFIRMED', 600, 'USD', '2020-03-20'),
       ('5e500000-0000-4000-a000-000000000002', 'QA-ACC-PAY-3', 'CONFIRMED', 400, 'PEN', '2020-03-15');

-- ---------------------------------------------------------------------------
-- Una organización, por mes
-- ---------------------------------------------------------------------------
select is(pg_temp.org_txt(pg_temp.alpha()),
  '1000.00|0 0|400.00 0|600.00',
  'Alpha: facturado en enero, cobrado en febrero y marzo (sólo lo suyo)');

select is(pg_temp.org_txt(pg_temp.omega()),
  '0|0 0|0 1000.00|100.00',
  'Omega: PEN convertido a la tasa del mes (4000→1000, 400→100)');

select is(
  (select invoiced_native::text || ' ' || collected_native::text
     from platform.executive_account_series(pg_temp.omega(), null, '2020-03-01', '2020-03-31', 'USD')),
  '{"PEN": 4000.00} {"PEN": 400.00}',
  'Los importes nativos se conservan por moneda');

select is(
  (select count(*)::int from platform.executive_account_series(pg_temp.alpha(), null, null, null, 'USD')),
  12, 'Por defecto: 12 meses hasta el mes en curso');

-- ---------------------------------------------------------------------------
-- Datos reales: Σ de las cuentas = series globales del mes en curso
-- ---------------------------------------------------------------------------
select is(
  (with acc as (
     select a.*
       from platform.organizations o
       cross join lateral platform.executive_account_series(o.id, null, current_date, current_date, 'USD') a),
   per as (
     select k, n.key as c, sum(n.value::numeric) as v
       from acc
       cross join lateral (values ('MRR', acc.mrr_native), ('INV', acc.invoiced_native), ('COL', acc.collected_native)) x(k, j)
       cross join lateral jsonb_each(x.j) n
      group by k, n.key),
   glob as (
     select 'MRR' as k, n.key as c, n.value::numeric as v
       from platform.executive_mrr_series(current_date, current_date, 'USD') s cross join lateral jsonb_each(s.mrr_native) n
     union all
     select 'INV', n.key, n.value::numeric
       from platform.executive_billing_series(current_date, current_date, 'USD') s cross join lateral jsonb_each(s.invoiced_native) n
     union all
     select 'COL', n.key, n.value::numeric
       from platform.executive_billing_series(current_date, current_date, 'USD') s cross join lateral jsonb_each(s.collected_native) n)
   select count(*)::int
     from per full join glob using (k, c)
    where per.v is distinct from glob.v),
  0,
  'Σ por organización del MRR, facturado y cobrado nativos = S01 y S06 del mes (misma definición)');

select is(
  (select count(*)::int
     from platform.tenants t
     cross join lateral platform.executive_account_series(null, t.id, current_date, current_date, 'USD') a
     cross join lateral (
       select coalesce(jsonb_object_agg(x.c, x.v order by x.c), '{}'::jsonb) as j
         from (select e.native_currency as c, sum(e.native_mrr) as v
                 from platform.executive_mrr_at(current_date, 'USD', current_date) e
                where e.tenant_id = t.id group by e.native_currency) x) e
    where a.mrr_native is distinct from e.j),
  0, 'Modo tenant: el MRR nativo de cada tenant = executive_mrr_at de sus suscripciones');

-- ---------------------------------------------------------------------------
-- Errores de parámetros
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select * from platform.executive_account_series(null, null) $$,
  '22023', null, 'Sin cuenta → error');

select throws_ok(
  format($$ select * from platform.executive_account_series(%L, %L) $$,
         pg_temp.alpha(), (select id from platform.tenants limit 1)),
  '22023', null, 'Organización y tenant a la vez → error');

-- ---------------------------------------------------------------------------
-- Alcance por rol (RLS)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.alpha_admin());
select is(pg_temp.org_txt(pg_temp.omega()),
  '0|0 0|0 0|0',
  'Tenant admin de Alpha: la cuenta de Omega no le suma nada');

select pg_temp.act_as(pg_temp.partner());
select is(pg_temp.org_txt(pg_temp.alpha()),
  '0|0 0|0 0|0',
  'Partner: no ve la cuenta de un cliente ajeno');

select pg_temp.act_as_postgres();

select * from finish();
rollback;
