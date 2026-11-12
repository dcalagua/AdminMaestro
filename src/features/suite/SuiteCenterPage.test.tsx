import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * V5 · F2 · Centro de la suite. Ver la pantalla no verifica nada; «Verificar
 * ahora» usa CHECK_HEALTH; un tenant PENDING con alta ACTIVE se muestra como
 * «pendiente de confirmar» y sólo cambia tras confirmar; los botones respetan
 * los permisos de siempre.
 */

const checkHealth = vi.fn().mockResolvedValue({ health: 'HEALTHY', detail: 'ok' });
const setStatus = vi.fn().mockResolvedValue(undefined);
const retry = vi.fn().mockResolvedValue('r-2');
const suspend = vi.fn().mockResolvedValue({});
const resume = vi.fn().mockResolvedValue({});
const invoke = vi.fn();

const state = {
  canManagePlatform: true,
  canForProduct: (_code: string, _productId?: string | null) => true,
  persona: 'EBIM',
  platformRole: 'EBIM_SUPER_ADMIN' as string | null,
};

const q = <T,>(data: T) => ({ isLoading: false, error: null, data, refetch: vi.fn() });

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/services/mutations', () => ({
  useCheckDeploymentHealth: () => ({ mutateAsync: checkHealth, isPending: false, variables: undefined }),
  useSetTenantStatus: () => ({ mutateAsync: setStatus, isPending: false }),
  useRetrySaasProvisioning: () => ({ mutateAsync: retry, isPending: false }),
  useRequestTenantSuspension: () => ({ mutateAsync: suspend, isPending: false }),
  useRequestTenantResume: () => ({ mutateAsync: resume, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useProducts: () =>
    q([
      { id: 'p-ewm', code: 'ewm', short_name: 'EWM', accent_color: null, sort_order: 1, status: 'ACTIVE' },
      { id: 'p-tms', code: 'tms', short_name: 'TMS', accent_color: null, sort_order: 2, status: 'ACTIVE' },
    ]),
  useProvisioningTargets: () =>
    q([
      {
        deployment_target_id: 't-ewm', code: 'ewm-qas', saas_product_id: 'p-ewm', product_integration_id: 'i-ewm',
        provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY',
        health_status: 'HEALTHY', health_checked_at: '2026-09-24T12:00:00Z', contract_version: 'v1',
      },
      {
        deployment_target_id: 't-tms', code: 'tms-qas', saas_product_id: 'p-tms', product_integration_id: 'i-tms',
        provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY',
        health_status: 'HEALTHY', health_checked_at: new Date().toISOString(), contract_version: 'v1',
      },
    ]),
  useProductIntegrations: () =>
    q([
      { id: 'i-ewm', saas_product_id: 'p-ewm', enabled: true, status: 'READY', integration_type: 'HTTP_M2M', contract_version: 'v1', entitlements_push_enabled: false, usage_ingest_enabled: false },
      { id: 'i-tms', saas_product_id: 'p-tms', enabled: true, status: 'READY', integration_type: 'HTTP_M2M', contract_version: 'v1', entitlements_push_enabled: false, usage_ingest_enabled: false },
    ]),
  useTenantOverview: () =>
    q([
      { tenant_id: 'tn-acme', name: 'Acme EWM', status: 'PENDING', customer_organization_id: 'o-acme', customer_name: 'Acme', saas_product_id: 'p-ewm', subscription_id: 's-1' },
      { tenant_id: 'tn-beta', name: 'Beta TMS', status: 'ACTIVE', customer_organization_id: 'o-beta', customer_name: 'Beta', saas_product_id: 'p-tms', subscription_id: null },
      { tenant_id: 'tn-gama', name: 'Gama EWM', status: 'PENDING', customer_organization_id: 'o-gama', customer_name: 'Gama', saas_product_id: 'p-ewm', subscription_id: null },
    ]),
  useSaasProvisioningRequests: () =>
    q([
      { id: 'r-acme', tenant_id: 'tn-acme', saas_product_id: 'p-ewm', status: 'ACTIVE', attempt_count: 1, max_attempts: 3, requested_at: '2026-10-01T00:00:00Z' },
      { id: 'r-beta', tenant_id: 'tn-beta', saas_product_id: 'p-tms', status: 'ACTIVE', attempt_count: 1, max_attempts: 3, requested_at: '2026-10-01T00:00:00Z' },
      { id: 'r-gama', tenant_id: 'tn-gama', saas_product_id: 'p-ewm', status: 'FAILED', attempt_count: 1, max_attempts: 3, requested_at: '2026-10-01T00:00:00Z', last_error_code: 'PROVIDER_TIMEOUT' },
    ]),
  useEntitlementSyncStatus: () => q([]),
  useSubscriptionStatuses: () => q([{ id: 's-1', code: 'SUB-1', status: 'ACTIVE' }]),
  useAdminUsers: () =>
    q([
      { id: 'u-1', fullName: 'Lucía Beta', email: 'lucia@beta.pe', tenants: [{ tenant_id: 'tn-beta', is_active: true }] },
      { id: 'u-2', fullName: 'Otro', email: 'otro@beta.pe', tenants: [{ tenant_id: 'tn-otro', is_active: true }] },
    ]),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct: (code: string, id?: string | null) => state.canForProduct(code, id) }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: state.canManagePlatform }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: state.persona, roles: { platformRole: state.platformRole, organizations: [] } }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { SuiteCenterPage } from './SuiteCenterPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/suite']}>
      <SuiteCenterPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.canManagePlatform = true;
  state.canForProduct = () => true;
  state.platformRole = 'EBIM_SUPER_ADMIN';
});

describe('franja de salud', () => {
  it('una tarjeta por app con salud, ambiente, último chequeo y canales honestos', () => {
    renderPage();
    const strip = document.querySelector('[data-health-strip]') as HTMLElement;
    const ewm = within(strip).getByRole('article', { name: 'EWM' });
    expect(within(ewm).getByText('Saludable')).toBeInTheDocument();
    expect(within(ewm).getByText(/Calidad/)).toBeInTheDocument();
    expect(within(ewm).getByText(/contrato de alta v1/)).toBeInTheDocument();
    expect(within(ewm).getByText(/semanas/)).toBeInTheDocument();
    expect(ewm.querySelector('[data-stale="true"]')).not.toBeNull();
    // TMS se comprobó ahora mismo: sin aviso.
    const tms = within(strip).getByRole('article', { name: 'TMS' });
    expect(tms.querySelector('[data-stale="false"]')).not.toBeNull();
    // Canales: alta activa; módulos y uso «No activo»; suspensión «No disponible».
    expect(ewm.querySelector('[data-channel="alta"]')?.getAttribute('data-active')).toBe('true');
    expect(within(ewm.querySelector('[data-channel="modulos"]') as HTMLElement).getByText('No activo')).toBeInTheDocument();
    expect(within(ewm.querySelector('[data-channel="uso"]') as HTMLElement).getByText('No activo')).toBeInTheDocument();
    expect(within(ewm.querySelector('[data-channel="suspension"]') as HTMLElement).getByText('No disponible')).toBeInTheDocument();
    expect(within(ewm).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute('href', '/apps/ewm');
  });

  it('abrir la pantalla no verifica nada; «Verificar ahora» invoca CHECK_HEALTH del destino', async () => {
    renderPage();
    expect(checkHealth).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar ahora EWM' }));
    expect(checkHealth).toHaveBeenCalledWith('t-ewm');
  });

  it('sin permiso de lectura de entornos no se ofrece «Verificar ahora»', () => {
    state.canForProduct = (code) => code !== 'platform.deployment.read';
    renderPage();
    expect(screen.queryByRole('button', { name: /Verificar ahora/ })).not.toBeInTheDocument();
  });
});

describe('matriz cuenta × app', () => {
  it('tenant PENDING con alta ACTIVE: «pendiente de confirmar», con aviso; el ACTIVE se ve activo', () => {
    renderPage();
    expect(document.querySelector('[data-pending-confirm-notice]')).not.toBeNull();
    const acme = screen.getByRole('button', { name: /^Acme en EWM: Activo en la app · pendiente de confirmar en MasterAdmin/ });
    expect(acme).toHaveAttribute('data-cell-kind', 'PENDING_CONFIRM');
    expect(within(acme).getByText('Por confirmar')).toBeInTheDocument();
    expect(within(acme).getByText(/Contrato: Activa/)).toBeInTheDocument();
    expect(within(acme).getByText(/Módulos: no activo · Uso: no activo/)).toBeInTheDocument();
    const beta = screen.getByRole('button', { name: /^Beta en TMS: Activo\./ });
    expect(beta).toHaveAttribute('data-cell-kind', 'ACTIVE');
  });

  it('confirmar como activo pide confirmación y sólo entonces llama a set_tenant_status', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Acme en EWM/ }));
    const drawer = screen.getByRole('dialog', { name: 'Acme · EWM' });
    expect(within(drawer).getByRole('link', { name: 'Ver tenant' })).toHaveAttribute('href', '/tenants/tn-acme');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Confirmar como activo' }));
    expect(setStatus).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Confirmar el tenant como activo' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Confirmar como activo' }));
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ p_tenant_id: 'tn-acme', p_status: 'ACTIVE' }));
  });

  it('alta fallida: «Reintentar alta» con permiso de ejecución', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Gama en EWM: Alta fallida/ }));
    const drawer = screen.getByRole('dialog', { name: 'Gama · EWM' });
    expect(within(drawer).getByText('El producto no respondió a tiempo')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Reintentar alta' }));
    expect(retry).toHaveBeenCalledWith({ p_request_id: 'r-gama' });
  });

  it('suspender exige motivo y usa request_tenant_suspension', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Beta en TMS/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Beta · TMS' })).getByRole('button', { name: 'Suspender' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender Beta TMS' });
    // Vista previa del impacto: la app, el tenant, los usuarios y el aviso honesto del canal.
    expect(within(dialog).getByText('La app aún no aplica la suspensión: canal pendiente.')).toBeInTheDocument();
    const impact = dialog.querySelector('[data-lifecycle-impact]') as HTMLElement;
    expect(within(impact).getByText('TMS')).toBeInTheDocument();
    expect(within(impact).getByText('Beta TMS')).toBeInTheDocument();
    const users = dialog.querySelector('[data-lifecycle-users]') as HTMLElement;
    expect(within(users).getByText('Lucía Beta')).toBeInTheDocument();
    expect(within(users).queryByText('Otro')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Impago de octubre');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(suspend).toHaveBeenCalledWith({ p_tenant_id: 'tn-beta', p_reason: 'Impago de octubre' });
  });

  it('sin permisos de gestión no hay confirmar, suspender ni reintentar', async () => {
    state.canManagePlatform = false;
    state.canForProduct = () => false;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Acme en EWM/ }));
    const drawer = screen.getByRole('dialog', { name: 'Acme · EWM' });
    expect(within(drawer).queryByRole('button', { name: 'Confirmar como activo' })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Ver tenant' })).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Cerrar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Gama en EWM/ }));
    expect(screen.queryByRole('button', { name: 'Reintentar alta' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Beta en TMS/ }));
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
  });

  it('sin vista financiera no se muestra el contrato', () => {
    state.platformRole = null;
    renderPage();
    const acme = screen.getByRole('button', { name: /^Acme en EWM/ });
    expect(within(acme).queryByText(/Contrato:/)).not.toBeInTheDocument();
  });

  it('filtra por estado y por app', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Alta fallida/ }));
    expect(screen.getByRole('button', { name: /^Gama en EWM/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Acme en EWM/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Todas/ }));
    await userEvent.selectOptions(screen.getByLabelText('App'), 'tms');
    expect(screen.getByRole('button', { name: /^Beta en TMS/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Acme en EWM/ })).not.toBeInTheDocument();
  });
});
