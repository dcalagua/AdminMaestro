import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { DotsThreeIcon } from '@phosphor-icons/react';

/**
 * Menú de acciones (§5.7 y §5.13): botón `DotsThree` que abre un menú WAI-ARIA.
 *
 * - `row` (por defecto): columna final de una tabla. En escritorio el botón se
 *   ve al pasar por la fila o al enfocarla (`.ebim-row-actions`); en táctil
 *   siempre. La acción primaria de la fila sigue siendo el clic en su nombre.
 * - `page`: botón fantasma «Más acciones» del encabezado (lo que no cabe en
 *   1 primaria + 2 secundarias).
 *
 * El menú se pinta en un portal con posición fija: una tabla con scroll
 * horizontal no lo recorta. Las acciones destructivas van al final, tras un
 * separador y en `--danger` (nunca un enlace rojo por fila, A12).
 */

export interface ActionMenuItem {
  label: string;
  onSelect?: () => void;
  /** Navega a la ruta (alternativa a `onSelect`). */
  to?: string;
  tone?: 'danger';
  icon?: ReactNode;
  disabled?: boolean;
  /** Motivo de un ítem deshabilitado o detalle breve. */
  title?: string;
}

export function ActionMenu({
  label,
  items,
  variant = 'row',
  buttonLabel = 'Más acciones',
}: {
  /** Nombre accesible del botón: «Acciones de INV-0001». */
  label: string;
  items: Array<ActionMenuItem | null | false | undefined>;
  /** `icon`: botón solo-icono siempre visible (tarjetas de catálogo). */
  variant?: 'row' | 'page' | 'icon';
  /** Texto visible del botón en la variante `page`. */
  buttonLabel?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = items.filter(Boolean) as ActionMenuItem[];
  const regular = visible.filter((i) => i.tone !== 'danger');
  const danger = visible.filter((i) => i.tone === 'danger');

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const r = button.getBoundingClientRect();
      const width = menuRef.current?.offsetWidth ?? 224;
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = r.bottom + 4 + height <= window.innerHeight;
      setPos({
        top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height),
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      });
    };
    place();
    // Segunda medida: el alto real del menú existe tras el primer pintado.
    const raf = requestAnimationFrame(place);
    // Con scroll (página o tabla) el menú sigue al botón en vez de cerrarse.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus({ preventScroll: true });
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  if (visible.length === 0) return null;

  const close = (refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (item: ActionMenuItem) => {
    close(!item.to);
    if (item.to) navigate(item.to);
    else item.onSelect?.();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const renderItem = (item: ActionMenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={item.disabled}
      title={item.title}
      className={`ebim-menu-item disabled:cursor-not-allowed disabled:opacity-55 ${item.tone === 'danger' ? 'text-danger' : ''}`}
      onClick={() => choose(item)}
    >
      {item.icon ? (
        <span aria-hidden className={item.tone === 'danger' ? '' : 'text-muted'}>
          {item.icon}
        </span>
      ) : null}
      {item.label}
    </button>
  );

  return (
    <span className={variant === 'row' ? 'ebim-row-actions inline-flex' : 'inline-flex'} data-open={open || undefined}>
      <button
        ref={buttonRef}
        type="button"
        className={variant === 'page' ? 'ebim-btn-ghost' : 'ebim-icon-btn'}
        aria-label={label}
        title={variant === 'page' ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <DotsThreeIcon size={variant === 'page' ? 18 : 20} weight="bold" aria-hidden />
        {variant === 'page' ? buttonLabel : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className="ebim-menu fixed z-50 min-w-[200px] max-w-[280px]"
              style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
              onKeyDown={onMenuKey}
            >
              {regular.map(renderItem)}
              {danger.length > 0 && regular.length > 0 ? <div role="separator" className="my-1 border-t border-border" /> : null}
              {danger.map(renderItem)}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
