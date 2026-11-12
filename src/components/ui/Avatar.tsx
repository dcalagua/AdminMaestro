import type { CSSProperties } from 'react';
import { initialsOf } from '@/lib/initials';

/**
 * Avatar de iniciales (listados de clientes, fichas 360; VISUAL_SYSTEM_V2 §8
 * PT-360 / PT-LIST). Siempre decorativo: el nombre ya está escrito al lado.
 *
 * Colores por token (`--accent-soft` + `--accent-deep`, AA 5.74 / 6.74). El
 * color de acento propio de una organización es un DATO de su marca: se usa
 * solo como punto en la esquina, nunca como fondo del texto, porque su
 * contraste con las iniciales no está garantizado.
 */

const SIZE = {
  sm: 'h-8 w-8 rounded-md text-caption',
  md: 'h-10 w-10 rounded-lg text-compact',
  lg: 'h-14 w-14 rounded-xl text-h3',
} as const;

export function Avatar({
  name,
  size = 'sm',
  ringColor,
  mode = 'org',
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZE;
  /** Color de marca de la organización (dato): punto en la esquina. */
  ringColor?: string | null;
  mode?: 'org' | 'person';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-avatar
      className={`relative inline-flex shrink-0 select-none items-center justify-center bg-accent-soft font-bold text-accent-deep ${SIZE[size]} ${className}`}
    >
      {initialsOf(name, mode)}
      {ringColor ? (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card ${size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'}`}
          style={{ background: ringColor } as CSSProperties}
        />
      ) : null}
    </span>
  );
}
