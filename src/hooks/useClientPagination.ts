import { useState } from 'react';
import { PAGE_SIZES } from '@/lib/paging';

/**
 * Paginación en cliente (V5 · F0) para listados que ya tienen todas sus filas
 * en memoria: `DataTable` y `PagedList`. Mismo pie que la paginación en
 * servidor (`TablePager`). Si cambia el número de elementos (buscador,
 * pestaña), vuelve a la primera página; la página nunca queda fuera de rango.
 */
export function useClientPagination(total: number, initialPageSize: number = PAGE_SIZES[0]) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(0);
  const [seenTotal, setSeenTotal] = useState(total);
  if (seenTotal !== total) {
    setSeenTotal(total);
    setPage(0);
  }
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const current = Math.min(page, lastPage);
  const from = current * pageSize;
  return {
    /** Hay más elementos que la página más corta: se muestra el paginador. */
    active: total > PAGE_SIZES[0],
    page: current,
    pageSize,
    total,
    slice: <T,>(items: readonly T[]): T[] => items.slice(from, from + pageSize),
    onPageChange: setPage,
    onPageSizeChange: (n: number) => {
      setPageSize(n);
      setPage(0);
    },
  };
}
