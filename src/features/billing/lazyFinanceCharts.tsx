import { lazy, Suspense, type ComponentProps } from 'react';
import { ChartSkeleton } from '@/features/executive/components/ChartPanel';

/**
 * Carga perezosa de los gráficos de Finanzas: Recharts (~170 kB gzip) solo se
 * descarga cuando una pantalla pinta un gráfico, no con el listado (decisión de
 * la fase 05). Mientras llega, el esqueleto tiene la forma del gráfico (§5.12).
 */
const PeriodBarsImpl = lazy(() => import('./financeCharts').then((m) => ({ default: m.PeriodBars })));

export type PeriodBarsProps = ComponentProps<typeof PeriodBarsImpl>;
export type { PeriodDatum, PeriodSeries } from './financeCharts';

export function PeriodBars(props: PeriodBarsProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 240} />}>
      <PeriodBarsImpl {...props} />
    </Suspense>
  );
}
