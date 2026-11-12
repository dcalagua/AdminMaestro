import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';
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
  size = 'md',
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** `md` 480 px · `lg` 640 px (§5.10). */
  size?: 'md' | 'lg';
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
    <div className="ebim-scrim fixed inset-0 z-40 flex justify-end">
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`ebim-drawer flex h-full w-full flex-col ${size === 'lg' ? 'max-w-[640px]' : 'max-w-[480px]'}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 text-fg">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 break-words text-caption text-muted">{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="ebim-icon-btn -mr-2" aria-label="Cerrar" title="Cerrar" onClick={onClose}>
            <XIcon size={18} aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {actions ? <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">{actions}</footer> : null}
      </aside>
    </div>
  );
}

/** Lista clave → valor para el cuerpo de un `DetailDrawer`: etiqueta caption encima del valor, en 2 columnas. */
export function DetailList({ items, columns = 2 }: { items: Array<[string, ReactNode]>; columns?: 1 | 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-caption text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-body font-medium text-fg">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
