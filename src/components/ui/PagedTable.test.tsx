import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PagedTable, type TableColumn } from './PagedTable';
import { ExportMenu } from './ExportMenu';
import type { ExportColumn } from '@/lib/export';

const download = vi.hoisted(() => ({ calls: [] as Array<{ name: string; csv: string }> }));
vi.mock('@/lib/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/export')>();
  return {
    ...actual,
    downloadCsv: (name: string, csv: string) => download.calls.push({ name, csv }),
  };
});

interface Row { id: string; number: string; total: string; currency: string }
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, number: `F-${i}`, total: `${i}.50`, currency: 'USD' }));
const columns: TableColumn<Row>[] = [
  { id: 'number', header: 'Número', cell: (r) => r.number, sortKey: 'number' },
  { id: 'total', header: 'Total', cell: (r) => `${r.currency} ${r.total}`, align: 'right', sortKey: 'total' },
];
const exportColumns: ExportColumn<Row>[] = [
  { header: 'Número', value: (r) => r.number },
  { header: 'Total', value: (r) => r.total, kind: 'amount' },
  { header: 'Moneda', value: (r) => r.currency },
];

beforeEach(() => {
  download.calls.length = 0;
});

describe('PagedTable', () => {
  it('muestra rango y total del universo, no de la página', () => {
    render(
      <PagedTable label="Facturas" columns={columns} rows={rows} rowKey={(r) => r.id} sortBy="number" sortDir="desc"
        onSortChange={vi.fn()} page={1} pageSize={25} total={523} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 26–50 de 523');
    expect(screen.getByText('Página 2 de 21')).toBeInTheDocument();
  });

  it('ordenar por una columna pide el orden al servidor y declara aria-sort', () => {
    const onSort = vi.fn();
    render(
      <PagedTable label="Facturas" columns={columns} rows={rows} rowKey={(r) => r.id} sortBy="number" sortDir="desc"
        onSortChange={onSort} page={0} pageSize={25} total={25} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );
    const table = screen.getByRole('table', { name: 'Facturas' });
    expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(table).getByRole('button', { name: 'Total' }));
    expect(onSort).toHaveBeenCalledWith('total', 'desc');
  });

  it('el scroll horizontal queda confinado a la región de la tabla', () => {
    render(
      <PagedTable label="Facturas" columns={columns} rows={rows} rowKey={(r) => r.id} sortBy="number" sortDir="desc"
        onSortChange={vi.fn()} page={0} pageSize={25} total={25} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );
    expect(screen.getByRole('region', { name: 'Facturas' })).toHaveClass('overflow-x-auto');
  });

  it('error se muestra como error con reintento, no como tabla vacía', () => {
    render(
      <PagedTable label="Facturas" columns={columns} rows={[]} rowKey={(r) => r.id} sortBy="number" sortDir="desc"
        onSortChange={vi.fn()} page={0} pageSize={25} total={0} onPageChange={vi.fn()} onPageSizeChange={vi.fn()}
        error={new Error('timeout')} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('timeout');
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument();
  });
});

describe('ExportMenu', () => {
  const universe: Row[] = Array.from({ length: 1234 }, (_, i) => ({ id: `u${i}`, number: `F-${i}`, total: '1.00', currency: 'PEN' }));
  const fetchPage = async (page: number, size: number) => ({ rows: universe.slice(page * size, page * size + size), total: universe.length });

  it('distingue página actual de todos los resultados filtrados', async () => {
    render(<ExportMenu filenameBase="facturacion" columns={exportColumns} pageRows={rows} total={1234} fetchPage={fetchPage} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Página actual/ }));
    expect(download.calls[0]!.name).toMatch(/^facturacion-pagina-/);
    expect(download.calls[0]!.csv.split('\r\n')).toHaveLength(26);

    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Todos los resultados filtrados/ }));
    await waitFor(() => expect(download.calls).toHaveLength(2));
    expect(download.calls[1]!.name).toMatch(/^facturacion-todos-/);
    expect(download.calls[1]!.csv.split('\r\n')).toHaveLength(1235);
    expect(screen.getByRole('status')).toHaveTextContent('1,234 resultados');
  });

  it('muestra el límite técnico ANTES de exportar y marca la salida incompleta', async () => {
    const big = { rows: [], total: 9000 };
    const fetchBig = async (page: number, size: number) => ({
      rows: Array.from({ length: size }, (_, i) => ({ id: `b${page * size + i}`, number: 'x', total: '1', currency: 'USD' })),
      total: big.total,
    });
    render(<ExportMenu filenameBase="costos" columns={exportColumns} pageRows={rows} total={9000} fetchPage={fetchBig} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(screen.getByText(/Supera el límite de 5,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Todos los resultados filtrados/ }));
    await waitFor(() => expect(download.calls).toHaveLength(1));
    expect(download.calls[0]!.name).toMatch(/^costos-incompleto-todos-/);
    expect(screen.getByRole('status')).toHaveTextContent('INCOMPLETA');
  });

  it('un error intermedio no descarga nada y lo explica', async () => {
    const failing = async (page: number, size: number) => {
      if (page === 1) throw new Error('permiso denegado');
      return { rows: universe.slice(page * size, page * size + size), total: universe.length };
    };
    render(<ExportMenu filenameBase="facturacion" columns={exportColumns} pageRows={rows} total={1234} fetchPage={failing} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Todos los resultados filtrados/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se generó el archivo'));
    expect(download.calls).toHaveLength(0);
  });
});
