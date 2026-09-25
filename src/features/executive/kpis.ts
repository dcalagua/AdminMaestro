import type { ConsolidatedGroup, ConsolidatedMetricKey } from '@/types/domain';
import type { DataState } from './dataState';
import { toCurrencyAmounts, type CurrencyAmounts } from './reportContext';

/**
 * Diccionario de indicadores K01–K06 — spec §8.
 *
 * Es la fuente única de nombre, fuente, reglas y enlace a detalle de cada KPI.
 * La versión legible vive en `docs/finance/EXECUTIVE_KPI_DICTIONARY.md` y debe
 * coincidir con esto (lo comprueba `kpis.test.ts`).
 */
export type KpiId = 'K01' | 'K02' | 'K03' | 'K04' | 'K05' | 'K06';

export interface KpiDefinition {
  id: KpiId;
  name: string;
  /** Foto actual o movimiento del período. */
  temporality: 'SNAPSHOT' | 'PERIOD';
  unit: string;
  source: string;
  includes: string;
  excludes: string;
  precision: string;
  coverage: string;
  /** Ruta que abre exactamente el detalle que compone la cifra. */
  detailHref: string;
}

export const KPI_DICTIONARY: Record<KpiId, KpiDefinition> = {
  K01: {
    id: 'K01',
    name: 'MRR vigente',
    temporality: 'SNAPSHOT',
    unit: 'Importe mensual recurrente por moneda nativa (consolidado sólo con FX explícito)',
    source: 'platform.finance_consolidated (métrica MRR) ← v_subscription_mrr',
    includes: 'Ítems recurrentes vigentes hoy de suscripciones ACTIVE (MONTHLY ×1, QUARTERLY ÷3, YEARLY ÷12)',
    excludes: 'ONE_TIME, DISCOUNT, suscripciones no ACTIVE, ítems fuera de vigencia, tenants DEMO',
    precision: 'numeric(14,2) del backend; redondeo por ítem de la vista',
    coverage: 'Foto al momento de consulta; no existe serie histórica de MRR',
    detailHref: '/subscriptions',
  },
  K02: {
    id: 'K02',
    name: 'Cobrado del período',
    temporality: 'PERIOD',
    unit: 'Importe cobrado por moneda nativa',
    source: 'platform.collections_by_month ← v_collected_payments (fórmula de v_collected_revenue)',
    includes: 'Pagos CONFIRMED con paid_at dentro del período sobre facturas ISSUED/PARTIALLY_PAID/PAID',
    excludes: 'Pagos PENDING o REVERSED; facturas DRAFT, VOID, UNCOLLECTIBLE o de total 0',
    precision: 'Prorrateo por línea redondeado a 2 decimales (idéntico a v_collected_revenue)',
    coverage: 'Mes en curso rotulado como parcial; sin comparación contra base cero',
    detailHref: '/billing',
  },
  K03: {
    id: 'K03',
    name: 'Saldo por cobrar',
    temporality: 'SNAPSHOT',
    unit: 'Importe por moneda nativa',
    source: 'platform.invoice_summary (receivable) ← v_invoice_balances',
    includes: 'total − pagos CONFIRMED de facturas ISSUED/PARTIALLY_PAID/PAID',
    excludes: 'DRAFT, VOID, UNCOLLECTIBLE (se informan aparte); pagos en otra moneda no se compensan',
    precision: 'numeric(14,2); sobrepagos quedan negativos, sin recorte',
    coverage: 'Foto actual; no reconstruye saldos a fechas pasadas',
    // Todas las facturas: el saldo incluye sobrepagos (negativos) de facturas pagadas.
    detailHref: '/billing',
  },
  K04: {
    id: 'K04',
    name: 'Cartera vencida',
    temporality: 'SNAPSHOT',
    unit: 'Importe por moneda nativa y banda',
    source: 'platform.receivables_aging ← v_invoice_balances.aging_bucket',
    includes: 'Saldo con vencimiento anterior a hoy: 1–30, 31–60, 61–90, más de 90 días',
    excludes: 'Vigente (vence hoy o después) y «Sin fecha» (sin vencimiento), que se muestran aparte',
    precision: 'numeric(14,2)',
    coverage: 'Clasificación visual a la fecha de hoy; no es política de cobro',
    detailHref: '/billing?estado=OPEN',
  },
  K05: {
    id: 'K05',
    name: 'Margen gerencial',
    temporality: 'PERIOD',
    unit: 'Importe por moneda nativa (consolidado sólo con FX completo)',
    source: 'platform.finance_consolidated (native_margin / margin) ← v_finance_facts',
    includes: 'Cobrado − costo asignado − comisión no anulada, dentro del período',
    excludes: 'No es utilidad neta, EBITDA ni resultado contable; costo de plataforma no se reparte',
    precision: 'Suma por moneda antes de convertir; consolidado NULL si falta una tasa',
    coverage: 'Si falta una fuente (costos o comisiones) la cifra se marca no calculable',
    detailHref: '/costs',
  },
  K06: {
    id: 'K06',
    name: 'Renovaciones próximas',
    temporality: 'SNAPSHOT',
    unit: 'Contratos y MRR vigente por moneda en la ventana elegida',
    source: 'platform.v_renewal_pipeline ← v_renewal_dashboard + v_subscription_mrr',
    includes: 'Suscripciones ACTIVE/PAST_DUE con próxima renovación dentro de 7/15/30/45/60 días',
    excludes: 'Contratos sin fecha de renovación; no es pronóstico de churn',
    precision: 'MRR vigente de la suscripción (NULL si no tiene recurrente vigente)',
    coverage: 'Ventana contada desde hoy',
    detailHref: '/renewals',
  },
};

export const RENEWAL_WINDOWS = [7, 15, 30, 45, 60] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

/**
 * Lee una métrica del consolidado. En modo nativo siempre hay mapa por moneda;
 * el equivalente en moneda de reporte sólo cuenta como dato si la conversión
 * está COMPLETA. Si falta una tasa → `partial` con la moneda faltante, jamás 0.
 */
export function consolidatedMetricState(
  group: ConsolidatedGroup | null | undefined,
  key: ConsolidatedMetricKey,
): DataState<{ native: CurrencyAmounts; reporting: number | null }> {
  const metric = group?.metrics[key];
  if (!group || !metric) return { status: 'empty' };
  const native = toCurrencyAmounts(metric.native);
  const reporting = metric.reporting_amount === null ? null : Number(metric.reporting_amount);
  if (!metric.complete || reporting === null) {
    const missing = metric.missing_currencies ?? [];
    return {
      status: 'partial',
      data: { native, reporting: null },
      reasons: [`Sin tasa FX para ${missing.join(', ') || 'alguna moneda'}: el consolidado no se calcula`],
    };
  }
  return { status: 'ready', data: { native, reporting } };
}

export type AgingBucket = 'VIGENTE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_MAS' | 'SIN_FECHA' | 'A_FAVOR';

export const AGING_BUCKETS: Array<{ id: AgingBucket; label: string; overdue: boolean }> = [
  { id: 'VIGENTE', label: 'Vigente', overdue: false },
  { id: 'D1_30', label: '1–30 días', overdue: true },
  { id: 'D31_60', label: '31–60 días', overdue: true },
  { id: 'D61_90', label: '61–90 días', overdue: true },
  { id: 'D90_MAS', label: 'Más de 90 días', overdue: true },
  { id: 'SIN_FECHA', label: 'Sin fecha', overdue: false },
  // Sobrepago: saldo negativo a favor del cliente; visible, nunca «vencido».
  { id: 'A_FAVOR', label: 'Saldo a favor', overdue: false },
];

export interface AgingRow {
  currency: string;
  aging_bucket: string;
  invoice_count: number | string;
  balance: number | string;
}

/** Cartera vencida por moneda (K04): sólo bandas vencidas; «Sin fecha» nunca cuenta. */
export function overdueByCurrency(rows: readonly AgingRow[]): CurrencyAmounts {
  const overdue = new Set(AGING_BUCKETS.filter((b) => b.overdue).map((b) => b.id as string));
  const out: CurrencyAmounts = {};
  for (const r of rows) {
    if (!overdue.has(r.aging_bucket)) continue;
    out[r.currency] = Math.round(((out[r.currency] ?? 0) + Number(r.balance)) * 100) / 100;
  }
  return out;
}
