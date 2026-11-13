import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/**
 * V6 · T11 · `ResponsiveContainer` que solo se monta cuando su caja mide algo.
 *
 * Recharts avisa en consola («The width(0) and height(0) of chart should be
 * greater than 0») si el contenedor mide 0: un panel dentro de un bloque
 * `hidden` (los gráficos plegados del Resumen en móvil), una pestaña sin
 * mostrar o el primer pintado antes del layout. Aquí se mide la caja, el
 * gráfico se monta con esa medida como `initialDimension` y se desmonta si la
 * caja vuelve a medir 0. Sin `ResizeObserver` (jsdom) no se dibuja, igual que
 * antes.
 */
export function ChartFrame({ children }: { children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      setSize((prev) => (w > 0 && h > 0 ? (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }) : null));
    };
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) update(box.width, box.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }} data-chart-frame>
      {size ? (
        <ResponsiveContainer width="100%" height="100%" initialDimension={size}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
