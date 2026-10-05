# FASE 09 — Resumen Ejecutivo de impacto

## Objetivo
La pantalla estrella de la presentación. En 10 segundos Gerencia debe entender: cuánto factura el negocio, si crece,
de dónde viene el crecimiento, si se cobra, y qué requiere atención.

**Carga primero el skill `dataviz` y síguelo en cada gráfico.**

## Estructura (D-V05; ajusta con criterio de `dataviz`)
1. **Franja hero**: 6 KpiTile — MRR, ARR, Cobrado del mes, Cartera vencida, Clientes activos, NRR (o churn %). Cada uno con
   sparkline de 12 meses (serie de la fase 08), variación vs mes anterior con tono semántico (cartera que sube = malo).
2. **Protagonista**: evolución de MRR 12/18 meses (área con gradiente de marca, línea de ARR opcional), selector de periodo y
   moneda de reporte (reutiliza `CurrencyPicker`), anotación del último valor.
3. **Puente de MRR del mes** (waterfall) con selector de mes; clic en una barra → lista de clientes que la componen.
4. **Facturado vs cobrado** por mes (barras agrupadas + línea de % de cobro en eje secundario).
5. **Cartera por antigüedad** (barra apilada horizontal) con monto y n° de facturas; clic → Facturación filtrada.
6. **Mix de MRR** por producto (barras horizontales ordenadas, los 8 productos) y por mercado (PE/BO/EC).
7. **Top 5 clientes** y **top partners** por MRR, con tendencia.
8. **Requiere atención**: renovaciones próximas, cobros fallidos, tenants suspendidos, liquidaciones abiertas — cada ítem con acción.
- Las perspectivas existentes (Ejecutiva/Finanzas/Operación) se conservan; la Ejecutiva se rediseña así; Finanzas y Operación adoptan
  KpiTile, skeletons y el estilo de gráficos.
- Tooltips ricos, leyendas solo cuando hacen falta, números abreviados (`S/ 1,24 M`), todo clicable al detalle existente.
- Vacíos/errores elegantes por panel (un panel que falla no tumba el tablero).
- Responsive: 1440 (rejilla 12 col), 1280, 1024; legible en proyector.

## Pasos
1. Diseña la rejilla según `VISUAL_SYSTEM_V2.md`. 2. Implementa reutilizando `ChartPanel` y los hooks de la fase 08.
3. Tests vitest (render con datos, vacío, error por panel, clic → navegación). Actualiza `DashboardPage.test.tsx`.
4. Capturas `VISUAL_LABEL=fase09` del dashboard claro/oscuro, 1440 y 1280; **mira las capturas** y corrige lo que no se lea.
5. Gate completo. 6. Commits `feat(executive): …`.

## Hecho cuando
Dashboard completo con datos del demo, legible a distancia, clicable, probado, gates verdes.
