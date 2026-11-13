import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppChips, CellTitle, MoneyCell, StatusCell } from './cells';
import { DataTable } from './primitives';
import { nextSort } from './tableSort';

const wrap = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('celdas tipadas (V6 · T4)', () => {
  it('CellTitle: nombre enlazado con title y segunda línea sin partes vacías, códigos en mono', () => {
    wrap(<CellTitle title="GRUPASA" to="/organizations/g" secondary={['Grupasa S.A.C.', null, 'PE', '20500000001']} monoParts={[3]} />);
    const link = screen.getByRole('link', { name: 'GRUPASA' });
    expect(link).toHaveAttribute('href', '/organizations/g');
    expect(link).toHaveAttribute('title', 'GRUPASA');
    const second = screen.getByTitle('Grupasa S.A.C. · PE · 20500000001');
    expect(within(second).getByText('20500000001')).toHaveClass('font-mono');
  });

  it('MoneyCell: compacto por moneda con el monto completo en el title; sin importe, «—»', () => {
    const { rerender } = wrap(<MoneyCell amounts={{ USD: 22_700, PEN: 0 }} tone="danger" context="2 facturas" />);
    expect(screen.getByTitle(/USD\s22,700\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/PEN/)).toBeNull();
    expect(screen.getByText('2 facturas')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <MoneyCell amount={null} currency="USD" />
      </MemoryRouter>,
    );
    expect(screen.getByText('—').closest('[data-money-empty]')).not.toBeNull();
  });

  it('MoneyCell sin importe conserva el contexto (V6 · F5)', () => {
    wrap(<MoneyCell amount={0} currency="USD" empty="Al día" context="0 facturas" />);
    expect(screen.getByText('Al día')).toBeInTheDocument();
    expect(screen.getByText('0 facturas')).toBeInTheDocument();
  });

  it('CellTitle con segunda línea como nodo lleva title (dado o el texto pintado)', () => {
    const { unmount } = wrap(<CellTitle title="EWM" secondary={<span>Código <b>ewm-v1</b></span>} />);
    expect(screen.getByText('ewm-v1').closest('[title]')).toHaveAttribute('title', 'Código ewm-v1');
    unmount();
    wrap(<CellTitle title="EWM" secondary={<span>Corto</span>} secondaryTitle="Texto completo" />);
    expect(screen.getByText('Corto').closest('[title]')).toHaveAttribute('title', 'Texto completo');
  });

  it('AppChips: estado legible sin color y «+N» con el resto', () => {
    wrap(
      <AppChips
        label="Apps de GRUPASA"
        max={2}
        items={[
          { key: 'a', name: 'eChange', tone: 'ok', status: 'Activo' },
          { key: 'b', name: 'EWM', tone: 'warn', status: 'Sin alta' },
          { key: 'c', name: 'eSupplier', tone: 'danger', status: 'Alta fallida' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Apps de GRUPASA' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('eChange: Activo');
    expect(items[2]).toHaveTextContent('+1');
    expect(items[2]).toHaveTextContent('eSupplier (Alta fallida)');
  });

  it('AppChips sin apps dice «Sin apps»; StatusCell lleva su detalle', () => {
    wrap(
      <>
        <AppChips items={[]} />
        <StatusCell label="Con deuda vencida" tone="warn" detail="hace 45 días" />
      </>,
    );
    expect(screen.getByText('Sin apps')).toBeInTheDocument();
    expect(screen.getByText('hace 45 días')).toBeInTheDocument();
  });
});

describe('DataTable gerencial (V6 · T4)', () => {
  const rows = (
    <>
      <tr>
        <td className="ebim-td">Andina</td>
        <td className="ebim-td ebim-num">10</td>
      </tr>
    </>
  );

  it('cabecera ordenable con aria-sort y la primera columna fija', () => {
    const onSort = vi.fn();
    const { container } = wrap(
      <DataTable
        label="Cuentas"
        columns={[{ label: 'Cuenta', sticky: true, sortKey: 'name', width: 280 }, { label: 'MRR', align: 'right', sortKey: 'mrr' }]}
        sort={{ key: 'mrr', dir: 'desc' }}
        onSort={onSort}
      >
        {rows}
      </DataTable>,
    );
    const [cuenta, mrr] = screen.getAllByRole('columnheader');
    expect(cuenta).toHaveAttribute('aria-sort', 'none');
    expect(cuenta).toHaveStyle({ width: '280px' });
    expect(mrr).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(cuenta!).getByRole('button', { name: 'Cuenta' }));
    expect(onSort).toHaveBeenCalledWith('name');
    expect(container.querySelector('table')!.className).toContain('[&_tr>*:first-child]:sticky');
  });

  it('nextSort: la misma columna alterna; otra empieza descendente', () => {
    expect(nextSort(undefined, 'mrr')).toEqual({ key: 'mrr', dir: 'desc' });
    expect(nextSort({ key: 'mrr', dir: 'desc' }, 'mrr')).toEqual({ key: 'mrr', dir: 'asc' });
    expect(nextSort({ key: 'mrr', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
  });
});

describe('estados vacíos (V6 · T5)', () => {
  it('no-results: lupa y «Limpiar búsqueda»; empty: la acción que crea', async () => {
    const { EmptyState, SearchBar } = await import('./primitives');
    const onClear = vi.fn();
    const { container, rerender } = wrap(<EmptyState variant="no-results" title="Ningún resultado" onClear={onClear} />);
    expect(container.querySelector('[data-empty-variant="no-results"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(onClear).toHaveBeenCalled();
    rerender(
      <MemoryRouter>
        <EmptyState title="Sin clientes" action={<button type="button">Nuevo cliente</button>} />
        <SearchBar value="" onChange={() => {}} total={0} right={<span>Todos 0</span>} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeInTheDocument();
    // Conjunto vacío: ni buscador ni pestañas de estado.
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('Todos 0')).toBeNull();
  });
});
