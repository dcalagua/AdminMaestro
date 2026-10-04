import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP M4 · «Uso» (spec §5.1). Medidores, ingest, agregados, eventos, rechazos y
 * alertas. Cada acción se ofrece según el rol (UX); la RPC es la autoridad.
 */

const metersHook = vi.fn();
const capabilitiesHook = vi.fn();
const integrationsHook = vi.fn();
const credentialsHook = vi.fn();
const aggregatesHook = vi.fn();
const eventsHook = vi.fn();
const cogsHook = vi.fn();
const rejectionsHook = vi.fn();
const alertsHook = vi.fn();
const permissions = vi.fn();

const upsertMeter = vi.fn();
const setBillable = vi.fn();
const configureCredential = vi.fn();
const setIngest = vi.fn();
const finalize = vi.fn();
const toastError = vi.fn();

const mutation = (fn = vi.fn()) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/services/queries', () => ({
  USAGE_LIST_LIMIT: 500,
  useUsageMeters: () => metersHook(),
  useProductCapabilities: () => capabilitiesHook(),
  useProducts: () => ({
    data: [
      { id: 'p-ewm', code: 'ewm', short_name: 'EWM' },
      { id: 'p-esup', code: 'esupplier', short_name: 'eSupplier' },
    ],
  }),
  useTenantOverview: () => ({
    data: [
      { tenant_id: 't-alpha', name: 'Alpha Retail', slug: 'alpha', saas_product_id: 'p-ewm', product_code: 'ewm', product_short_name: 'EWM', tenant_type: 'PRODUCTION' },
    ],
  }),
  useProductIntegrations: () => integrationsHook(),
  useUsageIngestCredentials: () => credentialsHook(),
  useUsageAggregates: () => aggregatesHook(),
  useUsageEvents: (p: unknown) => eventsHook(p),
  useUsageEventCogs: (p: unknown) => cogsHook(p),
  useUsageIngestRejections: () => rejectionsHook(),
  useUsageAlerts: () => alertsHook(),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/services/mutations', () => ({
  useUpsertUsageMeter: () => mutation(upsertMeter),
  useSetUsageMeterBillable: () => mutation(setBillable),
  useConfigureUsageIngestCredential: () => mutation(configureCredential),
  useSetUsageIngestEnabled: () => mutation(setIngest),
  useFinalizeUsageAggregate: () => mutation(finalize),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => permissions() }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, push: vi.fn() }),
}));

import { UsagePage } from './UsagePage';
import { MetersTab } from './MetersTab';
import { IngestTab } from './IngestTab';
import { AggregatesTab } from './AggregatesTab';
import { EventsTab } from './EventsTab';
import { RejectionsTab } from './RejectionsTab';
import { AlertsTab } from './AlertsTab';

const ok = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
const failed = () => ({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });

const PRODUCT_ADMIN = { canManagePlatform: true, canReadFinance: false, canManageCommercial: true };
const FINANCE = { canManagePlatform: false, canReadFinance: true, canManageCommercial: true };
const READER = { canManagePlatform: false, canReadFinance: false, canManageCommercial: false };

function meter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1', saas_product_id: 'p-ewm', code: 'ai.pages', name: 'Páginas IA', unit: 'page', aggregation: 'SUM',
    measurement: 'EVENT', capability_id: 'c-ai', is_billable: false, allows_negative: false, grace_hours: 72,
    status: 'ACTIVE', billable_decided_by: null, billable_reason: null, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function aggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agg-1', tenant_id: 't-alpha', tenant_slug: 'alpha', saas_product_id: 'p-ewm', product_code: 'ewm',
    meter_code: 'ai.pages', unit: 'page', period_start: '2026-09-01', period_end: '2026-09-30', status: 'CLOSING',
    event_count: 0, late_event_count: 0, quantity: 0, allowance_included: null, overage_quantity: null,
    allowance_status: null, overage_policy: null, is_billable: false, source_hash: null, finalized_at: null,
    ...overrides,
  };
}

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  for (const fn of [upsertMeter, setBillable, configureCredential, setIngest, finalize, toastError]) fn.mockReset();
  permissions.mockReturnValue(READER);
  metersHook.mockReturnValue(ok([]));
  capabilitiesHook.mockReturnValue(ok([{ id: 'c-ai', code: 'ewm.ai_docs', name: 'Lectura IA', kind: 'AI_FEATURE', saas_product_id: 'p-ewm' }]));
  integrationsHook.mockReturnValue(ok([]));
  credentialsHook.mockReturnValue(ok([]));
  aggregatesHook.mockReturnValue(ok([]));
  eventsHook.mockReturnValue(ok([]));
  cogsHook.mockReturnValue(ok([]));
  rejectionsHook.mockReturnValue(ok([]));
  alertsHook.mockReturnValue(ok([]));
  window.location.hash = '';
});

describe('UsagePage', () => {
  it('organiza el uso en pestañas con deep-link', () => {
    wrap(<UsagePage />);
    for (const name of ['Medidores', 'Ingest', 'Agregados', 'Eventos', 'Rechazos', 'Alertas']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Sin medidores registrados')).toBeInTheDocument();
  });
});

describe('MetersTab', () => {
  it('un medidor sin decisión de finanzas se rotula «No decidido (D-06)», nunca gratis', () => {
    metersHook.mockReturnValue(
      ok([
        meter(),
        meter({ id: 'm2', code: 'api.calls', name: 'Llamadas', is_billable: true, billable_reason: 'Aprobado D-06' }),
        meter({ id: 'm3', code: 'old.metric', name: 'Viejo', status: 'DEPRECATED', billable_reason: 'No se cobra' }),
      ]),
    );
    wrap(<MetersTab />);
    const pages = screen.getByRole('row', { name: /Páginas IA/ });
    expect(within(pages).getByText('No decidido (D-06)')).toBeInTheDocument();
    expect(within(pages).getByText('ewm.ai_docs')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Llamadas/ })).getByText('Facturable')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Viejo/ })).getByText('No facturable')).toBeInTheDocument();
    expect(screen.queryByText(/gratis/i)).toBeNull();
  });

  it('solo producto edita y registra; solo finanzas decide facturable', () => {
    metersHook.mockReturnValue(ok([meter()]));
    const { unmount } = wrap(<MetersTab />);
    expect(screen.queryByRole('button', { name: 'Nuevo medidor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Facturable…' })).toBeNull();
    unmount();

    permissions.mockReturnValue(PRODUCT_ADMIN);
    const admin = wrap(<MetersTab />);
    expect(screen.getByRole('button', { name: 'Nuevo medidor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Facturable…' })).toBeNull();
    admin.unmount();

    permissions.mockReturnValue(FINANCE);
    wrap(<MetersTab />);
    expect(screen.queryByRole('button', { name: 'Nuevo medidor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Facturable…' })).toBeInTheDocument();
  });

  it('«Nuevo medidor» llama a upsert_usage_meter con los argumentos del formulario', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(PRODUCT_ADMIN);
    upsertMeter.mockResolvedValue('m-new');
    wrap(<MetersTab />);
    await user.click(screen.getByRole('button', { name: 'Nuevo medidor' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), 'ewm');
    await user.type(within(dialog).getByLabelText(/Código/), 'ai.pages');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Páginas IA');
    await user.type(within(dialog).getByLabelText(/Unidad/), 'page');
    await user.selectOptions(within(dialog).getByLabelText(/Capacidad/), 'ewm.ai_docs');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(upsertMeter).toHaveBeenCalledWith({
      p_product_code: 'ewm', p_code: 'ai.pages', p_name: 'Páginas IA', p_unit: 'page', p_aggregation: 'SUM',
      p_status: 'DRAFT', p_measurement: 'EVENT', p_capability_code: 'ewm.ai_docs', p_allows_negative: false,
      p_grace_hours: 72,
    });
  });

  it('una foto diaria exige agregación por máximo', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(PRODUCT_ADMIN);
    wrap(<MetersTab />);
    await user.click(screen.getByRole('button', { name: 'Nuevo medidor' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), 'ewm');
    await user.type(within(dialog).getByLabelText(/Código/), 'wh.active');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Almacenes');
    await user.type(within(dialog).getByLabelText(/Unidad/), 'warehouse');
    await user.selectOptions(within(dialog).getByLabelText(/Medición/), 'DAILY_SNAPSHOT');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await within(dialog).findByText(/máximo \(pico\), nunca como suma/)).toBeInTheDocument();
    expect(upsertMeter).not.toHaveBeenCalled();
  });

  it('«Facturable…» exige motivo y llama a set_usage_meter_billable', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    setBillable.mockResolvedValue(undefined);
    metersHook.mockReturnValue(ok([meter()]));
    wrap(<MetersTab />);
    await user.click(screen.getByRole('button', { name: 'Facturable…' }));
    const dialog = screen.getByRole('dialog');
    // Un motivo en blanco lo rechaza zod (el campo además es `required`).
    await user.type(within(dialog).getByLabelText(/Motivo/), '  ');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar decisión' }));
    expect(await within(dialog).findByText('El motivo es obligatorio')).toBeInTheDocument();
    expect(setBillable).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText(/Motivo/));
    await user.selectOptions(within(dialog).getByLabelText(/Facturable/), 'true');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Aprobado en comité D-06');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar decisión' }));
    expect(setBillable).toHaveBeenCalledWith({
      p_product_code: 'ewm', p_code: 'ai.pages', p_billable: true, p_reason: 'Aprobado en comité D-06',
    });
  });

  it('carga y error', () => {
    metersHook.mockReturnValue(loading());
    const { unmount } = wrap(<MetersTab />);
    expect(screen.getByText('Cargando medidores…')).toBeInTheDocument();
    unmount();
    metersHook.mockReturnValue(failed());
    wrap(<MetersTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin medidores registrados')).toBeNull();
  });
});

describe('IngestTab', () => {
  const integration = {
    id: 'i1', code: 'ewm-m2m-dev', saas_product_id: 'p-ewm', usage_ingest_enabled: false,
    saas_products: { code: 'ewm', short_name: 'EWM' },
  };

  it('avisa que el flag global vive en el entorno y está apagado hasta D-12', () => {
    wrap(<IngestTab />);
    expect(screen.getByRole('note')).toHaveTextContent('USAGE_INGEST_ENABLED');
    expect(screen.getByRole('note')).toHaveTextContent('D-12');
    expect(screen.getByText('Sin credenciales de ingest')).toBeInTheDocument();
  });

  it('el kill-switch pide motivo y llama a set_usage_ingest_enabled', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    integrationsHook.mockReturnValue(ok([integration]));
    setIngest.mockResolvedValue(1);
    wrap(<IngestTab />);
    const row = screen.getByRole('row', { name: /EWM/ });
    expect(within(row).getByText('Apagado')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Encender ingest' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'D-12 aprobada para DEV');
    await user.click(within(dialog).getByRole('button', { name: 'Encender' }));
    expect(setIngest).toHaveBeenCalledWith({ p_product_code: 'ewm', p_enabled: true, p_reason: 'D-12 aprobada para DEV' });
  });

  it('sin rol de producto ni finanzas no hay interruptor ni configuración', () => {
    integrationsHook.mockReturnValue(ok([integration]));
    wrap(<IngestTab />);
    expect(screen.queryByRole('button', { name: /ingest/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configurar credencial' })).toBeNull();
  });

  it('configurar credencial envía la REFERENCIA de la clave, no la clave', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(PRODUCT_ADMIN);
    configureCredential.mockResolvedValue('cred-1');
    wrap(<IngestTab />);
    await user.click(screen.getByRole('button', { name: 'Configurar credencial' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), 'ewm');
    await user.type(within(dialog).getByLabelText(/Emisor/), 'ewm.ebim');
    const ref = within(dialog).getByLabelText(/Referencia de la clave pública/);
    await user.type(ref, '-----BEGIN PUBLIC KEY-----');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/nunca la clave/)).toBeInTheDocument();
    expect(configureCredential).not.toHaveBeenCalled();
    await user.clear(ref);
    await user.type(ref, 'EWM_DEV_USAGE_PUBLIC_JWK');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(configureCredential).toHaveBeenCalledWith({
      p_product_code: 'ewm', p_environment: 'DEV', p_issuer: 'ewm.ebim', p_public_key_ref: 'EWM_DEV_USAGE_PUBLIC_JWK',
      p_enabled: false, p_kid: undefined, p_audience: 'masteradmin.ebim',
    });
  });

  it('error al leer credenciales se muestra como error', () => {
    credentialsHook.mockReturnValue(failed());
    wrap(<IngestTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
  });
});

describe('AggregatesTab', () => {
  it('pestañas de estado y cantidad provisional hasta finalizar', async () => {
    aggregatesHook.mockReturnValue(
      ok([
        aggregate(),
        aggregate({
          id: 'agg-2', meter_code: 'api.calls', status: 'FINALIZED', quantity: 1250, event_count: 40, late_event_count: 2,
          allowance_status: 'OVER', allowance_included: 1000, overage_quantity: 250, overage_policy: 'BLOCK',
          is_billable: true, finalized_at: '2026-10-04T10:00:00Z',
        }),
        aggregate({ id: 'agg-3', meter_code: 'open.metric', status: 'OPEN' }),
      ]),
    );
    wrap(<AggregatesTab />);
    expect(within(screen.getByRole('row', { name: /ai\.pages/ })).getByText('Se calcula al finalizar')).toBeInTheDocument();
    const finalized = screen.getByRole('row', { name: /api\.calls/ });
    expect(within(finalized).getByText('Excede la asignación')).toBeInTheDocument();
    expect(finalized.textContent).toMatch(/2 tardío/);
    await userEvent.click(screen.getByRole('tab', { name: /En cierre/ }));
    expect(screen.queryByRole('row', { name: /api\.calls/ })).toBeNull();
    expect(screen.getByRole('row', { name: /ai\.pages/ })).toBeInTheDocument();
  });

  it('«Finalizar» solo para finanzas y solo en CLOSING; llama a finalize_usage_aggregate', async () => {
    aggregatesHook.mockReturnValue(ok([aggregate(), aggregate({ id: 'agg-3', meter_code: 'open.metric', status: 'OPEN' })]));
    const { unmount } = wrap(<AggregatesTab />);
    expect(screen.queryByRole('button', { name: 'Finalizar' })).toBeNull();
    unmount();

    permissions.mockReturnValue(FINANCE);
    finalize.mockResolvedValue({});
    wrap(<AggregatesTab />);
    expect(within(screen.getByRole('row', { name: /open\.metric/ })).queryByRole('button', { name: 'Finalizar' })).toBeNull();
    await userEvent.click(within(screen.getByRole('row', { name: /ai\.pages/ })).getByRole('button', { name: 'Finalizar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    expect(finalize).toHaveBeenCalledWith({ p_aggregate_id: 'agg-1' });
  });

  it('vacío, carga y error', () => {
    const { unmount } = wrap(<AggregatesTab />);
    expect(screen.getByText('Sin agregados de uso')).toBeInTheDocument();
    unmount();
    aggregatesHook.mockReturnValue(loading());
    const l = wrap(<AggregatesTab />);
    expect(screen.getByText('Cargando agregados…')).toBeInTheDocument();
    l.unmount();
    aggregatesHook.mockReturnValue(failed());
    wrap(<AggregatesTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
  });
});

describe('EventsTab', () => {
  const event = {
    id: 'e1', saas_product_id: 'p-ewm', event_id: 'ev-1', tenant_id: 't-alpha', meter_id: 'm1', meter_code: 'ai.pages',
    quantity: 3, unit: 'page', occurred_at: '2026-10-02T10:00:00Z', received_at: '2026-10-02T10:00:01Z',
    environment: 'DEV', external_company_id: 'CO-1', subject_ref: 'user-9', capability_code: null,
    event_hash: `sha256:${'a'.repeat(64)}`, period_start: '2026-10-01', late: true, ingest_batch_id: 'batch-123456789',
  };

  it('consulta por tenant y período; marca los tardíos', async () => {
    eventsHook.mockReturnValue(ok([event]));
    wrap(<EventsTab />);
    const row = screen.getByRole('row', { name: /ai\.pages/ });
    expect(within(row).getByText('Alpha Retail')).toBeInTheDocument();
    expect(within(row).getByText('Tardío')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tenant'), 't-alpha');
    expect(eventsHook).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 't-alpha' }));
  });

  it('el COGS es solo de finanzas y exige un tenant', async () => {
    const { unmount } = wrap(<EventsTab />);
    expect(screen.queryByRole('button', { name: 'Ver COGS' })).toBeNull();
    unmount();

    permissions.mockReturnValue(FINANCE);
    cogsHook.mockReturnValue(
      ok([{ event_id: 'ev-1', meter_code: 'ai.pages', occurred_at: '2026-10-02T10:00:00Z', quantity: 3,
        internal: { provider: 'anthropic', model: 'm-1', inputTokens: 1200, outputTokens: 300, costAmount: 0.42, costCurrency: 'USD' } }]),
    );
    wrap(<EventsTab />);
    const button = screen.getByRole('button', { name: 'Ver COGS' });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Tenant'), 't-alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Ver COGS' }));
    expect(cogsHook).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 't-alpha' }));
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<EventsTab />);
    expect(screen.getByText(/Sin eventos en/)).toBeInTheDocument();
    unmount();
    eventsHook.mockReturnValue(failed());
    wrap(<EventsTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
  });
});

describe('RejectionsTab', () => {
  const rejection = (id: string, code: string) => ({
    id, saas_product_id: 'p-ewm', event_id: `ev-${id}`, tenant_id: null, meter_code: 'ai.pages', code,
    ingest_batch_id: 'b1', environment: 'DEV', detail: {}, created_at: `2026-10-0${id}T10:00:00Z`,
  });

  it('agrupa por código y marca CONFLICT como integridad', async () => {
    rejectionsHook.mockReturnValue(ok([rejection('1', 'UNKNOWN_METER'), rejection('2', 'UNKNOWN_METER'), rejection('3', 'CONFLICT')]));
    wrap(<RejectionsTab />);
    const unknown = screen.getByRole('row', { name: /UNKNOWN_METER/ });
    expect(within(unknown).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /CONFLICT/ })).getByText('Integridad')).toBeInTheDocument();
    await userEvent.click(within(unknown).getByRole('button', { name: 'Ver detalle' }));
    expect(screen.getByRole('list', { name: 'Rechazos UNKNOWN_METER' }).querySelectorAll('li')).toHaveLength(2);
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<RejectionsTab />);
    expect(screen.getByText('Sin rechazos')).toBeInTheDocument();
    unmount();
    rejectionsHook.mockReturnValue(failed());
    wrap(<RejectionsTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('AlertsTab', () => {
  it('traduce los códigos y filtra por categoría', async () => {
    alertsHook.mockReturnValue(
      ok([
        { id: 'a1', tenant_id: 't-alpha', saas_product_id: 'p-ewm', aggregate_id: 'agg-1', code: 'POLITICA_CREDITOS_NO_DEFINIDA', detail: { period: '2026-09-01' }, created_at: '2026-10-01T00:00:00Z' },
        { id: 'a2', tenant_id: 't-alpha', saas_product_id: 'p-ewm', aggregate_id: 'agg-2', code: 'OVERAGE_UNDER_BLOCK_POLICY', detail: { overage: 250 }, created_at: '2026-10-02T00:00:00Z' },
      ]),
    );
    wrap(<AlertsTab />);
    expect(screen.getByText('Política de créditos no decidida (D-03)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Créditos IA/ }));
    expect(screen.queryByText('Exceso bajo política BLOCK')).toBeNull();
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<AlertsTab />);
    expect(screen.getByText('Sin alertas')).toBeInTheDocument();
    unmount();
    alertsHook.mockReturnValue(failed());
    wrap(<AlertsTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
