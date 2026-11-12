# FASE 10 — Pantallas de Finanzas

## Rutas
`/billing`, `/costs`, `/commissions`, `/commission-plans`, `/renewals`, `/reconciliation`, `/regional`, `/ai-credits`,
`/billing-shadow`, `/partner-fees`, y el detalle de suscripción/factura (cobro, enlace de pago, intentos).

## Patrón a aplicar en cada una (de `VISUAL_SYSTEM_V2.md` §8)
- Encabezado unificado (título, descripción breve, acciones primarias a la derecha).
- Franja de 3–4 KpiTile propios de la pantalla calculados de datos ya cargados (sin consultas nuevas pesadas), p. ej.
  Facturación: emitido del mes / cobrado / % cobro / vencido; Comisiones: devengado / en liquidación / pagado.
- Un gráfico pequeño y útil donde aporte (no en todas): p. ej. cobros por semana en Facturación, comisiones por mes en Comisiones.
- Tablas con el nuevo `DataTable`: números tabulares a la derecha, estados con Badge, acciones al hover, buscador único + pestañas (U-06).
- Formularios/diálogos con los nuevos campos (MoneyField donde haya importes).
- Skeleton/vacío/error consistentes.
- No cambies lógica de negocio ni permisos; solo presentación (y lecturas livianas si un KPI lo necesita).

## Pasos
Por cada pantalla: implementar → ajustar tests → captura `VISUAL_LABEL=fase10`. Commit por grupo de 2–3 pantallas (`style(finance): …`).
Gate completo al final.

## Hecho cuando
Las 10 rutas con el patrón aplicado, tests y gates verdes, capturas revisadas.
