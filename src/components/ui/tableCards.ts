import { Children, Fragment, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/** V5 · F7 · Modelo de las tarjetas móviles de `DataTable`/`PagedTable` (ver `MobileCards.tsx`). */
export interface CardField {
  label: string;
  content: ReactNode;
}

export interface CardItem {
  key: string;
  className?: string;
  title: ReactNode;
  fields: CardField[];
  actions: ReactNode[];
}

type Column = string | { label: string; srOnly?: boolean };

type ElementWithChildren = ReactElement<{ children?: ReactNode; className?: string }>;

/**
 * Convierte las filas `<tr><td>…` de un `DataTable` en tarjetas. Si alguna fila
 * no es un `<tr>` directo (p. ej. un componente propio), devuelve `null` y la
 * pantalla sigue con la tabla: nunca se pierde información.
 */
export function rowsToCards(rows: ReactNode[], columns: Column[]): CardItem[] | null {
  const items: CardItem[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isValidElement(row) || row.type !== 'tr') return null;
    const tr = row as ElementWithChildren;
    const cells = Children.toArray(tr.props.children).filter(
      (c): c is ElementWithChildren => isValidElement(c) && (c.type === 'td' || c.type === 'th'),
    );
    if (cells.length === 0) return null;
    const item: CardItem = {
      key: String(tr.key ?? index),
      className: tr.props.className,
      title: cells[0]!.props.children,
      fields: [],
      actions: [],
    };
    cells.slice(1).forEach((cell, i) => {
      const col = columns[i + 1];
      const spec = typeof col === 'string' ? { label: col } : col;
      const content = cell.props.children;
      if (content === null || content === undefined || content === false) return;
      if (!spec || spec.srOnly || spec.label.trim() === '') {
        item.actions.push(createElement(Fragment, { key: `a-${i}` }, content));
      } else {
        item.fields.push({ label: spec.label, content });
      }
    });
    items.push(item);
  }
  return items;
}
