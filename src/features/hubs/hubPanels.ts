import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { HubPanels } from './HubPage';

/**
 * Las entradas de la V5 que fusionan pantallas (plan §4). Cada pestaña es la
 * pantalla de siempre, cargada en diferido: entrar a Cobranza no descarga
 * Conciliación hasta que alguien abre esa pestaña.
 */
function lazyPanel<K extends string>(
  loader: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const CUENTAS: HubPanels = {
  clientes: lazyPanel(() => import('@/features/organizations/CustomersPage'), 'CustomersPage'),
  directorio: lazyPanel(() => import('@/features/organizations/OrganizationsPage'), 'OrganizationsPage'),
};

const EQUIPO_COMERCIAL: HubPanels = {
  equipo: lazyPanel(() => import('@/features/commercial/SalesAgentsPage'), 'SalesAgentsPage'),
  atribuciones: lazyPanel(() => import('@/features/commercial/AttributionsPage'), 'AttributionsPage'),
};

const APPS: HubPanels = {
  integraciones: lazyPanel(() => import('@/features/platform/IntegrationsPage'), 'IntegrationsPage'),
  altas: lazyPanel(() => import('@/features/deployments/SaasProvisioningPage'), 'SaasProvisioningPage'),
  sincronizacion: lazyPanel(() => import('@/features/commercial/sync/EntitlementSyncPage'), 'EntitlementSyncPage'),
  uso: lazyPanel(() => import('@/features/usage/UsagePage'), 'UsagePage'),
  entornos: lazyPanel(() => import('@/features/deployments/DeploymentsPage'), 'DeploymentsPage'),
  infraestructura: lazyPanel(() => import('@/features/deployments/ProvisioningPage'), 'ProvisioningPage'),
};

const CATALOGO: HubPanels = {
  productos: lazyPanel(() => import('@/features/catalog/ProductsPage'), 'ProductsPage'),
  planes: lazyPanel(() => import('@/features/catalog/PlansPage'), 'PlansPage'),
  addons: lazyPanel(() => import('@/features/catalog/AddonsPage'), 'AddonsPage'),
  capacidades: lazyPanel(() => import('@/features/catalog/FeatureFlagsPage'), 'FeatureFlagsPage'),
  registro: lazyPanel(() => import('@/features/commercial/capabilities/CapabilitiesPage'), 'CapabilitiesPage'),
};

const COBRANZA: HubPanels = {
  'por-cobrar': lazyPanel(() => import('@/features/billing/CollectionsInboxPage'), 'CollectionsInboxPage'),
  facturacion: lazyPanel(() => import('@/features/billing/BillingPage'), 'BillingPage'),
  renovaciones: lazyPanel(() => import('@/features/billing/RenewalsPage'), 'RenewalsPage'),
  conciliacion: lazyPanel(() => import('@/features/billing/ReconciliationPage'), 'ReconciliationPage'),
};

const COMISIONES: HubPanels = {
  comisiones: lazyPanel(() => import('@/features/commercial/CommissionsPage'), 'CommissionsPage'),
  planes: lazyPanel(() => import('@/features/commercial/CommissionPlansPage'), 'CommissionPlansPage'),
};

const CONFIGURACION: HubPanels = {
  general: lazyPanel(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
  regional: lazyPanel(() => import('@/features/regional/RegionalPage'), 'RegionalPage'),
  'creditos-ia': lazyPanel(() => import('@/features/credits/AiCreditsPage'), 'AiCreditsPage'),
  avanzado: lazyPanel(() => import('@/features/billing/shadow/BillingShadowPage'), 'BillingShadowPage'),
};

/** Pantallas de cada entrada con pestañas, por ruta (fuente de las pestañas: `navigation.ts`). */
export const HUB_PANELS: Record<string, HubPanels> = {
  '/cuentas': CUENTAS,
  '/sales-agents': EQUIPO_COMERCIAL,
  '/apps': APPS,
  '/catalogo': CATALOGO,
  '/cobranza': COBRANZA,
  '/commissions': COMISIONES,
  '/settings': CONFIGURACION,
};
