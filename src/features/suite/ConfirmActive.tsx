import type { ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';
import { CONFIRM_ACTIVE_LABEL, type ConfirmTarget, type useConfirmActive } from './useConfirmActive';

/**
 * «Confirmar como activo» (V5 · F2): un tenant que la app ya dio de alta
 * (alta ACTIVE) pero que en el Admin Maestro sigue «Pendiente». Es la MISMA
 * acción en el Centro de la suite, en la ficha de la cuenta y en la del tenant:
 * nada cambia sin la confirmación de una persona y el motivo queda en auditoría.
 */

/** Explicación para UN tenant en ese estado (detalle de la celda, ficha del tenant). */
export const PENDING_CONFIRM_EXPLANATION =
  'La app respondió que el tenant existe y está activo, pero el Admin Maestro lo mantiene «Pendiente». ' +
  'Mientras tanto no se cuenta como activo en los reportes. Confírmalo cuando verifiques que el cliente ya entra a la app.';

/** Aviso con el número de tenants activos en su app y «Pendiente» aquí. */
export function PendingConfirmNotice({ count, children }: { count: number; children?: ReactNode }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border bg-warn-soft px-5 py-3 text-compact text-fg" role="note" data-pending-confirm-notice>
      <InfoIcon size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          <strong>
            {count} tenant{count === 1 ? '' : 's'} activo{count === 1 ? '' : 's'} en su app
            {' '}pero «Pendiente» en el Admin Maestro.
          </strong>{' '}
          Cuando la app confirma el alta, el estado del tenant todavía no se actualiza solo. Revisa cada uno y
          confírmalo desde su detalle; nada cambia sin tu confirmación.
        </p>
        {children ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

/** Botón que abre la confirmación; no se pinta si el rol no puede confirmar. */
export function ConfirmActiveButton({
  confirm,
  target,
  size = 'sm',
  onBeforeOpen,
}: {
  confirm: ReturnType<typeof useConfirmActive>;
  target: ConfirmTarget;
  size?: 'sm' | 'md';
  onBeforeOpen?: () => void;
}) {
  if (!confirm.allowed) return null;
  return (
    <button
      type="button"
      className={`ebim-btn-primary${size === 'sm' ? ' ebim-btn-sm' : ''}`}
      onClick={() => {
        onBeforeOpen?.();
        confirm.open(target);
      }}
    >
      {CONFIRM_ACTIVE_LABEL}
    </button>
  );
}
