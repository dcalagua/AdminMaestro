import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StatCell, StatStrip } from './StatStrip';
import { KpiTile } from './primitives';
import { mockViewport } from '@/test/matchMedia';

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('StatStrip (V6 · T2)', () => {
  it('banda compacta: una sola tarjeta con una celda por cifra', () => {
    wrap(
      <StatStrip label="Resumen de cuentas">
        <StatCell label="Clientes activos" value="21" />
        <StatCell label="Con deuda" value="3" tone="warn" />
        {null}
      </StatStrip>,
    );
    const strip = screen.getByRole('region', { name: 'Resumen de cuentas' });
    expect(strip).toHaveAttribute('data-stat-strip', 'band');
    expect(strip.querySelectorAll('[data-stat-cell]')).toHaveLength(2);
    expect(within(strip).getByText('Requiere atención')).toHaveClass('sr-only');
  });

  it('montos multimoneda en una línea, cada uno con su monto completo en el title; nunca se suman', () => {
    wrap(
      <StatStrip label="Dinero">
        <StatCell label="MRR vigente" amounts={{ USD: 22_700, PEN: 3_210.5, BOB: 0 }} />
        <StatCell label="Saldo vencido" amounts={{}} emptyLabel="Nada vencido" />
      </StatStrip>,
    );
    const mrr = screen.getByText('MRR vigente').closest('[data-stat-cell]') as HTMLElement;
    expect(within(mrr).getByTitle(/PEN\s3,210\.50/)).toBeInTheDocument();
    expect(within(mrr).getByTitle(/USD\s22,700\.00/)).toBeInTheDocument();
    expect(mrr).not.toHaveTextContent('BOB');
    const overdue = screen.getByText('Saldo vencido').closest('[data-stat-cell]') as HTMLElement;
    expect(within(overdue).getByText('Nada vencido')).toBeInTheDocument();
  });

  it('una celda con onSelect filtra: es un botón con aria-pressed', () => {
    const onSelect = vi.fn();
    wrap(
      <StatStrip label="Filtros">
        <StatCell label="Con deuda" value="3" onSelect={onSelect} selected />
      </StatStrip>,
    );
    const button = screen.getByRole('button', { name: /Con deuda/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('sin dato dice «Sin datos», nunca 0; la carga y el error tienen su estado', () => {
    const retry = vi.fn();
    wrap(
      <StatStrip label="Estados">
        <StatCell label="Vacío" value={null} />
        <StatCell label="Cargando" loading />
        <StatCell label="Roto" error="x" onRetry={retry} />
      </StatStrip>,
    );
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando Cargando…');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalled();
  });

  it('compatibilidad: un KpiTile dentro de la banda se pinta como celda compacta (sin sparkline)', () => {
    const { container } = wrap(
      <StatStrip label="Compat">
        <KpiTile label="Tenants" value="12" footer="3 en demo" trend={[1, 2, 3]} />
      </StatStrip>,
    );
    const cell = container.querySelector('[data-stat-cell="Tenants"]') as HTMLElement;
    expect(cell).toHaveTextContent('12');
    expect(cell).toHaveTextContent('3 en demo');
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it('variant="tiles" conserva las tarjetas grandes para las tendencias', () => {
    const { container } = wrap(
      <StatStrip label="Tendencia" variant="tiles">
        <KpiTile label="Cobrado" value="50" />
      </StatStrip>,
    );
    expect(screen.getByRole('region', { name: 'Tendencia' })).toHaveAttribute('data-stat-strip', 'tiles');
    expect(container.querySelector('[data-stat-cell]')).toBeNull();
    expect(container.querySelector('.ebim-card')).toHaveClass('min-h-[120px]');
  });

  it('en móvil, variant="tiles" se pinta como banda compacta (V6 · F5)', () => {
    const restore = mockViewport('mobile');
    try {
      wrap(
        <StatStrip label="Tendencia" variant="tiles">
          <KpiTile label="Cobrado" value="50" />
        </StatStrip>,
      );
      const strip = screen.getByRole('region', { name: 'Tendencia' });
      expect(strip).toHaveAttribute('data-stat-strip', 'band');
      expect(strip.querySelector('[data-stat-cell="Cobrado"]')).not.toBeNull();
    } finally {
      restore();
    }
  });
});
