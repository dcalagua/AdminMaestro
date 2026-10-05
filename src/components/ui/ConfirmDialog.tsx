import { useEffect, useId, useRef, useState } from 'react';
import { QuestionIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { useModalFocus } from './useModalFocus';

/**
 * Confirmación para operaciones destructivas o de alto impacto.
 *
 * Ciclo de teclado completo (E09): foco confinado y devuelto al activador;
 * Escape cancela salvo con la operación en curso. En tono `danger` el foco
 * inicial va a «Cancelar»: un Enter accidental nunca ejecuta lo irreversible.
 *
 * Sin doble envío: tras el primer clic el botón queda deshabilitado y
 * `aria-busy` hasta que la promesa de `onConfirm` termina, `busy` vuelve a
 * `false` o el diálogo se cierra.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** Operación en curso controlada por el consumidor (p. ej. `mutation.isPending`). */
  busy?: boolean;
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [latched, setLatched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const firing = useRef(false);
  const pending = busy || latched;

  // Al cerrarse, el cerrojo se libera (ajuste de estado durante el render).
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setLatched(false);
  }
  useEffect(() => {
    if (!open) firing.current = false;
  }, [open]);

  useModalFocus(panelRef, open, {
    initialFocus: () => (tone === 'danger' ? cancelRef.current : confirmRef.current),
    onEscape: onCancel,
    canEscape: () => !pending,
  });

  if (!open) return null;

  const confirm = () => {
    if (firing.current || busy) return;
    firing.current = true;
    setLatched(true);
    let result: void | Promise<unknown>;
    try {
      result = onConfirm();
    } catch (error) {
      firing.current = false;
      setLatched(false);
      throw error;
    }
    if (result && typeof (result as Promise<unknown>).finally === 'function') {
      void (result as Promise<unknown>).finally(() => {
        firing.current = false;
        setLatched(false);
      });
    }
  };

  return (
    <div className="ebim-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        className="ebim-dialog w-full max-w-[440px] p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="flex items-start gap-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-deep'
            }`}
            aria-hidden
          >
            {tone === 'danger' ? <WarningOctagonIcon size={22} /> : <QuestionIcon size={22} />}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2 text-fg">
              {title}
            </h2>
            <p id={messageId} className="mt-1.5 text-body text-fg-2">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="ebim-btn-ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? 'ebim-btn-danger' : 'ebim-btn-primary'}
            onClick={confirm}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? <span className="ebim-spinner" aria-hidden /> : null}
            {pending ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
