/**
 * Isotipo EBIM — contrato §4.6.
 *
 * SVG inline (sin archivo de imagen): 1 círculo + 5 cuadrados redondeados
 * rotados, viewBox 200x200 — copiado del isotipo de EWM (WMS-by-EBIM),
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
      <circle cx="100" cy="38" r="26" />
      <rect x="127.7" y="43" width="52" height="52" rx="4" transform="rotate(15 153.7 69)" />
      <rect x="127.7" y="105" width="52" height="52" rx="14" transform="rotate(-10 153.7 131)" />
      <rect x="74" y="136" width="52" height="52" rx="13" transform="rotate(45 100 162)" />
      <rect x="20.3" y="105" width="52" height="52" rx="16" transform="rotate(8 46.3 131)" />
      <rect x="20.3" y="43" width="52" height="52" rx="23" transform="rotate(-6 46.3 69)" />
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
