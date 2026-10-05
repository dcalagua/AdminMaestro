# FASE 11 — Pantallas de Clientes, canales, productos y contratos

## Rutas
`/customers`, `/partners`, `/organizations` + **ficha 360 de organización**, `/sales-agents`, `/attributions`, `/products` + detalle,
`/plans`, `/feature-flags`, `/commercial/capabilities`, `/catalog/addons`, `/onboarding` (nueva venta), `/tenants` + **Tenant 360**,
`/subscriptions` + detalle.

## Énfasis
- **Fichas 360** (organización y tenant): cabecera tipo «perfil» con avatar de iniciales/logo, estado, país, MRR, saldo, salud;
  `SectionTabs` con `#hash`; resumen con mini-gráficos (MRR del cliente 12m, cobros, uso) usando datos ya disponibles o las RPCs de la fase 08 filtradas si existen.
- **Suite SaaS**: tarjetas por producto con su isotipo/color de marca de producto si existe, MRR, tenants, estado de integración.
- **Nueva venta** (onboarding): asistente por pasos con progreso visible, resumen lateral fijo del contrato y total, validación clara.
- Listados: buscador único + pestañas de estado (U-06), avatar/iniciales en filas de clientes, columnas numéricas a la derecha.
- Sin cambios de lógica ni permisos.

## Pasos
Implementar por grupos, tests, capturas `VISUAL_LABEL=fase11`, commits `style(clients): …` / `style(catalog): …`, gate completo.

## Hecho cuando
Todas las rutas con el patrón, las dos fichas 360 y el asistente de venta a nivel de presentación, gates verdes.
