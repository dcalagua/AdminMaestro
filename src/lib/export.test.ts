import { describe, expect, it, vi } from 'vitest';
import { collectAllPages, sanitizeCell, toCsv, type ExportColumn } from './export';

interface Row {
  id: string;
  number: string;
  customer: string;
  total: string;
  currency: string;
  secret_ref?: string;
}

const columns: ExportColumn<Row>[] = [
  { header: 'Número', value: (r) => r.number },
  { header: 'Cliente', value: (r) => r.customer },
  { header: 'Total', value: (r) => r.total, kind: 'amount' },
  { header: 'Moneda', value: (r) => r.currency },
];

describe('CSV seguro', () => {
  it('neutraliza texto que una hoja de cálculo ejecutaría como fórmula', () => {
    for (const payload of ['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', '\t=1', '\r=1']) {
      expect(sanitizeCell(payload).startsWith("'")).toBe(true);
    }
    expect(sanitizeCell('Cliente normal')).toBe('Cliente normal');
  });

  it('un importe negativo NO se trata como fórmula (es un número)', () => {
    const csv = toCsv([{ header: 'Saldo', value: () => '-15.00', kind: 'amount' }], [{}]);
    expect(csv.split('\r\n')[1]).toBe('-15.00');
  });

  it('conserva moneda y precisión del backend (sin float ni símbolo)', () => {
    const csv = toCsv(columns, [
      { id: '1', number: 'F-1', customer: 'Alpha', total: '1250.10', currency: 'PEN' },
      { id: '2', number: 'F-2', customer: 'Beta, S.A.', total: '0.30', currency: 'USD' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Número,Cliente,Total,Moneda');
    expect(lines[1]).toBe('F-1,Alpha,1250.10,PEN');
    expect(lines[2]).toBe('F-2,"Beta, S.A.",0.30,USD');
  });

  it('la fila de cliente con fórmula sale neutralizada y citada', () => {
    const csv = toCsv(columns, [{ id: '1', number: 'F-9', customer: '=HYPERLINK("http://x")', total: '1', currency: 'USD' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('no existe forma de exportar una columna marcada como secreta', () => {
    const cols: ExportColumn<Row>[] = [...columns, { header: 'secret_ref', value: (r) => r.secret_ref ?? '', secret: true }];
    const csv = toCsv(cols, [{ id: '1', number: 'F', customer: 'C', total: '1', currency: 'USD', secret_ref: 'vault://x' }]);
    expect(csv).not.toContain('secret_ref');
    expect(csv).not.toContain('vault://x');
  });
});

describe('Todos los resultados filtrados', () => {
  const universe = Array.from({ length: 523 }, (_, i) => ({ id: `id-${String(i).padStart(4, '0')}` }));

  it('recorre todas las páginas sin perder ni duplicar filas', async () => {
    const fetchPage = vi.fn(async (page: number, size: number) => ({
      rows: universe.slice(page * size, page * size + size),
      total: universe.length,
    }));
    const result = await collectAllPages(fetchPage, { pageSize: 100, limit: 5000, rowKey: (r) => r.id });
    expect(result.rows).toHaveLength(523);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(523);
    expect(result.complete).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it('detecta duplicados por orden inestable y NO entrega una exportación completa', async () => {
    const fetchPage = async (page: number, size: number) => ({
      // Página 2 repite filas de la 1 (orden sin desempate estable).
      rows: page === 1 ? universe.slice(0, size) : universe.slice(page * size, page * size + size),
      total: universe.length,
    });
    await expect(collectAllPages(fetchPage, { pageSize: 100, limit: 5000, rowKey: (r) => r.id })).rejects.toThrow(/duplicad/i);
  });

  it('un error en una página intermedia aborta: nunca un archivo «completo» parcial', async () => {
    const fetchPage = async (page: number, size: number) => {
      if (page === 3) throw new Error('timeout');
      return { rows: universe.slice(page * size, page * size + size), total: universe.length };
    };
    await expect(collectAllPages(fetchPage, { pageSize: 100, limit: 5000, rowKey: (r) => r.id })).rejects.toThrow(/timeout/);
  });

  it('si el universo cambia durante la exportación, se aborta', async () => {
    let total = 523;
    const fetchPage = async (page: number, size: number) => {
      const res = { rows: universe.slice(page * size, page * size + size), total };
      total += 1;
      return res;
    };
    await expect(collectAllPages(fetchPage, { pageSize: 100, limit: 5000, rowKey: (r) => r.id })).rejects.toThrow(/cambi/i);
  });

  it('por encima del límite técnico se informa como incompleta, no como completa', async () => {
    const fetchPage = async (page: number, size: number) => ({
      rows: universe.slice(page * size, page * size + size),
      total: universe.length,
    });
    const result = await collectAllPages(fetchPage, { pageSize: 100, limit: 200, rowKey: (r) => r.id });
    expect(result.complete).toBe(false);
    expect(result.rows).toHaveLength(200);
    expect(result.total).toBe(523);
  });
});
