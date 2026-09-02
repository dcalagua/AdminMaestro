-- ============================================================================
-- EBIM Control Plane — 08 · Helpers de autorización (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
-- D-009: todos son `security definer` con `search_path` fijo y `stable`.
--
-- Por qué SECURITY DEFINER: una política de `organizations` necesita consultar
-- `organization_memberships`, que a su vez tiene RLS. Sin definer, PostgreSQL
-- entra en recursión infinita de políticas. Con definer, la consulta interna
-- salta RLS de forma controlada y acotada a lecturas de pertenencia.
--
-- Por qué `search_path` explícito: sin él, un schema temporal del atacante
-- puede shadowear una tabla y cambiar lo que la función devuelve.
--
-- `anon` NO recibe EXECUTE de ninguno de estos helpers (migración 09).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles de plataforma
-- ---------------------------------------------------------------------------
create or replace function platform.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.platform_admins pa
     where pa.user_id = auth.uid() and pa.is_active
  );
$$;

create or replace function platform.has_platform_role(p_role platform.platform_role)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.platform_admins pa
     where pa.user_id = auth.uid() and pa.is_active and pa.role = p_role
  );
$$;

create or replace function platform.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.has_platform_role('EBIM_SUPER_ADMIN');
$$;

-- EBIM_FINANCE ve el plano financiero completo. El super admin también.
create or replace function platform.can_read_finance()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.has_platform_role('EBIM_FINANCE')
      or platform.has_platform_role('EBIM_SUPER_ADMIN');
$$;

-- EBIM_PRODUCT_ADMIN administra productos/tenants/deployments.
create or replace function platform.can_manage_platform_entities()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.has_platform_role('EBIM_PRODUCT_ADMIN')
      or platform.has_platform_role('EBIM_SUPER_ADMIN');
$$;

-- ---------------------------------------------------------------------------
-- Alcance por organización
-- ---------------------------------------------------------------------------
create or replace function platform.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select m.organization_id
    from platform.organization_memberships m
   where m.user_id = auth.uid() and m.is_active;
$$;

comment on function platform.my_org_ids() is
  'Organizaciones donde el usuario tiene membresía activa. PARTNER_ADMIN de la org A '
  'nunca ve la org B: esta función es la única fuente de ese alcance.';

create or replace function platform.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.organization_memberships m
     where m.user_id = auth.uid() and m.is_active and m.organization_id = p_org
  );
$$;

create or replace function platform.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.organization_memberships m
     where m.user_id = auth.uid() and m.is_active and m.organization_id = p_org
       and m.role in ('PARTNER_ADMIN', 'ORG_ADMIN')
  );
$$;

-- Roles con visibilidad COMERCIAL dentro de su organización (no operativa).
create or replace function platform.has_org_commercial_access(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.organization_memberships m
     where m.user_id = auth.uid() and m.is_active and m.organization_id = p_org
       and m.role in ('PARTNER_ADMIN', 'PARTNER_SALES', 'ORG_ADMIN')
  );
$$;

comment on function platform.has_org_commercial_access(uuid) is
  'PARTNER_SUPPORT queda fuera a propósito: soporte necesita metadata del tenant, '
  'no la información comercial/financiera (prompt fase 4).';

-- ---------------------------------------------------------------------------
-- Alcance por tenant
-- ---------------------------------------------------------------------------

-- Tenants que el usuario ve por membresía DIRECTA (TENANT_ADMIN / TENANT_USER).
create or replace function platform.my_direct_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select tm.tenant_id
    from platform.tenant_memberships tm
   where tm.user_id = auth.uid() and tm.is_active;
$$;

-- Tenants visibles para el usuario: los suyos + los de sus organizaciones
-- (como cliente o como partner que los administra).
create or replace function platform.my_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select tm.tenant_id
    from platform.tenant_memberships tm
   where tm.user_id = auth.uid() and tm.is_active
  union
  select t.id
    from platform.tenants t
   where t.customer_organization_id in (select platform.my_org_ids())
      or t.managing_organization_id in (select platform.my_org_ids());
$$;

comment on function platform.my_tenant_ids() is
  'Alcance de tenants. Un TENANT_ADMIN del tenant A no obtiene el tenant B porque no '
  'tiene membresía ni pertenece a su organización.';

create or replace function platform.can_read_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.is_platform_admin()
      or p_tenant in (select platform.my_tenant_ids());
$$;

-- Administrar un tenant: operador EBIM, admin de la org cliente, o partner
-- que lo administra. Un TENANT_USER no administra.
create or replace function platform.can_manage_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.can_manage_platform_entities()
      or exists (
        select 1 from platform.tenant_memberships tm
         where tm.user_id = auth.uid() and tm.is_active
           and tm.tenant_id = p_tenant and tm.role = 'TENANT_ADMIN'
      )
      or exists (
        select 1 from platform.tenants t
         where t.id = p_tenant
           and (platform.is_org_admin(t.customer_organization_id)
             or platform.is_org_admin(t.managing_organization_id))
      );
$$;

-- ---------------------------------------------------------------------------
-- Alcance comercial (SALES_AGENT)
-- ---------------------------------------------------------------------------
create or replace function platform.my_sales_agent_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  -- Su propio registro de comercial...
  select sa.id
    from platform.sales_agents sa
   where sa.user_id = auth.uid() and sa.status = 'ACTIVE'
  union
  -- ...más los comerciales de las organizaciones que administra (un PARTNER_ADMIN
  -- ve a los comerciales de su partner, no a los de otro partner).
  select sa.id
    from platform.sales_agents sa
   where sa.organization_id is not null
     and exists (
       select 1 from platform.organization_memberships m
        where m.user_id = auth.uid() and m.is_active
          and m.organization_id = sa.organization_id
          and m.role in ('PARTNER_ADMIN', 'ORG_ADMIN')
     );
$$;

comment on function platform.my_sales_agent_ids() is
  'Alcance comercial. Un SALES_AGENT sólo obtiene su propio id: nunca ve las '
  'atribuciones ni las comisiones de otro comercial (prompt fase 4, test 3).';

create or replace function platform.is_sales_agent()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.sales_agents sa
     where sa.user_id = auth.uid() and sa.status = 'ACTIVE'
  );
$$;

-- Organizaciones que el comercial puede ver por haberles vendido. Es visibilidad
-- COMERCIAL: no da acceso operativo a los tenants de esos clientes (§2.3).
create or replace function platform.my_attributed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select distinct a.customer_organization_id
    from platform.sales_attributions a
   where a.sales_agent_id in (select platform.my_sales_agent_ids())
     and a.status = 'ACTIVE';
$$;

-- Tenants sobre los que el comercial tiene visibilidad COMERCIAL (no operativa).
create or replace function platform.my_attributed_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select distinct a.tenant_id
    from platform.sales_attributions a
   where a.sales_agent_id in (select platform.my_sales_agent_ids())
     and a.status = 'ACTIVE'
     and a.tenant_id is not null;
$$;

comment on function platform.my_attributed_tenant_ids() is
  'IMPORTANTE: esto NO es acceso operativo. Alimenta sólo las políticas comerciales '
  '(atribuciones, comisiones). Las tablas operativas del tenant usan my_tenant_ids().';
