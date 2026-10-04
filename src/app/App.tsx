import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { LoadingState } from '@/components/ui/primitives';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from './AppShell';
import { RequireAuth, RequireFinanceView, RequirePersona } from './guards';
import { createAppQueryClient } from './queryClient';
import { AppearanceProvider } from './AppearanceProvider';

import { LoginPage } from '@/features/auth/LoginPage';
import { ProductsPage } from '@/features/catalog/ProductsPage';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { PlansPage } from '@/features/catalog/PlansPage';
import { FeatureFlagsPage } from '@/features/catalog/FeatureFlagsPage';
import { AddonsPage } from '@/features/catalog/AddonsPage';
import { CapabilitiesPage } from '@/features/commercial/capabilities/CapabilitiesPage';
import { EntitlementSyncPage } from '@/features/commercial/sync/EntitlementSyncPage';
import { OrganizationsPage } from '@/features/organizations/OrganizationsPage';
import { OrganizationDetailPage } from '@/features/organizations/OrganizationDetailPage';
import { PartnersPage } from '@/features/organizations/PartnersPage';
import { CustomersPage } from '@/features/organizations/CustomersPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { TenantsPage } from '@/features/tenants/TenantsPage';
import { TenantDetailPage } from '@/features/tenants/TenantDetailPage';
import { SalesAgentsPage } from '@/features/commercial/SalesAgentsPage';
import { AttributionsPage } from '@/features/commercial/AttributionsPage';
import { CommissionPlansPage } from '@/features/commercial/CommissionPlansPage';
import { CommissionsPage } from '@/features/commercial/CommissionsPage';
import { SubscriptionsPage } from '@/features/billing/SubscriptionsPage';
import { SubscriptionDetailPage } from '@/features/billing/SubscriptionDetailPage';
import { BillingPage } from '@/features/billing/BillingPage';
import { CostsPage } from '@/features/billing/CostsPage';
import { RenewalsPage } from '@/features/billing/RenewalsPage';
import { ReconciliationPage } from '@/features/billing/ReconciliationPage';
import { DeploymentsPage } from '@/features/deployments/DeploymentsPage';
import { ProvisioningPage } from '@/features/deployments/ProvisioningPage';
import { SaasProvisioningPage } from '@/features/deployments/SaasProvisioningPage';
import { IntegrationsPage } from '@/features/platform/IntegrationsPage';
import { IntegrationDetailPage } from '@/features/platform/IntegrationDetailPage';
import { AuditPage } from '@/features/settings/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { RegionalPage } from '@/features/regional/RegionalPage';
import { UsagePage } from '@/features/usage/UsagePage';
import { AiCreditsPage } from '@/features/credits/AiCreditsPage';
import { BillingShadowPage } from '@/features/billing/shadow/BillingShadowPage';
import { NotFoundPage } from '@/features/settings/NotFoundPage';

/**
 * El inicio ejecutivo es la única pantalla con gráficos (Recharts ≈ 170 kB gzip):
 * se carga aparte para que el login y el resto de la consola no paguen ese peso.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
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
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

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
                      <Suspense fallback={<LoadingState label="Cargando el resumen ejecutivo…" />}>
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

                    <Route path="404" element={<NotFoundPage />} />
                    <Route path="*" element={<Navigate to="/404" replace />} />
                  </Route>
                </Routes>
              </AppearanceProvider>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
