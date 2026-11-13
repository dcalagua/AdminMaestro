import type { ReactNode } from 'react';

/**
 * Cabecera fija de una ficha (V5 · F3): los cuatro o cinco datos que responden
 * «¿cómo está esta cuenta?» quedan a la vista mientras se recorren las
 * pestañas. En escritorio se pega bajo la barra superior (`top-16`); en móvil
 * fluye con la página para no comerse la pantalla.
 *
 * No son KPIs: texto compacto, sin cifras gigantes.
 */
export function SummaryBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      data-summary-bar
      className="ebim-card mb-5 md:sticky md:top-16 md:z-20 md:shadow-card"
    >
      <dl className="flex flex-wrap divide-border max-md:divide-y md:divide-x">
        {children}
      </dl>
    </section>
  );
}

export function SummaryItem({
  label,
  children,
  hint,
  grow = false,
}: {
  label: string;
  children: ReactNode;
  /** Explicación al pasar el puntero (p. ej. por qué un dato no se muestra). */
  hint?: string;
  /** Ocupa el espacio sobrante (la lista de apps). */
  grow?: boolean;
}) {
  return (
    <div className={`min-w-0 px-4 py-2.5 max-md:w-full ${grow ? 'md:flex-1' : ''}`} data-summary-item={label}>
      <dt className="text-micro text-muted" title={hint}>
        {label}
      </dt>
      <dd className="mt-1 flex min-h-[22px] flex-wrap items-center gap-1.5 text-compact font-semibold text-fg">{children}</dd>
    </div>
  );
}
