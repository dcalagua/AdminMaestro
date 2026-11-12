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
import { LEGACY_REDIRECTS } from './navigation';
import { LegacyRedirect } from '@/features/hubs/HubPage';
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
const ProductDetailPage = lazyPage(() => import('@/features/catalog/ProductDetailPage'), 'ProductDetailPage');
const OrganizationDetailPage = lazyPage(() => import('@/features/organizations/OrganizationDetailPage'), 'OrganizationDetailPage');
const PartnersPage = lazyPage(() => import('@/features/organizations/PartnersPage'), 'PartnersPage');
const OnboardingPage = lazyPage(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage');
const TenantsPage = lazyPage(() => import('@/features/tenants/TenantsPage'), 'TenantsPage');
const TenantDetailPage = lazyPage(() => import('@/features/tenants/TenantDetailPage'), 'TenantDetailPage');
const SubscriptionsPage = lazyPage(() => import('@/features/billing/SubscriptionsPage'), 'SubscriptionsPage');
const SubscriptionDetailPage = lazyPage(() => import('@/features/billing/SubscriptionDetailPage'), 'SubscriptionDetailPage');
const CostsPage = lazyPage(() => import('@/features/billing/CostsPage'), 'CostsPage');
const IntegrationDetailPage = lazyPage(() => import('@/features/platform/IntegrationDetailPage'), 'IntegrationDetailPage');
const AuditPage = lazyPage(() => import('@/features/settings/AuditPage'), 'AuditPage');
const PartnerFeesPage = lazyPage(() => import('@/features/partnerFees/PartnerFeesPage'), 'PartnerFeesPage');
const NotFoundPage = lazyPage(() => import('@/features/settings/NotFoundPage'), 'NotFoundPage');
const WelcomePage = lazyPage(() => import('@/features/auth/WelcomePage'), 'WelcomePage');
const UsersPage = lazyPage(() => import('@/features/users/UsersPage'), 'UsersPage');
const UserDetailPage = lazyPage(() => import('@/features/users/UserDetailPage'), 'UserDetailPage');
const InboxPage = lazyPage(() => import('@/features/hubs/PlaceholderPages'), 'InboxPage');
const SuiteCenterPage = lazyPage(() => import('@/features/suite/SuiteCenterPage'), 'SuiteCenterPage');
const AppDetailPage = lazyPage(() => import('@/features/suite/AppDetailPage'), 'AppDetailPage');

/*
 * V5 · F1: entradas que fusionan pantallas como pestañas (`?tab=`). Cada
 * pestaña carga su pantalla en diferido; ver `features/hubs/hubs.tsx`.
 */
const AccountsHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'AccountsHubPage');
const SalesTeamHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'SalesTeamHubPage');
const AppsHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'AppsHubPage');
const CatalogHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'CatalogHubPage');
const CollectionsHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'CollectionsHubPage');
const CommissionsHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'CommissionsHubPage');
const SettingsHubPage = lazyPage(() => import('@/features/hubs/hubs'), 'SettingsHubPage');

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

                    <Route path="bandeja" element={<InboxPage />} />
                    <Route
                      path="suite"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <SuiteCenterPage />
                        </RequirePersona>
                      }
                    />

                    {/*
                    V5 · F1. Entradas con pestañas (`?tab=`). Quién ve cada
                    pestaña sale de `navigation.ts` y copia el guard de la
                    pantalla que absorbe; RLS y las RPC siguen siendo la
                    autoridad. Las rutas viejas redirigen aquí (abajo).
                  */}
                    <Route path="cuentas" element={<AccountsHubPage />} />
                    <Route path="sales-agents" element={<SalesTeamHubPage />} />
                    <Route path="apps" element={<AppsHubPage />} />
                    <Route path="catalogo" element={<CatalogHubPage />} />
                    <Route path="cobranza" element={<CollectionsHubPage />} />
                    <Route path="commissions" element={<CommissionsHubPage />} />
                    <Route path="settings" element={<SettingsHubPage />} />
                    {LEGACY_REDIRECTS.map((r) => (
                      <Route key={r.from} path={r.from.slice(1)} element={<LegacyRedirect to={r.to} tab={r.tab} />} />
                    ))}

                    {/* Fichas de detalle: conservan su URL. */}
                    <Route path="products/:productId" element={<ProductDetailPage />} />
                    <Route
                      path="apps/:productCode"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <AppDetailPage />
                        </RequirePersona>
                      }
                    />
                    <Route path="organizations/:organizationId" element={<OrganizationDetailPage />} />
                    <Route
                      path="integrations/:integrationId"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <IntegrationDetailPage />
                        </RequirePersona>
                      }
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
                      path="partner-fees"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><PartnerFeesPage /></RequireFinanceView>
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
                      path="costs"
                      element={
                        <RequirePersona personas={['EBIM']}>
                          <RequireFinanceView><CostsPage /></RequireFinanceView>
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

                    {/*
                    M5 · «Usuarios». EBIM ve a todos; un admin de
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
