import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Series ejecutivas (S01–S05). Los hooks sólo traducen: la base calcula y
 * declara la cobertura. Lo que se prueba aquí es el contrato con la UI:
 * qué parámetros viajan y que un importe sin tasa llega como NULL, no como 0.
 */
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  useExecutiveAging,
  useExecutiveMrrMix,
  useExecutiveMrrMovements,
  useExecutiveMrrSeries,
} from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
});

describe('useExecutiveMrrSeries', () => {
  it('sin parámetros deja que la base use 18 meses y la moneda configurada', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderHook(() => useExecutiveMrrSeries(), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('executive_mrr_series', {
      p_from: undefined,
      p_to: undefined,
      p_reporting_currency: undefined,
    });
  });

  it('un mes sin tasa llega como NULL con la moneda faltante, y conserva los nativos', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          month: '2026-09-01', as_of: '2026-09-30', is_partial: false, reporting_currency: 'USD',
          mrr: 55669.85, arr: 668038.2, active_customers: 48, active_subscriptions: 81,
          mrr_native: { PEN: 51200, USD: 20000 }, complete: true, missing_currencies: [], fx_is_demo: true,
        },
        {
          month: '2026-10-01', as_of: '2026-10-05', is_partial: true, reporting_currency: 'USD',
          mrr: null, arr: null, active_customers: 51, active_subscriptions: 95,
          mrr_native: { BOB: 7000 }, complete: false, missing_currencies: ['BOB'], fx_is_demo: false,
        },
      ],
      error: null,
    });
    const { result } = renderHook(
      () => useExecutiveMrrSeries({ from: '2026-09-01', to: '2026-10-31', reportingCurrency: 'USD' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('executive_mrr_series', {
      p_from: '2026-09-01',
      p_to: '2026-10-31',
      p_reporting_currency: 'USD',
    });
    const [sep, oct] = result.current.data!;
    expect(sep).toMatchObject({ mrr: 55669.85, native: { PEN: 51200, USD: 20000 }, fxIsDemo: true });
    expect(oct).toMatchObject({ mrr: null, arr: null, isPartial: true, complete: false, missingCurrencies: ['BOB'] });
  });

  it('un error de la base se propaga (la UI muestra «No se pudo leer», no un cero)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'MONEDA_INVALIDA' } });
    const { result } = renderHook(() => useExecutiveMrrSeries({ reportingCurrency: 'XYZ' }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('MONEDA_INVALIDA');
  });
});

describe('useExecutiveMrrMovements', () => {
  it('mapea el puente y respeta su invariante', async () => {
    rpc.mockResolvedValue({
      data: [{
        month: '2026-08-01', as_of: '2026-08-31', reporting_currency: 'USD',
        opening_mrr: 53365.44, new_mrr: 970, expansion_mrr: 1382.86, contraction_mrr: 120, churn_mrr: 1310,
        closing_mrr: 54288.3, prior_closing_mrr: 53278.84, fx_revaluation: 86.6,
        new_customers: 1, expansion_customers: 3, contraction_customers: 1, churned_customers: 1, complete: true,
      }],
      error: null,
    });
    const { result } = renderHook(() => useExecutiveMrrMovements('2026-08-01', 'USD'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('executive_mrr_movements', { p_month: '2026-08-01', p_reporting_currency: 'USD' });
    const b = result.current.data!;
    expect(b.opening! + b.newMrr! + b.expansion! - b.contraction! - b.churn!).toBeCloseTo(b.closing!, 2);
    expect(b.priorClosing! + b.fxRevaluation!).toBeCloseTo(b.opening!, 2);
  });
});

describe('useExecutiveMrrMix', () => {
  it('envía la dimensión pedida', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderHook(() => useExecutiveMrrMix('MARKET', '2026-09-01'), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('executive_mrr_mix', {
      p_dimension: 'MARKET',
      p_month: '2026-09-01',
      p_reporting_currency: undefined,
    });
  });
});

describe('useExecutiveAging', () => {
  it('ordena las 6 bandas y resume la cobertura', async () => {
    const band = (aging_bucket: string, bucket_order: number, balance: number | null, complete = true) => ({
      as_of: '2026-10-05', aging_bucket, bucket_order, invoice_count: balance ? 2 : 0, balance,
      balance_native: balance ? { USD: balance } : {}, reporting_currency: 'USD', complete,
      missing_currencies: complete ? [] : ['BOB'], fx_is_demo: false,
    });
    rpc.mockResolvedValue({
      data: [band('D90_MAS', 5, 300), band('VIGENTE', 1, 1000), band('SIN_FECHA', 6, 0),
             band('D1_30', 2, null, false), band('D61_90', 4, 0), band('D31_60', 3, 0)],
      error: null,
    });
    const { result } = renderHook(() => useExecutiveAging(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const a = result.current.data!;
    expect(a.buckets.map((b) => b.bucket)).toEqual(['VIGENTE', 'D1_30', 'D31_60', 'D61_90', 'D90_MAS', 'SIN_FECHA']);
    expect(a.buckets[1]).toMatchObject({ balance: null, missingCurrencies: ['BOB'] });
    expect(a.complete).toBe(false);
  });
});
