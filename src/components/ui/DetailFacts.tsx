import type { ReactNode } from 'react';

/**
 * V6 · F4: pares etiqueta → valor de una ficha en una grilla compacta (2 columnas
 * en tableta, 3 en escritorio), con la etiqueta encima del valor. Sustituye las
 * listas de 2 columnas con la etiqueta a un lado y el valor a 500 px al otro
 * («Identidad del producto», «Datos del tenant»).
 *
 * Vive aquí porque F4 no toca `src/components/ui/*`; F5 puede promoverla junto a
 * `DetailList` (que solo admite 1 o 2 columnas y sin padding de tarjeta).
 */
export function DetailFacts({
  items,
  columns = 3,
}: {
  items: Array<[string, ReactNode]>;
  /** Columnas en escritorio (≥1280 px). */
  columns?: 2 | 3 | 4;
}) {
  const xl = columns === 4 ? 'xl:grid-cols-4' : columns === 3 ? 'xl:grid-cols-3' : '';
  return (
    <dl className={`grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 ${xl}`} data-detail-facts>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-caption text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-compact font-medium text-fg">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
