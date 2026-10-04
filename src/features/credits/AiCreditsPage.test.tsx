import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP M4 · «Créditos IA» (spec §5.2). Lo no decidido se rotula «No decidido
 * (D-xx)», nunca 0 ni gratis; toda escritura es de finanzas y lleva motivo.
 */

const balancesHook = vi.fn();
const ledgerHook = vi.fn();
const weightsHook = vi.fn();
const policiesHook = vi.fn();
const capabilitiesHook = vi.fn();
const itemsHook = vi.fn();
const metersHook = vi.fn();
const subscriptionsHook = vi.fn();
const permissions = vi.fn();

const reverse = vi.fn();
const setWeight = vi.fn();
const createPolicy = vi.fn();
const openPeriod = vi.fn();
const recordEntry = vi.fn();
const purchase = vi.fn();
const setPack = vi.fn();
const setBinding = vi.fn();

const mutation = (fn = vi.fn()) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/services/queries', () => ({
  useAiCreditBalances: () => balancesHook(),
  useAiCreditLedger: () => ledgerHook(),
  useAiCreditWeights: () => weightsHook(),
  useAiCreditPolicies: () => policiesHook(),
  useProductCapabilities: () => capabilitiesHook(),
  useCatalogItemsWithLifecycle: () => itemsHook(),
  useUsageMeters: () => metersHook(),
  useSubscriptions: () => subscriptionsHook(),
  usePlans: () => ({ data: [{ id: 'plan-pro', code: 'ewm-pro', name: 'EWM Pro' }] }),
  useProducts: () => ({ data: [{ id: 'p-ewm', code: 'ewm', short_name: 'EWM' }] }),
  useTenantOverview: () => ({
    data: [{ tenant_id: 't-alpha', name: 'Alpha Retail', slug: 'alpha', saas_product_id: 'p-ewm', product_code: 'ewm', product_short_name: 'EWM' }],
  }),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/services/mutations', () => ({
  useReverseAiCreditEntry: () => mutation(reverse),
  useSetAiCreditWeight: () => mutation(setWeight),
  useCreateAiCreditPolicy: () => mutation(createPolicy),
  useOpenAiCreditPeriod: () => mutation(openPeriod),
  useRecordAiCreditEntry: () => mutation(recordEntry),
  usePurchaseAiCredits: () => mutation(purchase),
  useSetCatalogItemCreditPack: () => mutation(setPack),
  useSetCatalogItemUsageBinding: () => mutation(setBinding),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => permissions() }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { AiCreditsPage } from './AiCreditsPage';
import { BalancesTab } from './BalancesTab';
import { LedgerTab } from './LedgerTab';
import { WeightsTab } from './WeightsTab';
import { PoliciesTab } from './PoliciesTab';
import { OperationsTab } from './OperationsTab';
import { CreditCatalogTab } from './CreditCatalogTab';

const ok = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
const failed = () => ({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });

const FINANCE = { canManagePlatform: false, canReadFinance: true, canManageCommercial: true };
const PRODUCT_ADMIN = { canManagePlatform: true, canReadFinance: false, canManageCommercial: true };

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1', tenant_id: 't-alpha', saas_product_id: 'p-ewm', pool_key: 'TENANT', period_start: '2026-10-01',
    entry_type: 'GRANT_BONUS', credits: 100, entry_idempotency_key: 'manual:abc', usage_aggregate_id: null,
    capability_id: null, weight_id: null, weight_applied: null, quantity: null, policy_id: null,
    reverses_entry_id: null, reason: 'Bono de bienvenida', created_by: null, created_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [reverse, setWeight, createPolicy, openPeriod, recordEntry, purchase, setPack, setBinding]) fn.mockReset();
  permissions.mockReturnValue(PRODUCT_ADMIN);
  balancesHook.mockReturnValue(ok([]));
  ledgerHook.mockReturnValue(ok([]));
  weightsHook.mockReturnValue(ok([]));
  policiesHook.mockReturnValue(ok([]));
  capabilitiesHook.mockReturnValue(
    ok([{ id: 'c-ai', code: 'ewm.ai_docs', name: 'Lectura IA', kind: 'AI_FEATURE', unit: 'page', saas_product_id: 'p-ewm' }]),
  );
  itemsHook.mockReturnValue(ok([]));
  metersHook.mockReturnValue(ok([]));
  subscriptionsHook.mockReturnValue(ok([]));
  window.location.hash = '';
});

describe('AiCreditsPage', () => {
  it('pestañas de créditos', () => {
    wrap(<AiCreditsPage />);
    for (const name of ['Saldos', 'Movimientos', 'Pesos', 'Políticas', 'Operaciones', 'Catálogo']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Sin saldos de créditos')).toBeInTheDocument();
  });
});

describe('BalancesTab', () => {
  it('saldo por pool; el negativo se destaca y se filtra', async () => {
    balancesHook.mockReturnValue(
      ok([
        { tenant_id: 't-alpha', saas_product_id: 'p-ewm', pool_key: 'TENANT', period_start: '2026-10-01', included: 100, purchased: 0, bonus: 0, reserved: 0, used: 140, expired: 0, adjusted: 0, rollover_net: 0, balance: -40 },
        { tenant_id: 't-alpha', saas_product_id: 'p-ewm', pool_key: 'PRODUCT:ewm', period_start: '2026-09-01', included: 50, purchased: 0, bonus: 0, reserved: 0, used: 10, expired: 0, adjusted: 0, rollover_net: 0, balance: 40 },
      ]),
    );
    wrap(<BalancesTab />);
    expect(screen.getByRole('row', { name: /Pool del tenant/ })).toHaveTextContent('-40');
    await userEvent.click(screen.getByRole('tab', { name: /Saldo negativo/ }));
    expect(screen.queryByRole('row', { name: /Pool del producto ewm/ })).toBeNull();
  });

  it('carga y error', () => {
    balancesHook.mockReturnValue(loading());
    const { unmount } = wrap(<BalancesTab />);
    expect(screen.getByText('Cargando saldos…')).toBeInTheDocument();
    unmount();
    balancesHook.mockReturnValue(failed());
    wrap(<BalancesTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
  });
});

describe('LedgerTab', () => {
  it('detalle en panel lateral; «Revertir» solo para finanzas y entradas reversibles', async () => {
    ledgerHook.mockReturnValue(ok([entry(), entry({ id: 'l-2', entry_type: 'REVERSAL', credits: -10, reverses_entry_id: 'l-9', reason: 'x' })]));
    const { unmount } = wrap(<LedgerTab />);
    await userEvent.click(within(screen.getByRole('row', { name: /Bono/ })).getByRole('button', { name: 'Ver detalle' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('manual:abc')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Revertir' })).toBeNull();
    unmount();

    permissions.mockReturnValue(FINANCE);
    wrap(<LedgerTab />);
    await userEvent.click(within(screen.getByRole('row', { name: /Reversión/ })).getByRole('button', { name: 'Ver detalle' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Revertir' })).toBeNull();
  });

  it('«Revertir» pide motivo y llama a reverse_ai_credit_entry', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    reverse.mockResolvedValue('l-rev');
    ledgerHook.mockReturnValue(ok([entry()]));
    wrap(<LedgerTab />);
    await user.click(screen.getByRole('button', { name: 'Ver detalle' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revertir' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Bono duplicado');
    await user.click(within(dialog).getByRole('button', { name: 'Revertir' }));
    expect(reverse).toHaveBeenCalledWith({ p_entry_id: 'l-1', p_reason: 'Bono duplicado' });
  });

  it('una entrada ya revertida no se vuelve a ofrecer', async () => {
    permissions.mockReturnValue(FINANCE);
    ledgerHook.mockReturnValue(ok([entry(), entry({ id: 'l-2', entry_type: 'REVERSAL', credits: -100, reverses_entry_id: 'l-1' })]));
    wrap(<LedgerTab />);
    expect(within(screen.getByRole('row', { name: /Bono/ })).getByText('Revertida')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('row', { name: /Bono/ })).getByRole('button', { name: 'Ver detalle' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Revertir' })).toBeNull();
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<LedgerTab />);
    expect(screen.getByText('Sin movimientos de créditos')).toBeInTheDocument();
    unmount();
    ledgerHook.mockReturnValue(failed());
    wrap(<LedgerTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('WeightsTab', () => {
  it('sin peso vigente la capacidad es «No decidido (D-03)»', () => {
    wrap(<WeightsTab />);
    expect(within(screen.getByRole('row', { name: /Lectura IA/ })).getByText('No decidido (D-03)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva versión' })).toBeNull();
  });

  it('muestra el peso vigente y el historial', () => {
    weightsHook.mockReturnValue(
      ok([{ id: 'w1', capability_id: 'c-ai', credits_per_unit: 2.5, unit: 'page', valid_from: '2026-01-01T00:00:00Z', valid_to: null, reason: 'Aprobado D-03', created_by: null, created_at: '2026-01-01T00:00:00Z' }]),
    );
    wrap(<WeightsTab />);
    expect(screen.getByRole('row', { name: /Lectura IA/ })).toHaveTextContent(/2[.,]5 créditos \/ page/);
    expect(screen.getByText('Aprobado D-03')).toBeInTheDocument();
  });

  it('«Nueva versión» llama a set_ai_credit_weight', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    setWeight.mockResolvedValue('w2');
    wrap(<WeightsTab />);
    await user.click(within(screen.getByRole('row', { name: /Lectura IA/ })).getByRole('button', { name: 'Nueva versión' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Créditos por unidad/), '3');
    fireEvent.change(within(dialog).getByLabelText(/Vigente desde/), { target: { value: '2026-11-01T00:00' } });
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Comité D-03');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar peso' }));
    expect(setWeight).toHaveBeenCalledWith({
      p_capability_code: 'ewm.ai_docs', p_credits_per_unit: 3, p_unit: 'page',
      p_valid_from: new Date('2026-11-01T00:00').toISOString(), p_reason: 'Comité D-03',
    });
  });

  it('error', () => {
    weightsHook.mockReturnValue(failed());
    wrap(<WeightsTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('PoliciesTab', () => {
  it('los campos nulos se rotulan como no decididos (D-03 / D-04)', () => {
    policiesHook.mockReturnValue(
      ok([{ id: 'pol-1', saas_product_id: 'p-ewm', source_type: 'PLAN', plan_id: 'plan-pro', catalog_item_id: null, pool_scope: null, included_credits: null, overage_mode: null, rollover_policy: null, expiry_policy: null, valid_from: '2026-01-01', valid_to: null, reason: 'Alta inicial', created_by: null, created_at: '2026-01-01T00:00:00Z' }]),
    );
    wrap(<PoliciesTab />);
    const row = screen.getByRole('row', { name: /EWM Pro/ });
    expect(within(row).getAllByText('No decidido (D-03)')).toHaveLength(3);
    expect(within(row).getByText('No decidido (D-04)')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it('crear política deja en NULL lo no decidido', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    createPolicy.mockResolvedValue('pol-2');
    wrap(<PoliciesTab />);
    await user.click(screen.getByRole('button', { name: 'Nueva política' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Plan/), 'ewm-pro');
    await user.selectOptions(within(dialog).getByLabelText(/Pool/), 'TENANT');
    fireEvent.change(within(dialog).getByLabelText(/Vigente desde/), { target: { value: '2026-11-01' } });
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Pool decidido, incluidos no');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar política' }));
    expect(createPolicy).toHaveBeenCalledWith({
      p_source_type: 'PLAN', p_source_code: 'ewm-pro', p_pool_scope: 'TENANT', p_included_credits: null,
      p_overage_mode: null, p_valid_from: '2026-11-01', p_reason: 'Pool decidido, incluidos no',
    });
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<PoliciesTab />);
    expect(screen.getByText('Sin políticas de créditos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva política' })).toBeNull();
    unmount();
    policiesHook.mockReturnValue(failed());
    wrap(<PoliciesTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('OperationsTab', () => {
  it('sin finanzas no ofrece operaciones', () => {
    wrap(<OperationsTab />);
    expect(screen.getByText(/exclusivo de EBIM_FINANCE/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir período' })).toBeNull();
  });

  it('abrir período sin política informa «No decidido (D-03)»', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    openPeriod.mockResolvedValue({ granted: 0, code: 'POLITICA_CREDITOS_NO_DEFINIDA' });
    wrap(<OperationsTab />);
    await user.click(screen.getByRole('button', { name: 'Abrir período' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Tenant/), 't-alpha');
    fireEvent.change(within(dialog).getByLabelText(/Mes/), { target: { value: '2026-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Abrir período' }));
    expect(openPeriod).toHaveBeenCalledWith({ p_tenant_id: 't-alpha', p_period_start: '2026-10-01' });
    expect(await screen.findByRole('status')).toHaveTextContent('No decidido (D-03)');
  });

  it('bono o ajuste: solo GRANT_BONUS / ADJUST, con clave de idempotencia', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    recordEntry.mockResolvedValue('l-new');
    wrap(<OperationsTab />);
    await user.click(screen.getByRole('button', { name: 'Registrar bono o ajuste' }));
    const dialog = screen.getByRole('dialog');
    const types = Array.from((within(dialog).getByLabelText(/Tipo/) as HTMLSelectElement).options).map((o) => o.value);
    expect(types).toEqual(['GRANT_BONUS', 'ADJUST']);
    await user.selectOptions(within(dialog).getByLabelText(/Tenant/), 't-alpha');
    await user.selectOptions(within(dialog).getByLabelText(/Pool/), 'PRODUCT:ewm');
    await user.selectOptions(within(dialog).getByLabelText(/Tipo/), 'ADJUST');
    await user.type(within(dialog).getByLabelText(/Créditos/), '-15');
    fireEvent.change(within(dialog).getByLabelText(/Mes/), { target: { value: '2026-10' } });
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Corrección de consumo');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(recordEntry).toHaveBeenCalledWith({
      p_tenant_id: 't-alpha', p_pool_key: 'PRODUCT:ewm', p_period_start: '2026-10-01', p_entry_type: 'ADJUST',
      p_credits: -15, p_reason: 'Corrección de consumo', p_idempotency_key: expect.stringMatching(/^manual:/),
    });
  });

  it('compra de paquetes llama a purchase_ai_credits', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    subscriptionsHook.mockReturnValue(
      ok([{ id: 'sub-1', code: 'SUB-001', status: 'ACTIVE', tenant_id: 't-alpha', saas_product_id: 'p-ewm', saas_products: { code: 'ewm', short_name: 'EWM' }, tenants: { name: 'Alpha Retail' } }]),
    );
    itemsHook.mockReturnValue(
      ok([{ id: 'ci-1', code: 'ewm-credits-1k', name: 'Paquete 1k', billing_model: 'ONE_TIME', lifecycle_status: 'AVAILABLE', saas_product_id: 'p-ewm', credit_pack_credits: 1000, per_unit_source: null, usage_meter_id: null }]),
    );
    purchase.mockResolvedValue({ credits: 2000, unit_amount: 50, currency: 'USD', created: true });
    wrap(<OperationsTab />);
    await user.click(screen.getByRole('button', { name: 'Registrar compra' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Contrato/), 'sub-1');
    await user.selectOptions(within(dialog).getByLabelText(/^Paquete\*$/), 'ewm-credits-1k');
    await user.clear(within(dialog).getByLabelText(/Paquetes/));
    await user.type(within(dialog).getByLabelText(/Paquetes/), '2');
    fireEvent.change(within(dialog).getByLabelText(/Mes/), { target: { value: '2026-10' } });
    await user.type(within(dialog).getByLabelText(/Motivo/), 'OC 4471');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }));
    expect(purchase).toHaveBeenCalledWith({
      p_subscription_id: 'sub-1', p_catalog_item_code: 'ewm-credits-1k', p_packs: 2, p_pool_key: 'TENANT',
      p_period_start: '2026-10-01', p_reason: 'OC 4471', p_idempotency_key: expect.stringMatching(/^console:/),
    });
  });
});

describe('CreditCatalogTab', () => {
  const items = [
    { id: 'ci-1', code: 'ewm-credits-1k', name: 'Paquete 1k', billing_model: 'ONE_TIME', lifecycle_status: 'AVAILABLE', saas_product_id: 'p-ewm', credit_pack_credits: null, per_unit_source: null, usage_meter_id: null },
    { id: 'ci-2', code: 'ewm-pages', name: 'Páginas extra', billing_model: 'PER_UNIT', lifecycle_status: 'AVAILABLE', saas_product_id: 'p-ewm', credit_pack_credits: null, per_unit_source: null, usage_meter_id: null },
  ];

  it('lo no decidido se rotula; sin finanzas no hay acciones', () => {
    itemsHook.mockReturnValue(ok(items));
    wrap(<CreditCatalogTab />);
    expect(within(screen.getByRole('row', { name: /Paquete 1k/ })).getByText('No decidido (D-03)')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Páginas extra/ })).getByText('No decidido (D-02/D-06)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créditos por paquete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vincular uso' })).toBeNull();
  });

  it('créditos por paquete llama a set_catalog_item_credit_pack', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    itemsHook.mockReturnValue(ok(items));
    setPack.mockResolvedValue({});
    wrap(<CreditCatalogTab />);
    await user.click(screen.getByRole('button', { name: 'Créditos por paquete' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Créditos por paquete/), '1000');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'D-03 aprobada');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(setPack).toHaveBeenCalledWith({ p_catalog_item_code: 'ewm-credits-1k', p_credits: 1000, p_reason: 'D-03 aprobada' });
  });

  it('vincular uso AI_CREDIT envía el medidor nulo', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    itemsHook.mockReturnValue(ok(items));
    setBinding.mockResolvedValue({});
    wrap(<CreditCatalogTab />);
    await user.click(screen.getByRole('button', { name: 'Vincular uso' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Qué tarifa/), 'AI_CREDIT');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Exceso por pool');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar vínculo' }));
    expect(setBinding).toHaveBeenCalledWith({
      p_catalog_item_code: 'ewm-pages', p_source: 'AI_CREDIT', p_meter_code: null, p_reason: 'Exceso por pool',
    });
  });

  it('error', () => {
    itemsHook.mockReturnValue(failed());
    wrap(<CreditCatalogTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
