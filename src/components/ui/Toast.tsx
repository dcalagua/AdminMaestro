import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
 * anidados, tokens de color del tema.
 */

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, title, detail }]);
      // Los errores también se auto-cierran: quedarse pegados obliga a limpiar la
      // pantalla a mano y acaba entrenando a la gente para ignorarlos.
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

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
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`ebim-card pointer-events-auto flex items-start gap-3 p-3 shadow-pop ${
              t.tone === 'error'
                ? 'border-l-4 border-l-danger'
                : t.tone === 'success'
                  ? 'border-l-4 border-l-ok'
                  : 'border-l-4 border-l-info'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t.title}</p>
              {t.detail ? <p className="mt-0.5 break-words text-xs text-muted">{t.detail}</p> : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted hover:bg-accent-soft"
              aria-label="Cerrar aviso"
              onClick={() => dismiss(t.id)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="m3 3 10 10M13 3 3 13" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
