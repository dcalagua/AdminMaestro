import type { ReactNode } from 'react';
import { CheckCircleIcon, WarningIcon, XIcon } from '@phosphor-icons/react';
import { formatNumber } from '@/lib/format';

/**
 * Piezas compartidas por los listados financieros paginados en servidor
 * (facturación, costos, comisiones). No son componentes de UI genéricos: sólo
 * resuelven lo que esas pantallas repiten — buscar sin una consulta por tecla,
 * mostrar el contexto heredado como chip removible y declarar si el resumen y la
 * tabla hablan del mismo universo.
 */

/** Contexto heredado (tarjeta, gráfico, enlace) visible y removible. */
export function ScopeChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-xs font-semibold text-accent-deep">
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-card"
        aria-label={`Quitar filtro «${label}»`}
        onClick={onRemove}
      >
        <XIcon size={12} aria-hidden />
      </button>
    </span>
  );
}

/** Fila de chips bajo el buscador; no ocupa espacio si no hay contexto. */
export function ScopeChips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">{children}</div>;
}

/**
 * Declara si el resumen agregado en servidor y la tabla paginada describen el
 * mismo universo (spec §9.1). Si difieren se dice, no se disimula.
 */
export function ConsistencyNote({
  summaryCount,
  tableTotal,
  noun,
}: {
  summaryCount: number | null | undefined;
  tableTotal: number | null | undefined;
  noun: string;
}) {
  if (summaryCount === null || summaryCount === undefined || tableTotal === null || tableTotal === undefined) {
    return null;
  }
  const count = Number(summaryCount);
  if (count === tableTotal) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted" data-testid="consistency-note">
        <CheckCircleIcon size={14} aria-hidden className="shrink-0 text-ok" />
        Resumen y tabla cubren las mismas {formatNumber(count)} {noun}.
      </p>
    );
  }
  return (
    <p
      className="flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs font-semibold text-warn"
      role="status"
      data-testid="consistency-note"
    >
      <WarningIcon size={14} aria-hidden className="mt-px shrink-0" />
      El resumen cubre {formatNumber(count)} {noun} y la tabla {formatNumber(tableTotal)}: los datos cambiaron entre
      lecturas. Vuelve a cargar para alinearlos.
    </p>
  );
}

/** Nota breve de negocio bajo el encabezado de una sección. */
export function InfoNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">{children}</p>;
}
