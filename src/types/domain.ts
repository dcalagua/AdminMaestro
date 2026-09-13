/**
 * Tipos de dominio del Control Plane.
 *
 * Se derivan de `database.types.ts` (generado desde la DB) para que un cambio de
 * schema rompa el typecheck en vez de aparecer como un `undefined` en pantalla.
 */
import type { Database } from './database.types';

type Schema = Database['platform'];
export type Tables<T extends keyof Schema['Tables']> = Schema['Tables'][T]['Row'];
export type Views<T extends keyof Schema['Views']> = Schema['Views'][T]['Row'];
export type Enums<T extends keyof Schema['Enums']> = Schema['Enums'][T];

export type Organization = Tables<'organizations'>;
export type Company = Tables<'companies'>;
export type SaasProduct = Tables<'saas_products'>;
export type Tenant = Tables<'tenants'>;
export type Plan = Tables<'plans'>;
export type Subscription = Tables<'subscriptions'>;
export type Invoice = Tables<'invoices'>;
export type Payment = Tables<'payments'>;
export type CostEntry = Tables<'cost_entries'>;
export type SalesAgent = Tables<'sales_agents'>;
export type SalesAttribution = Tables<'sales_attributions'>;
export type CommissionEvent = Tables<'commission_events'>;
export type CommissionSettlement = Tables<'commission_settlements'>;
export type CommissionPlan = Tables<'commission_plans'>;
export type CommissionRule = Tables<'commission_rules'>;
export type DeploymentTarget = Tables<'deployment_targets'>;
export type ProvisioningRequest = Tables<'provisioning_requests'>;
export type ProvisioningEvent = Tables<'provisioning_events'>;
export type AuditLog = Tables<'audit_logs'>;
export type TenantFeature = Tables<'tenant_features'>;
export type OrganizationAgreement = Tables<'organization_product_agreements'>;

export type TenantOverview = Views<'v_tenant_overview'>;
export type ProductMargin = Views<'v_product_margin'>;
export type PartnerMargin = Views<'v_partner_margin'>;
export type TenantMargin = Views<'v_tenant_margin'>;

export type DeploymentMode = Enums<'deployment_mode'>;
export type TenantType = Enums<'tenant_type'>;
export type TenantStatus = Enums<'tenant_status'>;
export type PlatformRole = Enums<'platform_role'>;
export type OrgRole = Enums<'org_role'>;
export type TenantRole = Enums<'tenant_role'>;
export type CommissionStatus = Enums<'commission_status'>;
export type InvoiceStatus = Enums<'invoice_status'>;
export type ProvisioningStatus = Enums<'provisioning_status'>;

/** Resultado de `platform.dashboard_summary()`. */
export interface DashboardSummary {
  active_products: number;
  organizations: number;
  partners: number;
  customers: number;
  production_tenants: number;
  demo_trial_tenants: number;
  tenants_by_mode: Record<string, number>;
  mrr_by_currency: Record<string, number>;
  collected_by_currency: Record<string, number>;
  cost_by_currency: Record<string, number>;
  commission_pending_by_currency: Record<string, number>;
  commission_paid_by_currency: Record<string, number>;
  /** V3: NULL cuando hay comisiones en más de una moneda. Usar los mapas por moneda. */
  commission_pending: number | null;
  commission_paid: number | null;
  reporting_currency: string | null;
  provisioning_by_status: Record<string, number>;
  provisioning_failures: number;
}

/**
 * Rol efectivo del usuario en la sesión. Se resuelve SIEMPRE contra la base
 * (platform_admins / organization_memberships / sales_agents), nunca contra
 * `user_metadata`, que el propio usuario puede editar (contrato §5 de RLS).
 */
export interface SessionRoles {
  userId: string;
  email: string;
  fullName: string | null;
  platformRole: PlatformRole | null;
  organizations: Array<{ organizationId: string; role: OrgRole; displayName: string }>;
  tenantRoles: Array<{ tenantId: string; role: TenantRole }>;
  salesAgentId: string | null;
}

/** Etiquetas en español de los enums, para no repetirlas por toda la UI. */
export const DEPLOYMENT_MODE_LABEL: Record<DeploymentMode, string> = {
  SHARED: 'Compartido',
  PARTNER_DEDICATED: 'Dedicado partner',
  TENANT_DEDICATED: 'Dedicado cliente',
};

export const TENANT_TYPE_LABEL: Record<TenantType, string> = {
  DEMO: 'Demo',
  TRIAL: 'Trial',
  PRODUCTION: 'Producción',
  SANDBOX: 'Sandbox',
};

export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  PENDING: 'Pendiente',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  CHURNED: 'Dado de baja',
  ARCHIVED: 'Archivado',
};

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  EBIM_SUPER_ADMIN: 'Super Admin EBIM',
  EBIM_PRODUCT_ADMIN: 'Admin de Producto',
  EBIM_FINANCE: 'Finanzas',
};

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  PARTNER_ADMIN: 'Admin de Partner',
  PARTNER_SALES: 'Comercial de Partner',
  PARTNER_SUPPORT: 'Soporte de Partner',
  ORG_ADMIN: 'Admin de Organización',
  ORG_VIEWER: 'Consulta',
};

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  PENDING: 'Pendiente',
  ELIGIBLE: 'Elegible',
  ACCRUED: 'Devengada',
  PAID: 'Pagada',
  VOID: 'Anulada',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida',
  PARTIALLY_PAID: 'Pago parcial',
  PAID: 'Pagada',
  VOID: 'Anulada',
  UNCOLLECTIBLE: 'Incobrable',
};

export const PROVISIONING_STATUS_LABEL: Record<ProvisioningStatus, string> = {
  PENDING: 'En cola',
  VALIDATING: 'Validando',
  RUNNING: 'Ejecutando',
  SUCCEEDED: 'Completado',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};
