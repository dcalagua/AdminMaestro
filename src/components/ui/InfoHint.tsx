import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';

/**
 * V6 · T1 · «¿Qué es esto?»: la explicación larga de una pantalla, una cifra o
 * un aviso, plegada tras un icono para que no ocupe 2–3 líneas fijas.
 *
 * - Botón de icono con `aria-expanded`; clic o Enter abre un globo con el texto.
 * - Escape, un clic fuera o volver a pulsar lo cierran; el foco vuelve al botón.
 * - El texto queda SIEMPRE en el DOM (oculto con `hidden` mientras está
 *   cerrado) y enlazado con `aria-describedby`: el lector de pantalla lo anuncia
 *   al llegar al botón sin tener que abrirlo.
 *
 * Úsalo para descripciones de pestaña (lo hace `PageContainer` incrustado en
 * un hub), avisos de método («el MRR oficial…») y notas al pie de tarjetas.
 * No sirve para información imprescindible para decidir: esa va a la vista.
 *
 * @example
 * <InfoHint label="Qué es el MRR oficial" title="MRR oficial">
 *   Suma de contratos activos por moneda, sin tipo de cambio.
 * </InfoHint>
 */
export function InfoHint({
  label = '¿Qué es esto?',
  title,
  children,
  showLabel = false,
  align = 'start',
  className = '',
}: {
  /** Nombre accesible del botón (y texto visible con `showLabel`). */
  label?: string;
  /** Encabezado en negrita dentro del globo (p. ej. el nombre de la pestaña). */
  title?: string;
  /** La explicación. */
  children: ReactNode;
  /** Muestra `label` junto al icono (por defecto, solo el icono). */
  showLabel?: boolean;
  /** Borde del globo alineado con el botón: `start` (izquierda) o `end` (derecha). */
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // En pantallas estrechas el globo se fija al ancho de la ventana (16 px de margen)
  // bajo el botón, para no salirse por la derecha.
  const [narrow, setNarrow] = useState<CSSProperties | undefined>(undefined);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={`relative inline-flex align-middle ${className}`} data-info-hint>
      <button
        ref={button}
        type="button"
        aria-label={showLabel ? undefined : label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={id}
        onClick={() => {
          const rect = button.current?.getBoundingClientRect();
          setNarrow(
            rect && typeof window !== 'undefined' && window.innerWidth < 640
              ? { position: 'fixed', top: rect.bottom + 6, left: 16, right: 16, width: 'auto' }
              : undefined,
          );
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1 rounded-full text-muted transition-colors duration-fast ease-out hover:text-accent-deep ${
          showLabel ? 'text-caption font-semibold' : 'h-7 w-7 justify-center hover:bg-hover'
        } ${open ? 'text-accent-deep' : ''}`}
      >
        <InfoIcon size={showLabel ? 14 : 18} aria-hidden />
        {showLabel ? label : null}
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        style={narrow}
        className={`absolute top-full z-30 mt-1.5 w-[min(360px,calc(100vw-32px))] rounded-field border border-border bg-elevated p-3 text-left text-compact font-normal normal-case tracking-normal text-fg-2 shadow-pop ${
          align === 'end' ? 'right-0' : 'left-0'
        }`}
      >
        {title ? <span className="mb-1 block font-semibold text-fg">{title}</span> : null}
        {title ? ' ' : null}
        {children}
      </span>
    </span>
  );
}
