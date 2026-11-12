import { describe, expect, it } from 'vitest';
import { consumptionVsIncluded, finalizedPeriods, meterKey, meterSeries, type AggregateLike } from './usageSeries';

const agg = (o: Partial<AggregateLike>): AggregateLike => ({
  product_code: 'esup',
  meter_code: 'ai.calls',
  period_start: '2026-08-01',
  status: 'FINALIZED',
  quantity: 10,
  allowance_included: null,
  overage_quantity: null,
  unit: 'call',
  ...o,
});

describe('usageSeries', () => {
  it('solo cuenta agregados FINALIZADOS: un período abierto no es definitivo', () => {
    const rows = [agg({}), agg({ period_start: '2026-09-01', status: 'OPEN', quantity: 99 })];
    expect(finalizedPeriods(rows)).toEqual(['2026-08-01']);
    expect(meterSeries(rows).get(meterKey('esup', 'ai.calls'))!.last).toEqual({ period: '2026-08-01', value: 10 });
  });

  it('suma tenants por mes; antes del primer agregado es null y después un mes sin agregado es 0', () => {
    const rows = [
      agg({ period_start: '2026-07-01', meter_code: 'other' }),
      agg({ period_start: '2026-08-01', quantity: 4 }),
      agg({ period_start: '2026-08-01', quantity: '6' }),
      agg({ period_start: '2026-09-01', meter_code: 'other', quantity: 2 }),
    ];
    const s = meterSeries(rows);
    expect(s.get(meterKey('esup', 'ai.calls'))!.values).toEqual([null, 10, 0]);
    expect(s.get(meterKey('esup', 'other'))!.values).toEqual([10, 0, 2]);
  });

  it('consumo vs incluido: compara solo lo que tiene asignación y suma el exceso', () => {
    const rows = [
      agg({ quantity: 1250, allowance_included: 1000, overage_quantity: 250 }),
      agg({ quantity: 300 }),
      agg({ meter_code: 'ocr', quantity: 7 }),
    ];
    const [calls, ocr] = consumptionVsIncluded(rows, '2026-08-01');
    expect(calls).toMatchObject({ consumed: 1550, included: 1000, consumedWithAllowance: 1250, overage: 250, tenants: 2 });
    expect(ocr).toMatchObject({ meterCode: 'ocr', included: null, consumed: 7 });
  });
});
