/**
 * Isotipo EBIM — contrato §4.6.
 *
 * SVG inline (sin archivo de imagen), swirl de 6 figuras, viewBox 200x200,
 * `fill` configurable. El mismo dibujo que sirve el favicon: todas las apps de
 * la suite muestran EL MISMO isotipo, no una reinterpretación.
 *
 * `animated` activa "gira y para": una vuelta y se detiene, en bucle, 3.6s.
 * La animación respeta `prefers-reduced-motion` (definido en index.css).
 */
interface EbimMarkProps {
  size?: number;
  color?: string;
  animated?: boolean;
  className?: string;
}

export function EbimMark({
  size = 32,
  color = 'currentColor',
  animated = false,
  className = '',
}: EbimMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill={color}
      role="img"
      aria-label="EBIM"
      className={`${animated ? 'animate-spin-stop' : ''} ${className}`.trim()}
    >
      <path d="M100 18c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z" />
      <path d="M157 51c10 10 10 26 0 36s-26 10-36 0-10-26 0-36 26-10 36 0z" />
      <path d="M182 100c0 14-11 25-25 25s-25-11-25-25 11-25 25-25 25 11 25 25z" />
      <path d="M157 149c10 10 10 26 0 36s-26 10-36 0-10-26 0-36 26-10 36 0z" opacity=".82" />
      <path d="M100 132c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z" opacity=".64" />
      <path d="M43 75c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z" opacity=".46" />
    </svg>
  );
}

/**
 * Lockup de suite: `[isotipo] <NombreApp>` + `BY EBIM` debajo.
 * El nombre de app varía; "by EBIM" es fijo (contrato §4.6 y §4.5 punto 14).
 */
export function EbimLockup({
  appName = 'Control Plane',
  color,
  markColor,
  size = 30,
}: {
  appName?: string;
  color?: string;
  markColor?: string;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <EbimMark size={size} color={markColor ?? color ?? 'var(--brand-mark)'} animated />
      <div className="leading-none" style={color ? { color } : undefined}>
        <div className="text-[19px] font-extrabold tracking-tight">{appName}</div>
        <div className="mt-[3px] text-[9.5px] font-bold tracking-[0.22em] opacity-85">BY EBIM</div>
      </div>
    </div>
  );
}
