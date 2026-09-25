import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { businessErrorMessage } from '@/lib/pgError';
import { useModalFocus } from './useModalFocus';

/**
 * Diálogo de formulario del Control Plane.
 *
 * Es el complemento de escritura de `ConfirmDialog` (que solo confirma). Mismo
 * ciclo de teclado (E09): foco inicial en el primer campo, Tab confinado, foco
 * devuelto al activador y Escape bloqueado mientras se guarda (`busy`). El botón
 * de guardar queda deshabilitado y `aria-busy` durante el guardado: no hay doble
 * envío.
 *
 * Muestra el error de negocio devuelto por Postgres tal y como lo tradujo
 * `parseBusinessError`, encima de los botones: el usuario debe ver POR QUÉ la
 * base rechazó la operación, no un "algo salió mal".
 */
export function FormDialog({
  open,
  title,
  description,
  submitLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  busy = false,
  error,
  wide = false,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: unknown;
  wide?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useModalFocus(formRef, open, {
    // Primer control del formulario, no el botón de guardar.
    initialFocus: () =>
      bodyRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    onEscape: onCancel,
    canEscape: () => !busy,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        className={`ebim-card w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} p-5 shadow-pop`}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          onSubmit();
        }}
      >
        <h2 id={titleId} className="text-base font-bold text-fg">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1 text-sm text-muted">
            {description}
          </p>
        ) : null}

        <div ref={bodyRef} className="mt-4 grid gap-4">
          {children}
        </div>

        {error ? (
          <p
            className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {businessErrorMessage(error)}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="ebim-btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="submit" className="ebim-btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Guardando…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
