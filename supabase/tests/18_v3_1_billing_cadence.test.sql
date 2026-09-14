-- ============================================================================
-- V3.1 · Billing cadence — comportamiento de `issue_subscription_invoice`
-- ----------------------------------------------------------------------------
-- Una factura del periodo incluye SOLO las líneas que tocan en ese periodo según
-- su propia periodicidad, contada en MESES desde su ancla (`valid_from`):
--   MONTHLY cada 1 · QUARTERLY cada 3 · YEARLY cada 12 · ONE_TIME una sola vez.
--
-- Este archivo usa solo la RPC pública (no el helper nuevo) para que corra
-- también ANTES del fix: contra la migración 34 falla en los casos QUARTERLY,
-- YEARLY, mixtos, importe cero y re-emisión tras VOID (evidencia de la causa raíz
-- en `docs/nightly-v3-1/evidence/`).
--
-- Fixtures independientes del seed con fechas FIJAS; la regresión GRUPASA usa
-- además el contrato real del seed, calculando su ancla en vez de suponerla.
-- ============================================================================
begin;
select plan(64);

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

create or replace function pg_temp.sub(p_code text, p_market text, p_currency text, p_interval platform.billing_interval)
returns uuid language sql as $$
  insert into platform.subscriptions (code, billed_organization_id, saas_product_id, plan_id, market_id,
                                      status, billing_interval, currency, started_on)
  values (p_code, '30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001',
          '60000000-0000-4000-a000-000000000001', platform.market_id_by_code(p_market),
          'ACTIVE', p_interval, p_currency, '2026-01-01')
  returning id;
$$;

create or replace function pg_temp.item(p_code text, p_kind platform.charge_kind, p_amount numeric,
                                        p_interval platform.billing_interval, p_from date, p_to date default null)
returns void language sql as $$
  insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount,
                                           billing_interval, valid_from, valid_to)
  select s.id, p_kind, p_kind::text || ' ' || p_interval::text, p_amount, p_interval, p_from, p_to
    from platform.subscriptions s where s.code = p_code;
$$;

create or replace function pg_temp.sid(p_code text)
returns uuid language sql stable as $$
  select id from platform.subscriptions where code = p_code;
$$;

create or replace function pg_temp.issue(p_code text, p_period date)
returns jsonb language sql as $$
  select platform.issue_subscription_invoice(pg_temp.sid(p_code), p_period);
$$;

-- Factura vigente (no VOID) de un periodo: «MON total [kinds]».
create or replace function pg_temp.summary(p_code text, p_period date)
returns text language sql stable as $$
  select i.currency || ' ' || i.total || ' [' ||
         coalesce((select string_agg(l.charge_kind::text, ',' order by l.charge_kind::text)
                     from platform.invoice_lines l where l.invoice_id = i.id), '') || ']'
    from platform.invoices i
   where i.subscription_id = pg_temp.sid(p_code) and i.period_start = p_period and i.status <> 'VOID';
$$;

create or replace function pg_temp.invoices_in(p_code text, p_period date)
returns integer language sql stable as $$
  select count(*)::int from platform.invoices i
   where i.subscription_id = pg_temp.sid(p_code) and i.period_start = p_period;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
select pg_temp.sub('SUB-QA-CAD-MON-PEN', 'PE', 'PEN', 'MONTHLY');
select pg_temp.item('SUB-QA-CAD-MON-PEN', 'LICENSE', 3150, 'MONTHLY', '2026-01-01');

select pg_temp.sub('SUB-QA-CAD-QTR-BOB', 'BO', 'BOB', 'QUARTERLY');
select pg_temp.item('SUB-QA-CAD-QTR-BOB', 'LICENSE', 3000, 'QUARTERLY', '2026-01-15');

-- Equivalente independiente de SUB-GRUPASA-EWM.
select pg_temp.sub('SUB-QA-CAD-YR-USD', 'EC', 'USD', 'YEARLY');
select pg_temp.item('SUB-QA-CAD-YR-USD', 'LICENSE', 24000, 'YEARLY', '2026-03-13');
select pg_temp.item('SUB-QA-CAD-YR-USD', 'IMPLEMENTATION_FEE', 12000, 'ONE_TIME', '2026-03-13');

select pg_temp.sub('SUB-QA-CAD-MIX', 'EC', 'USD', 'MONTHLY');
select pg_temp.item('SUB-QA-CAD-MIX', 'LICENSE', 100, 'MONTHLY', '2026-01-10');
select pg_temp.item('SUB-QA-CAD-MIX', 'SUPPORT_FEE', 1200, 'YEARLY', '2026-01-10');
select pg_temp.item('SUB-QA-CAD-MIX', 'IMPLEMENTATION_FEE', 5000, 'ONE_TIME', '2026-01-10');

select pg_temp.sub('SUB-QA-CAD-VALID', 'EC', 'USD', 'MONTHLY');
select pg_temp.item('SUB-QA-CAD-VALID', 'LICENSE', 500, 'MONTHLY', '2026-05-20', '2026-08-10');

select pg_temp.sub('SUB-QA-CAD-JAN31', 'EC', 'USD', 'MONTHLY');
select pg_temp.item('SUB-QA-CAD-JAN31', 'LICENSE', 700, 'MONTHLY', '2026-01-31');

select pg_temp.sub('SUB-QA-CAD-ZERO', 'EC', 'USD', 'MONTHLY');
select pg_temp.item('SUB-QA-CAD-ZERO', 'ADDON', 0, 'MONTHLY', '2026-01-01');

-- Ancla real del contrato GRUPASA del seed (relativa a la fecha del reset).
select set_config('qa.grupasa_anchor',
  (select date_trunc('month', si.valid_from)::date::text
     from platform.subscription_items si join platform.subscriptions s on s.id = si.subscription_id
    where s.code = 'SUB-GRUPASA-EWM' and si.charge_kind = 'LICENSE'), true);

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- EBIM_FINANCE

-- ---------------------------------------------------------------------------
-- MONTHLY (PEN)
-- ---------------------------------------------------------------------------
select is(pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-01-01') ->> 'created', 'true',
  '01 monthly current period due: la licencia mensual factura en su periodo ancla');
select is(pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-02-01') ->> 'created', 'true',
  '02 monthly next period due: el mes siguiente vuelve a facturar');
select is(pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-03-01') ->> 'created', 'true',
  '02b monthly +2 due');
select is(pg_temp.summary('SUB-QA-CAD-MON-PEN', '2026-02-01'), 'PEN 3150.00 [LICENSE]',
  '20 PEN preserved: PEN MONTHLY emite en PEN por el importe nativo, sin FX');
select is(
  (select string_agg(distinct l.currency, ',') from platform.invoice_lines l
     join platform.invoices i on i.id = l.invoice_id where i.subscription_id = pg_temp.sid('SUB-QA-CAD-MON-PEN')),
  'PEN', '20b PEN preserved: todas las líneas en PEN');

select is(
  (select (r ->> 'created') || ' ' || ((r ->> 'invoice_id')::uuid =
          (select id from platform.invoices where subscription_id = pg_temp.sid('SUB-QA-CAD-MON-PEN')
              and period_start = '2026-02-01'))::text
     from (select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-02-15') as r) x),
  'false true',
  '15 same period retry does not duplicate (MONTHLY): reintentar con cualquier día del mes devuelve la misma factura');
select is(pg_temp.invoices_in('SUB-QA-CAD-MON-PEN', '2026-02-01'), 1,
  '15b MONTHLY: una sola factura en el periodo tras el reintento');

-- ---------------------------------------------------------------------------
-- QUARTERLY (BOB), ancla 15/01/2026
-- ---------------------------------------------------------------------------
select is(pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-01-01') ->> 'created', 'true',
  '03 quarterly anchor period due');
select is(pg_temp.summary('SUB-QA-CAD-QTR-BOB', '2026-01-01'), 'BOB 3000.00 [LICENSE]',
  '21 BOB preserved: BOB QUARTERLY emite en BOB por el importe del trimestre');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-02-01') $$,
  'SIN_LINEAS_FACTURABLES%', '04 quarterly month +1 not due');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-03-01') $$,
  'SIN_LINEAS_FACTURABLES%', '05 quarterly month +2 not due');
select is(pg_temp.invoices_in('SUB-QA-CAD-QTR-BOB', '2026-02-01') + pg_temp.invoices_in('SUB-QA-CAD-QTR-BOB', '2026-03-01'), 0,
  '14 no due items creates no invoice (QUARTERLY +1/+2)');
select is(pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-04-01') ->> 'created', 'true',
  '06 quarterly month +3 due');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-05-01') $$,
  'SIN_LINEAS_FACTURABLES%', '06b quarterly month +4 not due');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-06-01') $$,
  'SIN_LINEAS_FACTURABLES%', '06c quarterly month +5 not due');
select is(pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-07-01') ->> 'created', 'true',
  '06d quarterly month +6 due');
select is(pg_temp.issue('SUB-QA-CAD-QTR-BOB', '2026-04-01') ->> 'created', 'false',
  '15c same period retry does not duplicate (QUARTERLY)');
select is(
  (select count(*)::int from platform.invoices where subscription_id = pg_temp.sid('SUB-QA-CAD-QTR-BOB')),
  3, '06e quarterly: 3 facturas en ENE-JUL (ene, abr, jul) y ninguna más');

-- ---------------------------------------------------------------------------
-- YEARLY + ONE_TIME (USD), ancla 13/03/2026 — equivalente GRUPASA EWM
-- ---------------------------------------------------------------------------
select is(pg_temp.issue('SUB-QA-CAD-YR-USD', '2026-03-01') ->> 'created', 'true',
  '07 yearly anchor period due');
select is(pg_temp.summary('SUB-QA-CAD-YR-USD', '2026-03-01'), 'USD 36000.00 [IMPLEMENTATION_FEE,LICENSE]',
  '11 one_time first due: el periodo ancla lleva licencia anual + implementación');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-YR-USD', '2026-04-01') $$,
  'SIN_LINEAS_FACTURABLES%', '08 yearly month +1 not due');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-YR-USD', '2026-09-01') $$,
  'SIN_LINEAS_FACTURABLES%', '09 yearly month +6 not due');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-YR-USD', '2027-02-01') $$,
  'SIN_LINEAS_FACTURABLES%', '09b yearly month +11 not due');
select is(
  (select count(*)::int from platform.invoices where subscription_id = pg_temp.sid('SUB-QA-CAD-YR-USD')),
  1, '14b no due items creates no invoice (YEARLY +1, +6, +11)');
select is(pg_temp.issue('SUB-QA-CAD-YR-USD', '2027-03-01') ->> 'created', 'true',
  '10 yearly month +12 due');
select is(pg_temp.summary('SUB-QA-CAD-YR-USD', '2027-03-01'), 'USD 24000.00 [LICENSE]',
  '12 one_time second not due: la renovación anual no repite la implementación');
select is(pg_temp.issue('SUB-QA-CAD-YR-USD', '2027-03-01') ->> 'created', 'false',
  '15d same period retry does not duplicate (YEARLY)');
select is(pg_temp.summary('SUB-QA-CAD-YR-USD', '2026-03-01'), 'USD 36000.00 [IMPLEMENTATION_FEE,LICENSE]',
  '22 USD preserved: USD YEARLY emite en USD por el importe nativo');

-- ---------------------------------------------------------------------------
-- MIXED: LICENSE MONTHLY + SUPPORT YEARLY + IMPLEMENTATION ONE_TIME
-- ---------------------------------------------------------------------------
select is((pg_temp.issue('SUB-QA-CAD-MIX', '2026-01-01') ->> 'total'), '6300.00',
  '13 mixed items · enero: MONTHLY + YEARLY + ONE_TIME');
select is(pg_temp.summary('SUB-QA-CAD-MIX', '2026-01-01'), 'USD 6300.00 [IMPLEMENTATION_FEE,LICENSE,SUPPORT_FEE]',
  '13b mixed items · enero: las tres líneas');
select is(pg_temp.issue('SUB-QA-CAD-MIX', '2026-01-01') ->> 'created', 'false',
  '15e same period retry does not duplicate (ONE_TIME en su periodo)');
select is(pg_temp.issue('SUB-QA-CAD-MIX', '2026-02-01') ->> 'total', '100.00',
  '13c mixed items · febrero: solo MONTHLY');
select is(pg_temp.summary('SUB-QA-CAD-MIX', '2026-02-01'), 'USD 100.00 [LICENSE]',
  '13d mixed items · febrero: YEARLY y ONE_TIME no entran');
select is(pg_temp.issue('SUB-QA-CAD-MIX', '2027-01-01') ->> 'total', '1300.00',
  '13e mixed items · enero año siguiente: MONTHLY + YEARLY');
select is(pg_temp.summary('SUB-QA-CAD-MIX', '2027-01-01'), 'USD 1300.00 [LICENSE,SUPPORT_FEE]',
  '13f mixed items · enero año siguiente: sin ONE_TIME');
select is(
  (select count(*)::int from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
    where i.subscription_id = pg_temp.sid('SUB-QA-CAD-MIX') and l.charge_kind = 'IMPLEMENTATION_FEE'),
  1, '12b one_time: exactamente una línea de implementación en toda la vida del contrato');
select is(
  (select string_agg(l.is_recurring::text, ',' order by l.charge_kind::text) from platform.invoice_lines l
     join platform.invoices i on i.id = l.invoice_id
    where i.subscription_id = pg_temp.sid('SUB-QA-CAD-MIX') and i.period_start = '2026-01-01'),
  'false,true,true', '13g mixed items: ONE_TIME no recurrente; MONTHLY y YEARLY recurrentes (MRR)');

-- ---------------------------------------------------------------------------
-- VALID_FROM / VALID_TO — ancla 20/05/2026, fin 10/08/2026
-- ---------------------------------------------------------------------------
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-VALID', '2026-04-01') $$,
  'SIN_LINEAS_FACTURABLES%', '16 valid_from respected: antes del inicio no hay cargo');
select is(pg_temp.issue('SUB-QA-CAD-VALID', '2026-05-01') ->> 'created', 'true',
  '16b valid_from respected: activación a mitad de mes (ancla posterior al inicio del periodo) factura ese mes');
select is(pg_temp.issue('SUB-QA-CAD-VALID', '2026-08-01') ->> 'created', 'true',
  '17 valid_to respected: fin de vigencia DENTRO del periodo aún factura ese periodo');
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-VALID', '2026-09-01') $$,
  'SIN_LINEAS_FACTURABLES%', '17b valid_to respected: después del fin no hay cargo');

-- ---------------------------------------------------------------------------
-- 31 de enero
-- ---------------------------------------------------------------------------
select is(pg_temp.issue('SUB-QA-CAD-JAN31', '2026-01-01') ->> 'created', 'true',
  '18 January 31 monthly: el periodo ancla factura');
select is(pg_temp.issue('SUB-QA-CAD-JAN31', '2026-02-01') ->> 'total', '700.00',
  '18b January 31 monthly works in February (febrero no tiene día 31)');
select is(pg_temp.issue('SUB-QA-CAD-JAN31', '2026-03-01') ->> 'created', 'true',
  '18c January 31 monthly: marzo también');

-- ---------------------------------------------------------------------------
-- Importe cero: ni vacía ni en 0
-- ---------------------------------------------------------------------------
select throws_like($$ select pg_temp.issue('SUB-QA-CAD-ZERO', '2026-01-01') $$,
  'SIN_IMPORTE_FACTURABLE%', '14c no invoice with total 0: cargos debidos que suman 0 no emiten factura');
select is(
  (select count(*)::int from platform.invoices where subscription_id = pg_temp.sid('SUB-QA-CAD-ZERO')),
  0, '14d no invoice with total 0: ninguna factura persistida');

-- ---------------------------------------------------------------------------
-- GRUPASA EWM (seed real)
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(si.charge_kind::text || ':' || si.currency || ':' || si.unit_amount || ':' || si.billing_interval, ','
                     order by si.charge_kind::text)
     from platform.subscription_items si where si.subscription_id = pg_temp.sid('SUB-GRUPASA-EWM')),
  'IMPLEMENTATION_FEE:USD:12000.00:ONE_TIME,LICENSE:USD:24000.00:YEARLY',
  '19 GRUPASA EWM annual regression · fixture real: licencia USD 24,000 YEARLY + implementación USD 12,000 ONE_TIME');
select is(
  pg_temp.issue('SUB-GRUPASA-EWM', current_setting('qa.grupasa_anchor')::date) ->> 'total', '36000.00',
  '19b GRUPASA EWM · periodo inicial: YEARLY DUE + ONE_TIME DUE');
select throws_like(
  $$ select pg_temp.issue('SUB-GRUPASA-EWM', (current_setting('qa.grupasa_anchor')::date + interval '1 month')::date) $$,
  'SIN_LINEAS_FACTURABLES%', '19c GRUPASA EWM · mes siguiente: la licencia anual NO se refactura');
select is(
  pg_temp.summary('SUB-GRUPASA-EWM', (current_setting('qa.grupasa_anchor')::date + interval '12 months')::date),
  null, '19d GRUPASA EWM · sin factura en el mes siguiente ni en ningún otro antes del aniversario');
select is(
  (select (r ->> 'total') || ' ' || (r ->> 'currency')
     from (select pg_temp.issue('SUB-GRUPASA-EWM', (current_setting('qa.grupasa_anchor')::date + interval '12 months')::date) r) x),
  '24000.00 USD', '19e GRUPASA EWM · 12 meses después: YEARLY DUE, ONE_TIME NOT DUE');

-- ---------------------------------------------------------------------------
-- VOID: la factura anulada no cuenta; el periodo se puede volver a emitir
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update platform.invoices set status = 'VOID'
 where subscription_id = pg_temp.sid('SUB-QA-CAD-YR-USD') and period_start = '2026-03-01';
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');

select lives_ok($$ select pg_temp.issue('SUB-QA-CAD-YR-USD', '2026-03-01') $$,
  '10b VOID: re-emitir un periodo cuya factura se anuló no choca con el número de la anulada');
select is(pg_temp.summary('SUB-QA-CAD-YR-USD', '2026-03-01'), 'USD 36000.00 [IMPLEMENTATION_FEE,LICENSE]',
  '10c VOID: la re-emisión vuelve a incluir el ONE_TIME (la línea anulada no cuenta como facturada)');
select is(
  (select string_agg(status::text, ',' order by created_at) from platform.invoices
    where subscription_id = pg_temp.sid('SUB-QA-CAD-YR-USD') and period_start = '2026-03-01'),
  'VOID,ISSUED', '10d VOID: la anulada se conserva y hay una sola vigente');
select is(
  (select count(distinct number)::int from platform.invoices
    where subscription_id = pg_temp.sid('SUB-QA-CAD-YR-USD') and period_start = '2026-03-01'),
  2, '10e VOID: la re-emisión usa un número distinto');

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------
select lives_ok($$ select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-04-01') $$,
  '24 EBIM_FINANCE can issue when authorized');

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');
select is(pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-05-01') ->> 'created', 'true',
  '25 EBIM_SUPER_ADMIN can issue');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');
select throws_ok($$ select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-06-01') $$,
  '42501', null, '23 unauthorized role cannot issue invoice · PARTNER_ADMIN');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-06-01') $$,
  '42501', null, '23b unauthorized role cannot issue invoice · TENANT_ADMIN');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-06-01') $$,
  '42501', null, '23c unauthorized role cannot issue invoice · EBIM_PRODUCT_ADMIN');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select pg_temp.issue('SUB-QA-CAD-MON-PEN', '2026-06-01') $$,
  '42501', null, '23d unauthorized role cannot issue invoice · comercial independiente');

select pg_temp.act_as_postgres();
select is(pg_temp.invoices_in('SUB-QA-CAD-MON-PEN', '2026-06-01'), 0,
  '23e los intentos no autorizados no dejan factura');

select ok(not has_function_privilege('anon', 'platform.issue_subscription_invoice(uuid, date)', 'EXECUTE'),
  '23f anon no ejecuta issue_subscription_invoice');
select ok(
  (select p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)
     from pg_proc p where p.oid = 'platform.issue_subscription_invoice(uuid, date)'::regprocedure),
  '23g issue_subscription_invoice sigue SECURITY DEFINER con search_path = platform, pg_catalog');

select * from finish();
rollback;
