import { describe, expect, it } from 'vitest';
import type { ExecutiveAging, ExecutiveMrrBridge, ExecutiveMrrMixRow, ExecutiveMrrMovementCustomer } from '@/services/queries';
import {
  agingSummary,
  analyzedMonthOptions,
  axisMonth,
  bridgeSteps,
  changeSteps,
  customersFor,
  lastClosedMonth,
  monthBounds,
  mrrChurnRate,
  netRevenueRetention,
  pctChange,
  stepLabel,
  topCustomers,
  topPartners,
  trailing,
} from './executiveModel';

const bridge = (over: Partial<ExecutiveMrrBridge> = {}): ExecutiveMrrBridge => ({
  month: '2026-09-01', asOf: '2026-09-30', reportingCurrency: 'USD',
  opening: 54353.28, newMrr: 0, expansion: 1388.57, contraction: 72, churn: 0, closing: 55669.85,
  priorClosing: 54288.3, fxRevaluation: 64.98, newCustomers: 0, expansionCustomers: 2, contractionCustomers: 1, churnedCustomers: 0,
  complete: true, ...over,
});

describe('mes analizado', () => {
  it('por defecto es el último mes cerrado, y el mes en curso se ofrece rotulado parcial', () => {
    const today = new Date(2026, 9, 5);
    expect(lastClosedMonth(today)).toBe('2026-09');
    const opts = analyzedMonthOptions(today, 12);
    expect(opts).toHaveLength(12);
    expect(opts[0]).toEqual({ value: '2026-10', label: 'oct 2026 (en curso, parcial)', partial: true });
    expect(opts[1]!.label).toBe('set 2026');
    expect(lastClosedMonth(new Date(2026, 0, 15))).toBe('2025-12');
  });

  it('límites del mes y tramos de serie', () => {
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    const rows = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => ({ month: `${m}-01` }));
    expect(trailing(rows, '2026-09', 3).map((r) => r.month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('eje de meses: año solo en enero o en el primer punto', () => {
    const data = ['2025-11', '2025-12', '2026-01', '2026-02'].map((month) => ({ month }));
    expect(data.map((d) => axisMonth(data, d.month))).toEqual(['nov 25', 'dic', 'ene 26', 'feb']);
  });
});

describe('variaciones y retención', () => {
  it('sin base comparable no hay variación (nunca ±∞ ni un 0 inventado)', () => {
    expect(pctChange(110, 100)).toBeCloseTo(0.1);
    expect(pctChange(90, -100)).toBeCloseTo(1.9);
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(null, 10)).toBeNull();
    expect(pctChange(10, undefined)).toBeNull();
  });

  it('NRR y churn del mes salen del puente; incompleto o sin inicio → null', () => {
    const b = bridge({ opening: 50000, expansion: 1700, contraction: 200, churn: 300 });
    expect(netRevenueRetention(b)).toBeCloseTo(1.024);
    expect(mrrChurnRate(b)).toBeCloseTo(0.006);
    expect(netRevenueRetention(bridge({ complete: false }))).toBeNull();
    expect(netRevenueRetention(bridge({ opening: 0 }))).toBeNull();
    expect(mrrChurnRate(null)).toBeNull();
  });
});

describe('puente de MRR', () => {
  it('los pasos van en orden fijo y la cascada de variación termina en cierre − inicio', () => {
    const steps = bridgeSteps(bridge())!;
    expect(steps.map((s) => s.key)).toEqual(['OPENING', 'NEW', 'EXPANSION', 'CONTRACTION', 'CHURN', 'CLOSING']);
    const cascade = changeSteps(steps)!;
    expect(cascade.map((s) => s.key)).toEqual(['NEW', 'EXPANSION', 'CONTRACTION', 'CHURN', 'NET']);
    // Encadenado desde 0: nuevo [0,0], expansión [0,1388.57], contracción [1316.57,1388.57]…
    expect(cascade[1]!.range).toEqual([0, 1388.57]);
    expect(cascade[2]!.range[0]).toBeCloseTo(1316.57);
    const net = cascade[4]!;
    expect(net.value).toBe(1316.57);
    expect(net.value).toBeCloseTo(55669.85 - 54353.28);
    expect(stepLabel(net, 'USD')).toMatch(/^\+USD 1\.3\sK$/);
    expect(stepLabel(cascade[2]!, 'USD')).toBe('−USD 72');
  });

  it('una variación neta negativa se dibuja hacia la izquierda del 0', () => {
    const cascade = changeSteps(bridgeSteps(bridge({ opening: 1000, newMrr: 0, expansion: 0, contraction: 0, churn: 400, closing: 600 })))!;
    const net = cascade.find((s) => s.key === 'NET')!;
    expect(net.range).toEqual([-400, 0]);
    expect(stepLabel(net, 'PEN')).toBe('−PEN 400');
  });

  it('sin tasa no hay puente que dibujar', () => {
    expect(bridgeSteps(bridge({ complete: false }))).toBeNull();
    expect(bridgeSteps(bridge({ churn: null }))).toBeNull();
    expect(changeSteps(null)).toBeNull();
  });

  it('clientes de un movimiento, del mayor cambio al menor', () => {
    const rows = [
      { organizationId: 'a', movement: 'EXPANSION', delta: 100 },
      { organizationId: 'b', movement: 'EXPANSION', delta: 900 },
      { organizationId: 'c', movement: 'FLAT', delta: 0 },
    ] as ExecutiveMrrMovementCustomer[];
    expect(customersFor(rows, 'EXPANSION').map((r) => r.organizationId)).toEqual(['b', 'a']);
  });
});

describe('tops', () => {
  it('top clientes por MRR de cierre, con participación y variación; los nuevos no tienen %', () => {
    const rows = [
      { organizationId: 'a', organizationName: 'A', movement: 'EXPANSION', opening: 100, closing: 150, delta: 50, complete: true },
      { organizationId: 'b', organizationName: 'B', movement: 'NEW', opening: 0, closing: 300, delta: 300, complete: true },
      { organizationId: 'c', organizationName: 'C', movement: 'CHURN', opening: 80, closing: 0, delta: -80, complete: true },
      { organizationId: 'd', organizationName: null, movement: 'FLAT', opening: 50, closing: 50, delta: 0, complete: true },
    ] as ExecutiveMrrMovementCustomer[];
    const top = topCustomers(rows, 5);
    expect(top.map((r) => r.key)).toEqual(['b', 'a', 'd']);
    expect(top[0]).toMatchObject({ isNew: true, change: null, share: 0.6 });
    expect(top[1]!.change).toBeCloseTo(0.5);
    expect(top[2]!.label).toBe('Organización sin nombre');
  });

  it('top partners: sin venta directa, con variación contra el mes anterior', () => {
    const row = (key: string, mrr: number | null): ExecutiveMrrMixRow => ({
      key, label: key, mrr, share: null, activeCustomers: 1, activeSubscriptions: 1, native: {}, complete: mrr !== null, missingCurrencies: [],
    });
    const top = topPartners([row('DIRECTO', 9000), row('p1', 2000), row('p2', 3000), row('p3', null)], [row('p1', 1600)]);
    expect(top.map((r) => r.key)).toEqual(['p2', 'p1']);
    expect(top[0]!.isNew).toBe(true);
    expect(top[1]!.change).toBeCloseTo(0.25);
  });
});

describe('cartera por antigüedad', () => {
  const aging = (complete = true): ExecutiveAging => ({
    asOf: '2026-09-30', reportingCurrency: 'USD', complete, fxIsDemo: false,
    buckets: (
      [['VIGENTE', 3, 900], ['D1_30', 2, 600], ['D31_60', 1, 200], ['D61_90', 0, 0], ['D90_MAS', 1, 200], ['SIN_FECHA', 1, 50]] as const
    ).map(([bucket, invoiceCount, balance]) => ({
      bucket, invoiceCount, balance: complete || bucket !== 'D31_60' ? balance : null, native: {}, complete: complete || bucket !== 'D31_60',
      missingCurrencies: complete || bucket !== 'D31_60' ? [] : ['BOB'],
    })),
  });

  it('vencida = 4 tramos (sin vigente ni sin fecha) con su participación', () => {
    const s = agingSummary(aging())!;
    expect(s.overdue).toBe(1000);
    expect(s.overdueInvoices).toBe(4);
    expect(s.segments.map((x) => x.share)).toEqual([0.6, 0.2, 0, 0.2]);
    expect(s.current?.balance).toBe(900);
  });

  it('si a un tramo le falta tasa, el total vencido es null y se nombra la moneda', () => {
    const s = agingSummary(aging(false))!;
    expect(s.overdue).toBeNull();
    expect(s.complete).toBe(false);
    expect(s.missingCurrencies).toEqual(['BOB']);
    expect(agingSummary(null)).toBeNull();
  });
});
