import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from './AppShell';
import { RequireAuth, RequirePersona } from './guards';

import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProductsPage } from '@/features/catalog/ProductsPage';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { PlansPage } from '@/features/catalog/PlansPage';
import { FeatureFlagsPage } from '@/features/catalog/FeatureFlagsPage';
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
import { AuditPage } from '@/features/settings/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { RegionalPage } from '@/features/regional/RegionalPage';
import { NotFoundPage } from '@/features/settings/NotFoundPage';

/**
 * TanStack Query con `retry: 1`: un fallo de RLS (403/permiso denegado) no es
 * transitorio, y reintentarlo tres veces sólo retrasa el mensaje de error.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route index element={<DashboardPage />} />

                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/:productId" element={<ProductDetailPage />} />
                  <Route path="plans" element={<PlansPage />} />
                  <Route path="feature-flags" element={<FeatureFlagsPage />} />

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
                        <CommissionPlansPage />
                      </RequirePersona>
                    }
                  />
                  <Route path="commissions" element={<CommissionsPage />} />

                  <Route
                    path="subscriptions"
                    element={
                      <RequirePersona personas={['EBIM', 'PARTNER']}>
                        <SubscriptionsPage />
                      </RequirePersona>
                    }
                  />
                  <Route
                    path="subscriptions/:subscriptionId"
                    element={
                      <RequirePersona personas={['EBIM', 'PARTNER']}>
                        <SubscriptionDetailPage />
                      </RequirePersona>
                    }
                  />
                  <Route
                    path="billing"
                    element={
                      <RequirePersona personas={['EBIM', 'PARTNER']}>
                        <BillingPage />
                      </RequirePersona>
                    }
                  />
                  <Route
                    path="renewals"
                    element={
                      <RequirePersona personas={['EBIM', 'PARTNER']}>
                        <RenewalsPage />
                      </RequirePersona>
                    }
                  />
                  <Route
                    path="reconciliation"
                    element={
                      <RequirePersona personas={['EBIM']}>
                        <ReconciliationPage />
                      </RequirePersona>
                    }
                  />
                  <Route
                    path="costs"
                    element={
                      <RequirePersona personas={['EBIM']}>
                        <CostsPage />
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
                        <RegionalPage />
                      </RequirePersona>
                    }
                  />
                  <Route path="settings" element={<SettingsPage />} />

                  <Route path="404" element={<NotFoundPage />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
