import type { ReactNode } from 'react';
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpIcon } from '@phosphor-icons/react';
import { EmptyState, ErrorState, LoadingState } from './primitives';
import { formatNumber } from '@/lib/format';
import type { SortDir } from '@/services/financeRead';
import { PAGE_SIZES } from '@/services/financeRead';

/**
 * Tabla operativa paginada en servidor (E06, spec §10).
 *
 * Aditiva: `DataTable` sigue existiendo para sus consumidores. Ésta añade
 * columnas tipadas con id estable, orden en servidor (con desempate por id en la
 * consulta), página, tamaño y total. El scroll horizontal queda confinado a la
 * tabla, nunca al documento; la región es enfocable para desplazarse con teclado.
 */
export interface TableColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  /** Columna de orden en servidor; sin ella la cabecera no es ordenable. */
  sortKey?: string;
  className?: string;
}

export function PagedTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  sortBy,
  sortDir,
  onSortChange,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  loading,
  fetching,
  error,
  onRetry,
  emptyTitle = 'Sin resultados',
  emptyDescription,
  rowClassName,
}: {
  /** Nombre accesible de la tabla. */
  label: string;
  columns: TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  sortBy: string;
  sortDir: SortDir;
  onSortChange: (sortBy: string, sortDir: SortDir) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  rowClassName?: (row: Row) => string | undefined;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, page * pageSize + rows.length);

  return (
    <div aria-busy={fetching || undefined}>
      <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full border-collapse" aria-label={label}>
          <thead className="border-b border-border bg-[color:var(--bg)]">
            <tr>
              {columns.map((c) => {
                const active = c.sortKey && c.sortKey === sortBy;
                const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : c.sortKey ? 'none' : undefined;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`ebim-th ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {c.sortKey ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg ${
                          active ? 'text-fg' : ''
                        }`}
                        onClick={() =>
                          onSortChange(c.sortKey!, active && sortDir === 'desc' ? 'asc' : 'desc')
                        }
                      >
                        {c.header}
                        {active ? (
                          sortDir === 'asc' ? <CaretUpIcon size={12} aria-hidden /> : <CaretDownIcon size={12} aria-hidden />
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={`ebim-td ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
        <p aria-live="polite">
          Mostrando <span className="font-semibold text-fg tabular-nums">{formatNumber(from)}–{formatNumber(to)}</span> de{' '}
          <span className="font-semibold text-fg tabular-nums">{formatNumber(total)}</span>
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Filas
            <select
              className="rounded-field border border-border bg-card px-2 py-1 text-xs text-fg"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ebim-btn-ghost h-8 w-8 px-0"
            aria-label="Página anterior"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <CaretLeftIcon size={14} aria-hidden />
          </button>
          <span className="tabular-nums">
            Página {page + 1} de {pages}
          </span>
          <button
            type="button"
            className="ebim-btn-ghost h-8 w-8 px-0"
            aria-label="Página siguiente"
            disabled={page + 1 >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <CaretRightIcon size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
