-- ============================================================================
-- Series ejecutivas (20261015000100_executive_series)
-- ----------------------------------------------------------------------------
-- Escenario aislado en 2020 (el seed y la demo empiezan años después), con
-- tasas QA propias (USD/PEN 4 hasta marzo y 5 desde abril; sin tasa BOB):
--   A  Empresa Directa Alpha   USD  1000 mes + 1200 año + 300 trimestre − 50 dto
--                                   + 5000 único (fuera); +200 addon desde marzo
--   B  Empresa Enterprise Omega PEN 4000 → 2000 desde mayo (contracción)
--   C  Industrias Titán        USD  500, CANCELLED con fin 2020-02-29 (churn marzo)
--   H  Exportadora Guayas      USD  300 desde febrero (nuevo), producto EWM, mercado EC
--   G  Minera Illimani         BOB  7000 desde 2020-06-10 (sin tasa → MISSING_FX)
--   Excluidos: tenant DEMO, tenant SANDBOX, DRAFT, PAUSED.
-- Demuestra: mensualización, exclusiones, conversión, puente que cuadra al
-- céntimo (también sobre los datos reales de los últimos 12 meses), mix que
-- suma la serie, cartera a fecha, estabilidad y alcance por rol (RLS).
-- Todo se revierte al final.
-- ============================================================================
begin;
select plan(47);

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
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;

-- Serie 2020 como texto «v1,v2,…» (NULL explícito).
create or replace function pg_temp.series_txt(p_col text, p_rc char(3) default 'USD')
returns text language plpgsql as $$
declare v text;
begin
  execute format(
    'select string_agg(coalesce(%I::text, ''NULL''), '','' order by month)
       from platform.executive_mrr_series(''2020-01-01'', ''2020-06-30'', %L)', p_col, p_rc)
    into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos de ejecución
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('executive_reporting_config', 'executive_mrr_at', 'executive_mrr_series',
                        'executive_mrr_movement_customers', 'executive_mrr_movements',
                        'executive_mrr_mix', 'executive_receivables_aging')
      and not p.prosecdef and p.provolatile = 's'),
  7, 'Las 7 funciones nuevas existen, son SECURITY INVOKER y STABLE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname like 'executive\_%'
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon no ejecuta ninguna función ejecutiva; authenticated sí');

-- ---------------------------------------------------------------------------
-- Fixture 2020
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', 'PEN', case when d < '2020-04-01' then 4 else 5 end, 'MANUAL', false, 'QA series ejecutivas'
  from generate_series('2020-01-01'::date, '2020-06-01'::date, interval '1 month') d;

-- Tenant SANDBOX (el TRIAL del seed, sólo dentro de esta transacción).
update platform.tenants set tenant_type = 'SANDBOX' where id = '50000000-0000-4000-a000-00000000000a';

insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id, tenant_id,
                                    status, billing_interval, currency, started_on, ends_on, cancelled_at)
values
  ('5e100000-0000-4000-a000-00000000000a', 'QA-SER-A', '30000000-0000-4000-a000-000000000004',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), null,
   'ACTIVE', 'MONTHLY', 'USD', '2020-01-01', null, null),
  ('5e100000-0000-4000-a000-00000000000b', 'QA-SER-B', '30000000-0000-4000-a000-000000000005',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), null,
   'ACTIVE', 'MONTHLY', 'PEN', '2020-01-15', null, null),
  ('5e100000-0000-4000-a000-00000000000c', 'QA-SER-C', '30000000-0000-4000-a000-00000000000a',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), null,
   'CANCELLED', 'MONTHLY', 'USD', '2020-01-10', '2020-02-29', '2020-02-10'),
  ('5e100000-0000-4000-a000-000000000011', 'QA-SER-H', '30000000-0000-4000-a000-00000000000f',
   '20000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000005', platform.market_id_by_code('EC'), null,
   'ACTIVE', 'MONTHLY', 'USD', '2020-02-01', null, null),
  ('5e100000-0000-4000-a000-000000000010', 'QA-SER-G', '30000000-0000-4000-a000-00000000000d',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('BO'), null,
   'ACTIVE', 'MONTHLY', 'BOB', '2020-06-10', null, null),
  -- Excluidos
  ('5e100000-0000-4000-a000-00000000000d', 'QA-SER-DEMO', '30000000-0000-4000-a000-000000000002',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'),
   '50000000-0000-4000-a000-000000000004', 'PAST_DUE', 'MONTHLY', 'USD', '2020-01-01', null, null),
  ('5e100000-0000-4000-a000-00000000000e', 'QA-SER-SANDBOX', '30000000-0000-4000-a000-000000000004',
   '20000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000005', platform.market_id_by_code('PE'),
   '50000000-0000-4000-a000-00000000000a', 'ACTIVE', 'MONTHLY', 'USD', '2020-01-01', null, null),
  ('5e100000-0000-4000-a000-00000000000f', 'QA-SER-DRAFT', '30000000-0000-4000-a000-00000000000c',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), null,
   'DRAFT', 'MONTHLY', 'USD', '2020-01-01', null, null),
  ('5e100000-0000-4000-a000-000000000012', 'QA-SER-PAUSED', '30000000-0000-4000-a000-00000000000c',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), null,
   'PAUSED', 'MONTHLY', 'USD', '2020-01-01', null, null);

insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount, billing_interval, valid_from, valid_to)
values
  ('5e100000-0000-4000-a000-00000000000a', 'LICENSE',            'A licencia',      1000, 'MONTHLY',   '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000a', 'SUPPORT_FEE',        'A soporte anual', 1200, 'YEARLY',    '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000a', 'INFRASTRUCTURE_FEE', 'A infra trim.',    300, 'QUARTERLY', '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000a', 'DISCOUNT',           'A descuento',       50, 'MONTHLY',   '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000a', 'IMPLEMENTATION_FEE', 'A implantación', 5000, 'ONE_TIME',  '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000a', 'ADDON',              'A usuarios',       200, 'MONTHLY',   '2020-03-01', null),
  ('5e100000-0000-4000-a000-00000000000b', 'LICENSE',            'B licencia',      4000, 'MONTHLY',   '2020-01-15', '2020-04-30'),
  ('5e100000-0000-4000-a000-00000000000b', 'LICENSE',            'B licencia baja', 2000, 'MONTHLY',   '2020-05-01', null),
  ('5e100000-0000-4000-a000-00000000000c', 'LICENSE',            'C licencia',       500, 'MONTHLY',   '2020-01-10', null),
  ('5e100000-0000-4000-a000-000000000011', 'LICENSE',            'H licencia',       300, 'MONTHLY',   '2020-02-01', null),
  ('5e100000-0000-4000-a000-000000000010', 'LICENSE',            'G licencia',      7000, 'MONTHLY',   '2020-06-10', null),
  ('5e100000-0000-4000-a000-00000000000d', 'LICENSE',            'DEMO',            9999, 'MONTHLY',   '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000e', 'LICENSE',            'SANDBOX',         7777, 'MONTHLY',   '2020-01-01', null),
  ('5e100000-0000-4000-a000-00000000000f', 'LICENSE',            'DRAFT',           3333, 'MONTHLY',   '2020-01-01', null),
  ('5e100000-0000-4000-a000-000000000012', 'LICENSE',            'PAUSED',          4444, 'MONTHLY',   '2020-01-01', null);

-- ---------------------------------------------------------------------------
-- MRR a una fecha: mensualización, exclusiones, conversión
-- ---------------------------------------------------------------------------
select is(
  (select native_mrr from platform.executive_mrr_at('2020-01-31', 'USD')
    where subscription_id = '5e100000-0000-4000-a000-00000000000a'),
  1150.00::numeric,
  'Mensualización: 1000 + 1200/12 + 300/3 − 50 de descuento; el ONE_TIME de 5000 no entra');

select is(
  (select count(*)::int from platform.executive_mrr_at('2020-01-31', 'USD')
    where subscription_id in ('5e100000-0000-4000-a000-00000000000d', '5e100000-0000-4000-a000-00000000000e')),
  0, 'Tenants DEMO y SANDBOX no aportan MRR');

select is(
  (select count(*)::int from platform.executive_mrr_at('2020-01-31', 'USD')
    where subscription_id in ('5e100000-0000-4000-a000-00000000000f', '5e100000-0000-4000-a000-000000000012')),
  0, 'DRAFT y PAUSED no aportan MRR');

select is(
  (select native_mrr || ' ' || native_currency || ' → ' || reporting_mrr || ' ' || reporting_currency || ' ' || conversion_status
     from platform.executive_mrr_at('2020-01-31', 'USD')
    where subscription_id = '5e100000-0000-4000-a000-00000000000b'),
  '4000.00 PEN → 1000.00 USD CONVERTED',
  'Conversión con el motor FX existente (USD/PEN 4, recíproca)');

select is(
  (select string_agg(d || '=' || (exists (
            select 1 from platform.executive_mrr_at(d::date, 'USD')
             where subscription_id = '5e100000-0000-4000-a000-00000000000c'))::text, ' ' order by d)
     from unnest(array['2020-02-29', '2020-03-31']) d),
  '2020-02-29=true 2020-03-31=false',
  'Una baja aporta hasta su fecha de fin y desaparece después');

-- ---------------------------------------------------------------------------
-- Serie mensual
-- ---------------------------------------------------------------------------
select is(pg_temp.series_txt('mrr'), '2650.00,2950.00,2650.00,2450.00,2050.00,NULL',
  'Serie de MRR en USD (junio NULL: falta tasa BOB, no 0)');

select is(pg_temp.series_txt('arr'), '31800.00,35400.00,31800.00,29400.00,24600.00,NULL', 'ARR = MRR × 12');

select is(pg_temp.series_txt('active_customers') || ' / ' || pg_temp.series_txt('active_subscriptions'),
  '3,4,3,3,3,4 / 3,4,3,3,3,4',
  'Clientes y contratos activos por mes');

select is(
  (select complete::text || ' ' || missing_currencies::text || ' ' || mrr_native::text
     from platform.executive_mrr_series('2020-06-01', '2020-06-30', 'USD')),
  'false {BOB} {"BOB": 7000.00, "PEN": 2000.00, "USD": 1650.00}',
  'Mes incompleto: declara la moneda sin tasa y conserva los importes nativos');

select is(pg_temp.series_txt('mrr', 'PEN'), '10600.00,11800.00,10600.00,12250.00,10250.00,NULL',
  'Serie en PEN: cada suscripción USD se convierte a la tasa de su mes');

select is(
  (select jsonb_agg(to_jsonb(s) order by s.month)
     from platform.executive_mrr_series('2020-01-01', '2020-06-30', 'USD') s),
  (select jsonb_agg(to_jsonb(s) order by s.month)
     from platform.executive_mrr_series('2020-01-01', '2020-06-30', 'USD') s),
  'Estabilidad: mismos datos → mismo resultado');

select is(
  (select count(*)::int || ' ' || (max(month) = date_trunc('month', current_date)::date)::text
          || ' ' || (bool_or(as_of > current_date))::text
     from platform.executive_mrr_series()),
  '18 true false',
  'Por defecto: 18 meses hasta el mes en curso, sin fechas futuras');

select throws_ok(
  $$ select * from platform.executive_mrr_series('2020-01-01', '2020-03-01', 'XYZ') $$,
  '22023', null, 'Moneda de reporte inexistente → error, no un número');

select throws_ok(
  $$ select * from platform.executive_mrr_series('2020-05-01', '2020-03-01') $$,
  '22023', null, 'Rango invertido → error');

-- ---------------------------------------------------------------------------
-- Puente de MRR
-- ---------------------------------------------------------------------------
create or replace function pg_temp.bridge(p_month date)
returns text language sql as $$
  select concat_ws(' ', opening_mrr, new_mrr, expansion_mrr, contraction_mrr, churn_mrr, closing_mrr)
    from platform.executive_mrr_movements(p_month, 'USD')
$$;

select is(pg_temp.bridge('2020-02-01'), '2650.00 300.00 0 0 0 2950.00',
  'Febrero: entra Guayas (nuevo 300)');

select is(pg_temp.bridge('2020-03-01'), '2950.00 0 200.00 0 500.00 2650.00',
  'Marzo: Alpha expande 200 y Titán hace churn de 500');

select is(
  (select pg_temp.bridge('2020-04-01') || ' | ' || prior_closing_mrr || ' ' || fx_revaluation
     from platform.executive_mrr_movements('2020-04-01', 'USD')),
  '2450.00 0 0 0 0 2450.00 | 2650.00 -200.00',
  'Abril: sin movimientos de negocio; el cambio de tasa va a fx_revaluation, no a contracción');

select is(pg_temp.bridge('2020-05-01'), '2450.00 0 0 400.00 0 2050.00',
  'Mayo: Omega contrae 400');

select is(
  (select count(*)::int
     from generate_series('2020-02-01'::date, '2020-05-01'::date, interval '1 month') g
     cross join lateral platform.executive_mrr_movements(g::date, 'USD') m
    where m.opening_mrr + m.new_mrr + m.expansion_mrr - m.contraction_mrr - m.churn_mrr <> m.closing_mrr
       or not m.complete),
  0, 'Invariante: opening + new + expansion − contraction − churn = closing (feb–may)');

select is(
  (select string_agg(m.closing_mrr::text, ',' order by g)
     from generate_series('2020-02-01'::date, '2020-05-01'::date, interval '1 month') g
     cross join lateral platform.executive_mrr_movements(g::date, 'USD') m),
  (select string_agg(s.mrr::text, ',' order by s.month)
     from platform.executive_mrr_series('2020-02-01', '2020-05-31', 'USD') s),
  'El cierre del puente es exactamente el punto de la serie');

select is(
  (select complete::text || ' ' || coalesce(opening_mrr::text, 'NULL') || ' ' || coalesce(closing_mrr::text, 'NULL')
     from platform.executive_mrr_movements('2020-06-01', 'USD')),
  'false NULL NULL',
  'Junio sin tasa BOB: el puente no inventa importes');

select is(
  (select string_agg(organization_name || ':' || movement || ':' || opening_mrr || '→' || closing_mrr, ' ' order by organization_name)
     from platform.executive_mrr_movement_customers('2020-03-01', 'USD')),
  'Empresa Directa Alpha:EXPANSION:1150.00→1350.00 Empresa Enterprise Omega:FLAT:1000.00→1000.00 '
  'Exportadora Guayas:FLAT:300.00→300.00 Industrias Titán:CHURN:500.00→0',
  'Detalle por cliente (organización facturada) de marzo');

select is(
  (select concat_ws(' ', sum(opening_mrr), sum(closing_mrr),
                    sum(delta_mrr) filter (where movement = 'EXPANSION'),
                    -sum(delta_mrr) filter (where movement = 'CHURN'))
     from platform.executive_mrr_movement_customers('2020-03-01', 'USD')),
  (select concat_ws(' ', opening_mrr, closing_mrr, expansion_mrr, churn_mrr)
     from platform.executive_mrr_movements('2020-03-01', 'USD')),
  'Los totales del puente son la suma del detalle por cliente');

select throws_ok(
  $$ select * from platform.executive_mrr_movements((current_date + interval '2 months')::date) $$,
  '22023', null, 'Mes futuro → error');

-- Datos reales (seed y, si está cargada, demo): tasas QA para los últimos 13
-- meses de cada moneda con contratos; el puente debe cuadrar en todos.
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select d::date, 'USD', c.currency, 3 + row_number() over (partition by c.currency order by d) / 10.0,
       'MANUAL', false, 'QA series ejecutivas'
  from generate_series(date_trunc('month', current_date) - interval '13 months',
                       date_trunc('month', current_date), interval '1 month') d
 cross join (select distinct currency from platform.subscriptions where currency <> 'USD') c
on conflict do nothing;

select is(
  (select count(*)::int
     from generate_series(date_trunc('month', current_date) - interval '11 months',
                          date_trunc('month', current_date), interval '1 month') g
     cross join lateral platform.executive_mrr_movements(g::date, 'USD') m
    where not m.complete
       or m.opening_mrr + m.new_mrr + m.expansion_mrr - m.contraction_mrr - m.churn_mrr <> m.closing_mrr),
  0, 'Invariante del puente al céntimo sobre los datos reales de los últimos 12 meses');

select is(
  (select count(*)::int
     from generate_series(date_trunc('month', current_date) - interval '11 months',
                          date_trunc('month', current_date), interval '1 month') g
     cross join lateral platform.executive_mrr_movements(g::date, 'USD') m
     join platform.executive_mrr_series((current_date - interval '11 months')::date, current_date, 'USD') s
       on s.month = m.month
    where m.closing_mrr <> s.mrr or m.prior_closing_mrr + m.fx_revaluation <> m.opening_mrr),
  0, 'Datos reales: cierre = serie y prior_closing + fx_revaluation = opening');

select is(
  (select jsonb_object_agg(native_currency, amount order by native_currency)
     from (select e.native_currency, sum(e.native_mrr) as amount
             from platform.executive_mrr_at(current_date, 'USD') e
             join platform.subscriptions s on s.id = e.subscription_id
            where s.status = 'ACTIVE'
            group by 1) x),
  (select jsonb_object_agg(currency, amount order by currency)
     from (select v.currency, sum(v.mrr) as amount
             from platform.v_subscription_mrr v
             join platform.subscriptions s on s.id = v.subscription_id
            where s.started_on <= current_date
              and (s.ends_on is null or s.ends_on >= current_date)
              and v.tenant_type is distinct from 'SANDBOX'
            group by 1) x),
  'A hoy, los contratos ACTIVE suman lo mismo que v_subscription_mrr (salvo SANDBOX, que aquí se excluye)');

-- ---------------------------------------------------------------------------
-- Mix por producto y mercado
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(group_label || '=' || mrr || '/' || share, ' ' order by mrr desc)
     from platform.executive_mrr_mix('2020-03-01', 'PRODUCT', 'USD')),
  'eSupplier=2350.00/0.8868 EWM=300.00/0.1132',
  'Mix por producto al cierre de marzo, con participación');

select is(
  (select string_agg(group_key || ':' || group_label || '=' || mrr, ' ' order by mrr desc)
     from platform.executive_mrr_mix('2020-03-01', 'market', 'USD')),
  'PE:Perú=2350.00 EC:Ecuador=300.00',
  'Mix por mercado al cierre de marzo');

select is(
  (select sum(mrr) from platform.executive_mrr_mix('2020-05-01', 'PRODUCT', 'USD')),
  (select mrr from platform.executive_mrr_series('2020-05-01', '2020-05-31', 'USD')),
  'Σ del mix = punto de la serie del mes');

select throws_ok(
  $$ select * from platform.executive_mrr_mix('2020-03-01', 'PAIS') $$,
  '22023', null, 'Dimensión desconocida → error');

-- ---------------------------------------------------------------------------
-- Cartera por antigüedad a una fecha
-- ---------------------------------------------------------------------------
insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date)
values
  ('5e200000-0000-4000-a000-000000000001', 'QA-SER-INV-1', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e200000-0000-4000-a000-000000000002', 'QA-SER-INV-2', '30000000-0000-4000-a000-000000000005', 'ISSUED', 'PEN', '2020-03-01', '2020-03-31'),
  ('5e200000-0000-4000-a000-000000000003', 'QA-SER-INV-3', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-01-01', '2020-01-16'),
  ('5e200000-0000-4000-a000-000000000004', 'QA-SER-INV-4', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2020-04-01', '2020-04-16'),
  ('5e200000-0000-4000-a000-000000000005', 'QA-SER-INV-5', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2019-12-01', null),
  ('5e200000-0000-4000-a000-000000000006', 'QA-SER-INV-6', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', '2019-10-01', '2019-10-15');

insert into platform.invoice_lines (invoice_id, charge_kind, description, unit_amount)
values ('5e200000-0000-4000-a000-000000000001', 'LICENSE', 'QA', 1000),
       ('5e200000-0000-4000-a000-000000000002', 'LICENSE', 'QA', 4000),
       ('5e200000-0000-4000-a000-000000000003', 'LICENSE', 'QA', 999),
       ('5e200000-0000-4000-a000-000000000004', 'LICENSE', 'QA', 500),
       ('5e200000-0000-4000-a000-000000000005', 'LICENSE', 'QA', 200),
       ('5e200000-0000-4000-a000-000000000006', 'LICENSE', 'QA', 300);

update platform.invoices set status = 'VOID' where id = '5e200000-0000-4000-a000-000000000003';

insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at)
values ('5e200000-0000-4000-a000-000000000001', 'QA-SER-PAY-1', 'CONFIRMED', 400, 'USD', '2020-02-10'),
       ('5e200000-0000-4000-a000-000000000001', 'QA-SER-PAY-2', 'CONFIRMED', 600, 'USD', '2020-04-20');

create or replace function pg_temp.aging(p_as_of date)
returns text language sql as $$
  select string_agg(aging_bucket || ':' || invoice_count || '=' || balance, ' ' order by bucket_order)
    from platform.executive_receivables_aging(p_as_of, 'USD')
   where invoice_count > 0
$$;

select is(
  (select string_agg(aging_bucket, ',' order by bucket_order) from platform.executive_receivables_aging('2020-03-31', 'USD')),
  'VIGENTE,D1_30,D31_60,D61_90,D90_MAS,SIN_FECHA',
  'Siempre las 6 bandas, en orden');

select is(pg_temp.aging('2020-03-31'),
  'VIGENTE:1=1000.00 D61_90:1=600.00 D90_MAS:1=300.00 SIN_FECHA:1=200.00',
  'Cartera al 31-03-2020: pago parcial descontado, PEN convertido, anulada y futura fuera');

select is(pg_temp.aging('2020-02-05'),
  'D1_30:1=1000.00 D90_MAS:1=300.00 SIN_FECHA:1=200.00',
  'Cartera al 05-02-2020: el pago del 10-02 aún no existe');

select is(pg_temp.aging('2020-05-01'),
  'D1_30:1=500.00 D31_60:1=800.00 D90_MAS:1=300.00 SIN_FECHA:1=200.00',
  'Cartera al 01-05-2020: factura saldada fuera; PEN a la tasa de mayo (5)');

select is(
  (select jsonb_object_agg(aging_bucket, balance_native order by aging_bucket)
     from platform.executive_receivables_aging(current_date, 'USD') where invoice_count > 0),
  (select jsonb_object_agg(aging_bucket, n order by aging_bucket)
     from (select aging_bucket, jsonb_object_agg(currency, balance order by currency) as n
             from platform.receivables_aging()
            where aging_bucket not in ('SALDADA', 'A_FAVOR')
            group by aging_bucket) x),
  'A hoy concilia por banda y moneda con receivables_aging() (foto actual)');

select throws_ok(
  $$ select * from platform.executive_receivables_aging(current_date + 1) $$,
  '22023', null, 'Fecha futura → error');

-- ---------------------------------------------------------------------------
-- Alcance por rol (RLS): finanzas ve el total; tenant admin y partner no.
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
select set_config('ebim.super_series', pg_temp.series_txt('mrr'), true);
select set_config('ebim.super_aging', pg_temp.aging('2020-03-31'), true);

select pg_temp.act_as(pg_temp.finance());
select is(pg_temp.series_txt('mrr'), current_setting('ebim.super_series'),
  'Finanzas ve la misma serie global que el super admin');
select is(pg_temp.aging('2020-03-31'), current_setting('ebim.super_aging'),
  'Finanzas ve la misma cartera global que el super admin');
select is(current_setting('ebim.super_series'), '2650.00,2950.00,2650.00,2450.00,2050.00,NULL',
  'El super admin ve la serie global');

select pg_temp.act_as(pg_temp.alpha_admin());
select is(
  (select active_customers || ' ' || mrr_native::text || ' ' || coalesce(mrr::text, 'NULL')
     from platform.executive_mrr_series('2020-01-01', '2020-01-31', 'USD')),
  '1 {"USD": 1150.00} 1150.00',
  'Tenant admin de Alpha: sólo su MRR, no el total global');
select is(pg_temp.bridge('2020-03-01'), '1150.00 0 200.00 0 0 1350.00',
  'Tenant admin de Alpha: el puente sólo contiene a su organización');
select is(
  (select string_agg(organization_name, ',') from platform.executive_mrr_movement_customers('2020-03-01', 'USD')),
  'Empresa Directa Alpha',
  'Tenant admin de Alpha: el detalle no expone otros clientes');

select pg_temp.act_as(pg_temp.partner());
select is(
  (select active_customers || ' ' || mrr_native::text
     from platform.executive_mrr_series('2020-01-01', '2020-01-31', 'USD')),
  '0 {}',
  'Partner: no ve contratos de clientes ajenos ni totales globales');
select is(
  (select sum(invoice_count)::int from platform.executive_receivables_aging('2020-03-31', 'USD')),
  0,
  'Partner: no ve la cartera de clientes ajenos');

select pg_temp.act_as_postgres();

select * from finish();
rollback;
