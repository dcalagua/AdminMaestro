import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SingleBars } from './charts';
import { BilledCollectedChart } from './executiveCharts';
import { PeriodBars } from '@/features/billing/financeCharts';

/* V5 · F7 · Cada gráfico lleva su descripción equivalente en texto, aunque la tabla esté oculta. */

describe('descripción equivalente de los gráficos', () => {
  it('barras simples: el gráfico se describe con su resumen', () => {
    render(
      <SingleBars
        ariaLabel="Cobrado por mes"
        currency="USD"
        data={[
          { key: 'a', label: 'ago', value: 100 },
          { key: 's', label: 'set', value: 300 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Cobrado por mes' })).toHaveAccessibleDescription(
      /Cobrado por mes: 2 puntos, de ago a set\. Máximo en set, .*300.*Último: set/,
    );
  });

  it('facturado vs cobrado: describe las dos series y marca el mes parcial', () => {
    render(
      <BilledCollectedChart
        ariaLabel="Facturado vs cobrado"
        currency="USD"
        data={[
          { month: '2026-09', label: 'set', invoiced: 1000, collected: 800, rate: 0.8, invoices: 3, payments: 2, partial: false },
          { month: '2026-10', label: 'oct', invoiced: 500, collected: null, rate: null, invoices: 1, payments: 0, partial: true },
        ]}
      />,
    );
    const img = screen.getByRole('img', { name: 'Facturado vs cobrado' });
    expect(img).toHaveAccessibleDescription(/^Facturado: 2 puntos, de set a oct \(parcial\)\..*Cobrado: set, /);
  });

  it('barras por período de Cobranza: resumen por serie', () => {
    render(
      <PeriodBars
        ariaLabel="Cobros por semana"
        unit={{ currency: 'PEN' }}
        series={[{ key: 'c', label: 'Cobrado', color: 'var(--chart-1)' }]}
        data={[
          { key: '1', label: '1 sep', title: 'semana del 1 sep', values: { c: 10 } },
          { key: '2', label: '8 sep', title: 'semana del 8 sep', values: { c: 20 }, partial: true },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Cobros por semana' })).toHaveAccessibleDescription(
      /Cobrado: 2 puntos, de semana del 1 sep a semana del 8 sep \(en curso\)/,
    );
  });
});
