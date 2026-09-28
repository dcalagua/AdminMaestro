-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · catálogo extendido y precios de
-- add-on con vigencia (Tasks MA-12, MA-13)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (catalog_items), §5 (catalog_item_prices = réplica de plan_prices).
-- Los importes son de prueba y se revierten (rollback): ningún precio de negocio
-- se crea ni se cambia (INV-4, ver 26_ccp_preservation).
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

select * from finish();
rollback;
