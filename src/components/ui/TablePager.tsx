import type { ReactNode } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { SelectInput } from './fields';
import { formatNumber } from '@/lib/format';
import { PAGE_SIZES } from '@/lib/paging';
import { useClientPagination } from '@/hooks/useClientPagination';

/**
 * Pie de un listado paginado en servidor: «Mostrando a–b de N», filas por
 * página y anterior/siguiente. Lo usan `PagedTable`, `DataTable` (paginación
 * en cliente, V5 · F0) y las líneas de tiempo (PT-TIMELINE) que no son tablas.
 */
export function TablePager({
  page,
  pageSize,
  total,
  shown,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Filas presentes en la página actual. */
  shown: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, page * pageSize + shown);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-caption text-muted">
      <p aria-live="polite">
        Mostrando <span className="font-semibold text-fg tabular-nums">{formatNumber(from)}–{formatNumber(to)}</span> de{' '}
        <span className="font-semibold text-fg tabular-nums">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <SelectInput
          label="Filas"
          labelDisplay="inline"
          size="sm"
          selectClassName="w-auto"
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange(Number(v))}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <button
          type="button"
          className="ebim-btn-ghost ebim-btn-sm w-8 px-0"
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
          className="ebim-btn-ghost ebim-btn-sm w-8 px-0"
          aria-label="Página siguiente"
          disabled={page + 1 >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <CaretRightIcon size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Lista no tabular (tarjetas, secciones) paginada en cliente con el mismo pie
 * que las tablas (V5 · F0). `children` recibe solo los elementos de la página.
 */
export function PagedList<T>({
  items,
  children,
  pageSize,
}: {
  items: readonly T[];
  children: (pageItems: T[]) => ReactNode;
  pageSize?: number;
}) {
  const pager = useClientPagination(items.length, pageSize);
  if (!pager.active) return <>{children([...items])}</>;
  const pageItems = pager.slice(items);
  return (
    <div>
      {children(pageItems)}
      <TablePager
        page={pager.page}
        pageSize={pager.pageSize}
        total={pager.total}
        shown={pageItems.length}
        onPageChange={pager.onPageChange}
        onPageSizeChange={pager.onPageSizeChange}
      />
    </div>
  );
}
