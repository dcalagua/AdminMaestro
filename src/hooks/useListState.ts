import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortDir } from '@/services/financeRead';

/**
 * Estado de un listado paginado en servidor, reflejado en la URL:
 * `?q=` buscador · `?estado=` tab · `?p=` página · `?orden=campo:asc|desc` ·
 * `?n=` tamaño. Así una tarjeta KPI o un gráfico abre EXACTAMENTE el detalle
 * que la compone (`/billing?estado=OPEN&antiguedad=D31_60`), y el enlace se
 * comparte o recarga sin perder contexto. Cambiar filtro o búsqueda vuelve a la
 * primera página. El `#hash` de las pestañas no se toca.
 */
export interface ListStateDefaults<F extends string, S extends string> {
  filter: F;
  filters: readonly F[];
  sortBy: S;
  sorts: readonly S[];
  sortDir: SortDir;
  pageSize?: number;
}

export function useListState<F extends string, S extends string>(
  defaults: ListStateDefaults<F, S>,
  prefix = '',
) {
  const [params, setParams] = useSearchParams();
  const k = (name: string) => `${prefix}${name}`;

  const search = params.get(k('q')) ?? '';
  const rawFilter = params.get(k('estado')) as F | null;
  const filter = rawFilter && defaults.filters.includes(rawFilter) ? rawFilter : defaults.filter;
  const page = Math.max(0, Number(params.get(k('p')) ?? '1') - 1) || 0;
  const pageSize = Number(params.get(k('n'))) || defaults.pageSize || 25;
  const [rawSort, rawDir] = (params.get(k('orden')) ?? '').split(':');
  const sortBy = rawSort && defaults.sorts.includes(rawSort as S) ? (rawSort as S) : defaults.sortBy;
  const sortDir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defaults.sortDir;

  const update = useCallback(
    (patch: Record<string, string | null>, resetPage: boolean) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') next.delete(k(key));
            else next.set(k(key), value);
          }
          if (resetPage) next.delete(k('p'));
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams, prefix],
  );

  return useMemo(
    () => ({
      search,
      filter,
      page,
      pageSize,
      sortBy,
      sortDir,
      setSearch: (q: string) => update({ q }, true),
      setFilter: (f: F) => update({ estado: f === defaults.filter ? null : f }, true),
      setPage: (p: number) => update({ p: p <= 0 ? null : String(p + 1) }, false),
      setPageSize: (n: number) => update({ n: String(n) }, true),
      setSort: (by: string, dir: SortDir) => update({ orden: `${by}:${dir}` }, true),
      /** Parámetro extra de alcance (p. ej. `antiguedad`) con el mismo prefijo. */
      extra: (name: string) => params.get(k(name)) ?? '',
      setExtra: (name: string, value: string | null) => update({ [name]: value }, true),
    }),
    [search, filter, page, pageSize, sortBy, sortDir, update, params, defaults.filter],
  );
}
