-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · catálogo extendido y precios de
-- add-on con vigencia (Tasks MA-12, MA-13)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (catalog_items), §5 (catalog_item_prices = réplica de plan_prices).
-- Los importes son de prueba y se revierten (rollback): ningún precio de negocio
-- se crea ni se cambia (INV-4, ver 26_ccp_preservation).
-- ============================================================================
begin;
select plan(46);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
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

-- ---------------------------------------------------------------------------
-- MA-12 · catalog_items extendido
-- ---------------------------------------------------------------------------
select has_column('platform', 'catalog_items', 'lifecycle_status', 'catalog_items.lifecycle_status');
select has_column('platform', 'catalog_items', 'billing_model', 'catalog_items.billing_model');

select is(
  (select string_agg(code || ':' || lifecycle_status || ':' || available || ':' || billing_model, ',' order by code)
     from platform.catalog_items),
  'compras_repuestos:COMING_SOON:false:FLAT,consolidation:AVAILABLE:true:FLAT,echange_desk:COMING_SOON:false:FLAT,'
  || 'extra_company:AVAILABLE:true:PER_COMPANY,licitaciones:AVAILABLE:true:PER_COMPANY,'
  || 'multi_country:AVAILABLE:true:FLAT,sla_premium:AVAILABLE:true:FLAT,white_label:AVAILABLE:true:FLAT',
  'Filas existentes: lifecycle derivado de available, billing_model derivado de scope');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.upsert_catalog_item('qa_new_item', 'QA nuevo', null, 'addon', 'org-wide', false, 0, 'USD') $$,
  'La RPC legacy sigue creando items');
select is(
  (select lifecycle_status || ':' || billing_model from platform.catalog_items where code = 'qa_new_item'),
  'DRAFT:FLAT', 'Un item nuevo no disponible nace DRAFT');

select lives_ok($$ select platform.set_catalog_item_lifecycle('qa_new_item', 'AVAILABLE', 'Lanzamiento QA') $$,
  'EBIM_PRODUCT_ADMIN publica un item');
select is(
  (select lifecycle_status || ':' || available from platform.catalog_items where code = 'qa_new_item'),
  'AVAILABLE:true', 'available sigue a lifecycle_status');

select lives_ok($$ select platform.set_catalog_item_lifecycle('qa_new_item', 'RETIRED', 'Retiro QA') $$,
  'EBIM_PRODUCT_ADMIN retira un item');
select is(
  (select lifecycle_status || ':' || available from platform.catalog_items where code = 'qa_new_item'),
  'RETIRED:false', 'Un item retirado no está disponible');

select throws_ok($$ select platform.set_catalog_item_lifecycle('qa_new_item', 'SOLD_OUT', 'QA') $$,
  '23514', null, 'Un lifecycle desconocido se rechaza');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.set_catalog_item_lifecycle('licitaciones', 'RETIRED', 'QA') $$,
  '42501', null, 'TENANT_ADMIN no cambia el ciclo de vida del catálogo');

select pg_temp.act_as_postgres();
select ok(
  (select count(*) from platform.audit_logs where action = 'CATALOG_ITEM_LIFECYCLE_SET' and entity_id = 'qa_new_item') = 2,
  'Cada cambio de ciclo de vida queda auditado');

-- ---------------------------------------------------------------------------
-- MA-13 · catalog_item_prices: estructura y privilegios
-- ---------------------------------------------------------------------------
create or replace function pg_temp.item(p_code text) returns uuid language sql as $$
  select id from platform.catalog_items where code = p_code
$$;
create or replace function pg_temp.market(p_code text) returns uuid language sql as $$
  select id from platform.markets where code = p_code
$$;

select has_table('platform', 'catalog_item_prices', 'Existe platform.catalog_item_prices');
select is(
  (select relrowsecurity::text || ':' || relforcerowsecurity from pg_class
    where oid = 'platform.catalog_item_prices'::regclass),
  'true:true', 'RLS habilitada y forzada en catalog_item_prices');
select is(
  has_table_privilege('anon', 'platform.catalog_item_prices', 'select')::text || ':'
  || has_table_privilege('authenticated', 'platform.catalog_item_prices', 'select') || ':'
  || has_table_privilege('authenticated', 'platform.catalog_item_prices', 'insert') || ':'
  || has_table_privilege('authenticated', 'platform.catalog_item_prices', 'update') || ':'
  || has_table_privilege('authenticated', 'platform.catalog_item_prices', 'delete'),
  'false:true:false:false:false', 'anon sin acceso; authenticated solo SELECT');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('public', p.oid, 'execute') || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || coalesce(array_to_string(p.proconfig, ';') like '%search_path%', false),
            ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('current_catalog_item_price', 'set_catalog_item_price')),
  'current_catalog_item_price:false:false:false:true,set_catalog_item_price:true:false:false:true',
  'current_… es INVOKER; set_… es DEFINER; ninguna ejecutable por PUBLIC/anon');

-- ---------------------------------------------------------------------------
-- MA-13 · autoridad: solo finanzas (can_manage_regional_catalog)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 10, 'USD') $$,
  '42501', null, 'anon no fija precios de add-on');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 10, 'USD') $$,
  '42501', null, 'authenticated sin rol no fija precios');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 10, 'USD') $$,
  '42501', null, 'TENANT_ADMIN no fija precios');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 10, 'USD') $$,
  '42501', null, 'EBIM_PRODUCT_ADMIN no fija precios (dinero = finanzas)');

-- ---------------------------------------------------------------------------
-- MA-13 · versionado con vigencia (espejo de 08_v3_regional_pricing)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 111.00, 'USD', current_date) $$,
  'EBIM_FINANCE fija la tarifa PE/USD de un add-on');
select is(platform.current_catalog_item_price(pg_temp.item('licitaciones'), pg_temp.market('PE'), 'ADDON', 'MONTHLY', 'USD', current_date),
  111.00::numeric, 'Tarifa vigente hoy');
select is(platform.current_catalog_item_price(pg_temp.item('licitaciones'), pg_temp.market('PE'), 'ADDON', 'MONTHLY', 'USD', current_date - 1),
  null::numeric, 'Sin tarifa antes de valid_from');
select is(platform.current_catalog_item_price(pg_temp.item('licitaciones'), pg_temp.market('EC'), 'ADDON', 'MONTHLY', 'USD', current_date),
  null::numeric, 'La tarifa de PE no resuelve en EC aunque la moneda coincida');
select is(
  (select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 111.00, 'USD', current_date + 5))
  = (select id from platform.catalog_item_prices where catalog_item_id = pg_temp.item('licitaciones') and valid_to is null),
  true, 'Guardar el mismo importe no crea historia');
select lives_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 122.00, 'USD', current_date + 30) $$,
  'Una tarifa nueva desde +30 días versiona la anterior');
select is(
  (select string_agg(amount || ':' || (valid_from - current_date) || ':' || coalesce((valid_to - current_date)::text, '∞'), ',' order by valid_from)
     from platform.catalog_item_prices where catalog_item_id = pg_temp.item('licitaciones')),
  '111.00:0:29,122.00:30:∞', 'La anterior se cierra el día previo; la nueva queda abierta');
select is(platform.current_catalog_item_price(pg_temp.item('licitaciones'), pg_temp.market('PE'), 'ADDON', 'MONTHLY', 'USD', current_date + 29),
  111.00::numeric, 'Vigencia inclusiva del cierre');
select is(platform.current_catalog_item_price(pg_temp.item('licitaciones'), pg_temp.market('PE'), 'ADDON', 'MONTHLY', 'USD', current_date + 30),
  122.00::numeric, 'Tarifa programada vigente desde su fecha');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 130.00, 'USD', current_date + 30) $$,
  '23514', null, 'VIGENCIA_INVALIDA: no se solapa hacia atrás');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 130.00, 'USD', current_date + 10) $$,
  '23514', null, 'TARIFA_SOLAPADA/VIGENCIA_INVALIDA con una tarifa posterior');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'EC', 'ADDON', 'MONTHLY', 90.00, 'PEN') $$,
  '23514', null, 'MONEDA_NO_PERMITIDA_EN_MERCADO');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', -1, 'USD') $$,
  '23514', null, 'Importe negativo rechazado');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'LICENSE', 'MONTHLY', 10, 'USD') $$,
  '23514', null, 'Un add-on no tiene tarifa de LICENSE');
select lives_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'USAGE_OVERAGE', 'MONTHLY', 0.50, 'USD') $$,
  'USAGE_OVERAGE es un cargo válido de add-on');
select throws_ok($$ select platform.set_catalog_item_price('no_existe', 'PE', 'ADDON', 'MONTHLY', 10, 'USD') $$,
  '23503', null, 'Item inexistente rechazado');
select throws_ok($$ select platform.set_catalog_item_price('licitaciones', 'PE', 'ADDON', 'MONTHLY', 10, null) $$,
  '23502', null, 'MONEDA_REQUERIDA: la moneda se declara explícitamente');

-- ---------------------------------------------------------------------------
-- MA-13 · inmutabilidad y reglas a nivel de tabla (también para postgres)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select throws_ok($$ update platform.catalog_item_prices set amount = 1 where catalog_item_id = pg_temp.item('licitaciones') $$,
  '23514', null, 'PRECIO_HISTORICO_INMUTABLE: el importe no se edita');
select throws_ok($$ delete from platform.catalog_item_prices where catalog_item_id = pg_temp.item('licitaciones') $$,
  '23514', null, 'PRECIO_HISTORICO_INMUTABLE: la historia no se borra');
select throws_ok($$ insert into platform.catalog_item_prices (catalog_item_id, market_id, charge_kind, billing_interval, amount, currency, valid_from)
                    values (pg_temp.item('licitaciones'), null, 'ADDON', 'MONTHLY', 5, 'USD', current_date) $$,
  '23502', null, 'MERCADO_REQUERIDO');
select throws_ok($$ insert into platform.catalog_item_prices (catalog_item_id, market_id, charge_kind, billing_interval, amount, currency, valid_from, valid_to)
                    values (pg_temp.item('licitaciones'), pg_temp.market('PE'), 'ADDON', 'MONTHLY', 5, 'USD', current_date + 3, current_date + 4) $$,
  '23P01', null, 'Exclusión GiST: vigencias solapadas imposibles');

-- price_month legacy congelado una vez que hay tarifa.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.upsert_catalog_item('licitaciones', 'Licitaciones', '20000000-0000-4000-a000-000000000001',
                    'module', 'per-company', true, 999, 'USD', null, pg_temp.item('licitaciones')) $$,
  '23514', null, 'PRECIO_LEGACY_CONGELADO: price_month no cambia si el item ya tiene tarifa');
select lives_ok($$ select platform.upsert_catalog_item('licitaciones', 'Licitaciones (QA)', '20000000-0000-4000-a000-000000000001',
                    'module', 'per-company', true, 350, 'USD', null, pg_temp.item('licitaciones')) $$,
  'Editar el item sin tocar price_month sigue funcionando');

-- ---------------------------------------------------------------------------
-- MA-13 · lectura (RLS) y auditoría
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select is((select count(*)::int from platform.catalog_item_prices), 0,
  'TENANT_ADMIN sin el add-on contratado no ve la tarifa de EBIM');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select is((select count(*)::int from platform.catalog_item_prices), 3, 'EBIM_FINANCE ve las tarifas');
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.audit_logs where action = 'ADDON_PRICE_VERSIONED'
      and metadata ->> 'catalog_item' = 'licitaciones'),
  3, 'Cada versión de tarifa queda auditada');

select * from finish();
rollback;
