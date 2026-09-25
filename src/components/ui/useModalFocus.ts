import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Ciclo de foco de un diálogo modal (WAI-ARIA Dialog Pattern, E09):
 *  - al abrir, recuerda el activador y enfoca `initialFocus()` (o el primer
 *    control);
 *  - Tab / Shift+Tab quedan confinados al diálogo;
 *  - Escape llama a `onEscape` sólo si `canEscape()` (no mientras se guarda);
 *  - al cerrar, el foco vuelve al activador.
 *
 * Las funciones se leen por ref: cambian de identidad en cada render del
 * consumidor y no deben reiniciar el ciclo (ni robar el foco al usuario).
 */
export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: {
    initialFocus?: () => HTMLElement | null | undefined;
    onEscape: () => void;
    canEscape?: () => boolean;
  },
) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  useEffect(() => {
    if (!open) return;
    const activator = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const target = opts.current.initialFocus?.() ?? (container ? focusableWithin(container)[0] : null);
    target?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (opts.current.canEscape?.() ?? true) {
          e.stopPropagation();
          opts.current.onEscape();
        }
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;
      const items = focusableWithin(containerRef.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? containerRef.current.contains(active) : false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Devolver el foco sólo si el activador sigue en el documento.
      if (activator && document.contains(activator)) activator.focus();
    };
  }, [open, containerRef]);
}
