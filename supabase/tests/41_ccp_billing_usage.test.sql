-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · facturación de uso, créditos IA,
-- add-ons y DISCOUNT correctivo (Task MA-60)
-- ----------------------------------------------------------------------------
-- Spec §5.3, §12.5, §13.1, §13.2, §17, §20 (D-01..D-06, D-11, D-13).
-- Plan §4 filas 20–21, §13 MA-60. Migraciones 20261008000050..000200.
--
-- Todos los importes, pesos, créditos y políticas son SINTÉTICOS de la prueba
-- (transacción que se revierte). Nada se siembra ni se inventa.
--
-- Escenario (suscripción nueva eSupplier PE/PEN, períodos relativos a hoy):
--   · M-2: uso finalizado de 6 medidores + créditos IA; M-1: factura con el
--     consumo vencido; M0: factura siguiente (correctivo, add-on, sin repetir).
--   · A qa.api.calls   facturable, sin capacidad ALLOWANCE, tarifa 0.50 → USAGE
--   · B qa.storage.gb  facturable, capacidad ALLOWANCE sin grant → alerta
--   · C qa.sync.jobs   facturable, asignación 2 del plan, uso 5 → OVER bajo
--                      BLOCK (contrato v1) → nunca factura
--   · D qa.exports     facturable, sin ítem/tarifa → TARIFA_ADDON_NO_DEFINIDA
--   · E qa.views       NO facturable (D-06) con tarifa → nada
--   · IA qa.ai.calls   8 llamadas × peso 2 = 16 créditos; incluidos 10 +
--                      compra 5 → saldo −1 → exceso 1 × 0.10 (overage ALLOW)
-- ============================================================================
begin;
select plan(66);

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
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.demo() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.superadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.m(k int) returns date language sql as $$
  select (date_trunc('month', now() at time zone 'UTC') + make_interval(months => k))::date
$$;
create or replace function pg_temp.ts(k int, p_day int) returns timestamptz language sql as $$
  select (pg_temp.m(k) + (p_day - 1))::timestamp at time zone 'UTC' + interval '12 hours'
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select ok('CREDIT_PURCHASE' = any(enum_range(null::platform.charge_kind)::text[]),
  'charge_kind incluye CREDIT_PURCHASE (migración aislada)');
select is(
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = 'platform' and table_name = 'invoice_lines'
      and column_name in ('usage_aggregate_id', 'meter_code', 'corrects_line_id', 'catalog_item_id', 'price_ref',
                          'usage_basis', 'ai_credit_pool_key', 'usage_period_start', 'usage_source_hash', 'ai_credit_entry_id')),
  'ai_credit_entry_id,ai_credit_pool_key,catalog_item_id,corrects_line_id,meter_code,price_ref,usage_aggregate_id,usage_basis,usage_period_start,usage_source_hash',
  'invoice_lines gana los vínculos de uso, crédito, add-on y corrección (nulos para lo existente)');
select is(
  (select count(*)::int from platform.invoice_lines
    where usage_aggregate_id is not null or corrects_line_id is not null or usage_basis is not null or ai_credit_entry_id is not null),
  0, 'Ninguna línea existente cambia: los vínculos nuevos nacen nulos');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
                     || ':' || has_function_privilege('anon', p.oid, 'execute')
                     || ':' || has_function_privilege('authenticated', p.oid, 'execute'), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('schedule_corrective_discount', 'purchase_ai_credits', 'set_catalog_item_usage_binding',
                        'set_catalog_item_credit_pack')),
  'purchase_ai_credits:true:search_path=platform, pg_catalog:false:true '
  || 'schedule_corrective_discount:true:search_path=platform, pg_catalog:false:true '
  || 'set_catalog_item_credit_pack:true:search_path=platform, pg_catalog:false:true '
  || 'set_catalog_item_usage_binding:true:search_path=platform, pg_catalog:false:true',
  'RPCs nuevas: DEFINER con search_path fijo, sin anon; el gate está dentro');
select is(has_table_privilege('authenticated', 'platform.invoice_lines', 'insert,update,delete'), false,
  'authenticated sigue sin escribir invoice_lines');

-- ---------------------------------------------------------------------------
-- Fixture: suscripción nueva (PE/PEN) con LICENSE 100 MONTHLY + IMPLEMENTATION 50 ONE_TIME desde M-2
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.superadmin());
select platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa-ccp-bill', 'Facturación QA',
  'admin@qa-ccp-bill.example.com', '60000000-0000-4000-a000-000000000001', 'PE',
  p_sales_agent_id => '80000000-0000-4000-a000-000000000002',
  p_commission_plan_id => '90000000-0000-4000-a000-000000000002',
  p_activate => true);

select pg_temp.act_as_postgres();
create temp table qa_sub as
select s.id, s.code, s.billed_organization_id as org_id, s.currency, s.tenant_id
  from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
 where t.slug = 'qa-ccp-bill';
grant select on qa_sub to authenticated, service_role;
create or replace function pg_temp.tenant() returns uuid language sql as $$ select tenant_id from qa_sub $$;
create or replace function pg_temp.cur() returns char(3) language sql as $$ select currency from qa_sub $$;

delete from platform.subscription_items where subscription_id = (select id from qa_sub);
update platform.subscriptions set started_on = pg_temp.m(-2) where id = (select id from qa_sub);
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, external_organization_id,
   external_company_id, status, provisioned_at, registered_manually)
values (pg_temp.tenant(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-qa-bill', 'ext-org-qa-bill', 'ext-co-qa-bill', 'ACTIVE', now(), true),
       (pg_temp.demo(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-demo', 'ext-org-demo', 'ext-co-demo', 'ACTIVE', now(), true);
-- Regla de prueba: base = cualquier línea cobrada (hace visible qué comisiona).
insert into platform.commission_rules (commission_plan_id, name, basis, rate, currency, is_recurring, priority)
values ('90000000-0000-4000-a000-000000000002', 'QA · cualquier línea', 'COLLECTED_ANY', 0.10, 'USD', true, 1);

select pg_temp.act_as(pg_temp.finance());
select platform.upsert_subscription_item((select id from qa_sub), 'LICENSE', 'Licencia QA', 1, 100, 'MONTHLY', p_valid_from => pg_temp.m(-2));
select platform.upsert_subscription_item((select id from qa_sub), 'IMPLEMENTATION_FEE', 'Implementación QA', 1, 50, 'ONE_TIME', p_valid_from => pg_temp.m(-2));

-- Regresión "antes = después": una suscripción SIN uso emite exactamente las líneas debidas.
create temp table qa_before as
select d.charge_kind::text as k, d.description, d.quantity, d.unit_amount, d.billing_interval <> 'ONE_TIME' as rec, d.subscription_item_id
  from platform.subscription_due_items((select id from qa_sub), pg_temp.m(-2)) d;

-- ---------------------------------------------------------------------------
-- Registro, medidores, tarifas y política (sintéticos)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-18",
  "capabilities": [
    {"code": "esupplier.qa.storage", "name": "QA almacenamiento", "kind": "ALLOWANCE", "unit": "gb", "combineRule": "SUM", "meterCode": "esupplier.qa.storage.gb", "status": "ACTIVE"},
    {"code": "esupplier.qa.jobs", "name": "QA trabajos", "kind": "ALLOWANCE", "unit": "job", "combineRule": "SUM", "meterCode": "esupplier.qa.sync.jobs", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE", "meterCode": "esupplier.qa.ai.calls", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.jobs', '{"included": 2, "period": "MONTH"}', pg_temp.m(-6), 'QA');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.api.calls', 'QA API', 'call', 'SUM', 'ACTIVE');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.storage.gb', 'QA GB', 'gb', 'SUM', 'ACTIVE', p_capability_code => 'esupplier.qa.storage');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.sync.jobs', 'QA jobs', 'job', 'SUM', 'ACTIVE', p_capability_code => 'esupplier.qa.jobs');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.exports', 'QA exports', 'call', 'SUM', 'ACTIVE');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.views', 'QA vistas', 'call', 'SUM', 'ACTIVE');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.ai.calls', 'QA IA', 'call', 'SUM', 'ACTIVE', p_capability_code => 'esupplier.qa.ai.copilot');

select pg_temp.act_as_postgres();
insert into platform.catalog_items (code, name, saas_product_id, item_type, scope, lifecycle_status, billing_model, currency)
values ('qa_api_calls', 'QA API por uso', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD'),
       ('qa_storage_gb', 'QA GB por uso', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD'),
       ('qa_sync_jobs', 'QA jobs por uso', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD'),
       ('qa_views', 'QA vistas por uso', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD'),
       ('qa_ai_overage', 'QA exceso de créditos IA', null, 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD'),
       ('qa_ai_pack', 'QA paquete de créditos IA', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'FLAT', 'USD'),
       ('qa_flat', 'QA plano', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'FLAT', 'USD');

select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.set_catalog_item_usage_binding('qa_api_calls', 'METER', 'esupplier.qa.api.calls', 'QA') $$,
  '42501', null, 'Un tenant admin no decide cómo se factura el uso');
select throws_ok($$ select platform.set_catalog_item_credit_pack('qa_ai_pack', 5, 'QA') $$,
  '42501', null, 'Un tenant admin no fija créditos por paquete (D-03)');

select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.set_catalog_item_usage_binding('qa_flat', 'METER', 'esupplier.qa.api.calls', 'QA') $$,
  '23514', null, 'Solo un ítem PER_UNIT se liga a un medidor');
select throws_ok($$ select platform.set_catalog_item_usage_binding('qa_api_calls', 'METER', 'esupplier.qa.api.calls', ' ') $$,
  '23502', null, 'Ligar un ítem a un medidor exige motivo');
select lives_ok($$ select platform.set_catalog_item_usage_binding('qa_api_calls', 'METER', 'esupplier.qa.api.calls', 'QA sintético') $$,
  'qa_api_calls tarifa el medidor A');
select throws_ok($$ select platform.set_catalog_item_usage_binding('qa_views', 'METER', 'esupplier.qa.api.calls', 'QA') $$,
  '23505', null, 'Un medidor tiene un solo ítem de tarifa vigente (sin doble cobro por diseño)');
select platform.set_catalog_item_usage_binding('qa_storage_gb', 'METER', 'esupplier.qa.storage.gb', 'QA sintético');
select platform.set_catalog_item_usage_binding('qa_sync_jobs', 'METER', 'esupplier.qa.sync.jobs', 'QA sintético');
select platform.set_catalog_item_usage_binding('qa_views', 'METER', 'esupplier.qa.views', 'QA sintético');
select platform.set_catalog_item_usage_binding('qa_ai_overage', 'AI_CREDIT', null, 'QA sintético');
select throws_ok($$ select platform.set_catalog_item_credit_pack('qa_ai_pack', 0, 'QA') $$,
  '23514', null, 'Créditos por paquete > 0');
select platform.set_catalog_item_credit_pack('qa_ai_pack', 5, 'QA sintético');

select platform.set_catalog_item_price('qa_api_calls', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 0.50, pg_temp.cur(), pg_temp.m(-6));
select platform.set_catalog_item_price('qa_storage_gb', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 2.00, pg_temp.cur(), pg_temp.m(-6));
select platform.set_catalog_item_price('qa_sync_jobs', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 3.00, pg_temp.cur(), pg_temp.m(-6));
select platform.set_catalog_item_price('qa_views', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 9.00, pg_temp.cur(), pg_temp.m(-6));
select platform.set_catalog_item_price('qa_ai_overage', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 0.10, pg_temp.cur(), pg_temp.m(-6));
select lives_ok($$ select platform.set_catalog_item_price('qa_ai_pack', 'PE', 'CREDIT_PURCHASE', 'ONE_TIME', 1.00, pg_temp.cur(), pg_temp.m(-6)) $$,
  'Una tarifa CREDIT_PURCHASE se versiona como las demás');

select platform.set_usage_meter_billable('esupplier', m, true, 'QA: decisión sintética de la prueba')
  from unnest(array['esupplier.qa.api.calls', 'esupplier.qa.storage.gb', 'esupplier.qa.sync.jobs', 'esupplier.qa.exports']) m;
select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 2, 'call', pg_temp.ts(-6, 1), 'QA sintético');
select platform.create_ai_credit_policy('PLAN', 'esupplier-shared-standard', 'TENANT', 10, 'ALLOW', pg_temp.m(-6), 'QA sintético');

-- ---------------------------------------------------------------------------
-- Uso de M-2, cierre y finalización
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ev(p_meter text, p_qty numeric, p_at timestamptz, p_tenant uuid default null, p_cap text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('eventId', gen_random_uuid()::text, 'meterCode', p_meter, 'quantity', p_qty,
    'unit', case p_meter when 'esupplier.qa.storage.gb' then 'gb' when 'esupplier.qa.sync.jobs' then 'job' else 'call' end,
    'occurredAt', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'controlPlaneTenantId', coalesce(p_tenant, pg_temp.tenant())::text, 'capabilityCode', p_cap))
$$;
select pg_temp.act_as_service();
select platform.open_ai_credit_period(pg_temp.tenant(), pg_temp.m(-2));
select platform.ingest_usage_events('esupplier', 'DEV', (
  select jsonb_agg(e) from (
    select pg_temp.ev('esupplier.qa.api.calls', 1, pg_temp.ts(-2, d)) e from generate_series(1, 7) d
    union all select pg_temp.ev('esupplier.qa.storage.gb', 3, pg_temp.ts(-2, 4))
    union all select pg_temp.ev('esupplier.qa.sync.jobs', 5, pg_temp.ts(-2, 5))
    union all select pg_temp.ev('esupplier.qa.exports', 4, pg_temp.ts(-2, 6))
    union all select pg_temp.ev('esupplier.qa.views', 11, pg_temp.ts(-2, 7))
    union all select pg_temp.ev('esupplier.qa.ai.calls', 1, pg_temp.ts(-2, d), null, 'esupplier.qa.ai.copilot') from generate_series(1, 8) d
    union all select pg_temp.ev('esupplier.qa.api.calls', 6, pg_temp.ts(-2, 9), pg_temp.demo())
    union all select pg_temp.ev('esupplier.qa.api.calls', 2, pg_temp.ts(0, 1))
  ) x), gen_random_uuid());
select platform.close_usage_periods(now());

create or replace function pg_temp.agg(p_meter text, k int, p_tenant uuid default null) returns uuid language sql as $$
  select a.id from platform.usage_period_aggregates a
   where a.tenant_id = coalesce(p_tenant, pg_temp.tenant()) and a.meter_code = p_meter and a.period_start = pg_temp.m(k)
$$;

-- Factura de M-1 ANTES de finalizar: nada de uso (nunca desde eventos crudos ni agregados abiertos).
select pg_temp.act_as(pg_temp.finance());
create temp table qa_inv_open as select platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(-2)) r;
select pg_temp.act_as_postgres();
select is(
  (select string_agg(k || ':' || description || ':' || quantity || ':' || unit_amount || ':' || rec, ',' order by k)
     from (select l.charge_kind::text k, l.description, l.quantity, l.unit_amount, l.is_recurring rec
             from platform.invoice_lines l where l.invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv_open)) x),
  (select string_agg(k || ':' || description || ':' || quantity || ':' || unit_amount || ':' || rec, ',' order by k) from qa_before),
  'Antes = después: la factura de un período sin uso facturable replica exactamente las líneas debidas');
select is(
  (select count(*)::int from platform.invoice_lines l
    where l.invoice_id = (select (r ->> 'invoice_id')::uuid from qa_inv_open)
      and (l.usage_aggregate_id is not null or l.usage_basis is not null or l.corrects_line_id is not null)),
  0, 'Sin uso: ninguna línea lleva vínculos de uso');
select is((select tax_amount from platform.invoices where id = (select (r ->> 'invoice_id')::uuid from qa_inv_open)),
  0.00::numeric, 'Ningún impuesto nuevo (D-13): tax_amount como hoy');

select pg_temp.act_as(pg_temp.finance());
select platform.finalize_usage_aggregate(pg_temp.agg(m, -2))
  from unnest(array['esupplier.qa.api.calls', 'esupplier.qa.storage.gb', 'esupplier.qa.sync.jobs', 'esupplier.qa.exports',
                    'esupplier.qa.views', 'esupplier.qa.ai.calls']) m;
select platform.finalize_usage_aggregate(pg_temp.agg('esupplier.qa.api.calls', -2, pg_temp.demo()));

select pg_temp.act_as_postgres();
select is(
  (select string_agg(meter_code || '=' || quantity::numeric(10,2) || ':' || allowance_status || ':' || is_billable, ',' order by meter_code)
     from platform.usage_period_aggregates where tenant_id = pg_temp.tenant() and period_start = pg_temp.m(-2)),
  'esupplier.qa.ai.calls=8.00:NO_ALLOWANCE:false,esupplier.qa.api.calls=7.00:NO_ALLOWANCE:true,'
  || 'esupplier.qa.exports=4.00:NO_ALLOWANCE:true,esupplier.qa.storage.gb=3.00:NO_ALLOWANCE:true,'
  || 'esupplier.qa.sync.jobs=5.00:OVER:true,esupplier.qa.views=11.00:NO_ALLOWANCE:false',
  'Agregados FINALIZED de M-2 (fase 17): C excede su asignación de 2; E y la IA no son facturables como medidor');

-- ---------------------------------------------------------------------------
-- Créditos: compra (CREDIT_PURCHASE) con su línea y su entrada GRANT_PURCHASE
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 1, 'TENANT', pg_temp.m(-2), 'QA', 'buy-qa-1') $$,
  '42501', null, 'Un tenant admin no se vende créditos');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_flat', 1, 'TENANT', pg_temp.m(-2), 'QA', 'buy-qa-x') $$,
  '23514', 'CREDITOS_POR_PAQUETE_NO_DEFINIDOS: qa_flat no declara créditos por paquete (D-03)',
  'Un ítem sin créditos por paquete no se vende como créditos');
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 0, 'TENANT', pg_temp.m(-2), 'QA', 'buy-qa-0') $$,
  '23514', null, 'Cantidad de paquetes > 0');
create temp table qa_buy as
select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 1, 'TENANT', pg_temp.m(-2), 'QA compra sintética', 'buy-qa-1') r;
select is((platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 1, 'TENANT', pg_temp.m(-2), 'QA compra sintética', 'buy-qa-1')
            ->> 'ledger_entry_id'),
  (select r ->> 'ledger_entry_id' from qa_buy), 'Misma clave de compra → misma compra (idempotente)');
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 2, 'TENANT', pg_temp.m(-2), 'QA', 'buy-qa-1') $$,
  '23505', null, 'Misma clave con otro contenido → conflicto');
select pg_temp.act_as_postgres();
select is(
  (select l.entry_type || ':' || l.credits::numeric(10,2) || ':' || l.pool_key from platform.ai_credit_ledger l
    where l.id = (select (r ->> 'ledger_entry_id')::uuid from qa_buy)),
  'GRANT_PURCHASE:5.00:TENANT', 'La compra acredita 1 paquete × 5 créditos en el ledger');
select is(
  (select si.charge_kind || ':' || si.billing_interval || ':' || si.quantity::numeric(10,2) || ':' || si.unit_amount || ':' || si.source_type
          || ':' || (si.price_ref = (select p.id from platform.catalog_item_prices p join platform.catalog_items ci on ci.id = p.catalog_item_id
                                      where ci.code = 'qa_ai_pack' and p.valid_to is null))
     from platform.subscription_items si where si.id = (select (r ->> 'subscription_item_id')::uuid from qa_buy)),
  'CREDIT_PURCHASE:ONE_TIME:1.00:1.00:CREDIT_PURCHASE:true', 'La compra deja un ítem ONE_TIME con la tarifa vigente congelada');
select is(
  (select b.included::numeric(10,2) || ':' || b.purchased::numeric(10,2) || ':' || b.used::numeric(10,2) || ':' || b.balance::numeric(10,2)
     from platform.v_ai_credit_balances b where b.tenant_id = pg_temp.tenant() and b.pool_key = 'TENANT' and b.period_start = pg_temp.m(-2)),
  '10.00:5.00:16.00:-1.00', 'Aritmética de créditos: 10 incluidos + 5 comprados − 8×2 usados = −1');

-- ---------------------------------------------------------------------------
-- Factura de M-1: consumo vencido de M-2
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
create temp table qa_inv as select platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(-1)) r;
grant select on qa_inv to authenticated;
create or replace function pg_temp.inv() returns uuid language sql as $$ select (r ->> 'invoice_id')::uuid from qa_inv $$;

select pg_temp.act_as_postgres();
select is(
  (select string_agg(l.charge_kind || ':' || coalesce(l.usage_basis, '-') || ':' || coalesce(l.meter_code, l.ai_credit_pool_key, '-')
                     || ':' || l.quantity || 'x' || l.unit_amount || '=' || l.amount || ':' || l.is_recurring, ' | '
                     order by l.charge_kind, l.amount)
     from platform.invoice_lines l where l.invoice_id = pg_temp.inv()),
  'LICENSE:-:-:1.00x100.00=100.00:true | USAGE_OVERAGE:AI_CREDIT_OVERAGE:TENANT:1.00x0.10=0.10:false | '
  || 'USAGE_OVERAGE:USAGE:esupplier.qa.api.calls:7.00x0.50=3.50:false | CREDIT_PURCHASE:-:-:1.00x1.00=1.00:false',
  'M-1 = licencia + compra de créditos + exceso de 1 crédito + 7 llamadas A; nada por B, C, D, E ni DEMO');
select is((select total::text || ' ' || tax_amount::text from platform.invoices where id = pg_temp.inv()),
  '104.60 0.00', 'Total 104.60 = suma exacta de líneas; sin impuesto inventado');
select is(
  (select (l.usage_aggregate_id = pg_temp.agg('esupplier.qa.api.calls', -2))::text || ':' || (l.usage_source_hash = a.source_hash)::text
          || ':' || (l.price_ref = p.id)::text || ':' || (l.catalog_item_id = ci.id)::text || ':' || (l.usage_period_start = pg_temp.m(-2))::text
     from platform.invoice_lines l
     join platform.usage_period_aggregates a on a.id = l.usage_aggregate_id
     join platform.catalog_items ci on ci.code = 'qa_api_calls'
     join platform.catalog_item_prices p on p.catalog_item_id = ci.id and p.valid_to is null
    where l.invoice_id = pg_temp.inv() and l.usage_basis = 'USAGE'),
  'true:true:true:true:true', 'La línea USAGE referencia el agregado FINALIZED (su source_hash), el ítem y la tarifa vigente');
select is(
  (select (l.usage_aggregate_id is null)::text || ':' || (l.usage_period_start = pg_temp.m(-2))::text || ':'
          || (l.usage_source_hash ~ '^sha256:[0-9a-f]{64}$')::text || ':' || (l.catalog_item_id is not null)::text
     from platform.invoice_lines l where l.invoice_id = pg_temp.inv() and l.usage_basis = 'AI_CREDIT_OVERAGE'),
  'true:true:true:true', 'La línea de exceso de créditos referencia pool × período y el hash de sus agregados FINALIZED');
select is(
  (select (l.ai_credit_entry_id = (select (r ->> 'ledger_entry_id')::uuid from qa_buy))::text
     from platform.invoice_lines l where l.invoice_id = pg_temp.inv() and l.charge_kind = 'CREDIT_PURCHASE'),
  'true', 'La línea CREDIT_PURCHASE apunta a su entrada GRANT_PURCHASE');
select is(
  (select string_agg(code, ',' order by code) from platform.usage_alerts
    where tenant_id = pg_temp.tenant() and aggregate_id in (pg_temp.agg('esupplier.qa.storage.gb', -2), pg_temp.agg('esupplier.qa.exports', -2),
                                                            pg_temp.agg('esupplier.qa.sync.jobs', -2), pg_temp.agg('esupplier.qa.views', -2))),
  'ASIGNACION_NO_DEFINIDA,OVERAGE_UNDER_BLOCK_POLICY,TARIFA_ADDON_NO_DEFINIDA',
  'Sin asignación decidida (B) o sin tarifa (D) → alerta a finanzas; C exceso bajo BLOCK solo alerta; E no facturable, sin alerta');

-- Idempotencia y no doble cobro
select pg_temp.act_as(pg_temp.finance());
select is((platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(-1)) ->> 'created')::boolean, false,
  'Re-emitir M-1 devuelve la misma factura');
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.usage_alerts where tenant_id = pg_temp.tenant() and code in ('ASIGNACION_NO_DEFINIDA', 'TARIFA_ADDON_NO_DEFINIDA')),
  2, 'Re-emitir no duplica alertas');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, is_recurring,
                                      usage_aggregate_id, meter_code, usage_basis, usage_period_start, usage_source_hash)
  select (r ->> 'invoice_id')::uuid, 'USAGE_OVERAGE', 'dup', 7, 0.50, pg_temp.cur(), false, a.id, a.meter_code, 'USAGE', a.period_start, a.source_hash
    from qa_inv_open, platform.usage_period_aggregates a where a.id = pg_temp.agg('esupplier.qa.api.calls', -2) $$,
  '23505', null, 'Un agregado ya facturado no entra en otra factura no anulada (AGREGADO_YA_FACTURADO)');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, is_recurring,
                                      usage_aggregate_id, meter_code, usage_basis, usage_period_start, usage_source_hash)
  select pg_temp.inv(), 'USAGE_OVERAGE', 'abierto', 2, 0.50, pg_temp.cur(), false, a.id, a.meter_code, 'USAGE', a.period_start, 'sha256:' || repeat('0', 64)
    from platform.usage_period_aggregates a where a.id = pg_temp.agg('esupplier.qa.api.calls', 0) $$,
  '55000', null, 'Un agregado no FINALIZED no se factura (AGREGADO_NO_FINALIZADO)');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, is_recurring,
                                      usage_aggregate_id, meter_code, usage_basis, usage_period_start, usage_source_hash)
  select pg_temp.inv(), 'USAGE_OVERAGE', 'demo', 6, 0.50, pg_temp.cur(), false, a.id, a.meter_code, 'USAGE', a.period_start, a.source_hash
    from platform.usage_period_aggregates a where a.id = pg_temp.agg('esupplier.qa.api.calls', -2, pg_temp.demo()) $$,
  '23514', null, 'Un agregado DEMO (no facturable) nunca se factura (AGREGADO_NO_FACTURABLE)');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, is_recurring,
                                      ai_credit_pool_key, usage_basis, usage_period_start, usage_source_hash, tenant_id)
  select (r ->> 'invoice_id')::uuid, 'USAGE_OVERAGE', 'dup', 1, 0.10, pg_temp.cur(), false, 'TENANT', 'AI_CREDIT_OVERAGE', pg_temp.m(-2),
         'sha256:' || repeat('0', 64), pg_temp.tenant()
    from qa_inv_open $$,
  '23505', null, 'El exceso de créditos de un pool × período se factura una sola vez (CREDITOS_YA_FACTURADOS)');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency)
  values (pg_temp.inv(), 'USAGE_OVERAGE', 'sin vínculo', 1, 1, pg_temp.cur()) $$,
  '23514', null, 'Una línea USAGE_OVERAGE sin agregado ni pool no existe (CHECK)');

-- ---------------------------------------------------------------------------
-- VOID libera la reclamación; nunca VOID con cobros CONFIRMED
-- ---------------------------------------------------------------------------
update platform.invoices set status = 'VOID' where id = pg_temp.inv();
select pg_temp.act_as(pg_temp.finance());
create temp table qa_inv2 as select platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(-1)) r;
grant select on qa_inv2 to authenticated;
create or replace function pg_temp.inv2() returns uuid language sql as $$ select (r ->> 'invoice_id')::uuid from qa_inv2 $$;
select pg_temp.act_as_postgres();
select is(
  (select (r ->> 'total') from qa_inv2) || ':' || (select count(*) from platform.invoice_lines where invoice_id = pg_temp.inv2() and usage_basis is not null),
  '104.60:2', 'Anulada la factura, la re-emisión vuelve a reclamar el mismo uso (una sola vez)');
select pg_temp.act_as(pg_temp.finance());
select lives_ok($$ select platform.confirm_manual_payment(pg_temp.inv2(), 104.60, 'TRF-QA-CCP-USAGE-001', 'BANK_TRANSFER', now()) $$,
  'Cobro CONFIRMED de la factura con uso');
select pg_temp.act_as_postgres();
select throws_ok($$ update platform.invoices set status = 'VOID' where id = pg_temp.inv2() $$,
  '23514', null, 'Una factura con cobros CONFIRMED no se anula (FACTURA_CON_PAGOS_CONFIRMADOS)');

-- Comisiones: solo desde CONFIRMED; uso y compra de créditos no comisionan sin regla explícita (D-11)
select is(
  (select string_agg(distinct l.charge_kind::text, ',') from platform.commission_events e
     join platform.invoice_lines l on l.id = e.invoice_line_id
     join platform.payments p on p.id = e.payment_id
    where p.reference = 'TRF-QA-CCP-USAGE-001'),
  'LICENSE', 'COLLECTED_ANY no incluye USAGE_OVERAGE ni CREDIT_PURCHASE (D-11): solo la licencia comisiona');
insert into platform.commission_rules (commission_plan_id, name, basis, rate, currency, is_recurring, priority, charge_kind)
values ('90000000-0000-4000-a000-000000000002', 'QA · uso explícito', 'COLLECTED_ANY', 0.05, 'USD', true, 2, 'USAGE_OVERAGE');
select platform.generate_commission_events(p.id) from platform.payments p where p.reference = 'TRF-QA-CCP-USAGE-001';
select is(
  (select count(*)::int from platform.commission_events e
     join platform.invoice_lines l on l.id = e.invoice_line_id
     join platform.commission_rules r on r.id = e.commission_rule_id
     join platform.payments p on p.id = e.payment_id
    where p.reference = 'TRF-QA-CCP-USAGE-001' and l.charge_kind = 'USAGE_OVERAGE' and r.charge_kind = 'USAGE_OVERAGE'),
  2, 'Una regla que nombra USAGE_OVERAGE explícitamente sí comisiona el uso (y solo esa regla)');
select is((select count(*)::int from platform.commission_events e join platform.payments p on p.id = e.payment_id
            where p.status <> 'CONFIRMED'), 0, 'Ningún evento de comisión nace de un pago no CONFIRMED');

-- ---------------------------------------------------------------------------
-- DISCOUNT correctivo (spec §13.2)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.lic_line() returns uuid language sql as $$
  select id from platform.invoice_lines where invoice_id = pg_temp.inv2() and charge_kind = 'LICENSE'
$$;
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.schedule_corrective_discount(pg_temp.lic_line(), 30, 'QA') $$,
  '42501', null, 'Un tenant admin no se aplica descuentos');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.schedule_corrective_discount(pg_temp.lic_line(), 30, ' ') $$,
  '23502', null, 'Un descuento correctivo exige motivo');
select throws_ok($$ select platform.schedule_corrective_discount(pg_temp.lic_line(), 0, 'QA') $$,
  '23514', null, 'Importe correctivo > 0');
select throws_ok($$ select platform.schedule_corrective_discount(
                      (select id from platform.invoice_lines where invoice_id = pg_temp.inv() and charge_kind = 'LICENSE'), 10, 'QA') $$,
  '23514', null, 'Una línea de factura anulada no se corrige');
select lives_ok($$ select platform.schedule_corrective_discount(pg_temp.lic_line(), 30, 'QA: precio mal aplicado') $$,
  'Finanzas programa un correctivo de 30 sobre la licencia de 100');
select throws_ok($$ select platform.schedule_corrective_discount(pg_temp.lic_line(), 80, 'QA') $$,
  '23514', 'DESCUENTO_EXCEDE_LINEA: 30.00 ya corregido + 80.00 supera el importe 100.00 de la línea',
  'Las correcciones acumuladas no superan la línea corregida');

-- Add-on de catálogo con tarifa vigente (ADDON ligado a catalog_item + price_ref)
select pg_temp.act_as_postgres();
update platform.catalog_items set saas_product_id = pg_temp.esup() where code = 'white_label';
select pg_temp.act_as(pg_temp.finance());
select platform.set_catalog_item_price('white_label', 'PE', 'ADDON', 'MONTHLY', 40.00, pg_temp.cur(), current_date);
select platform.request_tenant_addon(pg_temp.tenant(), 'white_label', null, 'QA');
select platform.approve_tenant_addon((select id from platform.tenant_addons where tenant_id = pg_temp.tenant() and addon_code = 'white_label'), 'QA');
-- D-09: una tarifa posterior no reprecia el ítem activo.
select platform.set_catalog_item_price('white_label', 'PE', 'ADDON', 'MONTHLY', 45.00, pg_temp.cur(), current_date + 1);

create temp table qa_inv3 as select platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(0)) r;
grant select on qa_inv3 to authenticated;
create or replace function pg_temp.inv3() returns uuid language sql as $$ select (r ->> 'invoice_id')::uuid from qa_inv3 $$;
select pg_temp.act_as_postgres();
select is(
  (select string_agg(l.charge_kind || ':' || l.quantity || 'x' || l.unit_amount || '=' || l.amount, ' | ' order by l.charge_kind, l.amount)
     from platform.invoice_lines l where l.invoice_id = pg_temp.inv3()),
  'LICENSE:1.00x100.00=100.00 | ADDON:1.00x40.00=40.00 | DISCOUNT:1.00x-30.00=-30.00',
  'M0 = licencia + add-on + correctivo negativo; sin repetir ONE_TIME, compra ni uso ya facturados; el uso de M0 sigue abierto');
select is((select total from platform.invoices where id = pg_temp.inv3()), 110.00::numeric,
  'Total M0 = 100 + 40 − 30: el correctivo resta exactamente una vez');
select is(
  (select (l.corrects_line_id = pg_temp.lic_line())::text from platform.invoice_lines l
    where l.invoice_id = pg_temp.inv3() and l.charge_kind = 'DISCOUNT'),
  'true', 'El correctivo apunta a la línea corregida (corrects_line_id)');
select is(
  (select (l.catalog_item_id = ci.id)::text || ':' || (l.price_ref = p.id)::text || ':' || l.unit_amount
     from platform.invoice_lines l
     join platform.catalog_items ci on ci.code = 'white_label'
     join platform.catalog_item_prices p on p.catalog_item_id = ci.id and p.amount = 40.00
    where l.invoice_id = pg_temp.inv3() and l.charge_kind = 'ADDON'),
  'true:true:40.00', 'La línea ADDON queda ligada al ítem de catálogo y a la tarifa vigente al activarse (no a la posterior)');
select is((select total from platform.invoices where id = pg_temp.inv2()), 104.60::numeric,
  'La factura corregida no cambia (inmutable; el correctivo va en la siguiente)');
select is(
  (select count(*)::int from platform.payments where invoice_id in (pg_temp.inv2(), pg_temp.inv3()) and amount < 0), 0,
  'Un correctivo no es reembolso: ningún pago negativo');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, corrects_line_id)
  values (pg_temp.inv3(), 'DISCOUNT', 'excede', 1, -71, pg_temp.cur(), pg_temp.lic_line()) $$,
  '23514', null, 'El guard de línea también impide corregir más que la línea (30 + 71 > 100)');
select throws_ok($$
  insert into platform.invoice_lines (invoice_id, charge_kind, description, quantity, unit_amount, currency, corrects_line_id)
  values (pg_temp.inv3(), 'LICENSE', 'no', 1, -5, pg_temp.cur(), pg_temp.lic_line()) $$,
  '23514', null, 'Solo un DISCOUNT negativo puede corregir una línea (CHECK)');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.schedule_corrective_discount(
                      (select id from platform.invoice_lines where invoice_id = pg_temp.inv3() and charge_kind = 'DISCOUNT'), 5, 'QA') $$,
  '23514', null, 'Un descuento no se corrige con otro descuento');

-- Siguiente período: nada se repite
select pg_temp.act_as(pg_temp.finance());
select is(
  (select r ->> 'total' from (select platform.issue_subscription_invoice((select id from qa_sub), pg_temp.m(1)) r) x),
  '140.00', 'M+1 = licencia + add-on: el correctivo, la compra y el uso no se repiten');

-- MRR: uso y créditos no son recurrentes
select pg_temp.act_as_postgres();
select is((select mrr from platform.v_subscription_mrr where subscription_id = (select id from qa_sub)), 140.00::numeric,
  'MRR = licencia 100 + add-on 40; ni uso, ni compra de créditos, ni correctivo ONE_TIME entran en MRR');

-- ---------------------------------------------------------------------------
-- Faltas de configuración: fallan cerrado
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 1, 'PRODUCT:esupplier', pg_temp.m(-2), 'QA', 'buy-qa-2') $$,
  '22023', null, 'Un pool que la política no define no recibe compras');
select pg_temp.act_as_postgres();
update platform.catalog_item_prices set valid_to = pg_temp.m(-6)
 where catalog_item_id = (select id from platform.catalog_items where code = 'qa_ai_pack') and valid_to is null;
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.purchase_ai_credits((select id from qa_sub), 'qa_ai_pack', 1, 'TENANT', pg_temp.m(0), 'QA', 'buy-qa-3') $$,
  '23514', null, 'Sin tarifa CREDIT_PURCHASE vigente → TARIFA_ADDON_NO_DEFINIDA (D-01/D-02)');
select throws_ok($$ select platform.set_catalog_item_price('qa_flat', 'PE', 'SUPPORT_FEE', 'MONTHLY', 1, pg_temp.cur(), current_date) $$,
  '23514', null, 'Un ítem de catálogo no se tarifa con cargos que no le corresponden');

-- Política BLOCK o no definida: el exceso de créditos no se factura
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
    where l.usage_basis = 'AI_CREDIT_OVERAGE' and i.status <> 'VOID' and l.tenant_id = pg_temp.tenant()),
  1, 'Un único exceso de créditos facturado para el pool × período');
select is(
  (select count(*)::int from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
    where l.usage_aggregate_id is not null and i.status <> 'VOID'
    group by l.usage_aggregate_id order by 1 desc limit 1),
  1, 'Ningún agregado aparece en dos facturas vigentes');

select * from finish();
rollback;
