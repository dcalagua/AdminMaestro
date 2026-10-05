# FASE 03 — Especificación del sistema visual V2

## Objetivo
Un documento corto y decidido que todas las fases siguientes apliquen sin improvisar: `docs/design/VISUAL_SYSTEM_V2.md`.

## Insumos
`DECISIONS.md` (D-V01…D-V08), `BASELINE.md` (auditoría de la fase 01), `src/app/tokens.css`, `src/app/index.css`,
`tailwind.config.ts`, `src/components/ui/*`, `EBIM_CONVENTIONS.md`. Carga el skill `dataviz` para la sección de gráficos.

## Contenido obligatorio del documento
1. Principios (5 como máximo) y qué NO se hace.
2. Tipografía: escala exacta (tamaño/alto de línea/peso/tracking/opsz) y su mapeo a clases Tailwind o utilidades CSS.
3. Color: tokens claro y oscuro (superficies, texto, bordes, marca, semánticos, foco), con relaciones de contraste calculadas (AA).
4. Elevación y radios, espaciado (escala 4px), rejilla de página (ancho máximo, columnas del dashboard), breakpoints.
5. Componentes: anatomía y estados de input, select, textarea, checkbox/switch, botón, badge, tarjeta, KPI tile, tabla, tabs,
   diálogo, drawer, toast, skeleton, estado vacío, encabezado de página.
6. Gráficos (según el skill `dataviz`): paleta categórica y secuencial validadas, estilo de ejes/grid/tooltip/leyenda,
   formatos de números (moneda abreviada `S/ 1,2 M`, porcentajes), reglas para sparkline, waterfall y barras apiladas, modo oscuro.
7. Movimiento y accesibilidad (foco visible, reduced motion, objetivos táctiles).
8. Inventario de pantallas → patrón que aplica cada una (para las fases 10–12).

## Pasos
1. Escribe el documento (en español), con valores concretos (no «a criterio»).
2. Si el skill `dataviz` provee un validador de paleta, ejecútalo y pega el resultado.
3. Commit: `docs(design): add the V2 visual system specification`.

## Hecho cuando
El documento existe, es concreto, cubre los 8 puntos, y está commiteado. Sin cambios de código en esta fase.
