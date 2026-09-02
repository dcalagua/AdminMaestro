-- ============================================================================
-- EBIM Control Plane — 13 · Índices de apoyo para claves foráneas
-- ----------------------------------------------------------------------------
-- PostgreSQL NO crea índice automáticamente del lado hijo de una FK. Sin él:
--   · un DELETE/UPDATE en el padre hace seq-scan del hijo para validar la FK;
--   · los JOIN de los dashboards (que van casi siempre por FK) escanean tabla.
--
-- Detectado por el test 12 de `supabase/tests/00_structure.test.sql`, que falla
-- si vuelve a aparecer una FK sin índice.
-- ============================================================================

create index if not exists catalog_items_product_ix
  on platform.catalog_items (saas_product_id);

create index if not exists commission_events_rule_ix
  on platform.commission_events (commission_rule_id);
create index if not exists commission_events_invoice_line_ix
  on platform.commission_events (invoice_line_id);
create index if not exists commission_events_product_ix
  on platform.commission_events (saas_product_id);
create index if not exists commission_events_attribution_ix
  on platform.commission_events (sales_attribution_id);
create index if not exists commission_events_tenant_ix
  on platform.commission_events (tenant_id);

create index if not exists commission_plans_product_ix
  on platform.commission_plans (saas_product_id);
create index if not exists commission_settlements_approved_by_ix
  on platform.commission_settlements (approved_by);

create index if not exists deployment_targets_product_ix
  on platform.deployment_targets (saas_product_id);

create index if not exists invoice_lines_subscription_item_ix
  on platform.invoice_lines (subscription_item_id);
create index if not exists invoices_company_ix
  on platform.invoices (company_id);

create index if not exists org_memberships_company_ix
  on platform.organization_memberships (company_id);
create index if not exists platform_admins_granted_by_ix
  on platform.platform_admins (granted_by);

create index if not exists provisioning_target_ix
  on platform.provisioning_requests (deployment_target_id);
create index if not exists provisioning_requested_by_ix
  on platform.provisioning_requests (requested_by);
create index if not exists provisioning_product_ix
  on platform.provisioning_requests (saas_product_id);

create index if not exists sales_attr_commission_plan_ix
  on platform.sales_attributions (commission_plan_id);
create index if not exists sales_attr_product_ix
  on platform.sales_attributions (saas_product_id);

create index if not exists subscription_items_catalog_ix
  on platform.subscription_items (catalog_item_code);
create index if not exists subscriptions_plan_ix
  on platform.subscriptions (plan_id);

create index if not exists tenant_addons_code_ix
  on platform.tenant_addons (addon_code);
create index if not exists tenant_features_updated_by_ix
  on platform.tenant_features (updated_by);
create index if not exists tenants_company_ix
  on platform.tenants (company_id);
create index if not exists workspace_apps_product_ix
  on platform.workspace_apps (saas_product_id);
