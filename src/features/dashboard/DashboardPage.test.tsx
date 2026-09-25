import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';

/*
 * P16 · Inicio ejecutivo (spec §7, K01–K06, AC11, AC13).
 * Las consultas se simulan: aquí se prueba la PRESENTACIÓN y el permiso de vista.
 */
type Q = { data?: unknown; error?: unknown; isLoading?: boolean; refetch: () => void; dataUpdatedAt?: number };
const q = (data?: unknown, error?: unknown): Q => ({ data, error, isLoading: data === undefined && !error, refetch: vi.fn(), dataUpdatedAt: 1 });

const state = vi.hoisted(() => ({
  persona: 'EBIM' as string,
  roles: null as unknown,
  consolidated: null as unknown,
  consolidatedError: null as unknown,
  healthCalls: 0,
}));

const group = {
  key: 'TOTAL', label: 'Total',
  metrics: {
    MRR: { native: { PEN: 3150, USD: 28800 }, reporting_amount: null, complete: false, missing_currencies: ['BOB'] },
    ARR: { native: { PEN: 37800, USD: 345600 }, reporting_amount: null, complete: false, missing_currencies: ['BOB'] },
    COLLECTED: { native: { USD: 1000 }, reporting_amount: 1000, complete: true, missing_currencies: [] },
    COST: { native: { USD: 300 }, reporting_amount: 300, complete: true, missing_currencies: [] },
    COMMISSION: { native: { USD: 50 }, reporting_amount: 50, complete: true, missing_currencies: [] },
  },
  native_margin: { USD: 650 },
  margin: { reporting_amount: 650, complete: true },
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ persona: state.persona, roles: state.roles }) }));
vi.mock('@/services/queries', () => ({
  useFinanceConsolidated: () =>
    state.consolidatedError ? q(undefined, state.consolidatedError) : q(state.consolidated ?? { reporting_currency: 'USD', groups: [group], completeness: { complete: false, missing_fx_count: 1, missing_currencies: ['BOB'] }, rates_used: [] }),
  useProducts: () => q([{ id: 'p1', short_name: 'eSupplier', status: 'ACTIVE' }, { id: 'p2', short_name: 'EWM', status: 'ACTIVE' }]),
  useBillingAlerts: () => q([]),
  useSubscriptionDocumentStatus: () => q([]),
  useSaasProvisioningRequests: () => q([]),
  useDashboardSummary: () => q({ provisioning_failures: 0 }),
  useProvisioningTargets: () => q([
    { deployment_target_id: 't1', saas_product_id: 'p2', code: 'ewm-qas', provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY', health_status: 'HEALTHY', health_checked_at: '2026-09-25T06:00:00Z', integration_code: 'ewm', integration_status: 'READY', integration_enabled: true },
    { deployment_target_id: 't2', saas_product_id: 'p2', code: 'ewm-prd', provisioning_environment: null, provisioning_enabled: false, provisioning_status: 'DRAFT', health_status: 'UNKNOWN', health_checked_at: null },
  ]),
  useAttributions: () => q([]),
  usePartnerMargin: () => q([]),
  useTenantOverview: () => q([]),
  useMarkets: () => q([]),
  useCurrencies: () => q([]),
  useOrganizations: () => q([]),
  // Si alguna vista llamara a una verificación de salud, lo registraríamos aquí.
  useCheckDeploymentHealth: () => { state.healthCalls += 1; return { mutate: vi.fn() }; },
}));
vi.mock('@/services/financeRead', () => ({
  useCollectionsByMonth: () => q([{ month: '2026-09-01', currency: 'USD', amount: 1000, payment_count: 2 }, { month: '2026-08-01', currency: 'USD', amount: 0, payment_count: 0 }]),
  useInvoiceSummary: () => q({ row_count: 3, status_counts: {}, invoiced: { USD: 5000 }, collected: { USD: 1000 }, receivable: { USD: '-15.00', PEN: '200.00' }, overdue: { PEN: '200.00' }, observed_at: '' }),
  useReceivablesAging: () => q([{ currency: 'PEN', aging_bucket: 'D31_60', invoice_count: 1, balance: 200 }]),
  useRenewalPipeline: () => q([{ subscription_id: 's1', days_to_renewal: 5, current_mrr: 100, currency: 'USD' }]),
  useCommissionSummary: () => q({ row_count: 0, by_status: {}, pending: {}, paid: {} }),
}));
// Recharts no se dibuja en jsdom (sin layout); el gráfico se prueba por su tabla.
vi.mock('@/features/executive/components/charts', () => ({ SingleBars: () => <div data-testid="chart" />, ComponentBars: () => <div data-testid="chart" /> }));

import { DashboardPage } from './DashboardPage';

const superAdmin: SessionRoles = { userId: 'u', email: 'a@ebim.pe', fullName: 'A', platformRole: 'EBIM_SUPER_ADMIN', organizations: [], tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [] };

function renderHome() {
  return render(<MemoryRouter initialEntries={['/?mes=2026-09&fx=2026-09-25']}><DashboardPage /></MemoryRouter>);
}

beforeEach(() => {
  state.persona = 'EBIM';
  state.roles = superAdmin;
  state.consolidated = null;
  state.consolidatedError = null;
  state.healthCalls = 0;
  window.location.hash = '';
});

describe('Resumen ejecutivo', () => {
  it('muestra exactamente seis KPI principales, no diecinueve tarjetas', () => {
    const { container } = renderHome();
    expect(container.querySelectorAll('[data-kpi]')).toHaveLength(6);
    for (const k of ['K01', 'K02', 'K03', 'K04', 'K05', 'K06']) expect(container.querySelector(`[data-kpi="${k}"]`)).not.toBeNull();
  });

  it('MRR es foto actual y no suma monedas', () => {
    const { container } = renderHome();
    const k01 = container.querySelector('[data-kpi="K01"]') as HTMLElement;
    expect(within(k01).getByText('Foto actual')).toBeInTheDocument();
    expect(k01).toHaveTextContent('PEN');
    expect(k01).toHaveTextContent('USD');
  });

  it('saldo negativo por sobrepago se conserva', () => {
    const { container } = renderHome();
    expect(container.querySelector('[data-kpi="K03"]')).toHaveTextContent('-USD');
  });

  it('mes en curso rotulado parcial y sin comparación engañosa', () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 25), toFake: ['Date'] });
    const { container } = renderHome();
    const k02 = container.querySelector('[data-kpi="K02"]') as HTMLElement;
    expect(k02).toHaveTextContent('parcial');
    expect(k02).not.toHaveTextContent('%');
    vi.useRealTimers();
  });

  it('si el consolidado falla, el margen es error explícito, no un cero', () => {
    state.consolidatedError = new Error('timeout de lectura');
    const { container } = renderHome();
    const k05 = container.querySelector('[data-kpi="K05"]') as HTMLElement;
    expect(within(k05).getByRole('alert')).toHaveTextContent('No se pudo leer');
    expect(k05).not.toHaveTextContent('USD 0');
  });

  it('la cartera vencida abre exactamente su detalle', () => {
    const { container } = renderHome();
    const link = within(container.querySelector('[data-kpi="K04"]') as HTMLElement).getByRole('link');
    expect(link).toHaveAttribute('href', '/billing?estado=OPEN&antiguedad=VENCIDA');
  });
});

describe('Perspectivas y permisos', () => {
  it('un usuario técnico EBIM sólo ve Operación SaaS, sin KPI financieros', () => {
    state.roles = { ...superAdmin, platformRole: null, ownedProductIds: ['p2'] };
    const { container } = renderHome();
    expect(screen.getByRole('heading', { name: 'Resumen de operación SaaS' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-kpi]')).toHaveLength(0);
  });

  it('operación: destino deshabilitado «No evaluado», salud fechada y sin llamadas de salud', () => {
    window.location.hash = '#operacion';
    renderHome();
    expect(screen.getByText('No evaluado')).toBeInTheDocument();
    expect(screen.getByText(/observado/)).toBeInTheDocument();
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
    expect(screen.queryByText(/8\/8/)).not.toBeInTheDocument();
    expect(state.healthCalls).toBe(0);
  });
});
