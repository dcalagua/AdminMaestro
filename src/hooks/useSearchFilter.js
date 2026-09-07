import { useMemo, useState } from 'react';
/**
 * Buscador único de listados — contrato §8 / regla `esupplier-022`.
 *
 * Un solo término se compara contra varios campos del registro. Es a propósito
 * que no exista una API de filtros por campo: la regla de suite prohíbe paneles
 * multi-campo en listados.
 */
export function useSearchFilter(items, fields) {
    const [term, setTerm] = useState('');
    const filtered = useMemo(() => {
        const list = items ?? [];
        const needle = term.trim().toLowerCase();
        if (!needle)
            return list;
        return list.filter((item) => fields(item).some((value) => String(value ?? '').toLowerCase().includes(needle)));
        // `fields` se omite a propósito de las deps: es una lambda nueva en cada
        // render, e incluirla recalcularía el filtro siempre. El contrato del hook es
        // que el extractor sea estable en semántica, no en identidad.
    }, [items, term]);
    return { term, setTerm, filtered };
}
