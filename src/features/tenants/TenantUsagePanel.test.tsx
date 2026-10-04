import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP M4 · Tenant 360 «Uso y créditos» (spec §5.4): solo lectura, acotado al
 * tenant (las tres lecturas reciben su id; RLS hace el resto).
 */

const aggregatesHook = vi.fn();
const balancesHook = vi.fn();
const ledgerHook = vi.fn();

vi.mock('@/services/queries', () => ({
  useUsageAggregates: (id: string) => aggregatesHook(id),
  useAiCreditBalances: (id: string) => balancesHook(id),
  useAiCreditLedger: (id: string, limit: number) => ledgerHook(id, limit),
}));

import { TenantUsagePanel } from './TenantUsagePanel';

const ok = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn() });

function renderPanel() {
  return render(
    <MemoryRouter>
      <TenantUsagePanel tenantId="t-alpha" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  aggregatesHook.mockReturnValue(ok([]));
  balancesHook.mockReturnValue(ok([]));
  ledgerHook.mockReturnValue(ok([]));
});

describe('TenantUsagePanel', () => {
  it('consulta solo este tenant y pinta agregados, saldo por pool y últimos movimientos', () => {
    aggregatesHook.mockReturnValue(
      ok([
        { id: 'a1', tenant_id: 't-alpha', meter_code: 'ai.pages', product_code: 'ewm', unit: 'page', period_start: '2026-09-01', status: 'FINALIZED', quantity: 42, allowance_status: 'WITHIN', is_billable: false },
        { id: 'a2', tenant_id: 't-alpha', meter_code: 'api.calls', product_code: 'ewm', unit: 'call', period_start: '2026-10-01', status: 'OPEN', quantity: 0, allowance_status: null, is_billable: false },
      ]),
    );
    balancesHook.mockReturnValue(
      ok([{ tenant_id: 't-alpha', pool_key: 'TENANT', period_start: '2026-10-01', included: 100, purchased: 0, bonus: 5, used: 120, balance: -15 }]),
    );
    ledgerHook.mockReturnValue(
      ok([{ id: 'l1', tenant_id: 't-alpha', entry_type: 'CONSUME', pool_key: 'TENANT', period_start: '2026-10-01', credits: -120, reason: null, created_at: '2026-10-03T00:00:00Z' }]),
    );
    renderPanel();
    expect(aggregatesHook).toHaveBeenCalledWith('t-alpha');
    expect(balancesHook).toHaveBeenCalledWith('t-alpha');
    expect(ledgerHook).toHaveBeenCalledWith('t-alpha', 20);

    expect(within(screen.getByRole('row', { name: /ai\.pages/ })).getByText('Dentro de la asignación')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /api\.calls/ })).getByText('Se calcula al finalizar')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Pool del tenant.*-15|-15.*Pool del tenant/ })).toBeInTheDocument();
    expect(screen.getByText('Consumo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Uso' })).toHaveAttribute('href', '/usage#aggregates');
  });

  it('estados vacíos', () => {
    renderPanel();
    expect(screen.getByText('Sin uso registrado')).toBeInTheDocument();
    expect(screen.getByText('Sin créditos')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos')).toBeInTheDocument();
  });

  it('carga y error por sección', () => {
    aggregatesHook.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    balancesHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPanel();
    expect(screen.getByText('Cargando agregados…')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin créditos')).toBeNull();
  });
});
