-- ============================================================================
-- EBIM Commercial Control Plane · preservación (INV-3 / INV-4)
-- ----------------------------------------------------------------------------
-- Fija con una huella md5 lo que ninguna migración del programa puede cambiar:
--   · INV-3: mapeos de provisioning (tenant_product_mappings,
--            saas_provisioning_requests), columnas de la base 346aa72;
--   · INV-4: valores de precio de negocio (plan_prices, catalog_items).
-- Las huellas usan solo columnas y claves deterministas del seed: los id de
-- plan_prices/catalog_items son gen_random_uuid() y valid_from es relativo a
-- current_date, así que se hashean la clave natural y el desfase en días.
-- Constantes medidas sobre `supabase db reset` en 346aa72, antes de cualquier
-- migración del programa (evidencia: logs/MA-01-*.txt). Solo la fase 07 puede
-- actualizar la huella del seed de productos, y debe documentarlo.
-- Nota: el seed local no trae mapeos ni solicitudes; su huella es la de la
-- tabla vacía (md5('')). Detecta cualquier fila que una migración inserte.
-- ============================================================================
begin;
select plan(4);

create or replace function pg_temp.fp_mappings() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|',
           id, tenant_id, saas_product_id, deployment_target_id, saas_provisioning_request_id,
           external_tenant_id, external_organization_id, external_company_id, status,
           provisioned_at, registered_manually, metadata), E'\n' order by id), ''))
    from platform.tenant_product_mappings
$$;

create or replace function pg_temp.fp_requests() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|',
           id, tenant_id, saas_product_id, subscription_id, deployment_target_id,
           product_integration_id, idempotency_key, correlation_id, request_version, status,
           provisioning_environment, provisioning_policy, requested_by, external_reference,
           product_configuration), E'\n' order by id), ''))
    from platform.saas_provisioning_requests
$$;

create or replace function pg_temp.fp_plan_prices() returns text language sql as $$
  select md5(coalesce(string_agg(r, E'\n' order by r), ''))
    from (select concat_ws('|', pp.plan_id, m.code, pp.charge_kind, pp.billing_interval,
                           pp.amount, pp.currency, pp.valid_from - current_date,
                           pp.valid_to - current_date) as r
            from platform.plan_prices pp
            left join platform.markets m on m.id = pp.market_id) s
$$;

create or replace function pg_temp.fp_catalog_items() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|', code, saas_product_id, price_month, currency),
                                 E'\n' order by code, saas_product_id), ''))
    from platform.catalog_items
$$;

select is(pg_temp.fp_mappings(),      'd41d8cd98f00b204e9800998ecf8427e', 'INV-3: tenant_product_mappings intactos');
select is(pg_temp.fp_requests(),      'd41d8cd98f00b204e9800998ecf8427e', 'INV-3: saas_provisioning_requests intactos');
select is(pg_temp.fp_plan_prices(),   '1114f95fa1ec85743ac0358c0ef80e10', 'INV-4: plan_prices (plan, mercado, cargo, periodo, importe, moneda, vigencia) intactos');
select is(pg_temp.fp_catalog_items(), '7b6c1e1dc8d8fa812237f93389811ab1', 'INV-4: catalog_items (code, price_month, currency) intactos');

select * from finish();
rollback;
