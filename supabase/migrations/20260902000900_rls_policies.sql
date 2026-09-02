-- ============================================================================
-- EBIM Control Plane — 09 · GRANTS y políticas RLS
-- ----------------------------------------------------------------------------
-- Modelo de permisos (contrato §8, prompt fase 4):
--   anon           : NADA. Ni USAGE del schema. Sin excepciones.
--   authenticated  : SELECT amplio filtrado por RLS; escritura acotada.
--   service_role   : todo, sólo server-side (Edge Functions). Jamás en el browser.
--
-- Regla estructural: se REVOCA todo primero y se concede lo mínimo. Un GRANT
-- heredado de `public` es la puerta por la que se cuela una lectura no prevista.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Base: revocar todo, incluido lo que PostgreSQL da por defecto a PUBLIC.
-- ---------------------------------------------------------------------------
revoke all on schema platform from public;
revoke all on all tables in schema platform from public;
revoke all on all functions in schema platform from public;
revoke all on all sequences in schema platform from public;

-- `anon` NO recibe USAGE: sin esto, ninguna política suya puede siquiera evaluarse.
revoke usage on schema platform from anon;
revoke all on all tables in schema platform from anon;
revoke all on all functions in schema platform from anon;
revoke all on all sequences in schema platform from anon;

grant usage on schema platform to authenticated, service_role;
grant all on all tables in schema platform to service_role;
grant all on all sequences in schema platform to service_role;
grant execute on all functions in schema platform to service_role;

-- Defaults para objetos futuros creados por el owner.
alter default privileges in schema platform revoke all on tables from public, anon;
alter default privileges in schema platform revoke all on functions from public, anon;
alter default privileges in schema platform grant all on tables to service_role;
alter default privileges in schema platform grant all on sequences to service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS ON + FORCE en TODAS las tablas del schema.
--    FORCE hace que la política aplique incluso al owner de la tabla — evita
--    que una función definer mal escrita se salte el filtro sin querer.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform' and c.relkind = 'r'
  loop
    execute format('alter table platform.%I enable row level security', r.relname);
    execute format('alter table platform.%I force row level security', r.relname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. EXECUTE de helpers: sólo `authenticated`. `anon` explícitamente fuera.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Políticas
-- ---------------------------------------------------------------------------

-- ---- profiles -------------------------------------------------------------
grant select, update on platform.profiles to authenticated;

create policy profiles_select_self on platform.profiles
  for select to authenticated
  using (id = auth.uid() or platform.is_platform_admin());

-- Un usuario ve a sus compañeros de organización (para asignar responsables).
create policy profiles_select_org_peers on platform.profiles
  for select to authenticated
  using (
    exists (
      select 1 from platform.organization_memberships m
       where m.user_id = platform.profiles.id
         and m.organization_id in (select platform.my_org_ids())
         and m.is_active
    )
  );

create policy profiles_update_self on platform.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- platform_admins ------------------------------------------------------
-- Sólo lectura para authenticated: la asignación de roles de consola pasa por
-- service_role + el trigger de gobernanza (contrato §13.4, doble capa).
grant select on platform.platform_admins to authenticated;

create policy platform_admins_select on platform.platform_admins
  for select to authenticated
  using (user_id = auth.uid() or platform.is_super_admin());

-- ---- organizations --------------------------------------------------------
grant select on platform.organizations to authenticated;
grant insert, update on platform.organizations to authenticated;

create policy organizations_select on platform.organizations
  for select to authenticated
  using (
    platform.is_platform_admin()
    or id in (select platform.my_org_ids())
    -- Un partner ve a los clientes que administra.
    or id in (
      select t.customer_organization_id from platform.tenants t
       where t.managing_organization_id in (select platform.my_org_ids())
    )
    -- Un cliente ve al partner que lo administra.
    or id in (
      select t.managing_organization_id from platform.tenants t
       where t.customer_organization_id in (select platform.my_org_ids())
         and t.managing_organization_id is not null
    )
    -- Un comercial ve a los clientes que le están atribuidos (visibilidad COMERCIAL).
    or id in (select platform.my_attributed_org_ids())
  );

create policy organizations_insert on platform.organizations
  for insert to authenticated
  with check (platform.can_manage_platform_entities());

create policy organizations_update on platform.organizations
  for update to authenticated
  using (platform.can_manage_platform_entities() or platform.is_org_admin(id))
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(id));

-- ---- organization_capabilities -------------------------------------------
grant select on platform.organization_capabilities to authenticated;

create policy org_capabilities_select on platform.organization_capabilities
  for select to authenticated
  using (
    platform.is_platform_admin()
    or organization_id in (select platform.my_org_ids())
  );

-- ---- companies ------------------------------------------------------------
grant select, insert, update on platform.companies to authenticated;

create policy companies_select on platform.companies
  for select to authenticated
  using (
    platform.is_platform_admin()
    or organization_id in (select platform.my_org_ids())
    or organization_id in (
      select t.customer_organization_id from platform.tenants t
       where t.managing_organization_id in (select platform.my_org_ids())
    )
  );

create policy companies_write on platform.companies
  for insert to authenticated
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

create policy companies_update on platform.companies
  for update to authenticated
  using (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id))
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

-- ---- organization_relationships ------------------------------------------
grant select on platform.organization_relationships to authenticated;

create policy org_relationships_select on platform.organization_relationships
  for select to authenticated
  using (
    platform.is_platform_admin()
    or parent_organization_id in (select platform.my_org_ids())
    or child_organization_id in (select platform.my_org_ids())
  );

-- ---- organization_memberships --------------------------------------------
grant select, insert, update, delete on platform.organization_memberships to authenticated;

create policy org_memberships_select on platform.organization_memberships
  for select to authenticated
  using (
    platform.is_platform_admin()
    or user_id = auth.uid()
    or organization_id in (select platform.my_org_ids())
  );

create policy org_memberships_write on platform.organization_memberships
  for insert to authenticated
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

create policy org_memberships_update on platform.organization_memberships
  for update to authenticated
  using (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id))
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

create policy org_memberships_delete on platform.organization_memberships
  for delete to authenticated
  using (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

-- ---- saas_products --------------------------------------------------------
-- El catálogo de productos es visible para cualquier usuario autenticado: es la
-- vitrina de la suite (contrato §6.1 cross-sell). No contiene datos sensibles.
grant select on platform.saas_products to authenticated;
grant insert, update on platform.saas_products to authenticated;

create policy saas_products_select on platform.saas_products
  for select to authenticated using (true);

create policy saas_products_write on platform.saas_products
  for insert to authenticated with check (platform.can_manage_platform_entities());

create policy saas_products_update on platform.saas_products
  for update to authenticated
  using (platform.can_manage_platform_entities())
  with check (platform.can_manage_platform_entities());

-- ---- organization_product_agreements -------------------------------------
grant select, insert, update on platform.organization_product_agreements to authenticated;

create policy opa_select on platform.organization_product_agreements
  for select to authenticated
  using (
    platform.is_platform_admin()
    or organization_id in (select platform.my_org_ids())
  );

create policy opa_write on platform.organization_product_agreements
  for insert to authenticated with check (platform.can_manage_platform_entities());

create policy opa_update on platform.organization_product_agreements
  for update to authenticated
  using (platform.can_manage_platform_entities())
  with check (platform.can_manage_platform_entities());

-- ---- tenants --------------------------------------------------------------
grant select, insert, update on platform.tenants to authenticated;

create policy tenants_select on platform.tenants
  for select to authenticated
  using (
    platform.is_platform_admin()
    or id in (select platform.my_tenant_ids())
    -- Visibilidad COMERCIAL del comercial atribuido: ve la metadata del tenant
    -- que vendió, no sus datos operativos (que viven en la app, no aquí).
    or id in (select platform.my_attributed_tenant_ids())
  );

create policy tenants_insert on platform.tenants
  for insert to authenticated
  with check (
    platform.can_manage_platform_entities()
    or platform.is_org_admin(customer_organization_id)
    or platform.is_org_admin(managing_organization_id)
  );

create policy tenants_update on platform.tenants
  for update to authenticated
  using (platform.can_manage_tenant(id))
  with check (platform.can_manage_tenant(id));

-- ---- tenant_memberships ---------------------------------------------------
grant select, insert, update, delete on platform.tenant_memberships to authenticated;

create policy tenant_memberships_select on platform.tenant_memberships
  for select to authenticated
  using (
    platform.is_platform_admin()
    or user_id = auth.uid()
    or tenant_id in (select platform.my_tenant_ids())
  );

create policy tenant_memberships_write on platform.tenant_memberships
  for insert to authenticated with check (platform.can_manage_tenant(tenant_id));

create policy tenant_memberships_update on platform.tenant_memberships
  for update to authenticated
  using (platform.can_manage_tenant(tenant_id))
  with check (platform.can_manage_tenant(tenant_id));

create policy tenant_memberships_delete on platform.tenant_memberships
  for delete to authenticated using (platform.can_manage_tenant(tenant_id));

-- ---- tenant_features / tenant_settings ------------------------------------
grant select, insert, update, delete on platform.tenant_features to authenticated;
grant select, insert, update on platform.tenant_settings to authenticated;

create policy tenant_features_select on platform.tenant_features
  for select to authenticated using (platform.can_read_tenant(tenant_id));

create policy tenant_features_write on platform.tenant_features
  for insert to authenticated with check (platform.can_manage_tenant(tenant_id));

create policy tenant_features_update on platform.tenant_features
  for update to authenticated
  using (platform.can_manage_tenant(tenant_id))
  with check (platform.can_manage_tenant(tenant_id));

create policy tenant_features_delete on platform.tenant_features
  for delete to authenticated using (platform.can_manage_tenant(tenant_id));

create policy tenant_settings_select on platform.tenant_settings
  for select to authenticated using (platform.can_read_tenant(tenant_id));

create policy tenant_settings_write on platform.tenant_settings
  for insert to authenticated with check (platform.can_manage_tenant(tenant_id));

create policy tenant_settings_update on platform.tenant_settings
  for update to authenticated
  using (platform.can_manage_tenant(tenant_id))
  with check (platform.can_manage_tenant(tenant_id));

-- ---- config en capas ------------------------------------------------------
grant select on platform.platform_defaults to authenticated;
grant select, insert, update on platform.org_config to authenticated;
grant select, insert, update on platform.company_config to authenticated;

create policy platform_defaults_select on platform.platform_defaults
  for select to authenticated using (true);

create policy org_config_select on platform.org_config
  for select to authenticated
  using (platform.is_platform_admin() or organization_id in (select platform.my_org_ids()));

create policy org_config_write on platform.org_config
  for insert to authenticated
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

create policy org_config_update on platform.org_config
  for update to authenticated
  using (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id))
  with check (platform.can_manage_platform_entities() or platform.is_org_admin(organization_id));

create policy company_config_select on platform.company_config
  for select to authenticated
  using (
    platform.is_platform_admin()
    or exists (
      select 1 from platform.companies c
       where c.id = company_config.company_id
         and c.organization_id in (select platform.my_org_ids())
    )
  );

create policy company_config_write on platform.company_config
  for insert to authenticated
  with check (
    platform.can_manage_platform_entities()
    or exists (
      select 1 from platform.companies c
       where c.id = company_config.company_id and platform.is_org_admin(c.organization_id)
    )
  );

create policy company_config_update on platform.company_config
  for update to authenticated
  using (
    platform.can_manage_platform_entities()
    or exists (
      select 1 from platform.companies c
       where c.id = company_config.company_id and platform.is_org_admin(c.organization_id)
    )
  )
  with check (
    platform.can_manage_platform_entities()
    or exists (
      select 1 from platform.companies c
       where c.id = company_config.company_id and platform.is_org_admin(c.organization_id)
    )
  );

-- ---- catalog_items / tenant_addons / workspace_apps -----------------------
-- Contrato §2.6 lección 1: el PRECIO lo decide la plataforma, el ADDON lo enciende
-- el cliente. Partir la política en lectura/escritura no alcanza: la escritura de
-- la fila es legítima, lo ilegítimo es una columna. Por eso el precio vive en
-- catalog_items (sin GRANT de escritura para authenticated) y la activación en
-- tenant_addons (donde no hay ninguna columna de precio).
grant select on platform.catalog_items to authenticated;
revoke insert, update, delete on platform.catalog_items from authenticated;

grant select, insert, update, delete on platform.tenant_addons to authenticated;
grant select on platform.workspace_apps to authenticated;

create policy catalog_items_select on platform.catalog_items
  for select to authenticated using (true);

create policy tenant_addons_select on platform.tenant_addons
  for select to authenticated using (platform.can_read_tenant(tenant_id));

create policy tenant_addons_write on platform.tenant_addons
  for insert to authenticated with check (platform.can_manage_tenant(tenant_id));

create policy tenant_addons_update on platform.tenant_addons
  for update to authenticated
  using (platform.can_manage_tenant(tenant_id))
  with check (platform.can_manage_tenant(tenant_id));

create policy tenant_addons_delete on platform.tenant_addons
  for delete to authenticated using (platform.can_manage_tenant(tenant_id));

create policy workspace_apps_select on platform.workspace_apps
  for select to authenticated
  using (platform.is_platform_admin() or organization_id in (select platform.my_org_ids()));

-- ---- plans / plan_prices --------------------------------------------------
-- Los planes son catálogo comercial: visibles para authenticated, editables sólo
-- por finanzas/operador.
grant select on platform.plans to authenticated;
grant select on platform.plan_prices to authenticated;
revoke insert, update, delete on platform.plans from authenticated;
revoke insert, update, delete on platform.plan_prices from authenticated;

create policy plans_select on platform.plans
  for select to authenticated using (true);

-- El precio de lista sólo lo ven finanzas/operador y la organización que tiene
-- una suscripción sobre ese plan. Un partner no ve la tarifa de un plan que no
-- contrata: eso es información comercial de EBIM.
create policy plan_prices_select on platform.plan_prices
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_platform_admin()
    or exists (
      select 1 from platform.subscriptions s
       where s.plan_id = plan_prices.plan_id
         and s.billed_organization_id in (select platform.my_org_ids())
    )
  );

-- ---- subscriptions / subscription_items -----------------------------------
grant select on platform.subscriptions to authenticated;
grant select on platform.subscription_items to authenticated;

create policy subscriptions_select on platform.subscriptions
  for select to authenticated
  using (
    platform.is_platform_admin()
    or billed_organization_id in (select platform.my_org_ids())
    or (tenant_id is not null and tenant_id in (select platform.my_tenant_ids()))
    -- El comercial ve la suscripción que le está atribuida: es su base de comisión.
    or exists (
      select 1 from platform.sales_attributions a
       where a.sales_agent_id in (select platform.my_sales_agent_ids())
         and a.status = 'ACTIVE'
         and (a.subscription_id = subscriptions.id or a.tenant_id = subscriptions.tenant_id)
    )
  );

create policy subscription_items_select on platform.subscription_items
  for select to authenticated
  using (
    platform.is_platform_admin()
    or exists (
      select 1 from platform.subscriptions s
       where s.id = subscription_items.subscription_id
         and (s.billed_organization_id in (select platform.my_org_ids())
              or (s.tenant_id is not null and s.tenant_id in (select platform.my_tenant_ids())))
    )
  );

-- ---- invoices / invoice_lines / payments ----------------------------------
-- Plano financiero: EBIM_FINANCE, operador, o la organización facturada.
-- PARTNER_SUPPORT y SALES_AGENT quedan fuera de las facturas del cliente.
grant select on platform.invoices to authenticated;
grant select on platform.invoice_lines to authenticated;
grant select on platform.payments to authenticated;

create policy invoices_select on platform.invoices
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_super_admin()
    or platform.has_org_commercial_access(customer_organization_id)
  );

create policy invoice_lines_select on platform.invoice_lines
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_super_admin()
    or exists (
      select 1 from platform.invoices i
       where i.id = invoice_lines.invoice_id
         and platform.has_org_commercial_access(i.customer_organization_id)
    )
  );

create policy payments_select on platform.payments
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_super_admin()
    or exists (
      select 1 from platform.invoices i
       where i.id = payments.invoice_id
         and platform.has_org_commercial_access(i.customer_organization_id)
    )
  );

-- ---- cost_entries / cost_allocations --------------------------------------
-- Los costos son información INTERNA de EBIM. Un partner no ve el costo de la
-- infraestructura que EBIM le provee.
grant select on platform.cost_entries to authenticated;
grant select on platform.cost_allocations to authenticated;

create policy cost_entries_select on platform.cost_entries
  for select to authenticated
  using (platform.can_read_finance() or platform.can_manage_platform_entities());

create policy cost_allocations_select on platform.cost_allocations
  for select to authenticated
  using (platform.can_read_finance() or platform.can_manage_platform_entities());

-- ---- sales_agents ---------------------------------------------------------
grant select on platform.sales_agents to authenticated;

create policy sales_agents_select on platform.sales_agents
  for select to authenticated
  using (
    platform.is_platform_admin()
    or id in (select platform.my_sales_agent_ids())
  );

-- ---- sales_attributions ---------------------------------------------------
grant select on platform.sales_attributions to authenticated;

create policy sales_attributions_select on platform.sales_attributions
  for select to authenticated
  using (
    platform.is_platform_admin()
    or sales_agent_id in (select platform.my_sales_agent_ids())
    or (channel_organization_id is not null
        and platform.has_org_commercial_access(channel_organization_id))
  );

-- ---- commission_plans / commission_rules ----------------------------------
grant select on platform.commission_plans to authenticated;
grant select on platform.commission_rules to authenticated;

create policy commission_plans_select on platform.commission_plans
  for select to authenticated using (true);

create policy commission_rules_select on platform.commission_rules
  for select to authenticated using (true);

-- ---- commission_events / settlements --------------------------------------
grant select on platform.commission_events to authenticated;
grant select on platform.commission_settlements to authenticated;

create policy commission_events_select on platform.commission_events
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_super_admin()
    or sales_agent_id in (select platform.my_sales_agent_ids())
  );

create policy commission_settlements_select on platform.commission_settlements
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.is_super_admin()
    or sales_agent_id in (select platform.my_sales_agent_ids())
  );

-- ---- deployment_targets / tenant_deployments ------------------------------
grant select on platform.deployment_targets to authenticated;
grant select on platform.tenant_deployments to authenticated;

create policy deployment_targets_select on platform.deployment_targets
  for select to authenticated
  using (
    platform.is_platform_admin()
    or (owner_organization_id is not null and owner_organization_id in (select platform.my_org_ids()))
    or exists (
      select 1 from platform.tenant_deployments td
       where td.deployment_target_id = deployment_targets.id
         and td.tenant_id in (select platform.my_tenant_ids())
    )
  );

create policy tenant_deployments_select on platform.tenant_deployments
  for select to authenticated using (platform.can_read_tenant(tenant_id));

-- ---- provisioning ---------------------------------------------------------
grant select on platform.provisioning_requests to authenticated;
grant select on platform.provisioning_events to authenticated;

create policy provisioning_requests_select on platform.provisioning_requests
  for select to authenticated
  using (
    platform.is_platform_admin()
    or (tenant_id is not null and tenant_id in (select platform.my_tenant_ids()))
  );

create policy provisioning_events_select on platform.provisioning_events
  for select to authenticated
  using (
    exists (
      select 1 from platform.provisioning_requests r
       where r.id = provisioning_events.provisioning_request_id
         and (platform.is_platform_admin()
              or (r.tenant_id is not null and r.tenant_id in (select platform.my_tenant_ids())))
    )
  );

-- ---- audit_logs -----------------------------------------------------------
-- APPEND-ONLY REAL: `authenticated` tiene SELECT y nada más. No hay GRANT de
-- INSERT/UPDATE/DELETE ni política que los permita. Escribir en la bitácora se
-- hace por platform.log_audit() (SECURITY DEFINER) o por service_role.
grant select on platform.audit_logs to authenticated;
revoke insert, update, delete on platform.audit_logs from authenticated;

create policy audit_logs_select on platform.audit_logs
  for select to authenticated
  using (
    platform.is_platform_admin()
    or (organization_id is not null and organization_id in (select platform.my_org_ids()))
    or (tenant_id is not null and tenant_id in (select platform.my_tenant_ids()))
  );
