import { formatCurrencyMap, formatMoney } from '@/lib/format';
import type { ConsolidatedGroup, ConsolidatedMetricKey } from '@/types/domain';

/**
 * Presentación del consolidado (V3 · fase 13). Pura y probada sin React.
 *
 * Regla que protege al lector: en modo CONSOLIDADO una cifra solo se muestra
 * como número si su conversión está COMPLETA. Si falta una tasa se muestra
 * «Incompleto» con la moneda que falta y los importes nativos como ayuda: un
 * total parcial presentado como total es exactamente el error a evitar.
 */

export type DashboardMode = 'NATIVE' | 'CONSOLIDATED';

export interface MetricDisplay {
  value: string;
  hint?: string;
  tone: 'neutral' | 'ok' | 'warn' | 'danger';
  complete: boolean;
}

export function metricDisplay(
  group: ConsolidatedGroup | null | undefined,
  key: ConsolidatedMetricKey,
  mode: DashboardMode,
  reportingCurrency: string | null | undefined,
): MetricDisplay {
  const metric = group?.metrics[key];
  const native = metric?.native ?? {};
  const nativeText = formatCurrencyMap(native);

  if (mode === 'NATIVE') {
    return { value: nativeText, tone: 'neutral', complete: true, hint: 'Por moneda, sin conversión' };
  }

  if (!reportingCurrency) {
    return { value: 'Sin moneda de reporte', tone: 'warn', complete: false, hint: nativeText };
  }

  if (!metric) {
    return { value: formatMoney(0, reportingCurrency), tone: 'neutral', complete: true };
  }

  if (!metric.complete || metric.reporting_amount === null) {
    return {
      value: 'Incompleto',
      tone: 'warn',
      complete: false,
      hint: `Falta FX: ${metric.missing_currencies.join(', ') || '—'} · nativo: ${nativeText}`,
    };
  }

  const onlyReportingCurrency = Object.keys(native).every((c) => c === reportingCurrency);
  return {
    value: formatMoney(metric.reporting_amount, reportingCurrency),
    tone: 'neutral',
    complete: true,
    // El «≈ nativo» solo aporta cuando hubo conversión.
    hint: onlyReportingCurrency ? 'Sin conversión: ya está en la moneda de reporte' : `≈ ${nativeText}`,
  };
}

export function marginDisplay(
  group: ConsolidatedGroup | null | undefined,
  mode: DashboardMode,
  reportingCurrency: string | null | undefined,
): MetricDisplay {
  if (mode === 'NATIVE') {
    const native = group?.native_margin ?? {};
    const negative = Object.values(native).some((v) => Number(v) < 0);
    return {
      value: formatCurrencyMap(native),
      tone: negative ? 'danger' : 'ok',
      complete: true,
      hint: 'cobrado − costo − comisión, dentro de cada moneda',
    };
  }
  if (!group) {
    return { value: reportingCurrency ? formatMoney(0, reportingCurrency) : '—', tone: 'neutral', complete: true };
  }
  if (!reportingCurrency || !group.margin.complete || group.margin.reporting_amount === null) {
    return {
      value: 'No calculable',
      tone: 'warn',
      complete: false,
      hint: 'El margen consolidado exige convertir cobrado, costos y comisiones',
    };
  }
  return {
    value: formatMoney(group.margin.reporting_amount, reportingCurrency),
    tone: group.margin.reporting_amount >= 0 ? 'ok' : 'danger',
    complete: true,
    hint: 'cobrado − costo − comisión, en moneda de reporte',
  };
}

/** Tasa legible: `1 PEN = 0.2667 USD`. */
export function formatRateLabel(from: string, to: string, rate: number): string {
  const value = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(rate);
  return `1 ${from} = ${value} ${to}`;
}
