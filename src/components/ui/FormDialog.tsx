import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react';
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
    <div className="ebim-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:py-10">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        className={`ebim-dialog flex max-h-[85vh] w-full flex-col ${wide ? 'max-w-[720px]' : 'max-w-[560px]'}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          onSubmit();
        }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2 text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-compact text-fg-2">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ebim-icon-btn -mr-2 -mt-1"
            aria-label="Cerrar"
            title="Cerrar"
            onClick={onCancel}
            disabled={busy}
          >
            <XIcon size={18} aria-hidden />
          </button>
        </header>

        <div ref={bodyRef} className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {error ? (
          <p
            className="mx-6 mb-1 flex items-start gap-2 rounded-field bg-danger-soft px-3 py-2.5 text-compact text-danger"
            role="alert"
          >
            <WarningCircleIcon size={18} className="mt-px shrink-0" aria-hidden />
            <span>{businessErrorMessage(error)}</span>
          </p>
        ) : null}

        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" className="ebim-btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="submit" className="ebim-btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="ebim-spinner" aria-hidden /> : null}
            {busy ? 'Guardando…' : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
