import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/*
 * V5 · F3 · Ficha del tenant con el mismo esquema que la de la cuenta.
 * - Cabecera: app, cuenta, estado aquí, estado en la app y modo; sin códigos
 *   de infraestructura en tamaño KPI (van a «Avanzado»).
 * - Cinco pestañas y redirección de los `#hash` viejos.
 * - PENDING aquí con alta ACTIVE: el mismo aviso y la misma acción
 *   «Confirmar como activo» del Centro de la suite.
 */

const setStatus = vi.fn().mockResolvedValue(undefined);
const q = (data?: unknown) => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });

const state = vi.hoisted(() => ({
  persona: 'EBIM' as string,
  platformRole: 'EBIM_SUPER_ADMIN' as string | null,
  tenantStatus: 'PENDING' as string,
  requestStatus: 'ACTIVE' as string | null,
  canViewUsers: true,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: state.persona, roles: { platformRole: state.platformRole, organizations: [] } }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => {
    const r = state.platformRole;
    return {
      canManagePlatform: r === 'EBIM_PRODUCT_ADMIN' || r === 'EBIM_SUPER_ADMIN',
      canReadFinance: r === 'EBIM_FINANCE' || r === 'EBIM_SUPER_ADMIN',
    };
  },
}));
vi.mock('@/features/users/useUserAdminScope', () => ({ useUserAdminScope: () => ({ canView: state.canViewUsers }) }));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/services/mutations', () => ({
  useRequestTenantSuspension: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestTenantResume: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetTenantStatus: () => ({ mutateAsync: setStatus, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useTenant: () =>
    q({
      tenant_id: 'tn-1', name: 'Qhapaq EWM', slug: 'qhapaq-ewm', status: state.tenantStatus, tenant_type: 'PRODUCTION',
      deployment_mode: 'SHARED', deployment_target_code: 'ewm-shared-qas-01', deployment_provider: 'SUPABASE', deployment_region: 'sa-east-1',
      product_short_name: 'EWM', product_lockup: 'EBIM EWM', product_code: 'ewm', saas_product_id: 'p-ewm',
      customer_name: 'Qhapaq', customer_organization_id: 'o-qhapaq', managing_name: null, market_code: 'PE',
      plan_name: 'Pro', admin_email: 'admin@qhapaq.pe', admin_activated_at: null, environment: 'PRODUCTION',
      created_at: '2026-10-01T00:00:00Z', activated_at: null,
    }),
  useTenantFeatures: () => q([]),
  useTenantAttributions: () => q([]),
  useTenantProductMappings: () =>
    q(
      state.requestStatus
        ? [{ id: 'r-1', tenant_id: 'tn-1', saas_product_id: 'p-ewm', product_short_name: 'EWM', status: state.requestStatus, requested_at: '2026-10-02T00:00:00Z', attempt_count: 1, max_attempts: 3 }]
        : [],
    ),
  useProvisioningTargets: () => q([]),
  useAccountSeries: () => q([]),
}));
vi.mock('./tenantQueries', () => ({
  useTenantSubscriptions: () => q([]),
  useTenantMarginRows: () => q([]),
  useTenantInfraRequests: () => q([]),
  useTenantAudit: () => q([]),
  useTenantRenewals: () => q([]),
}));
vi.mock('@/features/organizations/AccountPanels', () => ({
  AccountMrrTile: () => <div>Tile de MRR</div>,
  AccountTrendCharts: () => <div>Tendencia de MRR</div>,
  HealthTile: () => <div>Salud de cobranza</div>,
}));
vi.mock('@/features/organizations/Account360', () => ({
  AccountUsersCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock('./TenantAddonsPanel', () => ({ TenantAddonsPanel: () => <div>Add-ons del tenant</div> }));
vi.mock('./TenantUsagePanel', () => ({ TenantUsagePanel: () => <div>Uso del tenant</div> }));

import { TenantDetailPage } from './TenantDetailPage';

function Probe() {
  const l = useLocation();
  return <output data-testid="url">{`${l.search}${l.hash}`}</output>;
}

function renderAt(url = '/tenants/tn-1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/tenants/:tenantId"
          element={
            <>
              <TenantDetailPage />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByRole('region', { name: 'Resumen del tenant' });

beforeEach(() => {
  vi.clearAllMocks();
  state.persona = 'EBIM';
  state.platformRole = 'EBIM_SUPER_ADMIN';
  state.tenantStatus = 'PENDING';
  state.requestStatus = 'ACTIVE';
  state.canViewUsers = true;
});

describe('cabecera del tenant', () => {
  it('app, cuenta, estado aquí, estado en la app y modo', () => {
    state.tenantStatus = 'ACTIVE';
    renderAt();
    const bar = header();
    const item = (label: string) => bar.querySelector(`[data-summary-item="${label}"]`) as HTMLElement;
    expect(within(item('App')).getByRole('link', { name: 'EWM' })).toHaveAttribute('href', '/apps/ewm');
    expect(within(item('Cuenta')).getByRole('link', { name: 'Qhapaq' })).toHaveAttribute('href', '/organizations/o-qhapaq');
    expect(item('Estado aquí')).toHaveTextContent('Activo');
    expect(item('Estado en la app').querySelector('[data-app-state="ACTIVE"]')).not.toBeNull();
    expect(item('Modo')).toHaveTextContent('Producción');
  });

  it('fuera de EBIM la app no enlaza a su ficha técnica', () => {
    state.persona = 'PARTNER';
    state.platformRole = null;
    renderAt();
    expect(within(header()).queryByRole('link', { name: 'EWM' })).toBeNull();
    expect(within(header()).getByText('EWM')).toBeInTheDocument();
  });

  it('sin alta registrada lo dice; no inventa un estado en la app', () => {
    state.requestStatus = null;
    renderAt();
    expect(header().querySelector('[data-summary-item="Estado en la app"]')).toHaveTextContent('Sin alta registrada');
  });

  it('los códigos de infraestructura no están en el resumen: viven en «Avanzado»', async () => {
    renderAt();
    expect(screen.queryByText('ewm-shared-qas-01')).toBeNull();
    expect(screen.queryByText('Infraestructura')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'App y alta' }));
    const advanced = document.querySelector('[data-advanced]') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(within(advanced).getByText(/Avanzado/)).toBeInTheDocument();
    expect(within(advanced).getByText('ewm-shared-qas-01')).toBeInTheDocument();
  });
});

describe('pendiente aquí con alta activa en la app', () => {
  it('muestra el aviso del Centro de la suite y confirma con la misma acción', async () => {
    renderAt();
    const box = document.querySelector('[data-tenant-pending-confirm]') as HTMLElement;
    expect(within(box).getByRole('note')).toHaveTextContent('1 tenant activo en su app pero «Pendiente» en MasterAdmin.');
    await userEvent.click(within(box).getByRole('button', { name: 'Confirmar como activo' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar como activo' }));
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ p_tenant_id: 'tn-1', p_status: 'ACTIVE' }));
  });

  it('sin permiso de plataforma se ve el aviso, pero no la acción', () => {
    state.platformRole = 'EBIM_FINANCE';
    renderAt();
    const box = document.querySelector('[data-tenant-pending-confirm]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(within(box).queryByRole('button', { name: 'Confirmar como activo' })).toBeNull();
  });

  it('activo aquí y en la app: sin aviso', () => {
    state.tenantStatus = 'ACTIVE';
    renderAt();
    expect(document.querySelector('[data-tenant-pending-confirm]')).toBeNull();
  });
});

describe('pestañas del tenant', () => {
  it('cinco pestañas: Resumen · App y alta · Contrato · Personas · Actividad', () => {
    renderAt();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Resumen', 'App y alta', 'Contrato', 'Personas', 'Actividad',
    ]);
  });

  it('reubica el contenido anterior sin perderlo', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('tab', { name: 'App y alta' }));
    expect(screen.getByRole('heading', { name: 'Alta en los productos de la suite' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Funciones habilitadas' })).toBeInTheDocument();
    expect(screen.getByText('Uso del tenant')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Contrato' }));
    expect(screen.getByRole('heading', { name: 'Contrato' })).toBeInTheDocument();
    expect(screen.getByText('Add-ons del tenant')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rentabilidad del tenant' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Personas' }));
    expect(screen.getByRole('heading', { name: 'Atribución comercial' })).toBeInTheDocument();
    expect(screen.getByText('admin@qhapaq.pe')).toBeInTheDocument();
    expect(screen.getByText('Usuarios del tenant')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Actividad' }));
    expect(screen.getByRole('heading', { name: 'Auditoría del tenant' })).toBeInTheDocument();
  });

  it.each([
    ['#features', 'App y alta', '?tab=app#features'],
    ['#products', 'App y alta', '?tab=app#products'],
    ['#deployment', 'App y alta', '?tab=app#deployment'],
    ['#subscription', 'Contrato', '?tab=contrato#subscription'],
    ['#costs', 'Contrato', '?tab=contrato#costs'],
    ['#commercial', 'Personas', '?tab=personas#commercial'],
    ['#audit', 'Actividad', '?tab=actividad#audit'],
  ])('el enlace viejo %s abre «%s»', async (hash, tab, url) => {
    renderAt(`/tenants/tn-1${hash}`);
    expect(await screen.findByRole('tab', { name: tab, selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(url);
  });

  it('#deployment abre «Avanzado» desplegado', async () => {
    renderAt('/tenants/tn-1#deployment');
    await screen.findByRole('tab', { name: 'App y alta', selected: true });
    expect((document.querySelector('[data-advanced]') as HTMLDetailsElement).open).toBe(true);
  });
});

describe('permisos del tenant', () => {
  it('sin vista financiera (técnico EBIM): ni MRR ni margen', async () => {
    state.platformRole = null;
    renderAt();
    expect(screen.queryByText('Tile de MRR')).toBeNull();
    expect(screen.queryByText('Tendencia de MRR')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Contrato' }));
    expect(screen.queryByRole('heading', { name: 'Rentabilidad del tenant' })).toBeNull();
  });

  it('el cliente ve su MRR pero no el margen ni la gestión de usuarios si no la tiene', async () => {
    state.persona = 'TENANT';
    state.platformRole = null;
    state.canViewUsers = false;
    renderAt();
    expect(screen.getByText('Tile de MRR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Contrato' }));
    expect(screen.queryByRole('heading', { name: 'Rentabilidad del tenant' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Personas' }));
    expect(screen.queryByText('Usuarios del tenant')).toBeNull();
  });

  it('suspender sólo con permiso de plataforma', () => {
    state.tenantStatus = 'ACTIVE';
    renderAt();
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeInTheDocument();
  });
});
