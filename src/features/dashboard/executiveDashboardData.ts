import { useSearchParams } from 'react-router-dom';
import {
  useExecutiveAging,
  useExecutiveBillingSeries,
  useExecutiveMrrMix,
  useExecutiveMrrMovementCustomers,
  useExecutiveMrrMovementsSeries,
  useExecutiveMrrSeries,
} from '@/services/queries';
import {
  currentMonth,
  isoDate,
  lastMonths,
  previousMonth,
} from '@/features/executive/reportContext';
import {
  analyzedMonthOptions,
  HORIZONS,
  lastClosedMonth,
  monthBounds,
  monthLongLabel,
  type Horizon,
} from './executiveModel';
import { longMonthName } from '@/features/billing/financeModel';
import { PRESENTATION_PARAM } from './presentation/presentationModel';
import { requestFullscreen } from './presentation/fullscreen';

/* ---- Datos del tablero (compartidos con el modo presentación) ------------------------ */

/** Todas las lecturas del Resumen Ejecutivo para la fila de filtros vigente (URL). */
export function useExecutiveDashboard(today: Date) {
  const filters = useExecutiveFilters(today);
  const { month, horizon, reportingCurrency } = filters;
  const now = currentMonth(today);
  const isCurrent = month === now;
  const prev = previousMonth(month);

  // 24 meses de serie: el horizonte (12/18) más la tendencia de 12 de cualquier mes analizado.
  const seriesFrom = `${lastMonths(now, 24)[0]}-01`;
  const series = useExecutiveMrrSeries({ from: seriesFrom, reportingCurrency });
  const billing = useExecutiveBillingSeries({ from: seriesFrom, reportingCurrency });
  const movements = useExecutiveMrrMovementsSeries({
    from: `${lastMonths(month, 12)[0]}-01`,
    to: `${month}-01`,
    reportingCurrency,
  });
  const customers = useExecutiveMrrMovementCustomers(`${month}-01`, reportingCurrency);
  const asOf = isCurrent ? isoDate(today) : monthBounds(month).to;
  const aging = useExecutiveAging(asOf, reportingCurrency);
  const mixProduct = useExecutiveMrrMix('PRODUCT', `${month}-01`, reportingCurrency);
  const mixMarket = useExecutiveMrrMix('MARKET', `${month}-01`, reportingCurrency);
  const mixPartner = useExecutiveMrrMix('PARTNER', `${month}-01`, reportingCurrency);
  const mixPartnerPrev = useExecutiveMrrMix('PARTNER', `${prev}-01`, reportingCurrency);

  const rc =
    series.data?.[0]?.reportingCurrency ??
    billing.data?.[0]?.reportingCurrency ??
    reportingCurrency ??
    '';
  const missing = [
    ...new Set(
      [...(series.data ?? []), ...(billing.data ?? [])].flatMap((p) => p.missingCurrencies),
    ),
  ].sort();
  const fxIsDemo = [...(series.data ?? []), ...(billing.data ?? [])].some((p) => p.fxIsDemo);
  const bridge = movements.data?.find((b) => b.month.slice(0, 7) === month) ?? null;

  return {
    filters,
    month,
    horizon,
    isCurrent,
    prev,
    /** «sep 2026» (paneles). */
    monthLabel: monthLongLabel(month),
    /** «septiembre 2026» (cabecera y subtítulos de la presentación). */
    monthFullLabel: `${longMonthName(month)} ${month.slice(0, 4)}`,
    /** Fecha de corte de los datos: cierre del mes analizado o hoy si es el mes en curso. */
    asOf,
    rc,
    missing,
    fxIsDemo,
    bridge,
    series,
    billing,
    movements,
    customers,
    aging,
    mixProduct,
    mixMarket,
    mixPartner,
    mixPartnerPrev,
  };
}

export type ExecutiveDashboardData = ReturnType<typeof useExecutiveDashboard>;

export function useExecutiveFilters(today: Date) {
  const [params, setParams] = useSearchParams();
  const options = analyzedMonthOptions(today, 12);
  const rawMonth = params.get('cierre') ?? '';
  const month = options.some((o) => o.value === rawMonth) ? rawMonth : lastClosedMonth(today);
  const rawHorizon = Number(params.get('horizonte'));
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(rawHorizon)
    ? (rawHorizon as Horizon)
    : 18;
  const rawCurrency = (params.get('moneda') ?? '').toUpperCase();
  const reportingCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined;
  const set = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  return {
    month,
    horizon,
    reportingCurrency,
    options,
    setMonth: (m: string) => set('cierre', m),
    setHorizon: (h: Horizon) => set('horizonte', String(h)),
    setCurrency: (c: string) => set('moneda', c),
    /** Abre el modo presentación (entrada nueva en el historial: «Atrás» lo cierra). */
    present: () => {
      // Pantalla completa solo se puede pedir dentro del clic; si el navegador la niega, el modo igual cubre la ventana.
      void requestFullscreen();
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(PRESENTATION_PARAM, '1');
        return next;
      });
    },
  };
}
