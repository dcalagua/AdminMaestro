# FASE 14 — Modo presentación para Gerencia

## Objetivo
Poder proyectar el Admin Maestro en una reunión sin ruido de operación.

## Alcance
- Activación: `/?presentacion=1` o botón «Presentar» en el Resumen Ejecutivo (solo personas EBIM).
- Pantalla completa (Fullscreen API con fallback), oculta sidebar/topbar, tipografía +1 escalón, tema claro forzado opcional.
- Secuencia de «diapositivas» del tablero: (1) KPIs hero, (2) evolución MRR, (3) puente del mes, (4) facturado vs cobrado + cartera,
  (5) mix por producto y mercado, (6) top clientes/partners. Navegación con flechas/espacio, indicador de progreso, autoplay opcional
  (cada 20 s), `Esc` para salir.
- Cabecera discreta con logo EBIM, fecha de corte de datos y moneda de reporte.
- Opción «Ocultar nombres de clientes» (los reemplaza por «Cliente A, B…») para presentar sin exponer datos.
- Impresión/PDF: estilos `@media print` del tablero en A4 apaisado (una sección por página).
- Respeta reduced motion; accesible por teclado.

## Pasos
Implementar → tests (activación, navegación por teclado, anonimización) → capturas `VISUAL_LABEL=fase14` de cada diapositiva → gate completo → commit `feat(executive): add the presentation mode`.

## Hecho cuando
Modo presentación usable con el demo, imprimible, probado, gates verdes.
