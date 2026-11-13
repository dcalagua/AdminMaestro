import type { ReactNode } from 'react';

/**
 * V6 (promovido a `ui` en F5): un gráfico sin datos se pliega a UNA línea («Caja semanal: sin cobros
 * confirmados en las últimas 12 semanas.») en vez de una tarjeta vacía de
 * 180–200 px que empuja la tabla.
 */
export function EmptyChartLine({ title, children }: { title: string; children: ReactNode }) {
  return (
    <p
      className="ebim-card mb-6 flex flex-wrap items-center gap-x-2 px-5 py-3 text-compact text-muted"
      data-chart-empty={title}
    >
      <span className="font-semibold text-fg-2">{title}:</span>
      <span>{children}</span>
    </p>
  );
}
