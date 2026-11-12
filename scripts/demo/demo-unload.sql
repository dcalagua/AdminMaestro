-- ============================================================================
-- MasterAdmin · Datos de demostración para Gerencia (gerencia-v4) — DESCARGA
-- ----------------------------------------------------------------------------
-- SOLO STACK LOCAL. Lo ejecuta `scripts/demo/unload-demo-data.sh` (y también
-- `load-demo-data.sh` antes de recargar, en la MISMA transacción).
--
-- Borra exactamente lo que generó `demo-data.sql` y nada más:
--   · organizaciones / tenants / suscripciones / planes / comerciales /
--     destinos / costos con `metadata ->> 'demo' = 'gerencia-v4'`;
--   · todo lo que cuelga de ellos (facturas, cobros, comisiones, alertas,
--     liquidaciones, enlaces de pago, tarifa de partner, uso y créditos IA);
--   · tasas de cambio con nota `DEMO gerencia-v4` y la bitácora etiquetada.
--
-- Uso, agregados y ledger de créditos son append-only por diseño (triggers
-- USO_INMUTABLE / AGREGADO_INMUTABLE / config de créditos / BORRADO_FISICO_PROHIBIDO). Para retirar el
-- dataset local se desactivan ESOS triggers concretos dentro de la transacción
-- y se vuelven a activar al final: si algo falla, el ROLLBACK los deja como
-- estaban. Nunca se ejecuta contra un entorno compartido (guard en el .sh).
-- ============================================================================

set local search_path = platform, public, pg_catalog;

create temp table demo_x_org on commit drop as
  select id from platform.organizations where metadata ->> 'demo' = 'gerencia-v4';
create temp table demo_x_tenant on commit drop as
  select id from platform.tenants
   where metadata ->> 'demo' = 'gerencia-v4' or customer_organization_id in (select id from demo_x_org);
create temp table demo_x_sub on commit drop as
  select id from platform.subscriptions
   where metadata ->> 'demo' = 'gerencia-v4' or billed_organization_id in (select id from demo_x_org)
      or tenant_id in (select id from demo_x_tenant);
create temp table demo_x_invoice on commit drop as
  select id from platform.invoices
   where metadata ->> 'demo' = 'gerencia-v4' or customer_organization_id in (select id from demo_x_org)
      or subscription_id in (select id from demo_x_sub);
create temp table demo_x_payment on commit drop as
  select id from platform.payments where invoice_id in (select id from demo_x_invoice);
create temp table demo_x_agent on commit drop as
  select id from platform.sales_agents where metadata ->> 'demo' = 'gerencia-v4';
create temp table demo_x_plan on commit drop as
  select id from platform.plans where metadata ->> 'demo' = 'gerencia-v4';
create temp table demo_x_capability on commit drop as
  select id from platform.product_capabilities where manifest_version = 'demo-gerencia-v4';
create temp table demo_x_meter on commit drop as
  select id from platform.usage_meters
   where capability_id in (select id from demo_x_capability)
      or code in ('esupplier.ai.calls', 'esupplier.ai.ocr_pages', 'esupplier.docs.purchase_orders', 'ewm.ai.forecast_runs');

-- Triggers append-only: off solo durante esta transacción.
alter table platform.usage_events            disable trigger usage_events_no_update_delete;
alter table platform.usage_period_aggregates disable trigger usage_period_aggregates_guard;
alter table platform.usage_alerts            disable trigger usage_alerts_no_update_delete;
alter table platform.usage_alert_acks        disable trigger usage_alert_acks_no_update_delete;
alter table platform.ai_credit_ledger        disable trigger ai_credit_ledger_no_update_delete;
alter table platform.ai_credit_weights       disable trigger ai_credit_weights_guard;
alter table platform.ai_credit_policies      disable trigger ai_credit_policies_guard;
alter table platform.usage_ingest_rejections disable trigger usage_ingest_rejections_no_update_delete;
alter table platform.tenant_product_mappings disable trigger tenant_product_mappings_no_delete;
alter table platform.payment_link_events     disable trigger payment_link_events_append_only;

-- 1. Uso y créditos IA
delete from platform.ai_credit_ledger where tenant_id in (select id from demo_x_tenant);
delete from platform.usage_alert_acks
 where alert_id in (select id from platform.usage_alerts
                     where tenant_id in (select id from demo_x_tenant)
                        or aggregate_id in (select id from platform.usage_period_aggregates
                                             where tenant_id in (select id from demo_x_tenant)));
delete from platform.usage_alerts
 where tenant_id in (select id from demo_x_tenant)
    or aggregate_id in (select id from platform.usage_period_aggregates where tenant_id in (select id from demo_x_tenant));
delete from platform.usage_events where tenant_id in (select id from demo_x_tenant);
delete from platform.usage_period_aggregates where tenant_id in (select id from demo_x_tenant);
delete from platform.usage_ingest_rejections where tenant_id in (select id from demo_x_tenant);
delete from platform.ai_credit_policies where plan_id in (select id from demo_x_plan);
delete from platform.ai_credit_weights where capability_id in (select id from demo_x_capability);
delete from platform.usage_meters where id in (select id from demo_x_meter);
delete from platform.capability_aliases where capability_id in (select id from demo_x_capability);
delete from platform.product_capabilities where id in (select id from demo_x_capability);
delete from platform.tenant_product_mappings where tenant_id in (select id from demo_x_tenant);

-- 2. Cobranza: enlaces de pago, alertas, tarifa de partner
delete from platform.payment_link_events
 where link_id in (select id from platform.payment_links where organization_id in (select id from demo_x_org));
delete from platform.payment_links where organization_id in (select id from demo_x_org);
delete from platform.billing_alerts
 where subscription_id in (select id from demo_x_sub) or invoice_id in (select id from demo_x_invoice);
delete from platform.partner_fee_statement_lines
 where statement_id in (select id from platform.partner_fee_statements
                         where partner_organization_id in (select id from demo_x_org));
delete from platform.partner_fee_statements where partner_organization_id in (select id from demo_x_org);

-- 3. Comisiones (devengadas por los cobros demo) y liquidaciones de comerciales demo
delete from platform.commission_events
 where payment_id in (select id from demo_x_payment) or sales_agent_id in (select id from demo_x_agent);
delete from platform.commission_settlements where sales_agent_id in (select id from demo_x_agent);

-- 4. Cobros y facturas
delete from platform.invoice_charge_locks where invoice_id in (select id from demo_x_invoice);
delete from platform.payments where id in (select id from demo_x_payment);
delete from platform.invoice_lines where invoice_id in (select id from demo_x_invoice);
delete from platform.invoices where id in (select id from demo_x_invoice);

-- 5. Contratos
delete from platform.subscription_collection_profiles where subscription_id in (select id from demo_x_sub);
delete from platform.sales_attributions
 where subscription_id in (select id from demo_x_sub) or sales_agent_id in (select id from demo_x_agent)
    or customer_organization_id in (select id from demo_x_org);
delete from platform.subscription_items where subscription_id in (select id from demo_x_sub);
delete from platform.subscriptions where id in (select id from demo_x_sub);

-- 6. Tenants e infraestructura
delete from platform.entitlement_desired_state where tenant_id in (select id from demo_x_tenant);
delete from platform.tenant_deployments
 where tenant_id in (select id from demo_x_tenant)
    or deployment_target_id in (select id from platform.deployment_targets where metadata ->> 'demo' = 'gerencia-v4');
delete from platform.tenants where id in (select id from demo_x_tenant);
delete from platform.deployment_targets where metadata ->> 'demo' = 'gerencia-v4';

-- 7. Costos
delete from platform.cost_allocations
 where cost_entry_id in (select id from platform.cost_entries where metadata ->> 'demo' = 'gerencia-v4');
delete from platform.cost_entries where metadata ->> 'demo' = 'gerencia-v4';

-- 8. Organizaciones, catálogo comercial y comerciales
delete from platform.sales_agents where id in (select id from demo_x_agent);
delete from platform.organization_product_agreements where organization_id in (select id from demo_x_org);
delete from platform.organization_relationships
 where parent_organization_id in (select id from demo_x_org) or child_organization_id in (select id from demo_x_org);
delete from platform.workspace_apps where organization_id in (select id from demo_x_org);
delete from platform.organization_capabilities where organization_id in (select id from demo_x_org);
delete from platform.companies where organization_id in (select id from demo_x_org);
delete from platform.organizations where id in (select id from demo_x_org);
delete from platform.plan_prices where plan_id in (select id from demo_x_plan);
delete from platform.plans where id in (select id from demo_x_plan);
delete from platform.exchange_rates where is_demo and notes like 'DEMO gerencia-v4%';

-- 9. Bitácora generada por la carga (etiquetada al final de demo-data.sql)
delete from platform.audit_logs where metadata ->> 'demo' = 'gerencia-v4';

alter table platform.usage_events            enable trigger usage_events_no_update_delete;
alter table platform.usage_period_aggregates enable trigger usage_period_aggregates_guard;
alter table platform.usage_alerts            enable trigger usage_alerts_no_update_delete;
alter table platform.usage_alert_acks        enable trigger usage_alert_acks_no_update_delete;
alter table platform.ai_credit_ledger        enable trigger ai_credit_ledger_no_update_delete;
alter table platform.ai_credit_weights       enable trigger ai_credit_weights_guard;
alter table platform.ai_credit_policies      enable trigger ai_credit_policies_guard;
alter table platform.usage_ingest_rejections enable trigger usage_ingest_rejections_no_update_delete;
alter table platform.tenant_product_mappings enable trigger tenant_product_mappings_no_delete;
alter table platform.payment_link_events     enable trigger payment_link_events_append_only;

do $$
begin
  if exists (select 1 from platform.organizations where metadata ->> 'demo' = 'gerencia-v4')
     or exists (select 1 from platform.invoices where metadata ->> 'demo' = 'gerencia-v4') then
    raise exception 'DEMO_DESCARGA_INCOMPLETA: quedan filas gerencia-v4';
  end if;
  raise notice 'DEMO gerencia-v4 · descargado';
end;
$$;
