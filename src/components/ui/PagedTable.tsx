import type { ReactNode } from 'react';
import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { EmptyState, ErrorState, LoadingState } from './primitives';
import { TablePager } from './TablePager';
import { MobileCardList } from './MobileCards';
import { splitActions } from './tableCards';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { SortDir } from '@/services/financeRead';

export { TablePager };

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
  /** Columna de acciones (cabecera solo para lector de pantalla): en móvil va al pie de la tarjeta. */
  srOnly?: boolean;
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
  mobileCards = false,
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
  /** Por debajo de `sm`, filas como tarjetas (V5 · F7); el orden y la paginación se mantienen. */
  mobileCards?: boolean;
}) {
  const mobile = useIsMobile();
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  const pager = (
    <TablePager
      page={page}
      pageSize={pageSize}
      total={total}
      shown={rows.length}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  );

  if (mobileCards && mobile) {
    const [first, ...rest] = columns;
    return (
      <div aria-busy={fetching || undefined}>
        <MobileCardList
          label={label}
          items={rows.map((row) => ({
            key: rowKey(row),
            className: rowClassName?.(row),
            title: first ? first.cell(row) : null,
            fields: rest.filter((c) => !c.srOnly && c.header.trim() !== '').map((c) => ({ label: c.header, content: c.cell(row) })),
            ...splitActions(
              rest.filter((c) => c.srOnly || c.header.trim() === '').map((c) => <span key={c.id}>{c.cell(row)}</span>),
            ),
          }))}
        />
        {pager}
      </div>
    );
  }

  return (
    <div aria-busy={fetching || undefined}>
      <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full border-collapse" aria-label={label}>
          <thead className="sticky top-0 z-[1] border-b border-border bg-sunken">
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
                    {c.srOnly ? (
                      <span className="sr-only">{c.header}</span>
                    ) : c.sortKey ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-sm uppercase hover:text-fg ${
                          active ? 'text-fg' : ''
                        }`}
                        onClick={() =>
                          onSortChange(c.sortKey!, active && sortDir === 'desc' ? 'asc' : 'desc')
                        }
                      >
                        {c.header}
                        {active ? (
                          sortDir === 'asc' ? <CaretUpIcon size={12} weight="bold" aria-hidden /> : <CaretDownIcon size={12} weight="bold" aria-hidden />
                        ) : (
                          <CaretUpDownIcon size={12} className="opacity-60" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr]:duration-fast [&>tr:hover]:bg-hover">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={`ebim-td ${c.align === 'right' ? 'ebim-num' : ''} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pager}
    </div>
  );
}
