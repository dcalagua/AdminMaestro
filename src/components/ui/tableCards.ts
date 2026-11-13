import { Children, Fragment, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ActionMenu } from './ActionMenu';

/** V5 · F7 · Modelo de las tarjetas móviles de `DataTable`/`PagedTable` (ver `MobileCards.tsx`). */
export interface CardField {
  label: ReactNode;
  content: ReactNode;
}

export interface CardItem {
  key: string;
  className?: string;
  title: ReactNode;
  fields: CardField[];
  actions: ReactNode[];
  /**
   * V6 · F5: menús «⋯» (`ActionMenu`) de la fila. Van a la derecha del título,
   * no en un pie propio: un botón de 32 px no merece una fila entera.
   */
  menus: ReactNode[];
}

type Column = string | { label: ReactNode; name?: string; srOnly?: boolean; mobile?: boolean };

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
    const cells = flattenFragments(tr.props.children).filter(
      (c): c is ElementWithChildren => isValidElement(c) && (c.type === 'td' || c.type === 'th'),
    );
    if (cells.length === 0) return null;
    const item: CardItem = {
      key: String(tr.key ?? index),
      className: tr.props.className,
      title: cells[0]!.props.children,
      fields: [],
      actions: [],
      menus: [],
    };
    cells.slice(1).forEach((cell, i) => {
      const col = columns[i + 1];
      const spec = typeof col === 'string' ? { label: col } : col;
      const content = cell.props.children;
      if (content === null || content === undefined || content === false) return;
      // V6: columna secundaria que la tarjeta móvil omite (`mobile: false`).
      if (spec && spec.mobile === false) return;
      // Etiqueta de la tarjeta: el texto plano (`name`) si la cabecera es un nodo.
      const label = typeof spec?.label === 'string' ? spec.label : (spec?.name ?? spec?.label);
      const blank = label === null || label === undefined || label === false || (typeof label === 'string' && label.trim() === '');
      if (!spec || spec.srOnly || blank) {
        const target = onlyMenus(content) ? item.menus : item.actions;
        target.push(createElement(Fragment, { key: `a-${i}` }, content));
      } else {
        item.fields.push({ label, content });
      }
    });
    items.push(item);
  }
  return items;
}

/**
 * Hijos de una fila con los `<>…</>` aplanados: una fila puede agrupar celdas
 * condicionales en un fragmento (`{finance ? <><td/><td/></> : null}`) y cada
 * celda debe seguir alineada con su columna (V6).
 */
function flattenFragments(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((c) =>
    isValidElement(c) && c.type === Fragment
      ? flattenFragments((c as ElementWithChildren).props.children)
      : [c],
  );
}

/**
 * ¿La celda de acciones es SOLO un menú «⋯»? (uno o varios `ActionMenu`, quizá
 * envueltos en contenedores sin texto propio).
 */
export function onlyMenus(node: ReactNode): boolean {
  let menus = 0;
  const walk = (n: ReactNode): boolean => {
    if (n === null || n === undefined || typeof n === 'boolean') return true;
    if (typeof n === 'string') return n.trim() === '';
    if (typeof n === 'number') return false;
    if (Array.isArray(n)) return n.every(walk);
    if (!isValidElement(n)) return false;
    if (n.type === ActionMenu) {
      menus += 1;
      return true;
    }
    // Solo contenedores DOM (div/span) o fragmentos: un componente propio puede pintar texto.
    if (typeof n.type !== 'string' && n.type !== Fragment) return false;
    if (typeof n.type === 'string' && !['div', 'span'].includes(n.type)) return false;
    return walk((n as ElementWithChildren).props.children);
  };
  return walk(node) && menus > 0;
}

/** Reparte las acciones de una tarjeta: menús «⋯» junto al título, el resto al pie. */
export function splitActions(nodes: ReactNode[]): Pick<CardItem, 'actions' | 'menus'> {
  const actions: ReactNode[] = [];
  const menus: ReactNode[] = [];
  for (const n of nodes) (onlyMenus(n) ? menus : actions).push(n);
  return { actions, menus };
}
