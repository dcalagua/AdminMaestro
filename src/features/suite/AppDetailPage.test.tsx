import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
 * V5 · F2 · Ficha de app. Conexión enseña endpoints, emisor, audiencia y
 * scopes, nunca secretos; el nombre de la referencia de la llave sólo se
 * ofrece con `platform.credentials.manage`. Los canales apagados dicen
 * «no activo».
 */

const checkHealth = vi.fn().mockResolvedValue({ health: 'HEALTHY' });
const eventsFor = vi.fn();
const state = { perms: new Set<string>(['platform.deployment.read', 'platform.credentials.manage']) };
const q = <T,>(data: T) => ({ isLoading: false, error: null, data, refetch: vi.fn() });

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/services/mutations', () => ({
  useCheckDeploymentHealth: () => ({ mutateAsync: checkHealth, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useProducts: () => q([{ id: 'p-ewm', code: 'ewm', short_name: 'EWM', accent_color: null, sort_order: 1, status: 'ACTIVE' }]),
  useProvisioningTargets: () =>
    q([
      {
        deployment_target_id: 't-ewm', code: 'ewm-qas', saas_product_id: 'p-ewm', product_integration_id: 'i-ewm',
        provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY',
        health_status: 'HEALTHY', health_checked_at: '2026-09-24T12:00:00Z', contract_version: 'v1',
        base_url: 'https://ewm-qas.ebim.pe', issuer: 'masteradmin', audience: 'ewm-api',
        create_scope: 'tenants:create', read_scope: 'tenants:read',
        credential_profile_id: 'c-1', credential_profile_code: 'ewm-qas-key', credential_secret_configured: true,
        timeout_ms: 15000, retry_count: 2,
      },
    ]),
  useProductIntegrations: () =>
    q([
      {
        id: 'i-ewm', saas_product_id: 'p-ewm', enabled: true, status: 'READY', integration_type: 'HTTP_M2M',
        contract_version: 'v1', entitlements_push_enabled: false, usage_ingest_enabled: false,
        create_path_template: '/internal/tenants', health_path_template: '/health',
      },
    ]),
  useTenantOverview: () =>
    q([{ tenant_id: 'tn-acme', name: 'Acme EWM', status: 'PENDING', customer_organization_id: 'o-acme', customer_name: 'Acme', saas_product_id: 'p-ewm', subscription_id: null }]),
  useSaasProvisioningRequests: () =>
    q([{ id: 'r-acme', tenant_id: 'tn-acme', tenant_name: 'Acme EWM', saas_product_id: 'p-ewm', status: 'ACTIVE', attempt_count: 1, max_attempts: 3, requested_at: '2026-10-01T00:00:00Z' }]),
  useEntitlementSyncStatus: () => q([]),
  useSubscriptionStatuses: () => q([]),
  useSaasProvisioningEventsForRequests: (ids: string[]) => {
    eventsFor(ids);
    return q([
      { id: 1, saas_provisioning_request_id: 'r-acme', action: 'PROVISION_SUCCEEDED', message: 'Alta completada en la app', status: 'ACTIVE', occurred_at: '2026-10-01T00:05:00Z', attempt: 1 },
    ]);
  },
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct: (code: string) => state.perms.has(code) }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: 'EBIM', roles: { platformRole: 'EBIM_SUPER_ADMIN', organizations: [] } }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/features/platform/RevealSecretRef', () => ({
  RevealSecretRefButton: () => <button type="button">Ver referencia</button>,
}));

import { AppDetailPage } from './AppDetailPage';

function renderAt(path: string, hash = '') {
  window.location.hash = hash;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apps/:productCode" element={<AppDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.perms = new Set(['platform.deployment.read', 'platform.credentials.manage']);
});

describe('ficha de app', () => {
  it('resumen con pestañas, salud y canales honestos', () => {
    renderAt('/apps/ewm');
    expect(screen.getByRole('heading', { level: 1, name: 'EWM' })).toBeInTheDocument();
    for (const tab of ['Resumen', 'Tenants', 'Conexión', 'Sincronización', 'Uso', 'Historial']) {
      expect(screen.getByRole('tab', { name: new RegExp(tab) })).toBeInTheDocument();
    }
    expect(screen.getAllByText('No disponible').length).toBeGreaterThan(0);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('conexión: endpoints, emisor, audiencia y scopes; la referencia de la llave sólo con permiso', async () => {
    renderAt('/apps/ewm', '#conexion');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('https://ewm-qas.ebim.pe')).toBeInTheDocument();
    expect(within(panel).getByText('masteradmin')).toBeInTheDocument();
    expect(within(panel).getByText('ewm-api')).toBeInTheDocument();
    expect(within(panel).getByText('tenants:create tenants:read')).toBeInTheDocument();
    expect(within(panel).getByText('Referencia configurada')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Ver referencia' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Verificar este entorno' }));
    expect(checkHealth).toHaveBeenCalledWith('t-ewm');
  });

  it('sin platform.credentials.manage no se ofrece ver la referencia; sin lectura de entornos, no se verifica', () => {
    state.perms = new Set();
    renderAt('/apps/ewm', '#conexion');
    expect(screen.queryByRole('button', { name: 'Ver referencia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verificar/ })).not.toBeInTheDocument();
  });

  it('módulos y uso apagados: «no activo»', () => {
    renderAt('/apps/ewm', '#sincronizacion');
    expect(screen.getByText('Canal de módulos no activo')).toBeInTheDocument();
  });

  it('tenants: el PENDING con alta activa se ve «por confirmar»; historial con los eventos de sus altas', () => {
    renderAt('/apps/ewm', '#tenants');
    expect(screen.getByText('Por confirmar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme EWM' })).toHaveAttribute('href', '/tenants/tn-acme');
    expect(eventsFor).toHaveBeenCalledWith(['r-acme']);
  });

  it('app inexistente: aviso y vuelta al centro', () => {
    renderAt('/apps/nada');
    expect(screen.getByText('No existe o no tienes acceso')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al Centro de la suite' })).toHaveAttribute('href', '/suite');
  });
});
