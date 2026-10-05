import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import { lastMonths } from '@/features/executive/reportContext';
import { formatDate } from '@/lib/format';

/*
 * Resumen ejecutivo V4 (fase 09, D-V05) y perspectivas.
 * Las consultas se simulan: aquí se prueba la PRESENTACIÓN (qué cifra, qué
 * estado, a dónde lleva cada clic) y el permiso de vista. Las cifras vienen ya
 * en moneda de reporte desde la base (S01–S08).
 */
type Q = { data?: unknown; error?: unknown; isLoading?: boolean; refetch: () => void; dataUpdatedAt?: number };
const q = (data?: unknown, error?: unknown): Q => ({ data, error, isLoading: data === undefined && !error, refetch: vi.fn(), dataUpdatedAt: 1 });

const state = vi.hoisted(() => ({
  persona: 'EBIM' as string,
  roles: null as unknown,
  consolidated: null as unknown,
  consolidatedError: null as unknown,
  healthCalls: 0,
  seriesMissing: false,
  billingError: null as unknown,
  customers: undefined as unknown,
  movementsEmpty: false,
  alertsError: null as unknown,
}));

// Meses de la demo: may 25 → oct 26 (mes en curso, parcial). Hoy = 5 oct 2026.
const TODAY = new Date(2026, 9, 5);
const MONTHS = lastMonths('2026-10', 24);
const idx = (m: string) => MONTHS.indexOf(m);

function seriesPoint(m: string) {
  const i = idx(m);
  const mrr = 30000 + i * 1000; // sep 26 = 52 000; ago 26 = 51 000
  const missing = state.seriesMissing && m === '2026-09';
  return {
    month: `${m}-01`, asOf: `${m}-28`, isPartial: m === '2026-10', reportingCurrency: 'USD',
    mrr: missing ? null : mrr, arr: missing ? null : mrr * 12,
    activeCustomers: 20 + i, activeSubscriptions: 30 + i,
    native: { USD: mrr - 5000, PEN: 20000 }, complete: !missing, missingCurrencies: missing ? ['BOB'] : [], fxIsDemo: true,
  };
}

function billingPoint(m: string) {
  const i = idx(m);
  return {
    month: `${m}-01`, asOf: `${m}-28`, isPartial: m === '2026-10', reportingCurrency: 'USD',
    invoiced: 40000 + i * 500, collected: m === '2026-10' ? 9000 : 38000 + i * 500, collectionRate: 0.95,
    overdue: 20000 + i * 1000, // la vencida SUBE mes a mes
    invoiceCount: 40, paymentCount: 38, overdueInvoiceCount: 12,
    invoicedNative: { USD: 40000 }, collectedNative: { USD: 38000 }, complete: true, missingCurrencies: [], fxIsDemo: true,
  };
}

function bridge(m: string) {
  return {
    month: `${m}-01`, asOf: `${m}-28`, reportingCurrency: 'USD',
    opening: 50000, newMrr: 800, expansion: 1700, contraction: 200, churn: 300, closing: 52000,
    priorClosing: 50000, fxRevaluation: 0, newCustomers: 1, expansionCustomers: 1, contractionCustomers: 1, churnedCustomers: 1, complete: true,
  };
}

const CUSTOMERS = [
  { organizationId: 'o1', organizationName: 'Minera Cordillera', movement: 'EXPANSION', opening: 4000, closing: 5700, delta: 1700, complete: true },
  { organizationId: 'o2', organizationName: 'Transportes Sajama', movement: 'FLAT', opening: 4600, closing: 4600, delta: 0, complete: true },
  { organizationId: 'o3', organizationName: 'Nueva Andina SA', movement: 'NEW', opening: 0, closing: 800, delta: 800, complete: true },
  { organizationId: 'o4', organizationName: 'Baja SRL', movement: 'CHURN', opening: 300, closing: 0, delta: -300, complete: true },
  { organizationId: 'o5', organizationName: 'Recorte SAC', movement: 'CONTRACTION', opening: 1200, closing: 1000, delta: -200, complete: true },
];

const mixRow = (key: string, label: string, mrr: number, share: number) => ({
  key, label, mrr, share, activeCustomers: 3, activeSubscriptions: 4, native: { USD: mrr }, complete: true, missingCurrencies: [],
});
const MIX = {
  PRODUCT: [mixRow('p1', 'eSupplier', 12000, 0.6), mixRow('p2', 'EWM', 8000, 0.4)],
  MARKET: [mixRow('PE', 'Perú', 15000, 0.75), mixRow('BO', 'Bolivia', 5000, 0.25)],
  PARTNER: [mixRow('DIRECTO', 'Venta directa', 14000, 0.7), mixRow('org-andes', 'Andes Digital Partners', 6000, 0.3)],
};

const AGING = {
  asOf: '2026-09-30', reportingCurrency: 'USD', complete: true, fxIsDemo: true,
  buckets: [
    ['VIGENTE', 10, 9000], ['D1_30', 5, 4000], ['D31_60', 2, 1500], ['D61_90', 1, 500], ['D90_MAS', 3, 2000], ['SIN_FECHA', 0, 0],
  ].map(([bucket, invoiceCount, balance]) => ({ bucket, invoiceCount, balance, native: { USD: balance }, complete: true, missingCurrencies: [] })),
};

const group = {
  key: 'TOTAL', label: 'Total',
  metrics: {
    MRR: { native: { PEN: 3150, USD: 28800 }, reporting_amount: null, complete: false, missing_currencies: ['BOB'] },
    COLLECTED: { native: { USD: 1000 }, reporting_amount: 1000, complete: true, missing_currencies: [] },
    COST: { native: { USD: 300 }, reporting_amount: 300, complete: true, missing_currencies: [] },
    COMMISSION: { native: { USD: 50 }, reporting_amount: 50, complete: true, missing_currencies: [] },
  },
  native_margin: { USD: -650 },
  margin: { reporting_amount: -650, complete: true },
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ persona: state.persona, roles: state.roles }) }));
vi.mock('@/services/queries', () => ({
  useFinanceConsolidated: () =>
    state.consolidatedError ? q(undefined, state.consolidatedError) : q(state.consolidated ?? { reporting_currency: 'USD', groups: [group], completeness: { complete: true, missing_fx_count: 0, missing_currencies: [] }, rates_used: [] }),
  useExecutiveMrrSeries: () => q(MONTHS.map(seriesPoint)),
  useExecutiveBillingSeries: () => (state.billingError ? q(undefined, state.billingError) : q(MONTHS.slice(-12).map(billingPoint))),
  useExecutiveMrrMovementsSeries: () => q(state.movementsEmpty ? [] : MONTHS.slice(-13).map(bridge)),
  useExecutiveMrrMovementCustomers: () => q(state.customers === undefined ? CUSTOMERS : state.customers),
  useExecutiveMrrMix: (dim: 'PRODUCT' | 'MARKET' | 'PARTNER') => q(MIX[dim]),
  useExecutiveAging: () => q(AGING),
  useCurrencies: () => q([{ code: 'USD', status: 'ACTIVE' }, { code: 'PEN', status: 'ACTIVE' }, { code: 'BOB', status: 'ACTIVE' }]),
  useProducts: () => q([{ id: 'p1', short_name: 'eSupplier', status: 'ACTIVE' }, { id: 'p2', short_name: 'EWM', status: 'ACTIVE' }]),
  useBillingAlerts: () =>
    state.alertsError
      ? q(undefined, state.alertsError)
      : q([{ alert_type: 'RENEWAL_NOTICE' }, { alert_type: 'RENEWAL_NOTICE' }, { alert_type: 'PAYMENT_FAILURE' }, { alert_type: 'SUSPENSION_DUE' }]),
  useSettlements: () => q([{ status: 'OPEN' }, { status: 'PAID' }]),
  usePartnerFeeStatements: () => q([{ status: 'DRAFT' }]),
  useSubscriptionDocumentStatus: () => q([]),
  useSaasProvisioningRequests: () => q([]),
  useDashboardSummary: () => q({ provisioning_failures: 0 }),
  useProvisioningTargets: () => q([
    { deployment_target_id: 't1', saas_product_id: 'p2', code: 'ewm-qas', provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY', health_status: 'HEALTHY', health_checked_at: '2026-09-25T06:00:00Z', integration_code: 'ewm', integration_status: 'READY', integration_enabled: true },
    { deployment_target_id: 't2', saas_product_id: 'p2', code: 'ewm-prd', provisioning_environment: null, provisioning_enabled: false, provisioning_status: 'DRAFT', health_status: 'UNKNOWN', health_checked_at: null },
  ]),
  useAttributions: () => q([]),
  usePartnerMargin: () => q([]),
  useTenantOverview: () => q([{ tenant_id: 't1', status: 'ACTIVE' }]),
  useMarkets: () => q([]),
  useOrganizations: () => q([]),
  // Si alguna vista llamara a una verificación de salud, lo registraríamos aquí.
  useCheckDeploymentHealth: () => { state.healthCalls += 1; return { mutate: vi.fn() }; },
}));
vi.mock('@/features/dashboard/RegionalFinancePanel', () => ({ RegionalFinancePanel: () => null }));
vi.mock('@/services/financeRead', () => ({
  useCollectionsByMonth: () => q([{ month: '2026-09-01', currency: 'USD', amount: 1000, payment_count: 2 }]),
  useInvoiceSummary: () => q({ row_count: 3, status_counts: {}, invoiced: { USD: 5000 }, collected: { USD: 1000 }, receivable: { USD: '-15.00', PEN: '200.00' }, overdue: { PEN: '200.00' }, observed_at: '' }),
  useReceivablesAging: () => q([{ currency: 'PEN', aging_bucket: 'D31_60', invoice_count: 1, balance: 200 }]),
  useRenewalPipeline: () => q([]),
  useCommissionSummary: () => q({ row_count: 0, by_status: {}, pending: {}, paid: {} }),
}));
// Recharts no se dibuja en jsdom (sin layout): los gráficos se prueban por su tabla y sus controles.
vi.mock('@/features/executive/components/charts', () => ({ SingleBars: () => <div data-testid="chart" />, ComponentBars: () => <div data-testid="chart" /> }));
vi.mock('@/features/executive/components/executiveCharts', () => ({
  MrrEvolutionChart: () => <div data-testid="chart-mrr" />,
  BridgeWaterfall: () => <div data-testid="chart-bridge" />,
  BilledCollectedChart: () => <div data-testid="chart-billed" />,
}));

import { DashboardPage } from './DashboardPage';

const superAdmin: SessionRoles = { userId: 'u', email: 'a@ebim.pe', fullName: 'A', platformRole: 'EBIM_SUPER_ADMIN', organizations: [], tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [] };

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}${loc.hash}`}</p>;
}

function renderHome(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tile = (container: HTMLElement, label: string) => {
  const hero = container.querySelector('[data-hero]') as HTMLElement;
  return [...hero.children].find((c) => c.textContent?.includes(label)) as HTMLElement;
};
const panel = (container: HTMLElement, id: string) => container.querySelector(`[data-panel="${id}"]`) as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ now: TODAY, toFake: ['Date'] });
  Object.assign(state, {
    persona: 'EBIM', roles: superAdmin, consolidated: null, consolidatedError: null, healthCalls: 0,
    seriesMissing: false, billingError: null, customers: undefined, movementsEmpty: false, alertsError: null,
  });
  window.location.hash = '';
});
afterEach(() => vi.useRealTimers());

describe('Resumen ejecutivo · franja hero', () => {
  it('seis KPI en moneda de reporte, del último mes CERRADO, con tendencia de 12 meses', () => {
    const { container } = renderHome();
    const hero = container.querySelector('[data-hero]') as HTMLElement;
    expect(hero.children).toHaveLength(6);
    for (const label of ['MRR', 'ARR', 'Cobrado del mes', 'Cartera vencida', 'Clientes activos', 'Retención neta (NRR)']) {
      expect(tile(container, label)).toBeDefined();
    }
    expect(screen.getByLabelText('Mes analizado')).toHaveValue('2026-09');
    // sep 26: MRR 52 000 → «USD 52.0 K», una sola cifra protagonista (no tres monedas apiladas, A02).
    const mrr = tile(container, 'MRR');
    expect(mrr).toHaveTextContent('USD52.0 K');
    expect(mrr).toHaveTextContent('+2.0%');
    expect(within(mrr).getByTestId('sparkline')).toBeInTheDocument();
    expect(tile(container, 'ARR')).toHaveTextContent('624.0 K');
    // NRR = (50 000 + 1 700 − 200 − 300) / 50 000 = 102.4 %
    expect(tile(container, 'Retención neta')).toHaveTextContent('102.4%');
  });

  it('la cartera vencida que sube se pinta como mala noticia y abre su detalle', () => {
    const { container } = renderHome();
    const overdue = tile(container, 'Cartera vencida');
    const delta = within(overdue).getByText('+2.4%'); // 42 000 vs 41 000
    expect(delta.closest('span')).toHaveClass('text-danger');
    expect(overdue.closest('a') ?? overdue).toHaveAttribute('href', '/billing?estado=OPEN&antiguedad=VENCIDA');
  });

  it('mes en curso: rotulado parcial y el cobrado no se compara con un mes completo', () => {
    const { container } = renderHome('/?cierre=2026-10');
    expect(screen.getByText('Mes en curso: cifras parciales')).toBeInTheDocument();
    const collected = tile(container, 'Cobrado en el mes');
    expect(collected).toHaveTextContent('parcial');
    expect(collected).not.toHaveTextContent('vs sep');
  });

  it('si falta una tasa, el MRR se rotula sin tasa y nunca se pinta como cero', () => {
    state.seriesMissing = true;
    const { container } = renderHome();
    const mrr = tile(container, 'MRR');
    expect(mrr).toHaveTextContent('—');
    expect(mrr).toHaveTextContent('Sin tasa para BOB');
    expect(mrr).not.toHaveTextContent('USD0');
    expect(within(screen.getByRole('list', { name: 'Notas del reporte' })).getByText(/Parcial: falta tasa BOB/)).toBeInTheDocument();
  });
});

describe('Resumen ejecutivo · paneles', () => {
  it('un panel que falla no tumba el tablero: error propio y el resto sigue', () => {
    state.billingError = new Error('timeout de lectura');
    const { container } = renderHome();
    expect(within(tile(container, 'Cobrado del mes')).getByRole('alert')).toHaveTextContent('No disponible');
    expect(within(panel(container, 'facturado-cobrado')).getByRole('alert')).toHaveTextContent('No se pudo leer');
    expect(panel(container, 'facturado-cobrado')).not.toHaveTextContent('USD 0');
    // Otras fuentes siguen visibles.
    expect(tile(container, 'MRR')).toHaveTextContent('52.0 K');
    expect(within(panel(container, 'top-clientes')).getByText('Minera Cordillera')).toBeInTheDocument();
  });

  it('puente: clic en un movimiento lista los clientes que lo componen, con enlace a su ficha', () => {
    const { container } = renderHome();
    const bridgePanel = panel(container, 'puente');
    expect(bridgePanel).toHaveTextContent('USD 50.0 K');
    expect(bridgePanel).toHaveTextContent('+4.0%');
    fireEvent.click(within(bridgePanel).getByRole('button', { name: /Churn/ }));
    const list = within(bridgePanel).getByTestId('bridge-customers');
    expect(list).toHaveTextContent('Churn: 1 cliente');
    expect(within(list).getByRole('link', { name: 'Baja SRL' })).toHaveAttribute('href', '/organizations/o4');
    expect(list).toHaveTextContent('−USD 300.00');
  });

  it('elegir un mes en la evolución lo vuelve el mes analizado de todo el tablero', () => {
    const { container } = renderHome();
    const evo = panel(container, 'evolucion-mrr');
    fireEvent.click(within(evo).getByRole('button', { name: /Tabla/ }));
    fireEvent.click(within(evo).getByRole('button', { name: 'ago 26' }));
    expect(screen.getByLabelText('Mes analizado')).toHaveValue('2026-08');
    expect(tile(container, 'MRR')).toHaveTextContent('51.0 K');
  });

  it('facturado vs cobrado: un mes lleva a Facturación con ese rango', () => {
    const { container } = renderHome();
    const billed = panel(container, 'facturado-cobrado');
    fireEvent.click(within(billed).getByRole('button', { name: /Tabla/ }));
    fireEvent.click(within(billed).getByRole('button', { name: 'jul 26' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/billing?desde=2026-07-01&hasta=2026-07-31#cobros');
  });

  it('cartera por antigüedad: cada tramo abre Facturación filtrada', () => {
    const { container } = renderHome();
    const aging = panel(container, 'antiguedad');
    expect(aging).toHaveTextContent('8.0 K'); // 4 000 + 1 500 + 500 + 2 000
    expect(within(aging).getByRole('link', { name: /Más de 90 días/ })).toHaveAttribute('href', '/billing?estado=OPEN&antiguedad=D90_MAS');
  });

  it('mix, tops y partners enlazan al detalle existente; venta directa no compite como partner', () => {
    const { container } = renderHome();
    expect(within(panel(container, 'mix-producto')).getByRole('link', { name: /eSupplier/ })).toHaveAttribute('href', '/products/p1');
    const top = panel(container, 'top-clientes');
    const first = within(top).getAllByRole('link')[0]!;
    expect(first).toHaveTextContent('Minera Cordillera');
    expect(first).toHaveAttribute('href', '/organizations/o1');
    const partners = panel(container, 'top-partners');
    expect(within(partners).getByRole('link', { name: /Andes Digital Partners/ })).toHaveAttribute('href', '/organizations/org-andes');
    expect(partners).toHaveTextContent('Venta directa: USD 14.0 K (70% del MRR)');
  });

  it('vacío: sin clientes con MRR se dice, no se dibuja una lista vacía', () => {
    state.customers = [];
    const { container } = renderHome();
    expect(panel(container, 'top-clientes')).toHaveTextContent('Sin clientes con MRR al cierre del mes');
  });

  it('requiere atención: cada frente con conteo y acción; cero = resuelto; fuente caída = sin conteo', () => {
    const { container } = renderHome();
    const att = panel(container, 'atencion');
    expect(att.querySelector('[data-attention="collections"]')).toHaveTextContent('2');
    expect(att.querySelector('[data-attention="settlements"]')).toHaveAttribute('href', '/commissions#settlements');
    expect(att.querySelector('[data-attention="suspended"]')).toHaveTextContent('Sin pendientes');
  });

  it('una fuente de atención caída no se muestra como cero', () => {
    state.alertsError = new Error('caída');
    const { container } = renderHome();
    const renewals = panel(container, 'atencion').querySelector('[data-attention="renewals"]') as HTMLElement;
    expect(renewals).toHaveTextContent('No se pudo leer');
    expect(renewals).toHaveTextContent('—');
  });
});

describe('Perspectivas y permisos', () => {
  it('Finanzas: KPI con skeleton/estado propio; margen de mes en curso explicado, no gritado (A04)', () => {
    vi.setSystemTime(new Date(2026, 8, 25));
    window.location.hash = '#finanzas';
    renderHome('/?mes=2026-09&fx=2026-09-25');
    const kpis = screen.getByRole('region', { name: 'Indicadores de finanzas' });
    expect(kpis).toHaveTextContent('Mes en curso: cobros y costos aún incompletos');
    expect(kpis).toHaveTextContent('−650');
  });

  it('Finanzas: si el consolidado falla, el margen es error explícito, no un cero', () => {
    state.consolidatedError = new Error('timeout de lectura');
    window.location.hash = '#finanzas';
    renderHome('/?mes=2026-09&fx=2026-09-25');
    const kpis = screen.getByRole('region', { name: 'Indicadores de finanzas' });
    expect(within(kpis).getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
    expect(kpis).not.toHaveTextContent('USD0');
  });

  it('un usuario técnico EBIM sólo ve Operación SaaS, sin KPI financieros', () => {
    state.roles = { ...superAdmin, platformRole: null, ownedProductIds: ['p2'] };
    const { container } = renderHome();
    expect(screen.getByRole('heading', { name: 'Resumen de operación SaaS' })).toBeInTheDocument();
    expect(container.querySelector('[data-hero]')).toBeNull();
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

describe('Modo presentación (fase 14)', () => {
  const deck = () => screen.getByRole('region', { name: 'Presentación del resumen ejecutivo' });
  const slideId = () => document.querySelector('[data-slide]')?.getAttribute('data-slide');
  const where = () => document.querySelector('[data-testid="where"]');

  it('se activa con ?presentacion=1: sin pestañas ni filtros, cabecera con fecha de corte y moneda', () => {
    renderHome('/?presentacion=1');
    expect(deck()).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Resumen ejecutivo' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Finanzas' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mes analizado')).not.toBeInTheDocument();
    expect(slideId()).toBe('kpis');
    expect(screen.getByRole('group', { name: '1 de 6: Indicadores clave' })).toBeInTheDocument();
    // Fecha de corte = cierre del mes analizado (último cerrado) y moneda de reporte.
    const header = within(deck()).getAllByRole('banner')[0]!;
    expect(header).toHaveTextContent(`Datos al${formatDate('2026-09-30')}`);
    expect(header).toHaveTextContent('Moneda de reporteUSD');
    expect(header).toHaveTextContent(/Mes analizadose(p)?tiembre 2026/);
    expect(document.documentElement).toHaveClass('ebim-presenting');
    expect(document.activeElement).toBe(deck());
  });

  it('«Presentar» solo lo ve el personal EBIM y abre la presentación conservando los filtros', () => {
    renderHome('/?moneda=USD&cierre=2026-08');
    fireEvent.click(screen.getByRole('button', { name: /Presentar/ }));
    expect(deck()).toBeInTheDocument();
    expect(within(deck()).getAllByRole('banner')[0]).toHaveTextContent('Mes analizadoagosto 2026');
  });

  it('un partner con ?presentacion=1 sigue en su tablero (el parámetro no abre nada)', () => {
    state.persona = 'PARTNER';
    state.roles = { ...superAdmin, platformRole: null };
    renderHome('/?presentacion=1');
    expect(screen.queryByRole('region', { name: 'Presentación del resumen ejecutivo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Presentar/ })).not.toBeInTheDocument();
  });

  it('teclado: flechas, espacio, Inicio/Fin y números; Esc sale y devuelve el foco a «Presentar»', () => {
    renderHome('/?presentacion=1');
    const key = (k: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(document.activeElement ?? window, { key: k, ...extra });
    key('ArrowRight');
    expect(slideId()).toBe('mrr');
    key(' ');
    expect(slideId()).toBe('puente');
    key('ArrowLeft');
    expect(slideId()).toBe('mrr');
    key('End');
    expect(slideId()).toBe('tops');
    key('ArrowRight'); // en la última no da la vuelta
    expect(slideId()).toBe('tops');
    key('Home');
    expect(slideId()).toBe('kpis');
    key('4');
    expect(slideId()).toBe('cobranza');
    expect(screen.getByText('Diapositiva 4 de 6: Facturado vs cobrado y cartera')).toBeInTheDocument();
    key('Escape');
    expect(screen.queryByRole('region', { name: 'Presentación del resumen ejecutivo' })).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('ebim-presenting');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Presentar/ }));
  });

  it('el espacio sobre un botón lo activa y no cambia de diapositiva; los puntos saltan a cada una', () => {
    renderHome('/?presentacion=1&diapositiva=2');
    const auto = screen.getByRole('button', { name: 'Automático' });
    auto.focus();
    fireEvent.keyDown(auto, { key: ' ' });
    expect(slideId()).toBe('mrr');
    fireEvent.click(screen.getByRole('button', { name: 'Ir a la diapositiva 5: Mix por producto y mercado' }));
    expect(slideId()).toBe('mix');
    expect(screen.getByRole('button', { name: 'Ir a la diapositiva 5: Mix por producto y mercado' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Diapositiva siguiente' })).toBeEnabled();
  });

  it('reproducción automática: avanza cada 20 s y tras la última vuelve a la primera', () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: TODAY, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    renderHome('/?presentacion=1&diapositiva=5');
    fireEvent.click(screen.getByRole('button', { name: 'Automático' }));
    expect(screen.getByRole('button', { name: 'Automático' })).toHaveAttribute('aria-pressed', 'true');
    act(() => vi.advanceTimersByTime(19_000));
    expect(slideId()).toBe('mix');
    act(() => vi.advanceTimersByTime(1_000));
    expect(slideId()).toBe('tops');
    act(() => vi.advanceTimersByTime(20_000));
    expect(slideId()).toBe('kpis');
  });

  it('ocultar nombres: clientes y partners pasan a «Cliente A…/Partner A…» por importe y sin enlace a su ficha', () => {
    renderHome('/?presentacion=1&diapositiva=6');
    const tops = () => deck().querySelector('[data-panel="top-clientes"]') as HTMLElement;
    expect(within(tops()).getByText('Minera Cordillera')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar nombres' }));
    expect(screen.getByRole('button', { name: 'Ocultar nombres' })).toHaveAttribute('aria-pressed', 'true');
    for (const real of ['Minera Cordillera', 'Transportes Sajama', 'Nueva Andina SA', 'Recorte SAC', 'Andes Digital Partners']) {
      expect(deck()).not.toHaveTextContent(real);
    }
    // Orden por MRR al cierre: Minera 5 700 → A, Sajama 4 600 → B, Recorte 1 000 → C, Nueva Andina 800 → D.
    const rows = [...tops().querySelectorAll('[data-ranked-row]')].map((r) => r.textContent);
    expect(rows[0]).toContain('Cliente A');
    expect(rows[1]).toContain('Cliente B');
    expect(rows[2]).toContain('Cliente C');
    expect(rows[3]).toContain('Cliente D');
    expect(within(tops()).queryAllByRole('link', { name: /Cliente/ })).toHaveLength(0);
    const partners = deck().querySelector('[data-panel="top-partners"]') as HTMLElement;
    expect(partners).toHaveTextContent('Partner A');
    expect(within(deck()).getAllByRole('banner')[0]).toHaveTextContent('Nombres ocultos');
  });

  it('ocultar nombres también cubre el detalle del puente, con el mismo alias que en el top', () => {
    renderHome('/?presentacion=1&diapositiva=3&anonimo=1');
    fireEvent.click(within(deck()).getByRole('button', { name: /Expansión/ }));
    const list = screen.getByTestId('bridge-customers');
    expect(list).toHaveTextContent('Cliente A');
    expect(list).not.toHaveTextContent('Minera Cordillera');
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('imprimir dibuja las seis diapositivas (una por hoja) y luego vuelve a la actual', () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: TODAY, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderHome('/?presentacion=1&diapositiva=2');
    fireEvent.click(screen.getByRole('button', { name: /Imprimir/ }));
    expect([...document.querySelectorAll('[data-slide]')].map((s) => s.getAttribute('data-slide'))).toEqual(['kpis', 'mrr', 'puente', 'cobranza', 'mix', 'tops']);
    act(() => vi.advanceTimersByTime(400));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-slide]')).toHaveLength(1);
    expect(slideId()).toBe('mrr');
    // Ctrl/⌘+P también imprime todas, no solo la visible.
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(document.querySelectorAll('[data-slide]')).toHaveLength(6);
    print.mockRestore();
  });

  it('el tema claro se fuerza mientras se presenta y al salir vuelve el de la persona', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderHome('/?presentacion=1');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'Tema claro' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Tema claro' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    fireEvent.click(screen.getByRole('button', { name: /Salir/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(where()).toBeNull();
    document.documentElement.removeAttribute('data-theme');
  });
});
