import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/*
 * E03 · El consolidado ya aceptaba período (p_period_start/p_period_end) en SQL,
 * pero el hook no lo enviaba. `asOf` sigue siendo la FECHA DE TASAS; el período
 * es otro parámetro. MRR es foto actual: el SQL lo excluye del filtro de período.
 */
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useFinanceConsolidated } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { groups: [] }, error: null });
});

describe('useFinanceConsolidated', () => {
  it('una consulta de septiembre envía ambas fechas del período', async () => {
    renderHook(
      () => useFinanceConsolidated({ asOf: '2026-09-25', groupBy: 'TOTAL', periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
      { wrapper },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('finance_consolidated', expect.objectContaining({
      p_as_of: '2026-09-25',
      p_period_start: '2026-09-01',
      p_period_end: '2026-09-30',
    }));
  });

  it('cambiar la fecha FX no cambia el período enviado', async () => {
    renderHook(
      () => useFinanceConsolidated({ asOf: '2026-08-31', groupBy: 'TOTAL', periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
      { wrapper },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_as_of).toBe('2026-08-31');
    expect(args.p_period_start).toBe('2026-09-01');
    expect(args.p_period_end).toBe('2026-09-30');
  });

  it('los consumidores existentes (sin período) mantienen la llamada anterior', async () => {
    renderHook(() => useFinanceConsolidated({ asOf: '2026-09-25', groupBy: 'MARKET' }), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_period_start).toBeUndefined();
    expect(args.p_period_end).toBeUndefined();
  });
});
