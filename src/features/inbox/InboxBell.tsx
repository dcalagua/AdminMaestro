import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellIcon } from '@phosphor-icons/react';
import { formatNumber } from '@/lib/format';
import { PRIORITY_LABEL, inboxTarget, type InboxItem } from './inboxModel';
import { useInbox } from './useInbox';

/**
 * Campana del topbar (V5 · F5): el contador de la Bandeja y un panel con los
 * cinco avisos más urgentes y «Ver todo».
 *
 * Panel NO modal (patrón «disclosure»): el botón lleva `aria-expanded`; al
 * abrir, el foco entra al panel; Escape lo cierra y devuelve el foco a la
 * campana; un clic fuera o salir con Tab también lo cierran. El contador
 * sustituye al antiguo badge de Cobranza: las alertas críticas ya cuentan aquí.
 */
const TOP = 5;

const DOT: Record<InboxItem['priority'], string> = {
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-border-strong',
};

export function InboxBell() {
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  const count = inbox.items.length;
  const urgent = inbox.items.filter((i) => i.priority === 1).length;
  const top = inbox.items.slice(0, TOP);
  const visibleKinds = Object.values(inbox.audience).some(Boolean);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  if (!visibleKinds) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const name =
    count === 0
      ? 'Bandeja: nada pendiente'
      : `Bandeja: ${formatNumber(count)} pendiente${count === 1 ? '' : 's'}${urgent > 0 ? `, ${formatNumber(urgent)} urgente${urgent === 1 ? '' : 's'}` : ''}`;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="ebim-icon-btn relative h-10 w-10"
        aria-label={name}
        title={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon size={20} weight={count > 0 ? 'fill' : 'regular'} aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            data-inbox-count
            className={`absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-caption font-bold tabular-nums ring-2 ring-[color:var(--card)] ${
              urgent > 0
                ? 'bg-[color:var(--danger-fill)] text-[color:var(--danger-fill-fg)]'
                : 'bg-accent-deep text-card'
            }`}
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="ebim-menu absolute right-0 top-12 z-40 w-[min(380px,calc(100vw-1.5rem))] p-0"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
          onBlur={(e) => {
            // Salir del panel con Tab lo cierra (no atrapa el foco: no es modal).
            const next = e.relatedTarget as Node | null;
            if (next && !panelRef.current?.contains(next) && !buttonRef.current?.contains(next)) setOpen(false);
          }}
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-compact font-semibold text-fg">
              Lo más urgente
            </h2>
            <span className="text-caption text-muted">
              {inbox.loading && count === 0 ? 'Revisando…' : `${formatNumber(count)} pendiente${count === 1 ? '' : 's'}`}
            </span>
          </div>
          {top.length === 0 ? (
            <p className="px-4 py-6 text-center text-compact text-muted">
              {inbox.loading ? 'Revisando cobranza, apps y aprobaciones…' : 'Nada pendiente. Todo al día.'}
            </p>
          ) : (
            <ul className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
              {top.map((item) => (
                <li key={item.key}>
                  <Link
                    to={inboxTarget(item)}
                    className="flex items-start gap-3 px-4 py-2.5 transition-colors duration-fast ease-out hover:bg-hover focus-visible:bg-hover"
                    onClick={() => setOpen(false)}
                  >
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[item.priority]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{PRIORITY_LABEL[item.priority]}: </span>
                      <span className="block truncate text-compact font-semibold text-fg">{item.title}</span>
                      <span className="block truncate text-caption text-muted">
                        {[item.account?.name, item.app, item.ageText].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="text-caption text-muted">
              {count > TOP ? `y ${formatNumber(count - TOP)} más` : ''}
            </span>
            <Link to="/bandeja" className="ebim-btn-secondary ebim-btn-sm" onClick={() => setOpen(false)}>
              Ver todo
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
