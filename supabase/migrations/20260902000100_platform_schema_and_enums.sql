-- ============================================================================
-- EBIM Control Plane — 01 · Schema `platform`, extensiones, enums y utilidades
-- ----------------------------------------------------------------------------
-- Convenciones aplicadas (docs/architecture/EBIM_CONVENTIONS.md):
--   C-01 schema dedicado `platform` (contrato §1/§7)
--   C-02 IDs uuid
--   C-05 RLS default deny  (se activa tabla por tabla en 10_rls_policies)
--   C-15 dinero numeric(14,2) + currency char(3)
-- ============================================================================

create schema if not exists platform;

comment on schema platform is
  'Plano de control EBIM: catálogo SaaS, organizaciones, tenants, comercial, '
  'finanzas gerenciales, provisioning y auditoría. NO contiene datos operativos '
  'de las apps (contrato §7 "regla de oro").';

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums de identidad y acceso
-- ---------------------------------------------------------------------------

-- Roles de plataforma (consola del operador). Ver contrato §13: el super admin
-- es único y no transferible; el enforcement vive en la DB, no sólo en la UI.
create type platform.platform_role as enum (
  'EBIM_SUPER_ADMIN',
  'EBIM_PRODUCT_ADMIN',
  'EBIM_FINANCE'
);

-- Roles dentro de una organización (partner, reseller o cliente).
create type platform.org_role as enum (
  'PARTNER_ADMIN',
  'PARTNER_SALES',
  'PARTNER_SUPPORT',
  'ORG_ADMIN',
  'ORG_VIEWER'
);

-- Roles dentro de un tenant (espacio de un SaaS para un cliente).
create type platform.tenant_role as enum (
  'TENANT_ADMIN',
  'TENANT_USER'
);

-- ---------------------------------------------------------------------------
-- Enums de negocio
-- ---------------------------------------------------------------------------

-- Una organización NO tiene un "tipo" rígido: acumula capacidades.
-- Consultora Andina puede ser PARTNER y CUSTOMER a la vez (D-006).
create type platform.org_capability as enum (
  'PARTNER',
  'RESELLER',
  'CONSULTING',
  'CUSTOMER'
);

create type platform.org_kind as enum (
  'PLATFORM',  -- EBIM
  'COMPANY'    -- cualquier otra organización
);

create type platform.org_relationship_type as enum (
  'MANAGES',       -- partner administra a un cliente
  'RESELLS_TO',    -- reseller vende a un cliente
  'SUBCONTRACTS'   -- partner subcontrata a otro partner
);

create type platform.entity_status as enum (
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'ARCHIVED'
);

-- Tipo de tenant: DEMO nunca genera cobro recurrente (regla de negocio §2.2).
create type platform.tenant_type as enum (
  'DEMO',
  'TRIAL',
  'PRODUCTION',
  'SANDBOX'
);

create type platform.tenant_status as enum (
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'CHURNED',
  'ARCHIVED'
);

-- Aislamiento FÍSICO. Desacoplado del tenant lógico (prompt fase 8).
create type platform.deployment_mode as enum (
  'SHARED',
  'PARTNER_DEDICATED',
  'TENANT_DEDICATED'
);

create type platform.environment_kind as enum (
  'DEMO',
  'TRIAL',
  'PRODUCTION',
  'SANDBOX'
);

-- ---------------------------------------------------------------------------
-- Enums comerciales / financieros
-- ---------------------------------------------------------------------------

create type platform.billing_interval as enum (
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'ONE_TIME'
);

-- Naturaleza de un ítem cobrable. `LICENSE` es recurrente; `IMPLEMENTATION_FEE`
-- e `INFRASTRUCTURE_FEE` cubren los modelos Partner/Tenant Dedicated (§2.2).
create type platform.charge_kind as enum (
  'LICENSE',
  'PARTNER_BASE_LICENSE',
  'TENANT_LICENSE',
  'IMPLEMENTATION_FEE',
  'INFRASTRUCTURE_FEE',
  'SUPPORT_FEE',
  'ADDON',
  'PROFESSIONAL_SERVICES',
  'DISCOUNT'
);

create type platform.subscription_status as enum (
  'DRAFT',
  'ACTIVE',
  'PAST_DUE',
  'PAUSED',
  'CANCELLED'
);

create type platform.invoice_status as enum (
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'UNCOLLECTIBLE'
);

create type platform.payment_status as enum (
  'PENDING',
  'CONFIRMED',
  'REVERSED'
);

-- ---------------------------------------------------------------------------
-- Enums de comisiones
-- ---------------------------------------------------------------------------

create type platform.sales_agent_type as enum (
  'EBIM_INTERNAL',
  'INDEPENDENT',
  'PARTNER_AGENT'
);

create type platform.attribution_source as enum (
  'DIRECT',
  'PARTNER',
  'REFERRAL',
  'INBOUND',
  'CAMPAIGN'
);

create type platform.commission_basis as enum (
  'COLLECTED_LICENSE',        -- % sobre licencia efectivamente cobrada
  'COLLECTED_IMPLEMENTATION', -- % sobre implementation fee cobrado
  'COLLECTED_ANY',            -- % sobre cualquier cobro elegible
  'FIXED_AMOUNT'              -- monto fijo por evento
);

create type platform.commission_status as enum (
  'PENDING',
  'ELIGIBLE',
  'ACCRUED',
  'PAID',
  'VOID'
);

create type platform.settlement_status as enum (
  'OPEN',
  'APPROVED',
  'PAID',
  'CANCELLED'
);

-- ---------------------------------------------------------------------------
-- Enums de costos y provisioning
-- ---------------------------------------------------------------------------

create type platform.cost_category as enum (
  'DATABASE',
  'COMPUTE',
  'STORAGE',
  'BANDWIDTH',
  'MESSAGING',
  'FRONTEND_HOSTING',
  'DOMAIN',
  'SUPPORT',
  'DEDICATED_INFRA',
  'THIRD_PARTY',
  'ADMIN_MANUAL'
);

create type platform.cost_scope as enum (
  'PLATFORM',
  'PRODUCT',
  'ORGANIZATION',
  'TENANT',
  'DEPLOYMENT_TARGET'
);

create type platform.provisioning_status as enum (
  'PENDING',
  'VALIDATING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

create type platform.provisioning_action as enum (
  'CREATE_TENANT_SPACE',
  'CREATE_DEDICATED_TARGET',
  'ATTACH_TENANT_TO_TARGET',
  'SUSPEND_TENANT',
  'RESUME_TENANT',
  'DECOMMISSION_TENANT'
);

create type platform.infra_provider as enum (
  'SUPABASE',
  'AWS',
  'AZURE',
  'GCP',
  'ON_PREMISE'
);

-- ---------------------------------------------------------------------------
-- Utilidades comunes
-- ---------------------------------------------------------------------------

create or replace function platform.set_updated_at()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function platform.set_updated_at() is
  'Trigger BEFORE UPDATE: mantiene updated_at. Sin SECURITY DEFINER (no lo necesita).';

-- Slugs estables y comparables. Se usa en constraints CHECK de code/slug.
create or replace function platform.is_slug(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_value ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

comment on function platform.is_slug(text) is
  'true si el texto es un slug kebab-case minúsculo. Usado por CHECK constraints.';
