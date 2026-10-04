import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useModalFocus } from './useModalFocus';

/**
 * Panel lateral de SOLO LECTURA para el detalle de una fila (un movimiento del
 * ledger, una comparación). Mismo ciclo de teclado que los diálogos (E09):
 * foco confinado, Escape cierra y el foco vuelve a la fila que lo abrió.
 *
 * Las acciones de escritura que se ofrezcan aquí abren su propio `FormDialog`
 * con motivo: este panel nunca escribe por sí mismo.
 */
export function DetailDrawer({
  open,
  title,
  subtitle,
  actions,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalFocus(panelRef, open, {
    initialFocus: () => closeRef.current,
    onEscape: onClose,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ebim-card flex h-full w-full max-w-xl flex-col rounded-none shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-bold text-fg">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="ebim-btn-ghost h-8 px-3 text-xs" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {actions ? <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{actions}</footer> : null}
      </aside>
    </div>
  );
}

/** Lista clave → valor para el cuerpo de un `DetailDrawer`. */
export function DetailList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="divide-y divide-border">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-2 text-sm">
          <dt className="text-muted">{k}</dt>
          <dd className="max-w-[60%] break-all text-right font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
