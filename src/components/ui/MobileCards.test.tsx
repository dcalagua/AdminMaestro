import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './primitives';
import { PagedTable, type TableColumn } from './PagedTable';
import { mockViewport } from '@/test/matchMedia';

/* V5 · F7 · Móvil «de consulta»: por debajo de `sm` las tablas principales pasan a tarjetas. */

let restore: () => void = () => {};
afterEach(() => restore());

function table(mobileCards = true) {
  return (
    <DataTable label="Cuentas" mobileCards={mobileCards} columns={['Cuenta', 'País', { label: 'MRR', align: 'right' }, { label: 'Acciones', srOnly: true }]}>
      <tr key="a" className="opacity-80">
        <td className="ebim-td"><a href="/cuentas/a">Andina</a></td>
        <td className="ebim-td">Perú</td>
        <td className="ebim-td">USD 1.2 K</td>
        <td className="ebim-td"><button type="button">Acciones de Andina</button></td>
      </tr>
      <tr key="b">
        <td className="ebim-td"><a href="/cuentas/b">Bética</a></td>
        <td className="ebim-td">Chile</td>
        <td className="ebim-td">{null}</td>
        <td className="ebim-td"><button type="button">Acciones de Bética</button></td>
      </tr>
    </DataTable>
  );
}

describe('DataTable · tarjetas en móvil', () => {
  it('a 390 px cada fila es una tarjeta: título, «etiqueta: valor» y acciones al pie', () => {
    restore = mockViewport('mobile');
    render(table());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Cuentas' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole('link', { name: 'Andina' })).toHaveAttribute('href', '/cuentas/a');
    expect(cards[0]).toHaveClass('opacity-80');
    const terms = within(cards[0]!).getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['País', 'MRR']);
    expect(within(cards[0]!).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Perú', 'USD 1.2 K']);
    // La columna de acciones no lleva etiqueta: va al pie, con el mismo botón.
    expect(within(cards[0]!).getByRole('button', { name: 'Acciones de Andina' })).toBeInTheDocument();
    // Un valor vacío no deja una etiqueta huérfana.
    expect(within(cards[1]!).getAllByRole('term').map((t) => t.textContent)).toEqual(['País']);
  });

  it('en escritorio, o sin `mobileCards`, sigue siendo tabla', () => {
    restore = mockViewport('desktop');
    const { unmount } = render(table());
    expect(screen.getByRole('table', { name: 'Cuentas' })).toBeInTheDocument();
    unmount();
    restore();
    restore = mockViewport('mobile');
    render(table(false));
    expect(screen.getByRole('table', { name: 'Cuentas' })).toBeInTheDocument();
  });

  it('si las filas no son <tr> directos, se queda la tabla (no se pierde información)', () => {
    restore = mockViewport('mobile');
    function Row() {
      return (
        <tr>
          <td>Fila propia</td>
        </tr>
      );
    }
    render(
      <DataTable label="Propias" mobileCards columns={['Nombre']}>
        <Row />
      </DataTable>,
    );
    expect(screen.getByRole('table', { name: 'Propias' })).toHaveTextContent('Fila propia');
  });
});

describe('PagedTable · tarjetas en móvil', () => {
  interface Row { id: string; number: string; balance: string }
  const columns: TableColumn<Row>[] = [
    { id: 'number', header: 'Factura', cell: (r) => r.number, sortKey: 'number' },
    { id: 'balance', header: 'Saldo', cell: (r) => r.balance, align: 'right' },
    { id: 'actions', header: 'Acciones', srOnly: true, cell: (r) => <button type="button">Cobrar {r.number}</button> },
  ];
  const rows: Row[] = [{ id: '1', number: 'F-1', balance: 'USD 10' }];

  it('pinta tarjetas con el pager y la columna de acciones al pie', () => {
    restore = mockViewport('mobile');
    render(
      <PagedTable
        mobileCards label="Por cobrar" columns={columns} rows={rows} rowKey={(r) => r.id}
        sortBy="number" sortDir="desc" onSortChange={vi.fn()} page={1} pageSize={25} total={1}
        onPageChange={vi.fn()} onPageSizeChange={vi.fn()}
      />,
    );
    const card = within(screen.getByRole('list', { name: 'Por cobrar' })).getByRole('listitem');
    expect(card).toHaveTextContent('F-1');
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['Saldo']);
    expect(within(card).getByRole('button', { name: 'Cobrar F-1' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('en escritorio la columna de acciones tiene la cabecera solo para lector de pantalla', () => {
    restore = mockViewport('desktop');
    render(
      <PagedTable
        label="Por cobrar" columns={columns} rows={rows} rowKey={(r) => r.id}
        sortBy="number" sortDir="desc" onSortChange={vi.fn()} page={1} pageSize={25} total={1}
        onPageChange={vi.fn()} onPageSizeChange={vi.fn()}
      />,
    );
    const header = screen.getByRole('columnheader', { name: 'Acciones' });
    expect(header.querySelector('.sr-only')).toHaveTextContent('Acciones');
  });
});
