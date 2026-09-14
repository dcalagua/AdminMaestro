-- ============================================================================
-- V3.1 · Billing cadence — motor server-side
-- ----------------------------------------------------------------------------
-- (a) `is_subscription_item_due_for_period`: helper puro, matriz de periodos.
-- (b) `subscription_due_items`: la única fuente de líneas debidas.
-- (c) `get_subscription_billing_status`: lo que pinta la UI (sin cadence en React).
-- (d) Seguridad de las funciones nuevas.
-- ============================================================================
begin;
select plan(42);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- «D» si toca, «-» si no, para cada mes de la lista.
create or replace function pg_temp.cadence(p_interval platform.billing_interval, p_anchor date,
                                           p_valid_to date, p_months date[])
returns text language sql immutable as $$
  select string_agg(case when platform.is_subscription_item_due_for_period(p_interval, p_anchor, p_valid_to, m)
                         then 'D' else '-' end, '' order by o)
    from unnest(p_months) with ordinality as t(m, o);
$$;

-- ---------------------------------------------------------------------------
-- (a) Helper puro
-- ---------------------------------------------------------------------------
select is(pg_temp.cadence('MONTHLY', '2026-01-15', null, array['2026-01-01','2026-02-01','2026-03-01']::date[]),
  'DDD', 'helper · MONTHLY ancla enero: ENE DUE, FEB DUE, MAR DUE');
select is(pg_temp.cadence('QUARTERLY', '2026-01-15', null,
          array['2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-06-01','2026-07-01']::date[]),
  'D--D--D', 'helper · QUARTERLY ancla enero: ENE DUE, FEB/MAR NOT, ABR DUE, MAY/JUN NOT, JUL DUE');
select is(pg_temp.cadence('YEARLY', '2026-03-13', null,
          array['2026-03-01','2026-04-01','2026-09-01','2027-02-01','2027-03-01']::date[]),
  'D---D', 'helper · YEARLY ancla marzo 2026: MAR26 DUE, ABR26/SEP26/FEB27 NOT, MAR27 DUE');
select is(pg_temp.cadence('YEARLY', '2026-03-13', null,
          array['2026-03-01','2026-04-01','2026-05-01','2026-06-01','2026-07-01','2026-08-01','2026-09-01',
                '2026-10-01','2026-11-01','2026-12-01','2027-01-01','2027-02-01','2027-03-01','2028-03-01']::date[]),
  'D-----------DD', 'helper · YEARLY: ninguno de los 11 meses intermedios toca; aniversarios sí');
select ok(platform.is_subscription_item_due_for_period('ONE_TIME', '2026-01-10', null, '2026-01-01', false),
  'helper · ONE_TIME primera factura: DUE');
select ok(not platform.is_subscription_item_due_for_period('ONE_TIME', '2026-01-10', null, '2026-01-01', true),
  'helper · ONE_TIME ya facturado: NOT DUE');
select ok(platform.is_subscription_item_due_for_period('ONE_TIME', '2026-01-10', null, '2026-04-01', false),
  'helper · ONE_TIME no facturado en su mes se factura en el siguiente periodo emitido');
select is(pg_temp.cadence('MONTHLY', '2026-01-31', null, array['2026-01-01','2026-02-01','2026-03-01','2026-04-01']::date[]),
  'DDDD', 'helper · ancla 31/01 MONTHLY: febrero (28 días) y abril (30) siguen DUE');
select is(pg_temp.cadence('QUARTERLY', '2026-01-31', null, array['2026-04-01','2026-05-01']::date[]),
  'D-', 'helper · ancla 31/01 QUARTERLY: abril DUE');
select is(pg_temp.cadence('YEARLY', '2024-02-29', null, array['2025-02-01','2025-03-01','2028-02-01']::date[]),
  'D-D', 'helper · ancla 29/02 YEARLY: febrero de años no bisiestos DUE');
select is(pg_temp.cadence('MONTHLY', '2026-05-20', null, array['2026-04-01','2026-05-01']::date[]),
  '-D', 'helper · valid_from: antes del mes de inicio NOT DUE; activación a mitad de mes DUE');
select is(pg_temp.cadence('YEARLY', '2026-05-20', null, array['2025-05-01']::date[]),
  '-', 'helper · YEARLY: un aniversario ANTERIOR al ancla nunca toca');
select is(pg_temp.cadence('MONTHLY', '2026-01-01', '2026-03-10', array['2026-03-01','2026-04-01']::date[]),
  'D-', 'helper · valid_to dentro del periodo DUE; después NOT DUE');
select is(pg_temp.cadence('QUARTERLY', '2026-01-01', '2026-03-31', array['2026-04-01']::date[]),
  '-', 'helper · QUARTERLY cuyo aniversario cae tras valid_to NOT DUE');
select ok(platform.is_subscription_item_due_for_period('QUARTERLY', '2026-01-15', null, '2026-04-17')
          = platform.is_subscription_item_due_for_period('QUARTERLY', '2026-01-15', null, '2026-04-01'),
  'helper · trabaja por periodo: cualquier día del mes da el mismo resultado');
select ok(not platform.is_subscription_item_due_for_period(null, '2026-01-01', null, '2026-01-01')
          and not platform.is_subscription_item_due_for_period('MONTHLY', null, null, '2026-01-01')
          and not platform.is_subscription_item_due_for_period('MONTHLY', '2026-01-01', null, null),
  'helper · entradas nulas nunca son DUE (nunca NULL)');
select is(
  (select p.provolatile::text || ' ' || p.prosecdef::text from pg_proc p
    where p.oid = 'platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean)'::regprocedure),
  'i false', 'helper · IMMUTABLE y SECURITY INVOKER: determinista y sin privilegios elevados');

-- ---------------------------------------------------------------------------
-- (b) subscription_due_items y (c) estado, sobre fixtures fijos
-- ---------------------------------------------------------------------------
insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id,
                                    status, billing_interval, currency, started_on)
values
  ('7c310000-0000-4000-a000-000000000001', 'SUB-QA-ENG-YR', '30000000-0000-4000-a000-000000000004',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   platform.market_id_by_code('EC'), 'ACTIVE', 'YEARLY', 'USD', '2026-03-13'),
  ('7c310000-0000-4000-a000-000000000002', 'SUB-QA-ENG-QTR', '30000000-0000-4000-a000-000000000004',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   platform.market_id_by_code('BO'), 'ACTIVE', 'QUARTERLY', 'BOB', '2026-01-15'),
  ('7c310000-0000-4000-a000-000000000003', 'SUB-QA-ENG-END', '30000000-0000-4000-a000-000000000004',
   '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   platform.market_id_by_code('PE'), 'ACTIVE', 'MONTHLY', 'PEN', '2026-01-01');

insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount, billing_interval, valid_from, valid_to)
values
  ('7c310000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia anual', 24000, 'YEARLY', '2026-03-13', null),
  ('7c310000-0000-4000-a000-000000000001', 'IMPLEMENTATION_FEE', 'Implementación', 12000, 'ONE_TIME', '2026-03-13', null),
  ('7c310000-0000-4000-a000-000000000002', 'LICENSE', 'Licencia trimestral', 3000, 'QUARTERLY', '2026-01-15', null),
  ('7c310000-0000-4000-a000-000000000003', 'LICENSE', 'Licencia mensual con fin', 3150, 'MONTHLY', '2026-01-01', '2026-02-20');

select is(
  (select string_agg(d.charge_kind::text, ',' order by d.charge_kind::text)
     from platform.subscription_due_items('7c310000-0000-4000-a000-000000000001', '2026-03-01') d),
  'IMPLEMENTATION_FEE,LICENSE', 'due_items · YEARLY+ONE_TIME en el periodo ancla: ambas líneas');
select is(
  (select string_agg(d.charge_kind::text, ',')
     from platform.subscription_due_items('7c310000-0000-4000-a000-000000000001', '2026-04-01') d),
  'IMPLEMENTATION_FEE', 'due_items · mes siguiente SIN haber emitido el ancla: la licencia anual no toca; el ONE_TIME pendiente se arrastra (primera factura)');
select is(
  (select p.provolatile::text || ' ' || p.prosecdef::text from pg_proc p
    where p.oid = 'platform.subscription_due_items(uuid, date)'::regprocedure),
  's false', 'due_items · STABLE (solo lectura) y SECURITY INVOKER (respeta RLS)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- EBIM_FINANCE

create temp table qa_st as
select 'yr-mar'::text as k, platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-03-01') as j
union all
select 'qtr-feb', platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000002', '2026-02-01')
union all
select 'end-mar', platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000003', '2026-03-01');

select is(
  (select concat_ws(' ', j ->> 'has_due_items', j ->> 'due_item_count', j ->> 'currency', j ->> 'estimated_total',
                    j ->> 'can_issue', j ->> 'next_billing_period') from qa_st where k = 'yr-mar'),
  'true 2 USD 36000.00 true 2026-03-01',
  'status · YEARLY periodo ancla sin facturar: 2 cargos, USD 36,000 estimado, próxima facturación = este periodo');
select is(
  (select concat_ws(' ', j ->> 'has_due_items', j ->> 'currency', j ->> 'next_billing_period') from qa_st where k = 'qtr-feb'),
  'false BOB 2026-04-01', 'status · QUARTERLY mes +1: sin cargos; próxima facturación en el trimestre siguiente');
select is(
  (select coalesce(j ->> 'next_billing_period', 'NULL') || ' ' || (j ->> 'has_due_items') from qa_st where k = 'end-mar'),
  'NULL false', 'status · línea terminada: no inventa una próxima facturación');

select is(
  platform.issue_subscription_invoice('7c310000-0000-4000-a000-000000000001', '2026-03-01') ->> 'created', 'true',
  'status · se emite la factura del periodo ancla');
select is(
  (select concat_ws(' ', s ->> 'can_issue', s -> 'existing_invoice' ->> 'number', s -> 'existing_invoice' ->> 'total',
                    s ->> 'next_billing_period')
     from (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-03-01') s) x),
  'false INV-202603-SUB-QA-ENG-YR 36000.00 2027-03-01',
  'status · tras emitir: muestra la factura vigente, ya no ofrece emitir y la próxima es +12 meses');
select is(
  (select concat_ws(' ', j ->> 'period_start', j ->> 'period_end', j ->> 'has_due_items', j ->> 'due_item_count',
                    j ->> 'estimated_total', j ->> 'can_issue', j ->> 'next_billing_period')
     from (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-04-20') j) x),
  '2026-04-01 2026-04-30 false 0 0.00 false 2027-03-01',
  'status · YEARLY mes siguiente (ancla ya emitida): sin cargos, no se puede emitir, próxima facturación en el aniversario');
select is(
  (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2027-03-01') ->> 'estimated_total'),
  '24000.00', 'status · aniversario: el estimado ya no incluye el ONE_TIME facturado');
select is(
  (select (d ->> 'has_due_items') || ' ' || (d ->> 'can_issue')
     from (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-04-01') d) x),
  'false false', 'status · coincide con la emisión: donde no hay cargos la RPC tampoco factura');
select throws_like(
  $$ select platform.issue_subscription_invoice('7c310000-0000-4000-a000-000000000001', '2026-04-01') $$,
  'SIN_LINEAS_FACTURABLES%', 'status y emisión usan el mismo motor (abril no factura)');

select is(
  (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-03-01') ->> 'currency'),
  'USD', 'status · moneda del contrato, sin conversión');

-- ---------------------------------------------------------------------------
-- (d) Seguridad
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');  -- ORG_ADMIN/TENANT_ADMIN de Alpha (dueña del contrato)
select is(
  (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000002', '2026-01-01') ->> 'currency'),
  'BOB', 'status · el admin del propio cliente lo ve por RLS (y aun así no puede emitir: pgTAP 18 · 23b)');

select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');  -- TENANT_ADMIN de Omega (otro cliente)
select throws_like(
  $$ select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-03-01') $$,
  'SUSCRIPCION_NO_ENCONTRADA%', 'status · TENANT_ADMIN ajeno no ve el estado (RLS del llamante)');
select is(
  (select count(*)::int from platform.subscription_due_items('7c310000-0000-4000-a000-000000000001', '2026-03-01')),
  0, 'due_items · TENANT_ADMIN ajeno no ve líneas (RLS del llamante)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- PARTNER_ADMIN (otra org)
select throws_like(
  $$ select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000001', '2026-03-01') $$,
  'SUSCRIPCION_NO_ENCONTRADA%', 'status · PARTNER_ADMIN sin relación no ve el estado');

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin
select is(
  (select platform.get_subscription_billing_status('7c310000-0000-4000-a000-000000000002', '2026-01-01') ->> 'can_issue'),
  'true', 'status · EBIM_SUPER_ADMIN lo consulta');

reset role;

select ok(not has_function_privilege('anon', 'platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'platform.subscription_due_items(uuid, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'platform.get_subscription_billing_status(uuid, date)', 'EXECUTE'),
  'seguridad · anon no ejecuta ninguna función nueva');
select ok(not has_function_privilege('public', 'platform.get_subscription_billing_status(uuid, date)', 'EXECUTE')
          and not has_function_privilege('public', 'platform.subscription_due_items(uuid, date)', 'EXECUTE'),
  'seguridad · PUBLIC sin EXECUTE');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean)'::regprocedure,
                    'platform.subscription_due_items(uuid, date)'::regprocedure,
                    'platform.get_subscription_billing_status(uuid, date)'::regprocedure)
      and not p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)),
  3, 'seguridad · las 3 funciones nuevas son SECURITY INVOKER con search_path fijo');
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'platform.get_subscription_billing_status(uuid, date)'::regprocedure),
  's', 'seguridad · get_subscription_billing_status es STABLE: no puede escribir');
select ok(
  (select p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p where p.oid = 'platform.issue_subscription_invoice(uuid, date)'::regprocedure),
  'seguridad · issue_subscription_invoice: DEFINER + search_path + EXECUTE solo authenticated (autoriza dentro)');
select is(
  (select count(*)::int from pg_proc p where p.oid = 'platform.issue_subscription_invoice(uuid, date)'::regprocedure
      and (p.prosrc ilike '%fx_%' or p.prosrc ilike '%exchange_rate%' or p.prosrc ilike '%reporting%')),
  0, 'multimoneda · la emisión no usa FX ni moneda de reporte');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('platform.subscription_due_items(uuid, date)'::regprocedure,
                    'platform.get_subscription_billing_status(uuid, date)'::regprocedure)
      and (p.prosrc ilike '%fx_%' or p.prosrc ilike '%exchange_rate%' or p.prosrc ilike '%reporting%')),
  0, 'multimoneda · el motor de cadence no usa FX ni moneda de reporte');

select * from finish();
rollback;
