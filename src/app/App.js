import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
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
import { TenantsPage } from '@/features/tenants/TenantsPage';
import { TenantDetailPage } from '@/features/tenants/TenantDetailPage';
import { SalesAgentsPage } from '@/features/commercial/SalesAgentsPage';
import { AttributionsPage } from '@/features/commercial/AttributionsPage';
import { CommissionPlansPage } from '@/features/commercial/CommissionPlansPage';
import { CommissionsPage } from '@/features/commercial/CommissionsPage';
import { SubscriptionsPage } from '@/features/billing/SubscriptionsPage';
import { BillingPage } from '@/features/billing/BillingPage';
import { CostsPage } from '@/features/billing/CostsPage';
import { DeploymentsPage } from '@/features/deployments/DeploymentsPage';
import { ProvisioningPage } from '@/features/deployments/ProvisioningPage';
import { AuditPage } from '@/features/settings/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
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
    return (_jsx(ErrorBoundary, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsx(AuthProvider, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsxs(Route, { element: _jsx(RequireAuth, { children: _jsx(AppShell, {}) }), children: [_jsx(Route, { index: true, element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "products", element: _jsx(ProductsPage, {}) }), _jsx(Route, { path: "products/:productId", element: _jsx(ProductDetailPage, {}) }), _jsx(Route, { path: "plans", element: _jsx(PlansPage, {}) }), _jsx(Route, { path: "feature-flags", element: _jsx(FeatureFlagsPage, {}) }), _jsx(Route, { path: "organizations", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(OrganizationsPage, {}) }) }), _jsx(Route, { path: "organizations/:organizationId", element: _jsx(OrganizationDetailPage, {}) }), _jsx(Route, { path: "partners", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(PartnersPage, {}) }) }), _jsx(Route, { path: "customers", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(CustomersPage, {}) }) }), _jsx(Route, { path: "tenants", element: _jsx(TenantsPage, {}) }), _jsx(Route, { path: "tenants/:tenantId", element: _jsx(TenantDetailPage, {}) }), _jsx(Route, { path: "sales-agents", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(SalesAgentsPage, {}) }) }), _jsx(Route, { path: "attributions", element: _jsx(AttributionsPage, {}) }), _jsx(Route, { path: "commission-plans", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(CommissionPlansPage, {}) }) }), _jsx(Route, { path: "commissions", element: _jsx(CommissionsPage, {}) }), _jsx(Route, { path: "subscriptions", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(SubscriptionsPage, {}) }) }), _jsx(Route, { path: "billing", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(BillingPage, {}) }) }), _jsx(Route, { path: "costs", element: _jsx(RequirePersona, { personas: ['EBIM'], children: _jsx(CostsPage, {}) }) }), _jsx(Route, { path: "deployments", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(DeploymentsPage, {}) }) }), _jsx(Route, { path: "provisioning", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(ProvisioningPage, {}) }) }), _jsx(Route, { path: "audit", element: _jsx(RequirePersona, { personas: ['EBIM', 'PARTNER'], children: _jsx(AuditPage, {}) }) }), _jsx(Route, { path: "settings", element: _jsx(SettingsPage, {}) }), _jsx(Route, { path: "404", element: _jsx(NotFoundPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/404", replace: true }) })] })] }) }) }) }) }));
}
