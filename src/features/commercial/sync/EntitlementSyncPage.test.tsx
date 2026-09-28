import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP fase 08 · Sincronización de entitlements (MA-39).
 *
 * Deseado frente a aplicado por tenant×producto. Los botones invocan el
 * orquestador (SYNC_ENTITLEMENTS / GET_ENTITLEMENTS) con el tenant y nada más:
 * la autorización es un booleano de la base, la pantalla solo es UX.
 */

const statusHook = vi.fn();
const syncMutate = vi.fn();
const verifyMutate = vi.fn();
const syncState = { isPending: false, data: undefined as unknown, error: null as Error | null, variables: undefined as unknown };
const verifyState = { isPending: false, data: undefined as unknown, error: null as Error | null, variables: undefined as unknown };

vi.mock('@/services/queries', () => ({
  useEntitlementSyncStatus: () => statusHook(),
}));
vi.mock('@/services/mutations', () => ({
  useSyncEntitlements: () => ({ mutate: syncMutate, ...syncState }),
  useVerifyEntitlements: () => ({ mutate: verifyMutate, ...verifyState }),
}));

import { EntitlementSyncPage } from './EntitlementSyncPage';

function row(overrides: Record<string, unknown>) {
  return {
    tenant_id: 't-alpha',
    tenant_name: 'Alpha Retail',
    tenant_slug: 'alpha',
    saas_product_id: 'p-esup',
    product_code: 'esupplier',
    product_name: 'eSupplier',
    state: 'IN_SYNC',
    state_reason: 'IN_SYNC',
    state_changed_at: '2026-10-01T10:00:00Z',
    desired_version: 3,
    desired_checksum: `sha256:${'a'.repeat(64)}`,
    desired_dirty: false,
    last_pushed_version: 3,
    last_push_at: '2026-10-01T10:00:00Z',
    last_push_result: 'APPLIED',
    applied_version: 3,
    applied_checksum: `sha256:${'a'.repeat(64)}`,
    applied_status: 'APPLIED',
    unknown_capabilities: [],
    last_verified_at: '2026-10-01T10:01:00Z',
    consecutive_failures: 0,
    next_attempt_at: '2026-10-01T10:01:00Z',
    cohort_state: null,
    integration_code: 'esupplier-m2m-dev',
    cutover_state_entitlements: 'SHADOW',
    push_enabled: true,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EntitlementSyncPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  statusHook.mockReset();
  syncMutate.mockReset();
  verifyMutate.mockReset();
  Object.assign(syncState, { isPending: false, data: undefined, error: null, variables: undefined });
  Object.assign(verifyState, { isPending: false, data: undefined, error: null, variables: undefined });
});

describe('EntitlementSyncPage', () => {
  it('muestra deseado frente a aplicado, estado, eje de cutover y kill-switch por tenant×producto', () => {
    statusHook.mockReturnValue({
      data: [
        row({}),
        row({
          tenant_id: 't-beta', tenant_name: 'Beta Foods', state: 'AWAITING_VERIFY', applied_version: 2,
          desired_version: 4, desired_dirty: true, push_enabled: false, applied_status: 'APPLIED',
        }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();
    const alpha = screen.getByRole('row', { name: /Alpha Retail/ });
    expect(within(alpha).getByText('En sincronía')).toBeInTheDocument();
    expect(within(alpha).getAllByText('v3')).toHaveLength(2);
    expect(within(alpha).getByText('SHADOW')).toBeInTheDocument();
    const beta = screen.getByRole('row', { name: /Beta Foods/ });
    expect(within(beta).getByText('Esperando verificación')).toBeInTheDocument();
    expect(within(beta).getByText('v4')).toBeInTheDocument();
    expect(within(beta).getByText('v2')).toBeInTheDocument();
    expect(within(beta).getByText('Cambios sin emitir')).toBeInTheDocument();
    expect(within(beta).getByText('Envío apagado')).toBeInTheDocument();
  });

  it('marca los incidentes (DRIFT_CHECKSUM / DRIFT_AHEAD) y las capacidades desconocidas', () => {
    statusHook.mockReturnValue({
      data: [
        row({ state: 'DRIFT_CHECKSUM', state_reason: 'VERSION_CONFLICT' }),
        row({ tenant_id: 't-g', tenant_name: 'Gamma', state: 'IN_SYNC_WITH_WARNINGS', unknown_capabilities: ['esupplier.ghost'] }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();
    const alpha = screen.getByRole('row', { name: /Alpha Retail/ });
    expect(within(alpha).getByText('Checksum distinto')).toBeInTheDocument();
    expect(within(alpha).getByText('VERSION_CONFLICT')).toBeInTheDocument();
    const gamma = screen.getByRole('row', { name: /Gamma/ });
    expect(within(gamma).getByText('esupplier.ghost')).toBeInTheDocument();
  });

  it('el filtro «Incidentes» deja solo los estados que requieren a una persona', async () => {
    statusHook.mockReturnValue({
      data: [row({}), row({ tenant_id: 't-x', tenant_name: 'Xeno', state: 'DRIFT_AHEAD' })],
      isLoading: false,
      error: null,
    });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Incidentes/ }));
    expect(screen.queryByRole('row', { name: /Alpha Retail/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Xeno/ })).toBeInTheDocument();
  });

  it('«Sincronizar ahora» y «Verificar» envían solo el tenant al orquestador', async () => {
    statusHook.mockReturnValue({ data: [row({})], isLoading: false, error: null });
    renderPage();
    const alpha = screen.getByRole('row', { name: /Alpha Retail/ });
    await userEvent.click(within(alpha).getByRole('button', { name: 'Sincronizar ahora' }));
    expect(syncMutate).toHaveBeenCalledWith('t-alpha');
    await userEvent.click(within(alpha).getByRole('button', { name: 'Verificar' }));
    expect(verifyMutate).toHaveBeenCalledWith('t-alpha');
  });

  it('muestra el resultado de la última acción y los errores del servidor sin ocultarlos', () => {
    statusHook.mockReturnValue({ data: [row({})], isLoading: false, error: null });
    syncState.data = {
      tenant_id: 't-alpha', saas_product_id: 'p-esup', state: 'REJECTED',
      push: { result: 'REJECTED', errorCode: 'INSUFFICIENT_SCOPE', httpStatus: 403 },
    };
    verifyState.error = new Error('NO_AUTORIZADO');
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent(/REJECTED/);
    expect(screen.getByRole('status')).toHaveTextContent(/INSUFFICIENT_SCOPE/);
    expect(screen.getByRole('alert')).toHaveTextContent('NO_AUTORIZADO');
  });

  it('estado vacío explica cómo se enrola una integración', () => {
    statusHook.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPage();
    expect(screen.getByText('Ningún tenant en sincronización')).toBeInTheDocument();
  });

  it('error de carga con reintento', async () => {
    const refetch = vi.fn();
    statusHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
