import type { CardItem } from './tableCards';

/**
 * V5 · F7 · Tabla → tarjetas por debajo de `sm` (móvil «de consulta»).
 *
 * Una fila es una tarjeta: la primera columna es el título, las demás pares
 * «etiqueta: valor» y las columnas sin etiqueta visible (acciones) van al pie;
 * si la acción es solo el menú «⋯», va a la derecha del título (V6 · F5).
 * Es la MISMA información y los mismos enlaces/acciones que la fila de la tabla,
 * solo apilada para leerse sin scroll horizontal.
 */
export function MobileCardList({ label, items }: { label?: string; items: CardItem[] }) {
  return (
    <ul aria-label={label} className="divide-y divide-border" data-mobile-cards>
      {items.map((item) => (
        <li key={item.key} className={`px-4 py-3 ${item.className ?? ''}`} data-mobile-card>
          {item.menus.length > 0 ? (
            // El menú «⋯» a la derecha del título (V6 · F5), sin fila propia.
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{item.title}</div>
              <div className="-mr-1 -mt-1 flex shrink-0 items-center gap-1">{item.menus}</div>
            </div>
          ) : (
            <div className="min-w-0">{item.title}</div>
          )}
          {item.fields.length > 0 ? (
            <dl className="mt-2 grid gap-1.5 text-compact">
              {item.fields.map((f, i) => (
                <div key={i} className="flex min-w-0 items-start justify-between gap-3">
                  <dt className="shrink-0 pt-0.5 text-caption text-muted">{f.label}</dt>
                  <dd className="min-w-0 text-right text-fg-2 [&_*]:max-w-full">{f.content}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {item.actions.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">{item.actions}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

