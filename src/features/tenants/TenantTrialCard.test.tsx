import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Periodo de prueba en la ficha del tenant (20261024000100). La fecha la fija la
 * base; la pantalla la dice en español y ofrece extender o convertir solo a
 * plataforma. La RPC `set_tenant_trial_end` es la autoridad.
 */

const setEnd = vi.fn();

vi.mock('@/services/mutations', () => ({
  useSetTenantTrialEnd: () => ({ mutateAsync: setEnd, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { TenantTrialCard } from './TenantTrialCard';

const IN_A_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60_000).toISOString();

function trialTenant(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: 't-61',
    name: 'Cliente eChange',
    tenant_type: 'TRIAL',
    status: 'ACTIVE',
    trial_days: 7,
    trial_ends_at: IN_A_WEEK,
    trial_converted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  setEnd.mockReset();
  setEnd.mockResolvedValue({});
});

describe('TenantTrialCard', () => {
  it('un tenant TRIAL dice cuándo vence y cuánto queda', () => {
    render(<TenantTrialCard tenant={trialTenant()} canManage={false} />);
    expect(screen.getByText(/^Prueba vence el .+ \(quedan 7 días\)$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extender prueba' })).not.toBeInTheDocument();
  });

  it('vencida lo dice; un tenant de producción no muestra la tarjeta', () => {
    const { rerender, container } = render(
      <TenantTrialCard tenant={trialTenant({ trial_ends_at: '2026-01-01T00:00:00Z' })} canManage />,
    );
    expect(screen.getByText(/^Prueba vencida el /)).toBeInTheDocument();
    rerender(<TenantTrialCard tenant={trialTenant({ tenant_type: 'PRODUCTION', trial_ends_at: null })} canManage />);
    expect(container.querySelector('[data-tenant-trial]')).toBeNull();
  });

  it('marcar como convertida exige motivo y envía p_ends_at null', async () => {
    const user = userEvent.setup();
    render(<TenantTrialCard tenant={trialTenant()} canManage />);
    await user.click(screen.getByRole('button', { name: 'Marcar como convertida' }));
    const reason = screen.getByLabelText(/Motivo/);
    await user.clear(reason);
    await user.click(screen.getAllByRole('button', { name: 'Marcar como convertida' }).at(-1)!);
    expect(setEnd).not.toHaveBeenCalled();
    await user.type(reason, 'Firmó el contrato anual');
    await user.click(screen.getAllByRole('button', { name: 'Marcar como convertida' }).at(-1)!);
    expect(setEnd).toHaveBeenCalledWith({ p_tenant_id: 't-61', p_ends_at: null, p_reason: 'Firmó el contrato anual' });
  });

  it('extender manda el final del día elegido', async () => {
    const user = userEvent.setup();
    render(<TenantTrialCard tenant={trialTenant()} canManage />);
    await user.click(screen.getByRole('button', { name: 'Extender prueba' }));
    await user.type(screen.getByLabelText(/Motivo/), 'Necesita una semana más');
    await user.click(screen.getAllByRole('button', { name: 'Extender prueba' }).at(-1)!);
    expect(setEnd).toHaveBeenCalledTimes(1);
    const args = setEnd.mock.calls[0]![0] as { p_ends_at: string; p_reason: string };
    const ends = new Date(args.p_ends_at);
    expect(ends.getHours()).toBe(23);
    expect(ends.getTime()).toBeGreaterThan(Date.parse(IN_A_WEEK));
    expect(args.p_reason).toBe('Necesita una semana más');
  });
});
