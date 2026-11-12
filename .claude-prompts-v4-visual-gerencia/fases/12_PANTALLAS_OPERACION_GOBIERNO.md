# FASE 12 — Pantallas de Operación SaaS y Gobierno

## Rutas
`/integrations` + detalle, `/commercial/entitlement-sync`, `/usage`, `/deployments`, `/saas-provisioning`, `/provisioning`,
`/users` + detalle, `/audit`, `/settings` (incluye Cuentas de pago y Mi perfil).

## Énfasis
- **Integraciones**: tarjetas por producto con semáforo de salud, último sync, modo de cutover (LEGACY/SHADOW/PRIMARY) como «stepper»
  visual; detalle con línea de tiempo de eventos.
- **Uso**: medidores con mini-sparkline, agregados con barras de consumo vs incluido.
- **Usuarios y accesos**: filas con avatar de iniciales, roles como chips, estado (activo/invitado/inactivo) con punto de color.
- **Auditoría**: línea de tiempo legible (quién, qué, cuándo) con iconos por tipo de acción y detalle expandible.
- **Configuración**: secciones claras en `SectionTabs`; Cuentas de pago con estado de llave cifrada bien visible.
- Sin cambios de lógica ni permisos.

## Pasos
Implementar por grupos, tests, capturas `VISUAL_LABEL=fase12`, commits `style(ops): …` / `style(governance): …`, gate completo.

## Hecho cuando
Todas las rutas con el patrón aplicado y gates verdes.
