import type {
  AgingBucket,
  ExecutiveAging,
  ExecutiveMrrBridge,
  ExecutiveMrrMixRow,
  ExecutiveMrrMovementCustomer,
  MrrMovementKind,
} from '@/services/queries';
import { currentMonth, lastMonths, previousMonth } from '@/features/executive/reportContext';
import { formatCompactAmount } from '@/lib/format';
import { MONTH_SHORT } from './executiveData';

/**
 * Lógica pura del Resumen Ejecutivo (fase 09, D-V05). Sin React ni consultas:
 * aquí se decide qué mes se analiza, cómo se comparan los meses y cómo se
 * arman el puente, los tops y la cartera. La base ya trae los importes en
 * moneda de reporte (S01–S08); esto solo elige, ordena y compara. Un importe
 * `null` (falta tasa) se propaga como `null`: nunca se convierte en 0.
 */

export type Horizon = 12 | 18;
export const HORIZONS: readonly Horizon[] = [12, 18];

/** Mes analizado por defecto: el último CERRADO (el mes en curso es parcial, nota [08]). */
export function lastClosedMonth(today: Date = new Date()): string {
  return previousMonth(currentMonth(today));
}

/**
 * Etiqueta de eje de mes (§6.3): mes abreviado y el año de 2 cifras solo en
 * enero o en el primer punto (`may 25 · jun · … · ene 26 · feb`).
 */
export function axisMonth(data: ReadonlyArray<{ month: string }>, month: string | undefined): string {
  if (!month) return '';
  const [y, m] = month.split('-') as [string, string];
  const short = MONTH_SHORT[Number(m) - 1] ?? '';
  return month === data[0]?.month || m === '01' ? `${short} ${y.slice(2)}` : short;
}

/** `2026-09` → `set 2026` (abreviatura es-PE, igual que las fechas de las tablas). */
export function monthLongLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

/** Opciones del selector de mes: el más reciente primero; el mes en curso rotulado parcial. */
export function analyzedMonthOptions(today: Date = new Date(), count = 12) {
  const now = currentMonth(today);
  return lastMonths(now, count)
    .reverse()
    .map((m) => ({ value: m, label: m === now ? `${monthLongLabel(m)} (en curso, parcial)` : monthLongLabel(m), partial: m === now }));
}

export function monthKey(isoDay: string): string {
  return isoDay.slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Punto de una serie mensual para el mes `YYYY-MM`. */
export function pointAt<T extends { month: string }>(rows: readonly T[] | undefined, month: string): T | undefined {
  return rows?.find((r) => monthKey(r.month) === month);
}

/** Los `n` puntos que terminan en `month` (incluido), en orden cronológico. */
export function trailing<T extends { month: string }>(rows: readonly T[] | undefined, month: string, n = 12): T[] {
  return (rows ?? []).filter((r) => monthKey(r.month) <= month).slice(-n);
}

/** Variación relativa (razón). Sin base comparable → null («—»), nunca ±∞ ni 0 inventado. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** NRR del mes = (inicio + expansión − contracción − churn) / inicio. Sin inicio no hay tasa. */
export function netRevenueRetention(b: ExecutiveMrrBridge | undefined | null): number | null {
  if (!b || !b.complete || b.opening == null || b.opening === 0) return null;
  if (b.expansion == null || b.contraction == null || b.churn == null) return null;
  return (b.opening + b.expansion - b.contraction - b.churn) / b.opening;
}

/** Churn de MRR del mes = churn / inicio. */
export function mrrChurnRate(b: ExecutiveMrrBridge | undefined | null): number | null {
  if (!b || !b.complete || b.opening == null || b.opening === 0 || b.churn == null) return null;
  return b.churn / b.opening;
}

/* ---- Puente de MRR (waterfall) ---------------------------------------------------- */

export type BridgeStepKey = 'OPENING' | 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURN' | 'NET' | 'CLOSING';

export interface BridgeStep {
  key: BridgeStepKey;
  label: string;
  /** Movimiento del detalle por cliente (los totales no tienen). */
  movement?: Exclude<MrrMovementKind, 'FLAT'>;
  kind: 'total' | 'pos' | 'neg';
  /** Importe del paso (positivo; `kind` da el sentido). */
  value: number;
  /** Tramo de la barra flotante [desde, hasta] relativo al MRR de inicio (inicio = 0). */
  range: [number, number];
  customers?: number;
}

/**
 * Pasos del puente en orden fijo inicio → nuevo → expansión → contracción →
 * churn → cierre. `null` si el puente no está completo (falta tasa): el panel lo
 * dice en lugar de dibujar barras falsas.
 */
export function bridgeSteps(b: ExecutiveMrrBridge | undefined | null): BridgeStep[] | null {
  if (!b || !b.complete) return null;
  const { opening, newMrr, expansion, contraction, churn, closing } = b;
  if (opening == null || newMrr == null || expansion == null || contraction == null || churn == null || closing == null) {
    return null;
  }
  let level = 0;
  const move = (value: number, sign: 1 | -1): [number, number] => {
    const from = level;
    level += sign * value;
    return sign > 0 ? [from, level] : [level, from];
  };
  return [
    { key: 'OPENING', label: 'Inicio', kind: 'total', value: opening, range: [0, 0] },
    { key: 'NEW', label: 'Nuevo', movement: 'NEW', kind: 'pos', value: newMrr, customers: b.newCustomers, range: move(newMrr, 1) },
    { key: 'EXPANSION', label: 'Expansión', movement: 'EXPANSION', kind: 'pos', value: expansion, customers: b.expansionCustomers, range: move(expansion, 1) },
    { key: 'CONTRACTION', label: 'Contracción', movement: 'CONTRACTION', kind: 'neg', value: contraction, customers: b.contractionCustomers, range: move(contraction, -1) },
    { key: 'CHURN', label: 'Churn', movement: 'CHURN', kind: 'neg', value: churn, customers: b.churnedCustomers, range: move(churn, -1) },
    { key: 'CLOSING', label: 'Cierre', kind: 'total', value: closing, range: [0, 0] },
  ];
}

/**
 * Cascada de la VARIACIÓN del mes: los cuatro movimientos encadenados desde 0
 * y la variación neta (= cierre − inicio). Inicio y cierre (~50 veces mayores
 * que un movimiento) van como cifras aparte: dibujarlos como barras desde cero
 * aplastaría los movimientos, que son la historia del puente.
 */
export function changeSteps(steps: BridgeStep[] | null): BridgeStep[] | null {
  if (!steps) return null;
  const movers = steps.filter((s) => s.movement);
  const opening = steps.find((s) => s.key === 'OPENING')!.value;
  const closing = steps.find((s) => s.key === 'CLOSING')!.value;
  const net = Math.round((closing - opening) * 100) / 100;
  return [
    ...movers,
    {
      key: 'NET',
      label: 'Variación neta',
      kind: 'total',
      value: net,
      range: net >= 0 ? [0, net] : [net, 0],
    },
  ];
}

/** Etiqueta con signo de un paso: `+USD 3.2 K`, `−USD 0.8 K`, `USD 55.7 K`. */
export function stepSign(step: Pick<BridgeStep, 'kind' | 'value' | 'key'>): string {
  if (step.kind === 'pos') return '+';
  if (step.kind === 'neg') return '−';
  if (step.key === 'NET') return step.value > 0 ? '+' : step.value < 0 ? '−' : '';
  return '';
}

export function stepLabel(step: Pick<BridgeStep, 'kind' | 'value' | 'key'>, currency: string): string {
  return `${stepSign(step)}${currency} ${formatCompactAmount(Math.abs(step.value))}`;
}

/** Clientes que componen un movimiento, del mayor cambio al menor. */
export function customersFor(
  rows: readonly ExecutiveMrrMovementCustomer[] | undefined,
  movement: MrrMovementKind,
): ExecutiveMrrMovementCustomer[] {
  return (rows ?? [])
    .filter((r) => r.movement === movement)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}

/* ---- Tops ------------------------------------------------------------------------- */

export interface RankedRow {
  key: string;
  label: string;
  mrr: number;
  /** Participación en el total del mes (0–1). */
  share: number | null;
  /** Variación vs el mes anterior (razón); null si no existía o falta tasa. */
  change: number | null;
  isNew: boolean;
}

/** Top `n` clientes por MRR al cierre del mes, desde el detalle del puente (S03). */
export function topCustomers(rows: readonly ExecutiveMrrMovementCustomer[] | undefined, n = 5): RankedRow[] {
  const live = (rows ?? []).filter((r) => r.closing != null && r.closing > 0);
  const total = live.reduce((t, r) => t + (r.closing ?? 0), 0);
  return live
    .sort((a, b) => (b.closing ?? 0) - (a.closing ?? 0))
    .slice(0, n)
    .map((r) => ({
      key: r.organizationId,
      label: r.organizationName ?? 'Organización sin nombre',
      mrr: r.closing!,
      share: total > 0 ? r.closing! / total : null,
      change: r.movement === 'NEW' ? null : pctChange(r.closing, r.opening),
      isNew: r.movement === 'NEW',
    }));
}

export const DIRECT_CHANNEL = 'DIRECTO';

/** Top partners por MRR (S08) con su variación contra el mismo mix del mes anterior. */
export function topPartners(
  current: readonly ExecutiveMrrMixRow[] | undefined,
  previous: readonly ExecutiveMrrMixRow[] | undefined,
  n = 5,
): RankedRow[] {
  return (current ?? [])
    .filter((r) => r.key !== DIRECT_CHANNEL && r.mrr != null && r.mrr > 0)
    .sort((a, b) => (b.mrr ?? 0) - (a.mrr ?? 0))
    .slice(0, n)
    .map((r) => {
      const before = previous?.find((p) => p.key === r.key);
      return {
        key: r.key,
        label: r.label,
        mrr: r.mrr!,
        share: r.share,
        change: before ? pctChange(r.mrr, before.mrr) : null,
        isNew: !before,
      };
    });
}

/* ---- Cartera por antigüedad -------------------------------------------------------- */

export const OVERDUE_BANDS: ReadonlyArray<{ bucket: AgingBucket; label: string; token: string }> = [
  { bucket: 'D1_30', label: '1–30 días', token: 'var(--chart-age-1)' },
  { bucket: 'D31_60', label: '31–60 días', token: 'var(--chart-age-2)' },
  { bucket: 'D61_90', label: '61–90 días', token: 'var(--chart-age-3)' },
  { bucket: 'D90_MAS', label: 'Más de 90 días', token: 'var(--chart-age-4)' },
];

export interface AgingSegment {
  bucket: AgingBucket;
  label: string;
  token: string;
  balance: number | null;
  invoiceCount: number;
  /** Parte de la cartera vencida (0–1). */
  share: number | null;
}

export function agingSummary(aging: ExecutiveAging | null | undefined) {
  if (!aging) return null;
  const find = (b: AgingBucket) => aging.buckets.find((x) => x.bucket === b);
  const overdueRows = OVERDUE_BANDS.map((band) => find(band.bucket));
  const complete = overdueRows.every((r) => !r || r.complete);
  const total = complete ? overdueRows.reduce((t, r) => t + (r?.balance ?? 0), 0) : null;
  const segments: AgingSegment[] = OVERDUE_BANDS.map((band, i) => {
    const row = overdueRows[i];
    return {
      ...band,
      balance: row ? row.balance : 0,
      invoiceCount: row?.invoiceCount ?? 0,
      share: total && row?.balance != null ? row.balance / total : null,
    };
  });
  return {
    asOf: aging.asOf,
    segments,
    overdue: total,
    overdueInvoices: overdueRows.reduce((t, r) => t + (r?.invoiceCount ?? 0), 0),
    current: find('VIGENTE') ?? null,
    noDueDate: find('SIN_FECHA') ?? null,
    complete,
    missingCurrencies: [...new Set(aging.buckets.flatMap((b) => b.missingCurrencies))].sort(),
  };
}
