-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · comparación BILLING_SHADOW (D-14)
-- ----------------------------------------------------------------------------
-- Spec §15.2 (BILLING_SHADOW: MasterAdmin calcula y un reporte compara línea a
-- línea contra el biller local; nadie cobra desde MasterAdmin), §19.1(8)
-- (diff = 0 para el período certificado), §18 (doble cobrador).
-- D-14 regla 5: eExpense y GMAO avanzan SOLO a BILLING_SHADOW; el diff lo
-- calcula MasterAdmin (nunca un literal del SaaS). Migración 20261008000300.
--
-- Importes SINTÉTICOS de la prueba (transacción que se revierte).
-- ============================================================================
begin;
select plan(40);

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
create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.superadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.m(k int) returns date language sql as $$
  select (date_trunc('month', now() at time zone 'UTC') + make_interval(months => k))::date
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'billing_shadow_comparisons', 'Existe platform.billing_shadow_comparisons');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
                     || ':' || has_function_privilege('anon', p.oid, 'execute'), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.proname in ('billing_shadow_expected_lines', 'record_billing_shadow_comparison')),
  'billing_shadow_expected_lines:true:search_path=platform, pg_catalog:false '
  || 'record_billing_shadow_comparison:true:search_path=platform, pg_catalog:false',
  'RPCs nuevas: DEFINER con search_path fijo y sin EXECUTE para anon');
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'platform.billing_shadow_comparisons', 'insert,update,delete'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'Nadie escribe la tabla directo: solo la RPC');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'platform.billing_shadow_comparisons'::regclass),
  true, 'RLS habilitado y forzado');

-- ---------------------------------------------------------------------------
-- Fixture: suscripción eSupplier PE/PEN con LICENSE 100 + SUPPORT 20 + DISCOUNT 10 (mensuales)
--          e IMPLEMENTATION 50 ONE_TIME en M0; integración con el eje de facturación en LEGACY.
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.superadmin());
select platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa-ccp-shadow', 'Shadow QA',
  'admin@qa-ccp-shadow.example.com', '60000000-0000-4000-a000-000000000001', 'PE',
  p_sales_agent_id => '80000000-0000-4000-a000-000000000002',
  p_commission_plan_id => '90000000-0000-4000-a000-000000000002',
  p_activate => true);

select pg_temp.act_as_postgres();
create temp table qa_sub as
select s.id, s.tenant_id, s.currency from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
 where t.slug = 'qa-ccp-shadow';
grant select on qa_sub to authenticated, service_role, anon;
create or replace function pg_temp.tenant() returns uuid language sql as $$ select tenant_id from qa_sub $$;
delete from platform.subscription_items where subscription_id = (select id from qa_sub);
update platform.subscriptions set started_on = pg_temp.m(-1) where id = (select id from qa_sub);
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
   enabled, status)
values ('70000000-0000-4000-a000-0000000000f2', pg_temp.esup(), 'esupplier-shadow-qa', 'eSupplier · shadow QA (test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL',
        false, 'READY');
-- Punto de partida explícito: ningún eje de facturación de eSupplier en SHADOW (independiente del seed).
update platform.product_integrations set cutover_state_billing = 'BILLING_LEGACY' where saas_product_id = pg_temp.esup();

select pg_temp.act_as(pg_temp.finance());
select platform.upsert_subscription_item((select id from qa_sub), 'LICENSE', 'Licencia QA', 1, 100, 'MONTHLY', p_valid_from => pg_temp.m(-1));
select platform.upsert_subscription_item((select id from qa_sub), 'SUPPORT_FEE', 'Soporte QA', 1, 20, 'MONTHLY', p_valid_from => pg_temp.m(-1));
select platform.upsert_subscription_item((select id from qa_sub), 'DISCOUNT', 'Descuento QA', 1, 10, 'MONTHLY', p_valid_from => pg_temp.m(-1));
select platform.upsert_subscription_item((select id from qa_sub), 'IMPLEMENTATION_FEE', 'Implementación QA', 1, 50, 'ONE_TIME', p_valid_from => pg_temp.m(0));

create temp table qa_ok as select jsonb_build_object(
  'source', 'qa.local-biller', 'currency', 'PEN',
  'lines', jsonb_build_array(
    jsonb_build_object('itemCode', 'plan:esupplier-shared-standard', 'quantity', 1, 'amount', 100),
    jsonb_build_object('itemCode', 'charge:SUPPORT_FEE', 'quantity', 1, 'amount', 20),
    jsonb_build_object('itemCode', 'charge:DISCOUNT', 'quantity', 1, 'amount', -10))) as j;
grant select on qa_ok to authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Lo que MasterAdmin facturaría: la misma fuente única que emite (subscription_due_items)
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(e ->> 'itemCode' || '=' || (e ->> 'quantity')::numeric::text || 'x' || (e ->> 'amount')::numeric || ' ' || (e ->> 'currency'), '; '
                     order by e ->> 'itemCode')
     from jsonb_array_elements(platform.billing_shadow_expected_lines('esupplier', pg_temp.tenant(), pg_temp.m(-1)) -> 'lines') e),
  'charge:DISCOUNT=1.00x-10.00 PEN; charge:SUPPORT_FEE=1.00x20.00 PEN; plan:esupplier-shared-standard=1.00x100.00 PEN',
  'M-1: plan + soporte + descuento con signo; la implementación ONE_TIME de M0 no toca M-1');
select is(
  (platform.billing_shadow_expected_lines('esupplier', pg_temp.tenant(), pg_temp.m(0)) ->> 'total')::numeric, 160.00,
  'M0: 100 + 20 − 10 + 50 = 160 (ONE_TIME aún no facturado)');
select is(
  platform.billing_shadow_expected_lines('esupplier', pg_temp.tenant(), pg_temp.m(-1)) ->> 'currency', 'PEN',
  'La moneda es la del contrato');

select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.billing_shadow_expected_lines('esupplier', pg_temp.tenant(), pg_temp.m(-1)) $$,
  '42501', null, 'Un admin de tenant no lee la expectativa de facturación');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.billing_shadow_expected_lines('esupplier', '00000000-0000-4000-a000-000000000000', pg_temp.m(-1)) $$,
  'P0002', null, 'Tenant sin suscripción ACTIVE del producto → SUSCRIPCION_NO_ENCONTRADA');

-- ---------------------------------------------------------------------------
-- Guardas del registro: solo en BILLING_SHADOW, solo finanzas o service_role
-- ---------------------------------------------------------------------------
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa') $$,
  '55000', null, 'Con el eje de facturación en BILLING_LEGACY no hay comparación (BILLING_NOT_IN_SHADOW)');
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000f2', 'BILLING', 'BILLING_SHADOW', 'D-14 shadow QA'),
  'BILLING_SHADOW', 'Finanzas mueve el eje a BILLING_SHADOW');

select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa') $$,
  '42501', null, 'Un admin de tenant no registra comparaciones');
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa') $$,
  '42501', null, 'El product admin tampoco: la facturación es de finanzas');
select pg_temp.act_as_anon();
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa') $$,
  '42501', null, 'anon no ejecuta la RPC');

-- ---------------------------------------------------------------------------
-- Paridad: diff material 0
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
create temp table r_ok as
select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa finanzas') as r;
select is((select (r ->> 'mismatches')::int from r_ok), 0, 'Local = MasterAdmin → 0 diferencias materiales');
select is((select (r ->> 'green')::boolean from r_ok), true, 'green = true');
select matches((select r ->> 'reportChecksum' from r_ok), '^sha256:[0-9a-f]{64}$', 'reportChecksum sha256 del reporte canónico');
select is((select (r ->> 'expectedTotal')::numeric from r_ok), 110.00, 'expectedTotal = 100 + 20 − 10');
select is((select (r ->> 'localTotal')::numeric from r_ok), 110.00, 'localTotal = 110');

-- El orden de las líneas locales no cambia el reporte ni su checksum.
select is(
  platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), jsonb_build_object(
    'source', 'qa.local-biller', 'currency', 'PEN',
    'lines', jsonb_build_array(
      jsonb_build_object('itemCode', 'charge:DISCOUNT', 'quantity', 1, 'amount', -10),
      jsonb_build_object('itemCode', 'plan:esupplier-shared-standard', 'quantity', 1, 'amount', 100.00),
      jsonb_build_object('itemCode', 'charge:SUPPORT_FEE', 'quantity', 1, 'amount', 20))), 'qa finanzas') ->> 'reportChecksum',
  (select r ->> 'reportChecksum' from r_ok),
  'Checksum determinista: mismo reporte con otro orden de líneas');

-- ---------------------------------------------------------------------------
-- Diferencias materiales: cada tipo se detecta y cuenta
-- ---------------------------------------------------------------------------
create temp table r_bad as
select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), jsonb_build_object(
  'source', 'qa.local-biller', 'currency', 'PEN',
  'lines', jsonb_build_array(
    jsonb_build_object('itemCode', 'plan:esupplier-shared-standard', 'quantity', 1, 'amount', 99.99),
    jsonb_build_object('itemCode', 'charge:DISCOUNT', 'quantity', 2, 'amount', -10),
    jsonb_build_object('itemCode', 'addon:esupplier.qa.extra', 'quantity', 1, 'amount', 5))), 'qa finanzas') as r;
select is((select (r ->> 'green')::boolean from r_bad), false, 'Con diferencias → green = false');
select is(
  (select string_agg(d ->> 'type' || '@' || (d ->> 'itemCode'), ',' order by d ->> 'itemCode', d ->> 'type')
     from r_bad, jsonb_array_elements(r -> 'diffs') d),
  'ONLY_LOCAL@addon:esupplier.qa.extra,QUANTITY_MISMATCH@charge:DISCOUNT,ONLY_MASTERADMIN@charge:SUPPORT_FEE,AMOUNT_MISMATCH@plan:esupplier-shared-standard',
  'ONLY_LOCAL, QUANTITY_MISMATCH, ONLY_MASTERADMIN y AMOUNT_MISMATCH (al centavo)');
select is((select (r ->> 'mismatches')::int from r_bad), 4, 'mismatches = número de diferencias materiales');
select isnt((select r ->> 'reportChecksum' from r_bad), (select r ->> 'reportChecksum' from r_ok), 'Otro reporte, otro checksum');

select is(
  platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1),
    jsonb_set((select j from qa_ok), '{currency}', '"USD"'), 'qa finanzas') -> 'diffs' -> 0 ->> 'type',
  'CURRENCY_MISMATCH', 'Moneda distinta → CURRENCY_MISMATCH (sin FX: D-13)');

select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), '{"currency":"PEN"}'::jsonb, 'qa') $$,
  '22023', null, 'Entrada local sin lines → LOCAL_INVALIDO');
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1),
    '{"currency":"PEN","lines":[{"itemCode":"plan:x","quantity":1,"amount":1},{"itemCode":"plan:x","quantity":1,"amount":1}]}'::jsonb, 'qa') $$,
  '22023', null, 'itemCode duplicado en la entrada local → LOCAL_INVALIDO');
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), '  ') $$,
  '23514', null, 'Actor obligatorio');

-- ---------------------------------------------------------------------------
-- service_role (job del SaaS/certificación) también registra; nunca emite ni cobra
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is((platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'x07 eExpense') ->> 'mismatches')::int,
  0, 'service_role registra la comparación');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.invoices where subscription_id = (select id from qa_sub)), 0,
  'BILLING_SHADOW no emite ninguna factura de MasterAdmin');
select is((select count(*)::int from platform.payments p join platform.invoices i on i.id = p.invoice_id
            where i.subscription_id = (select id from qa_sub)), 0, 'ni ningún pago');
select is((select count(*)::int from platform.billing_shadow_comparisons where tenant_id = pg_temp.tenant()), 5,
  'Cada comparación queda registrada (append-only)');
select is((select string_agg(distinct period_start::text, ',') from platform.billing_shadow_comparisons where tenant_id = pg_temp.tenant()),
  pg_temp.m(-1)::text, 'Período normalizado al mes');
select is((select string_agg(distinct subscription_id::text, ',') from platform.billing_shadow_comparisons where tenant_id = pg_temp.tenant()),
  (select id::text from qa_sub), 'La comparación apunta a la suscripción comparada');
select throws_ok($$ update platform.billing_shadow_comparisons set mismatches = 0 $$, '55000', null, 'append-only: sin UPDATE');
select throws_ok($$ delete from platform.billing_shadow_comparisons $$, '55000', null, 'append-only: sin DELETE');

-- ---------------------------------------------------------------------------
-- Lectura: finanzas sí; admin de tenant no
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.billing_shadow_comparisons where tenant_id = pg_temp.tenant()), 5, 'Finanzas lee las comparaciones');
select pg_temp.act_as(pg_temp.tadmin());
select is((select count(*)::int from platform.billing_shadow_comparisons), 0, 'Un admin de tenant no ve comparaciones');

-- Rollback del eje (un paso atrás) deja de aceptar comparaciones.
select pg_temp.act_as(pg_temp.finance());
select is(platform.set_commercial_cutover_state('70000000-0000-4000-a000-0000000000f2', 'BILLING', 'BILLING_LEGACY', 'rollback QA'),
  'BILLING_LEGACY', 'Rollback BILLING_SHADOW → BILLING_LEGACY');
select throws_ok($$ select platform.record_billing_shadow_comparison('esupplier', pg_temp.tenant(), pg_temp.m(-1), (select j from qa_ok), 'qa') $$,
  '55000', null, 'Tras el rollback ya no hay comparación');

select * from finish();
rollback;
