import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretDownIcon, CheckIcon, SignOutIcon, UserCircleIcon } from '@phosphor-icons/react';
import type { Density } from '@/hooks/appearanceStore';

/**
 * Avatar con menú de cuenta (topbar, U-11 A): Mi perfil, densidad y Salir.
 * Patrón de menú WAI-ARIA: flechas, Inicio/Fin, Escape devuelve el foco al botón,
 * clic fuera o Tab lo cierran. La densidad es preferencia del usuario (U-08):
 * se guarda igual que en Configuración.
 */

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: 'comoda', label: 'Cómoda' },
  { value: 'equilibrada', label: 'Equilibrada' },
  { value: 'compacta', label: 'Compacta' },
];

function initialsOf(name: string): string {
  // «Dennis Calagua (Operador)» → DC; «ana.perez@x.com» → AP. Sin paréntesis ni símbolos.
  const base = (name.includes('@') ? name.split('@')[0]!.replace(/[._-]+/g, ' ') : name).replace(/\([^)]*\)/g, ' ');
  const parts = base.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function AccountMenu({
  name,
  email,
  roleLabel,
  density,
  onDensity,
  onSignOut,
}: {
  name: string;
  email: string | null;
  roleLabel: string;
  density: Density;
  onDensity: (d: Density) => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
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

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="flex h-10 items-center gap-2.5 rounded-field pl-1 pr-2 transition-colors duration-fast ease-out hover:bg-hover"
        aria-label="Menú de cuenta"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-caption font-bold text-accent-deep"
        >
          {initialsOf(name)}
        </span>
        <span className="hidden min-w-0 max-w-[200px] text-left md:block">
          <span className="block truncate text-compact font-semibold leading-tight text-fg">{name}</span>
          <span className="block truncate text-caption leading-tight text-muted">{roleLabel}</span>
        </span>
        <CaretDownIcon size={14} aria-hidden className="hidden shrink-0 text-muted md:block" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Cuenta"
          className="ebim-menu absolute right-0 top-full z-40 mt-2 w-72"
          onKeyDown={onMenuKey}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="truncate text-compact font-semibold text-fg">{name}</div>
            {email && email !== name ? <div className="truncate text-caption text-muted">{email}</div> : null}
            <div className="mt-0.5 truncate text-caption text-muted">{roleLabel}</div>
          </div>
          <div role="separator" className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ebim-menu-item"
            onClick={() => {
              close(false);
              navigate('/settings#profile');
            }}
          >
            <UserCircleIcon size={18} aria-hidden className="text-muted" />
            Mi perfil
          </button>
          <div role="separator" className="my-1 border-t border-border" />
          <div role="group" aria-label="Densidad">
            <div aria-hidden className="px-2.5 pb-1 pt-1.5 text-micro text-muted">
              Densidad
            </div>
            {DENSITY_OPTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                role="menuitemradio"
                aria-checked={density === d.value}
                tabIndex={-1}
                className="ebim-menu-item"
                onClick={() => onDensity(d.value)}
              >
                <span className="inline-flex w-[18px] justify-center text-accent-deep">
                  {density === d.value ? <CheckIcon size={16} weight="bold" aria-hidden /> : null}
                </span>
                {d.label}
              </button>
            ))}
          </div>
          <div role="separator" className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ebim-menu-item"
            onClick={() => {
              close(false);
              onSignOut();
            }}
          >
            <SignOutIcon size={18} aria-hidden className="text-muted" />
            Salir
          </button>
        </div>
      ) : null}
    </div>
  );
}
