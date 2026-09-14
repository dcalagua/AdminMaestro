-- ============================================================================
-- V3.2 · Identidad del Plan del proveedor (migración 37)
-- ----------------------------------------------------------------------------
-- Causa raíz (P1-A): el Plan del proveedor se identificaba y se sobrescribía
-- sin importe. Estas pruebas fijan la regla en la BASE, que es la autoridad:
--   mismo contrato económico → mismo Plan · distinto importe → distinto Plan ·
--   una fila nunca cambia de identidad ni de external_plan_id.
-- La detección de cadencia/importe futuro vive en `recurring-amount.ts` y se
-- prueba con vitest y con el E2E de `payment-setup` contra la base real.
-- ============================================================================
begin;
select plan(51);

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

-- Cuenta EBIM Culqi Perú (seed) y una cuenta Culqi de partner creada aquí.
create or replace function pg_temp.ebim() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;

insert into platform.payment_provider_accounts (code, name, provider_kind, environment, country_code, currency, market_id)
select 'culqi-partner-qa-v32', 'Culqi Partner QA V3.2', 'CULQI', 'TEST', 'PE', 'PEN', m.id
  from platform.markets m where m.code = 'PE';

create or replace function pg_temp.partner_acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-partner-qa-v32' $$;

-- Planes locales: «Professional» = eSupplier Shared Standard; otro plan para contraste.
create or replace function pg_temp.pro() returns uuid language sql as $$ select '60000000-0000-4000-a000-000000000001'::uuid $$;

create or replace function pg_temp.find(p_account uuid, p_interval platform.billing_interval, p_currency text, p_amount numeric)
returns text language sql as $$
  select platform.find_reusable_provider_plan(p_account, pg_temp.pro(), p_interval, p_currency::char(3), p_amount)
$$;

create or replace function pg_temp.reg(p_account uuid, p_interval platform.billing_interval, p_currency text,
                                       p_amount numeric, p_external text)
returns jsonb language sql as $$
  select platform.register_provider_plan(p_account, pg_temp.pro(), p_interval, p_currency::char(3), p_amount, p_external)
$$;

create or replace function pg_temp.amount_of(p_external text) returns numeric language sql as $$
  select amount from platform.provider_plans where external_plan_id = p_external
$$;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'platform.provider_plans'::regclass
                                         and conname = 'provider_plans_uk'),
  '01 la unicidad sin importe (provider_plans_uk) ya no existe');

select is(
  (select pg_get_indexdef(i.indexrelid)
     from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'provider_plans_identity_uk' and i.indisunique),
  'CREATE UNIQUE INDEX provider_plans_identity_uk ON platform.provider_plans USING btree (provider_account_id, plan_id, billing_interval, currency, amount) WHERE (status = ''ACTIVE''::platform.provider_mapping_status)',
  '02 identidad única: cuenta + plan + intervalo + moneda + importe, sobre Planes ACTIVE');

select ok(
  exists (select 1 from pg_constraint where conrelid = 'platform.provider_plans'::regclass
                                     and conname = 'provider_plans_external_uk'),
  '03 se conserva la unicidad del external_plan_id por cuenta');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'platform.provider_plans'::regclass and contype = 'f'),
  3,
  '04 se conservan las 3 FK (cuenta, plan, moneda)');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'platform.provider_plans'::regclass),
  '05 provider_plans sigue con RLS habilitada y forzada');

select is(
  (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'platform.provider_plans'::regclass),
  '(platform.can_read_finance() OR platform.can_manage_platform_entities())',
  '06 la política de lectura de provider_plans no cambia');

-- ---------------------------------------------------------------------------
-- Regla de identidad (contexto de servicio)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1000, 'pln_qa_a_1000') ->> 'canonical', 'true',
  '07 cliente A · Professional MONTHLY USD 1000 registra el Plan A');

select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000), 'pln_qa_a_1000',
  '08 [1] mismo plan, intervalo, moneda, importe y cuenta → reutilizable');

select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000.00), 'pln_qa_a_1000',
  '09 1000 y 1000.00 son el mismo importe numeric');

select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1250), null,
  '10 [2] mismo todo pero importe 1250 → NO reutilizable');

select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000.01), null,
  '11 un céntimo de diferencia ya es otro contrato económico');

select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1250, 'pln_qa_b_1250') ->> 'canonical', 'true',
  '12 cliente B · mismo plan a USD 1250 registra un Plan B propio');

select is(
  (select count(*)::int from platform.provider_plans
    where provider_account_id = pg_temp.ebim() and plan_id = pg_temp.pro()
      and billing_interval = 'MONTHLY' and currency = 'USD' and status = 'ACTIVE'),
  2,
  '13 Plan A (1000) y Plan B (1250) coexisten ACTIVE para el mismo plan local');

select ok(pg_temp.amount_of('pln_qa_a_1000') = 1000 and pg_temp.amount_of('pln_qa_b_1250') = 1250,
  '14 cada fila conserva el importe de su Plan externo');

select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 875, 'pln_qa_neg_875') ->> 'registered', 'true',
  '15 [6] precio negociado USD 875: su propio Plan, no el de la tarifa');
select ok(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 875) = 'pln_qa_neg_875'
          and pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000) = 'pln_qa_a_1000',
  '16 [6] el negociado y el de 1000 nunca comparten external_plan_id');

select is(pg_temp.find(pg_temp.partner_acc(), 'MONTHLY', 'USD', 1000), null,
  '17 [3][14] misma economía en OTRA cuenta de comercio → NO reutilizable');
select is(pg_temp.reg(pg_temp.partner_acc(), 'MONTHLY', 'USD', 1000, 'pln_qa_partner_1000') ->> 'canonical', 'true',
  '18 [14] la cuenta del partner registra su propio Plan');
select ok(pg_temp.find(pg_temp.partner_acc(), 'MONTHLY', 'USD', 1000) = 'pln_qa_partner_1000'
          and pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000) = 'pln_qa_a_1000',
  '19 [14] cada cuenta resuelve su propio mapeo');

select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'PEN', 1000), null,
  '20 [4] USD 1000 y PEN 1000 → NO reutilizable');
select is(pg_temp.find(pg_temp.ebim(), 'YEARLY', 'USD', 1000), null,
  '21 [5] USD 1000 MONTHLY y USD 1000 YEARLY → NO reutilizable');
select is(pg_temp.find(pg_temp.ebim(), 'QUARTERLY', 'USD', 1000), null,
  '22 [5] USD 1000 QUARTERLY → NO reutilizable');

-- Idempotencia: el mismo Plan externo con la misma identidad no crea filas.
select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1000.00, 'pln_qa_a_1000') ->> 'reused', 'true',
  '23 repetir el registro del mismo contrato económico reutiliza la fila');
select is(
  (select count(*)::int from platform.provider_plans where external_plan_id = 'pln_qa_a_1000'),
  1,
  '24 same economic plan => same provider plan: sigue habiendo una sola fila');

-- ---------------------------------------------------------------------------
-- [7] Nunca fingir que el Plan externo cambió de precio
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1250, 'pln_qa_a_1000') $$,
  '23514', null,
  '25 [7] registrar P1 (1000 en el PSP) con importe 1250 se rechaza');
select is(pg_temp.amount_of('pln_qa_a_1000'), 1000.00::numeric,
  '26 [7] tras el intento, P1 sigue en 1000');

select throws_ok(
  $$ select pg_temp.reg(pg_temp.ebim(), 'YEARLY', 'USD', 1000, 'pln_qa_a_1000') $$,
  '23514', null,
  '27 [7] ni reasignarlo a otro intervalo');

select throws_ok(
  $$ update platform.provider_plans set amount = 1250 where external_plan_id = 'pln_qa_a_1000' $$,
  '23514', null,
  '28 [7] un UPDATE directo del importe se rechaza incluso con privilegios de servidor');
select throws_ok(
  $$ update platform.provider_plans set external_plan_id = 'pln_qa_otro' where external_plan_id = 'pln_qa_a_1000' $$,
  '23514', null,
  '29 [7] tampoco se cambia el external_plan_id de una fila');
select throws_ok(
  $$ update platform.provider_plans set currency = 'PEN' where external_plan_id = 'pln_qa_a_1000' $$,
  '23514', null,
  '30 [7] ni su moneda');
select throws_ok(
  $$ insert into platform.provider_plans (provider_account_id, plan_id, external_plan_id, amount, currency, billing_interval)
     values (pg_temp.ebim(), pg_temp.pro(), 'pln_qa_a_bis', 1000, 'USD', 'MONTHLY') $$,
  '23505', null,
  '31 un segundo Plan ACTIVE para el mismo contrato económico choca con la unicidad');

-- Dos altas simultáneas crean dos Planes iguales en el PSP: el segundo se
-- registra fiel pero INACTIVE, y el canónico no se toca.
select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1250, 'pln_qa_b_dup') ->> 'canonical', 'false',
  '32 un Plan duplicado del mismo contrato económico no pisa al canónico');
select ok(
  (select status = 'INACTIVE' and metadata ->> 'duplicate_of' = 'pln_qa_b_1250'
     from platform.provider_plans where external_plan_id = 'pln_qa_b_dup')
  and pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1250) = 'pln_qa_b_1250',
  '33 el duplicado queda INACTIVE con referencia al canónico y el lookup sigue en el Plan B');

select lives_ok(
  $$ update platform.provider_plans set status = 'INACTIVE' where external_plan_id = 'pln_qa_neg_875' $$,
  '34 retirar un Plan (status) sí está permitido');
select is(pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 875), null,
  '35 un Plan retirado no se reutiliza');
select is(pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 875, 'pln_qa_neg_875_v2') ->> 'canonical', 'true',
  '36 y su reemplazo puede registrarse como nuevo canónico');

-- Validaciones de entrada: sin redondeos ni Planes imposibles.
select throws_ok($$ select pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 12.345) $$, '22023', null,
  '37 el lookup rechaza importes con más de 2 decimales en vez de redondear');
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 12.345, 'pln_qa_x') $$, '22023', null,
  '38 el registro también');
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 0, 'pln_qa_x') $$, '22023', null,
  '39 un Plan de importe 0 no se registra');
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'ONE_TIME', 'USD', 100, 'pln_qa_x') $$, '22023', null,
  '40 [12] un ONE_TIME no es un Plan del proveedor');
select throws_ok(
  $$ insert into platform.provider_plans (provider_account_id, plan_id, external_plan_id, amount, currency, billing_interval)
     values (pg_temp.ebim(), pg_temp.pro(), 'pln_qa_onetime', 100, 'USD', 'ONE_TIME') $$,
  '23514', null,
  '41 [12] ni siquiera por INSERT directo');

-- ---------------------------------------------------------------------------
-- [15] Permisos: los mapeos PSP los controla el servidor
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- EBIM_FINANCE
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1500, 'pln_qa_fin') $$, '42501', null,
  '42 FINANCE no registra Planes del proveedor');
select throws_ok($$ update platform.provider_plans set status = 'INACTIVE' where external_plan_id = 'pln_qa_a_1000' $$,
  '42501', null,
  '43 FINANCE no modifica provider_plans directamente');

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- PARTNER_ADMIN
select throws_ok($$ select pg_temp.find(pg_temp.ebim(), 'MONTHLY', 'USD', 1000) $$, '42501', null,
  '44 PARTNER_ADMIN no ejecuta el lookup de servidor');
select throws_ok(
  $$ insert into platform.provider_plans (provider_account_id, plan_id, external_plan_id, amount, currency, billing_interval)
     values (pg_temp.ebim(), pg_temp.pro(), 'pln_qa_partner_fake', 1, 'USD', 'MONTHLY') $$,
  '42501', null,
  '45 PARTNER_ADMIN no falsifica un mapeo PSP');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');  -- TENANT_ADMIN (admin@alpha)
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1, 'pln_qa_tenant') $$, '42501', null,
  '46 TENANT_ADMIN no registra Planes del proveedor');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');  -- SALES_AGENT
select throws_ok($$ select pg_temp.reg(pg_temp.ebim(), 'MONTHLY', 'USD', 1, 'pln_qa_agent') $$, '42501', null,
  '47 SALES_AGENT no registra Planes del proveedor');

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.guard_provider_plan_identity()', 'EXECUTE'),
  '48 ni anon ni authenticated ejecutan las funciones nuevas');
select ok(
  has_function_privilege('service_role', 'platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)', 'EXECUTE'),
  '49 service_role sí: es el camino de payment-setup');
select ok(
  (select p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)
     from pg_proc p where p.oid = 'platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)'::regprocedure)
  and (select not p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)
     from pg_proc p where p.oid = 'platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)'::regprocedure)
  and (select not p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig)
     from pg_proc p where p.oid = 'platform.guard_provider_plan_identity()'::regprocedure),
  '50 register DEFINER, find y guard INVOKER; las tres con search_path = platform, pg_catalog');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and table_name = 'provider_plans'
      and grantee in ('authenticated', 'anon', 'PUBLIC')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  '51 provider_plans sin escritura directa para authenticated/anon');

select * from finish();
rollback;
