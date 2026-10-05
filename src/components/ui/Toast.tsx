import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { ToastContext } from './toast-context';
import type { ToastApi, ToastTone } from './toast-context';

/**
 * Feedback de operaciones de escritura.
 *
 * Existe porque el prompt de la Fase 02 exige "estados explícitos siempre:
 * vacío, carga, error, éxito" (U-14) y hasta V2 la consola era solo de lectura,
 * así que no había ningún canal para el "éxito" ni para el error de negocio.
 *
 * Deliberadamente minimalista: sin librería de notificaciones, sin portales
 * anidados, tokens de color del tema. Anatomía en VISUAL_SYSTEM_V2 §5.11:
 * abajo a la derecha, máximo 3 visibles, barra e icono del rol, autocierre a
 * los 6 s que se pausa mientras el puntero o el foco están encima.
 */

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 3;

const TONES: Record<ToastTone, { bar: string; icon: string; Icon: typeof CheckCircleIcon }> = {
  success: { bar: 'bg-ok', icon: 'text-ok', Icon: CheckCircleIcon },
  error: { bar: 'bg-danger', icon: 'text-danger', Icon: WarningCircleIcon },
  info: { bar: 'bg-info', icon: 'text-info', Icon: InfoIcon },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(AUTO_DISMISS_MS);

  // Los errores también se auto-cierran: quedarse pegados obliga a limpiar la
  // pantalla a mano y acaba entrenando a la gente para ignorarlos. Pero nunca
  // mientras alguien los está leyendo (puntero o foco encima).
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started));
    };
  }, [paused, toast.id, onDismiss]);

  const t = TONES[toast.tone];
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="ebim-toast pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-card border border-border bg-elevated py-3 pl-4 pr-2 shadow-pop"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} aria-hidden />
      <t.Icon size={20} weight="fill" className={`mt-px shrink-0 ${t.icon}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-compact font-semibold text-fg">{toast.title}</p>
        {toast.detail ? <p className="mt-0.5 break-words text-caption text-fg-2">{toast.detail}</p> : null}
      </div>
      <button
        type="button"
        className="ebim-icon-btn h-7 w-7"
        aria-label="Cerrar aviso"
        onClick={() => onDismiss(toast.id)}
      >
        <XIcon size={14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, title, detail }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, detail) => push('success', title, detail),
      error: (title, detail) => push('error', title, detail),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[360px] max-w-[calc(100vw-3rem)] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.slice(-MAX_VISIBLE).map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
