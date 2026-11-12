import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { LoadingState } from '@/components/ui/primitives';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from './AppShell';
import { RequireAuth, RequireDesignGallery, RequireFinanceView, RequirePersona } from './guards';
import { createAppQueryClient } from './queryClient';
import { AppearanceProvider } from './AppearanceProvider';

import { LoginPage } from '@/features/auth/LoginPage';

/**
 * Carga diferida por ruta (V5 · F0): cada pantalla es su propio chunk, así el
 * login y el shell no pagan el peso de toda la consola. Solo el login (puerta
 * de entrada) y el shell se cargan de inmediato. Los límites de `Suspense`
 * viven en `AppShell` (rutas privadas, el menú queda visible) y aquí (rutas
 * públicas), con el esqueleto de página del sistema de diseño.
 */
function lazyPage<K extends string>(
  loader: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const PaymentPortalPage = lazyPage(() => import('@/features/paymentPortal/PaymentPortalPage'), 'PaymentPortalPage');
const ProductsPage = lazyPage(() => import('@/features/catalog/ProductsPage'), 'ProductsPage');
const ProductDetailPage = lazyPage(() => import('@/features/catalog/ProductDetailPage'), 'ProductDetailPage');
const PlansPage = lazyPage(() => import('@/features/catalog/PlansPage'), 'PlansPage');
const FeatureFlagsPage = lazyPage(() => import('@/features/catalog/FeatureFlagsPage'), 'FeatureFlagsPage');
const AddonsPage = lazyPage(() => import('@/features/catalog/AddonsPage'), 'AddonsPage');
const CapabilitiesPage = lazyPage(() => import('@/features/commercial/capabilities/CapabilitiesPage'), 'CapabilitiesPage');
const EntitlementSyncPage = lazyPage(() => import('@/features/commercial/sync/EntitlementSyncPage'), 'EntitlementSyncPage');
const OrganizationsPage = lazyPage(() => import('@/features/organizations/OrganizationsPage'), 'OrganizationsPage');
const OrganizationDetailPage = lazyPage(() => import('@/features/organizations/OrganizationDetailPage'), 'OrganizationDetailPage');
const PartnersPage = lazyPage(() => import('@/features/organizations/PartnersPage'), 'PartnersPage');
const CustomersPage = lazyPage(() => import('@/features/organizations/CustomersPage'), 'CustomersPage');
const OnboardingPage = lazyPage(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage');
const TenantsPage = lazyPage(() => import('@/features/tenants/TenantsPage'), 'TenantsPage');
const TenantDetailPage = lazyPage(() => import('@/features/tenants/TenantDetailPage'), 'TenantDetailPage');
const SalesAgentsPage = lazyPage(() => import('@/features/commercial/SalesAgentsPage'), 'SalesAgentsPage');
const AttributionsPage = lazyPage(() => import('@/features/commercial/AttributionsPage'), 'AttributionsPage');
const CommissionPlansPage = lazyPage(() => import('@/features/commercial/CommissionPlansPage'), 'CommissionPlansPage');
const CommissionsPage = lazyPage(() => import('@/features/commercial/CommissionsPage'), 'CommissionsPage');
const SubscriptionsPage = lazyPage(() => import('@/features/billing/SubscriptionsPage'), 'SubscriptionsPage');
const SubscriptionDetailPage = lazyPage(() => import('@/features/billing/SubscriptionDetailPage'), 'SubscriptionDetailPage');
const BillingPage = lazyPage(() => import('@/features/billing/BillingPage'), 'BillingPage');
const CostsPage = lazyPage(() => import('@/features/billing/CostsPage'), 'CostsPage');
const RenewalsPage = lazyPage(() => import('@/features/billing/RenewalsPage'), 'RenewalsPage');
const ReconciliationPage = lazyPage(() => import('@/features/billing/ReconciliationPage'), 'ReconciliationPage');
const DeploymentsPage = lazyPage(() => import('@/features/deployments/DeploymentsPage'), 'DeploymentsPage');
const ProvisioningPage = lazyPage(() => import('@/features/deployments/ProvisioningPage'), 'ProvisioningPage');
const SaasProvisioningPage = lazyPage(() => import('@/features/deployments/SaasProvisioningPage'), 'SaasProvisioningPage');
const IntegrationsPage = lazyPage(() => import('@/features/platform/IntegrationsPage'), 'IntegrationsPage');
const IntegrationDetailPage = lazyPage(() => import('@/features/platform/IntegrationDetailPage'), 'IntegrationDetailPage');
const AuditPage = lazyPage(() => import('@/features/settings/AuditPage'), 'AuditPage');
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const RegionalPage = lazyPage(() => import('@/features/regional/RegionalPage'), 'RegionalPage');
const UsagePage = lazyPage(() => import('@/features/usage/UsagePage'), 'UsagePage');
const AiCreditsPage = lazyPage(() => import('@/features/credits/AiCreditsPage'), 'AiCreditsPage');
const BillingShadowPage = lazyPage(() => import('@/features/billing/shadow/BillingShadowPage'), 'BillingShadowPage');
const PartnerFeesPage = lazyPage(() => import('@/features/partnerFees/PartnerFeesPage'), 'PartnerFeesPage');
const NotFoundPage = lazyPage(() => import('@/features/settings/NotFoundPage'), 'NotFoundPage');
const WelcomePage = lazyPage(() => import('@/features/auth/WelcomePage'), 'WelcomePage');
const UsersPage = lazyPage(() => import('@/features/users/UsersPage'), 'UsersPage');
const UserDetailPage = lazyPage(() => import('@/features/users/UserDetailPage'), 'UserDetailPage');

/**
 * El inicio ejecutivo es la única pantalla con gráficos (Recharts ≈ 170 kB gzip):
 * se carga aparte para que el login y el resto de la consola no paguen ese peso.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

/** Galería de componentes (solo desarrollo o super admin): fuera del bundle principal. */
const DesignGalleryPage = lazy(() =>
  import('@/features/design/DesignGalleryPage').then((m) => ({ default: m.DesignGalleryPage })),
);

/** Una caché por pestaña, firmada por identidad de sesión (ver `queryClient.ts`). */
const queryClient = createAppQueryClient();

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppearanceProvider>
                <Suspense fallback={<LoadingState variant="page" label="Cargando…" />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  {/*
                    M1 · Portal de pago PÚBLICO (/pagar#<token>). Fuera de
                    RequireAuth/AppShell: quien paga no tiene sesión. No usa
                    PostgREST: habla solo con la Edge Function pay-portal.
                  */}
                  <Route path="/pagar" element={<PaymentPortalPage />} />
                  {/*
                    M5 · /bienvenida PÚBLICA: recibe la sesión del enlace de
                    invitación o de restablecimiento y pide fijar la contraseña.
                  */}
                  <Route path="/bienvenida" element={<WelcomePage />} />

                  <Route
                    element={
                      <RequireAuth>
                        <AppShell />
                      </RequireAuth>
                    }
                  >
                    <Route
                    index
                    element={
                      <Suspense fallback={<LoadingState variant="page" label="Cargando el resumen ejecutivo…" />}>
                        <DashboardPage />
                      </Suspense>
                    }
                  />

                    <Route path="products" element={<ProductsPage />} />
                    <Route path="products/:productId" element={<ProductDetailPage />} />
                    <Route path="plans" element={<PlansPage />} />
                    <Route path="feature-flags" element={<FeatureFlagsPage />} />
                    {/*
                    CCP fase 07. El registro de capacidades es gobierno de
                    producto de EBIM; los add-ons llevan tarifas, así que se
                    protegen como el resto de pantallas financieras. Ambas son
                    UX: RLS y las RPC son la autoridad.
                  */}
                    <Route
                      path="commercial/capabilities"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <CapabilitiesPage />
                        </RequirePersona>
                      }
                    />
                    {/*
                    CCP fase 08. Deseado frente a aplicado; «Sincronizar ahora»
                    pasa por el orquestador, que autoriza con un booleano de
                    la base (platform.provisioning.execute del producto).
                  */}
                    <Route
                      path="commercial/entitlement-sync"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <EntitlementSyncPage />
                        </RequirePersona>
                      }
                    />
                    {/*
                    CCP M4. «Uso» es operación SaaS de EBIM (medidores e ingest
                    los administra producto; facturable y finalizar, finanzas).
                    «Créditos IA» y «Billing shadow» son pantallas financieras.
                    Todo es UX: RLS y las RPC son la autoridad.
                  */}
                    <Route
                      path="usage"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <UsagePage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="ai-credits"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><AiCreditsPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="billing-shadow"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><BillingShadowPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="partner-fees"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><PartnerFeesPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="catalog/addons"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><AddonsPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />

                    <Route
                      path="organizations"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <OrganizationsPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="organizations/:organizationId"
                      element={<OrganizationDetailPage />}
                    />
                    <Route
                      path="partners"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <PartnersPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="customers"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <CustomersPage />
                        </RequirePersona>
                      }
                    />

                    <Route
                      path="onboarding"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <OnboardingPage />
                        </RequirePersona>
                      }
                    />

                    <Route path="tenants" element={<TenantsPage />} />
                    <Route path="tenants/:tenantId" element={<TenantDetailPage />} />

                    <Route
                      path="sales-agents"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <SalesAgentsPage />
                        </RequirePersona>
                      }
                    />
                    <Route path="attributions" element={<AttributionsPage />} />
                    <Route
                      path="commission-plans"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><CommissionPlansPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                    path="commissions"
                    element={
                      <RequireFinanceView>
                        <CommissionsPage />
                      </RequireFinanceView>
                    }
                  />

                    <Route
                      path="subscriptions"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><SubscriptionsPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="subscriptions/:subscriptionId"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><SubscriptionDetailPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="billing"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><BillingPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="renewals"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <RequireFinanceView><RenewalsPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="reconciliation"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><ReconciliationPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="costs"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><CostsPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />

                    <Route
                      path="deployments"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <DeploymentsPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="provisioning"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <ProvisioningPage />
                        </RequirePersona>
                      }
                    />
                    {/*
                    Provisioning SaaS: eje de APLICACIÓN, separado del de
                    infraestructura de arriba. Protegido además por RLS y por el
                    gate de permiso del orquestador; `RequirePersona` es UX.
                  */}
                    <Route
                      path="saas-provisioning"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <SaasProvisioningPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="integrations"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <IntegrationsPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="integrations/:integrationId"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <IntegrationDetailPage />
                        </RequirePersona>
                      }
                    />

                    <Route
                      path="audit"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <AuditPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="regional"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><RegionalPage /></RequireFinanceView>
                        </RequirePersona>
                      }
                    />
                    <Route path="settings" element={<SettingsPage />} />

                    {/*
                    M5 · «Usuarios y accesos». EBIM ve a todos; un admin de
                    partner o de cliente, a los miembros de su organización.
                    `admin_list_users` y cada RPC deciden; esto es UX.
                  */}
                    <Route
                      path="users"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <UsersPage />
                        </RequirePersona>
                      }
                    />
                    <Route
                      path="users/:userId"
                      element={
                        <RequirePersona personas={['EBIM', 'PARTNER']}>
                          <UserDetailPage />
                        </RequirePersona>
                      }
                    />

                    <Route
                      path="design"
                      element={
                        <RequireDesignGallery>
                          <Suspense fallback={<LoadingState variant="page" label="Cargando la galería…" />}>
                            <DesignGalleryPage />
                          </Suspense>
                        </RequireDesignGallery>
                      }
                    />

                    <Route path="404" element={<NotFoundPage />} />
                    <Route path="*" element={<Navigate to="/404" replace />} />
                  </Route>
                </Routes>
                </Suspense>
              </AppearanceProvider>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
