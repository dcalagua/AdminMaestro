import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { combineStates, fromQuery, type DataState } from './dataState';
import {
  buildReportContext,
  compareToPrevious,
  lastMonths,
  managementMargin,
  monthPeriod,
} from './reportContext';
import { KPI_DICTIONARY, consolidatedMetricState, overdueByCurrency } from './kpis';
import type { ConsolidatedGroup } from '@/types/domain';

describe('DataState: error, vacío y cero son cosas distintas', () => {
  it('un error de consulta es error, no una lista vacía', () => {
    expect(fromQuery({ error: new Error('timeout') })).toEqual({ status: 'error', message: 'timeout' });
  });

  it('permiso denegado se presenta como sin acceso', () => {
    expect(fromQuery({ error: new Error('permission denied for view v_invoice_balances') }).status).toBe('forbidden');
  });

  it('función ausente en el backend = no disponible (entorno sin migración), no cero', () => {
    const s = fromQuery({ error: { message: 'Could not find the function platform.invoice_summary' } });
    expect(s.status).toBe('unavailable');
  });

  it('un cero real es un dato completo; un array vacío es «sin actividad»', () => {
    expect(fromQuery({ data: 0 })).toMatchObject({ status: 'ready', data: 0 });
    expect(fromQuery({ data: [] }).status).toBe('empty');
  });

  it('sin data y sin error = cargando', () => {
    expect(fromQuery({ isLoading: true }).status).toBe('loading');
  });
});

describe('Margen gerencial (K05) no se completa con fuentes ausentes', () => {
  type Amounts = Record<string, number>;
  const ok = (data: Amounts): DataState<Amounts> => ({ status: 'ready', data });

  it('error de costos → margen parcial, nunca completo', () => {
    const s = combineStates<{ collected: Amounts; cost: Amounts; commission: Amounts }>(
      { collected: ok({ USD: 100 }), cost: { status: 'error', message: 'boom' } as DataState<Amounts>, commission: ok({ USD: 5 }) },
      { collected: 'Cobrado', cost: 'Costos', commission: 'Comisiones' },
    );
    expect(s.status).toBe('partial');
    if (s.status === 'partial') {
      expect(s.reasons.join()).toContain('Costos');
      expect(managementMargin(s.data.collected ?? null, s.data.cost ?? null, s.data.commission ?? null)).toBeNull();
    }
  });

  it('con las tres fuentes, calcula por moneda sin mezclar', () => {
    expect(managementMargin({ USD: 100, PEN: 50 }, { USD: 30 }, { PEN: 5 })).toEqual({ USD: 70, PEN: 45 });
  });

  it('todas las fuentes en error → error, no margen cero', () => {
    const err = { status: 'error', message: 'x' } as DataState<number>;
    expect(combineStates({ a: err, b: err }, { a: 'A', b: 'B' }).status).toBe('error');
  });
});

describe('FX faltante no produce cero (AC09)', () => {
  const group = (complete: boolean, reporting: number | null): ConsolidatedGroup =>
    ({
      key: 'TOTAL',
      label: 'Total',
      native_margin: {},
      margin: { reporting_amount: null, complete: false },
      metrics: {
        COLLECTED: { native: { PEN: 100, USD: 50 }, reporting_amount: reporting, complete, missing_currencies: complete ? [] : ['PEN'] },
      },
    }) as unknown as ConsolidatedGroup;

  it('conversión incompleta → parcial con la moneda que falta', () => {
    const s = consolidatedMetricState(group(false, null), 'COLLECTED');
    expect(s.status).toBe('partial');
    if (s.status === 'partial') {
      expect(s.data.reporting).toBeNull();
      expect(s.data.native).toEqual({ PEN: 100, USD: 50 });
      expect(s.reasons[0]).toContain('PEN');
    }
  });

  it('conversión completa → dato', () => {
    expect(consolidatedMetricState(group(true, 77.5), 'COLLECTED')).toMatchObject({ status: 'ready', data: { reporting: 77.5 } });
  });
});

describe('Período, FX y foto actual separados (AC08)', () => {
  const today = new Date(2026, 8, 25); // 25-sep-2026

  it('seleccionar un mes pasado no mueve la foto actual del MRR', () => {
    const past = buildReportContext('2026-06', '2026-09-25', today);
    const now = buildReportContext('2026-09', '2026-09-25', today);
    expect(past.snapshotDate).toBe('2026-09-25');
    expect(now.snapshotDate).toBe('2026-09-25');
    expect(past.period).toMatchObject({ start: '2026-06-01', end: '2026-06-30', partial: false });
  });

  it('cambiar la fecha FX no cambia el período', () => {
    const a = buildReportContext('2026-09', '2026-09-01', today);
    const b = buildReportContext('2026-09', '2026-09-25', today);
    expect(a.period).toEqual(b.period);
    expect(a.fxDate).not.toBe(b.fxDate);
  });

  it('el mes en curso se rotula parcial', () => {
    expect(monthPeriod('2026-09', today).partial).toBe(true);
    expect(monthPeriod('2026-09', today).label).toBe('septiembre 2026');
  });

  it('lastMonths cruza el año correctamente', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('Comparación con el período anterior (K02)', () => {
  it('base anterior cero → no comparable, nunca infinito', () => {
    expect(compareToPrevious(100, 0)).toMatchObject({ kind: 'not-comparable' });
  });
  it('mes parcial → no comparable', () => {
    expect(compareToPrevious(100, 80, { currentPartial: true }).kind).toBe('not-comparable');
  });
  it('dos meses completos → variación', () => {
    expect(compareToPrevious(120, 100)).toEqual({ kind: 'delta', ratio: 0.2 });
  });
});

describe('Cartera vencida (K04)', () => {
  it('sólo bandas vencidas; «Sin fecha» y vigente no cuentan; saldo negativo se conserva', () => {
    const rows = [
      { currency: 'USD', aging_bucket: 'VIGENTE', invoice_count: 1, balance: '100' },
      { currency: 'USD', aging_bucket: 'D1_30', invoice_count: 1, balance: '40.10' },
      { currency: 'USD', aging_bucket: 'D90_MAS', invoice_count: 2, balance: '-5.10' },
      { currency: 'USD', aging_bucket: 'SIN_FECHA', invoice_count: 1, balance: '999' },
      { currency: 'PEN', aging_bucket: 'D31_60', invoice_count: 1, balance: 10 },
    ];
    expect(overdueByCurrency(rows)).toEqual({ USD: 35, PEN: 10 });
  });
});

describe('Diccionario KPI', () => {
  it('K01–K06 definidos con fuente y detalle', () => {
    expect(Object.keys(KPI_DICTIONARY)).toEqual(['K01', 'K02', 'K03', 'K04', 'K05', 'K06']);
    for (const k of Object.values(KPI_DICTIONARY)) {
      expect(k.source).toMatch(/platform\./);
      expect(k.detailHref.startsWith('/')).toBe(true);
    }
  });

  it('el documento legible nombra cada KPI y su fuente', () => {
    const doc = readFileSync(resolve(process.cwd(), 'docs/finance/EXECUTIVE_KPI_DICTIONARY.md'), 'utf8');
    for (const k of Object.values(KPI_DICTIONARY)) {
      expect(doc).toContain(`${k.id} — ${k.name}`);
      expect(doc).toContain(k.source.split(' ')[0]!);
    }
  });
});
