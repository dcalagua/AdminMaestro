/**
 * Exportación común de listados — spec §10 (AC10).
 *
 * Una sola implementación para todas las pantallas:
 *  - «Página actual» o «Todos los resultados filtrados», siempre explícito;
 *  - el universo filtrado se obtiene por PÁGINAS autorizadas (la misma consulta y
 *    los mismos filtros que la tabla; RLS decide las filas);
 *  - si hay límite técnico se informa y la salida se rotula incompleta;
 *  - un error intermedio, un duplicado o un cambio del universo abortan: nunca se
 *    entrega un archivo parcial como si fuera completo;
 *  - texto susceptible de fórmula (=, +, -, @, tab, CR) se neutraliza;
 *  - columnas marcadas `secret` no se pueden exportar.
 *
 * Los importes se exportan con la precisión que devuelve la base (texto
 * `numeric`), en columna separada de la moneda: nada de símbolos ni floats.
 */

export interface ExportColumn<Row> {
  header: string;
  value: (row: Row) => string | number | null | undefined;
  /** `amount`: valor numérico del backend; no se neutraliza el signo negativo. */
  kind?: 'text' | 'amount' | 'number';
  /** Nunca exportable (referencias a secretos, tokens…). */
  secret?: boolean;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutraliza una celda de texto que una hoja de cálculo interpretaría como fórmula. */
export function sanitizeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cell<Row>(column: ExportColumn<Row>, row: Row): string {
  const raw = column.value(row);
  if (raw === null || raw === undefined) return '';
  const text = String(raw);
  if (column.kind === 'amount' || column.kind === 'number') {
    // Un número del backend (p. ej. «-15.00») se deja tal cual; si no parece un
    // número, se trata como texto y se neutraliza.
    return /^-?\d+(\.\d+)?$/.test(text) ? text : quote(sanitizeCell(text));
  }
  return quote(sanitizeCell(text));
}

/** CSV RFC 4180 (coma, CRLF). Las columnas `secret` se excluyen siempre. */
export function toCsv<Row>(columns: ExportColumn<Row>[], rows: readonly Row[]): string {
  const visible = columns.filter((c) => !c.secret);
  const header = visible.map((c) => quote(sanitizeCell(c.header))).join(',');
  const body = rows.map((row) => visible.map((c) => cell(c, row)).join(','));
  return [header, ...body].join('\r\n');
}

export interface PageResult<Row> {
  rows: Row[];
  total: number;
}

export interface CollectResult<Row> {
  rows: Row[];
  total: number;
  /** false si el universo supera el límite técnico: la UI lo rotula incompleto. */
  complete: boolean;
}

/**
 * Recorre el universo filtrado página a página.
 * Lanza error si una página falla, si aparece un duplicado (orden inestable) o
 * si el total cambia a mitad de camino.
 */
export async function collectAllPages<Row>(
  fetchPage: (page: number, pageSize: number) => Promise<PageResult<Row>>,
  options: { pageSize: number; limit: number; rowKey: (row: Row) => string },
): Promise<CollectResult<Row>> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let page = 0; ; page += 1) {
    if (rows.length >= options.limit) break;
    const result = await fetchPage(page, options.pageSize);
    if (total === null) total = result.total;
    else if (result.total !== total) {
      throw new Error('Los datos cambiaron durante la exportación. Vuelve a intentarlo.');
    }
    for (const row of result.rows) {
      const key = options.rowKey(row);
      if (seen.has(key)) {
        throw new Error('Fila duplicada entre páginas: el orden no es estable. Exportación cancelada.');
      }
      seen.add(key);
      rows.push(row);
      if (rows.length >= options.limit) break;
    }
    if (result.rows.length < options.pageSize || rows.length >= (total ?? 0)) break;
  }
  const finalTotal = total ?? rows.length;
  return { rows, total: finalTotal, complete: rows.length >= finalTotal };
}

/** Descarga local (no sale de la máquina). BOM para que Excel lea UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `facturacion-todos-2026-09-25.csv` */
export function exportFilename(base: string, scope: 'pagina' | 'todos', date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${base}-${scope}-${d}.csv`;
}
