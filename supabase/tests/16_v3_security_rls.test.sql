-- ============================================================================
-- V3 · Fase 16 — RLS, grants y SECURITY DEFINER de todo lo multicurrency
-- ----------------------------------------------------------------------------
-- Estructura (lista explícita de objetos V3, para que un fallo señale el objeto)
-- y negativos por rol: partner, tenant, comercial, producto y finanzas solo
-- pueden lo suyo. Un partner o un tenant nunca tocan FX ni catálogos globales.
-- ============================================================================
begin;
select plan(44);

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

-- Usuarios del seed
create or replace function pg_temp.partner() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.tenant_user() returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000b'::uuid $$;
create or replace function pg_temp.agent() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.product() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform'
      and c.relname in ('currencies', 'markets', 'market_currencies', 'payment_provider_account_currencies',
                        'exchange_rates', 'control_plane_settings')
      and c.relrowsecurity and c.relforcerowsecurity),
  6,
  'Las 6 tablas V3 tienen RLS habilitada y forzada'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('currencies', 'markets', 'market_currencies', 'payment_provider_account_currencies',
                         'exchange_rates', 'control_plane_settings', 'plan_prices')
      and grantee in ('authenticated', 'anon', 'PUBLIC')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  'Catálogo regional, FX, configuración y tarifas: sin escritura directa para authenticated/anon'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'v'
      and c.relname in ('v_company_markets', 'v_plan_price_catalog', 'v_currency_integrity_issues',
                        'v_provider_account_routes', 'v_finance_facts', 'v_tenant_overview',
                        'v_product_margin', 'v_partner_margin', 'v_tenant_margin', 'v_partner_agreements')
      and (select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker') = 'true'),
  10,
  'Las 10 vistas creadas o redefinidas en V3 son security_invoker'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and p.proname in ('require_active_market', 'resolve_market_currency', 'set_plan_price', 'create_subscription',
                        'onboard_customer_subscription', 'upsert_catalog_item', 'set_subscription_collection_profile',
                        'upsert_payment_provider_account', 'set_exchange_rate', 'void_exchange_rate',
                        'set_reporting_settings', 'settle_commissions', 'generate_commission_events',
                        'upsert_commission_rule', 'upsert_currency', 'upsert_market', 'upsert_company')
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                       where cfg = 'search_path=platform, pg_catalog')),
  0,
  'Toda RPC SECURITY DEFINER de V3 fija search_path = platform, pg_catalog'
);

select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and not p.prosecdef
      and p.proname in ('current_plan_price', 'plan_has_regional_price', 'provider_account_candidates',
                        'fx_rate_lookup', 'fx_convert', 'reporting_settings', 'to_reporting_amount',
                        'finance_reporting_rows', 'finance_consolidated', 'dashboard_summary')),
  'current_plan_price,dashboard_summary,finance_consolidated,finance_reporting_rows,fx_convert,fx_rate_lookup,plan_has_regional_price,provider_account_candidates,reporting_settings,to_reporting_amount',
  'Las lecturas de tarifa, FX, routing y reporting son SECURITY INVOKER: respetan RLS del llamante'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon no puede ejecutar ninguna función de platform'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'H-2/H-3: ninguna función de trigger concede EXECUTE a authenticated (grants mínimos)'
);

select ok(
  not has_function_privilege('authenticated', 'platform.generate_commission_events(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.generate_commission_events(uuid)', 'EXECUTE'),
  'H-1: generate_commission_events no es una RPC de usuario (solo trigger y service_role)'
);

-- ---------------------------------------------------------------------------
-- Negativos: PARTNER_ADMIN (Andina)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.partner());

select throws_ok($$ select platform.set_exchange_rate('2026-09-05', 'USD', 'PEN', 3.6) $$, '42501', null,
  'Partner: no publica tipos de cambio');
select throws_ok($$ select platform.void_exchange_rate((select id from platform.exchange_rates limit 1), 'x') $$, '42501', null,
  'Partner: no anula tipos de cambio');
select throws_ok($$ select platform.set_reporting_settings('PEN') $$, '42501', null,
  'Partner: no cambia la moneda de reporte');
select throws_ok($$ select platform.upsert_market('PE', 'Perú', 'PE', 'USD', array['USD']::char(3)[]) $$, '42501', null,
  'Partner: no mantiene mercados');
select throws_ok($$ select platform.upsert_currency('PEN', 'Sol', 2::smallint) $$, '42501', null,
  'Partner: no mantiene monedas');
select throws_ok($$ select platform.set_plan_price('60000000-0000-4000-a000-000000000001', 'PE', 'LICENSE', 'MONTHLY', 1, 'USD', current_date + 90) $$, '42501', null,
  'Partner: no fija tarifas regionales');
select throws_ok($$ select platform.upsert_payment_provider_account('andina-bo', 'Andina BO', 'BANK', 'TEST', null, 'BO', array['BOB']::char(3)[]) $$, '42501', null,
  'Partner: no configura cuentas de cobro');
select throws_ok($$ select platform.settle_commissions('80000000-0000-4000-a000-000000000002', current_date - 30, current_date, 'BOB') $$, '42501', null,
  'Partner: no liquida comisiones, ni las de su propio comercial');
select throws_ok($$ select platform.generate_commission_events((select id from platform.payments limit 1)) $$, '42501', null,
  'Partner: no dispara el devengo de comisiones');
select throws_ok($$ insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate) values ('2026-09-05', 'USD', 'BOB', 7) $$, '42501', null,
  'Partner: no inserta tasas por PostgREST');
select throws_ok($$ update platform.control_plane_settings set reporting_currency_code = 'PEN' $$, '42501', null,
  'Partner: no actualiza la configuración por PostgREST');

select is((select count(*)::int from platform.exchange_rates), 0,
  'Partner: RLS no le devuelve tipos de cambio');
select is(
  (select count(*)::int from platform.payment_provider_account_currencies c
     join platform.payment_provider_accounts a on a.id = c.provider_account_id where a.code = 'culqi-pe-test'),
  0,
  'Partner: no ve las monedas de las cuentas de cobro de EBIM');
select is(
  (select count(*)::int from platform.v_finance_facts
    where organization_id in ('30000000-0000-4000-a000-00000000000c', '30000000-0000-4000-a000-00000000000f')),
  0,
  'Partner: los hechos financieros de clientes directos de EBIM (Arequipa, Guayas) no le son visibles');
select is(
  (select platform.finance_consolidated(p_as_of => '2026-09-01') -> 'completeness' ->> 'complete'),
  'false',
  'Partner: sin acceso a tasas, su consolidado no se declara completo (no hay conversión inventada)');

-- ---------------------------------------------------------------------------
-- Negativos: TENANT_USER (Alpha)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tenant_user());

select throws_ok($$ select platform.set_exchange_rate('2026-09-05', 'USD', 'PEN', 3.6) $$, '42501', null,
  'Tenant: no publica tipos de cambio');
select throws_ok($$ select platform.set_reporting_settings('PEN') $$, '42501', null,
  'Tenant: no cambia la moneda de reporte');
select throws_ok($$ select platform.set_plan_price('60000000-0000-4000-a000-000000000001', 'PE', 'LICENSE', 'MONTHLY', 1, 'USD', current_date + 90) $$, '42501', null,
  'Tenant: no fija tarifas');
select throws_ok($$ select platform.create_subscription('30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001',
                     '60000000-0000-4000-a000-000000000001', 'MONTHLY', 'PE') $$, '42501', null,
  'Tenant: no crea contratos');
select throws_ok($$ select platform.onboard_customer_subscription('esupplier', '30000000-0000-4000-a000-000000000004', 'qa-tenant-x', 'X',
                     'x@example.com', '60000000-0000-4000-a000-000000000001', 'PE') $$, '42501', null,
  'Tenant: no hace altas regionales');
select throws_ok($$ insert into platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, amount, currency)
                     values ('60000000-0000-4000-a000-000000000001', platform.market_id_by_code('PE'), 'ADDON', 'MONTHLY', 1, 'USD') $$, '42501', null,
  'Tenant: no inserta tarifas por PostgREST');
select is((select count(*)::int from platform.exchange_rates), 0,
  'Tenant: RLS no le devuelve tipos de cambio');
select is((select count(*)::int from platform.v_plan_price_catalog where plan_code = 'esupplier-enterprise'), 0,
  'Tenant: no ve tarifas de un plan que su organización no contrata');
select ok((select count(*) from platform.markets) >= 3 and (select count(*) from platform.currencies) >= 3,
  'Tenant: sí lee el catálogo de mercados y monedas (lectura controlada: autenticado, sin escritura)');

-- ---------------------------------------------------------------------------
-- Negativos: SALES_AGENT (Carla)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.agent());

select throws_ok($$ select platform.settle_commissions('80000000-0000-4000-a000-000000000001', current_date - 30, current_date, 'PEN') $$, '42501', null,
  'Comercial: no liquida sus propias comisiones');
select throws_ok($$ select platform.upsert_commission_rule('90000000-0000-4000-a000-000000000001', 'Autoasignada', 'COLLECTED_ANY', 0.9, p_currency => 'PEN') $$, '42501', null,
  'Comercial: no se define reglas de comisión');
select throws_ok($$ select platform.set_exchange_rate('2026-09-05', 'USD', 'PEN', 1) $$, '42501', null,
  'Comercial: no publica tipos de cambio');
select is((select count(*)::int from platform.commission_events where sales_agent_id <> '80000000-0000-4000-a000-000000000001'), 0,
  'Comercial: solo ve sus comisiones, en cualquier moneda');

-- ---------------------------------------------------------------------------
-- Separación de funciones EBIM
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.product());
select throws_ok($$ select platform.set_exchange_rate('2026-09-05', 'USD', 'PEN', 3.6) $$, '42501', null,
  'EBIM_PRODUCT_ADMIN: no publica tipos de cambio (catálogo financiero)');
select throws_ok($$ select platform.upsert_payment_provider_account('prod-bo', 'Prod BO', 'BANK', 'TEST', null, 'BO', array['BOB']::char(3)[]) $$, '42501', null,
  'EBIM_PRODUCT_ADMIN: no configura cuentas de cobro');
select throws_ok($$ select platform.settle_commissions('80000000-0000-4000-a000-000000000001', current_date - 30, current_date, 'PEN') $$, '42501', null,
  'EBIM_PRODUCT_ADMIN: no liquida comisiones');
select lives_ok($$ select platform.set_plan_price('60000000-0000-4000-a000-000000000005', 'BO', 'LICENSE', 'MONTHLY', 4700, 'BOB') $$,
  'EBIM_PRODUCT_ADMIN: sí publica tarifas regionales');

-- Auditoría final (migración 35): ningún país regional implícito.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'platform' and column_name in ('country_code', 'currency') and column_default is not null),
  0,
  'Ninguna columna de país o moneda conserva un default regional (PE/PEN/USD)'
);
select pg_temp.act_as(pg_temp.product());
select throws_like($$ select platform.upsert_organization('qa-sin-pais', 'QA Sin País S.A.', 'QA Sin País') $$,
  'PAIS_REQUERIDO%',
  'Una organización ya no nace peruana por omisión: el país es obligatorio');

select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.set_plan_price('60000000-0000-4000-a000-000000000005', 'EC', 'LICENSE', 'MONTHLY', 600, 'USD', current_date + 1) $$, '42501', null,
  'EBIM_FINANCE: no fija tarifas (DV3-004: la tarifa es de producto)');
select lives_ok($$ select platform.set_exchange_rate('2026-09-05', 'USD', 'PEN', 3.6, 'QA seguridad') $$,
  'EBIM_FINANCE: sí publica tipos de cambio');

select * from finish();
rollback;
