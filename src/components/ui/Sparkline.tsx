/**
 * Tendencia mínima para un KpiTile (VISUAL_SYSTEM_V2 §6.6, skill `dataviz`).
 *
 * SVG puro y no Recharts: los primitivos viajan en el bundle de todas las
 * pantallas y Recharts (~170 kB) solo se carga con el resumen ejecutivo.
 *
 * Sin ejes, grid ni tooltip: la cifra la da el tile. Línea 1.5 px en el tono de
 * de-énfasis (`--chart-muted`) y el último punto en el acento (`--chart-1`) con
 * anillo de superficie; si el último mes es parcial el punto va hueco. Escala Y
 * desde el mínimo de la serie (es tendencia, no magnitud). El trazo no se
 * deforma al estirar el SVG (`non-scaling-stroke`) y el marcador es HTML para
 * seguir siendo un círculo a cualquier ancho.
 */
export function Sparkline({
  data,
  partialLast = false,
  description,
  height = 36,
  className = '',
}: {
  data: ReadonlyArray<number | null | undefined>;
  /** El último punto es un período en curso (mes parcial): marcador hueco. */
  partialLast?: boolean;
  /** Texto para lectores de pantalla, p. ej. «Tendencia 12 meses: de USD 41 K a USD 50 K». */
  description?: string;
  height?: number;
  className?: string;
}) {
  const points = data
    .map((v, i) => (typeof v === 'number' && Number.isFinite(v) ? { i, v } : null))
    .filter((p): p is { i: number; v: number } => p !== null);

  if (points.length < 2) return null;

  const W = 100;
  const H = 100;
  const PAD = 10; // margen vertical para que el marcador no se recorte
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const last = data.length - 1 || 1;
  const x = (i: number) => (i / last) * W;
  const y = (v: number) => (max === min ? H / 2 : PAD + (1 - (v - min) / span) * (H - 2 * PAD));

  const path = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
  const end = points[points.length - 1]!;

  return (
    <div className={`relative w-full ${className}`} style={{ height }} data-testid="sparkline">
      {description ? <span className="sr-only">{description}</span> : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
        aria-hidden
        focusable="false"
      >
        <path
          d={path}
          fill="none"
          stroke="var(--chart-muted)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{
          left: `${x(end.i)}%`,
          top: `${y(end.v)}%`,
          // Anillo de superficie (2 px) alrededor de un punto de 6 px; hueco si es parcial.
          boxShadow: '0 0 0 2px var(--card)',
          borderColor: 'var(--chart-1)',
          background: partialLast ? 'var(--card)' : 'var(--chart-1)',
        }}
      />
    </div>
  );
}
