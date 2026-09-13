# 14 - Seeds Regionales

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Extiende seed local con escenarios gerenciales deterministas, sin secretos:

1. PE cliente PEN - Shared directo.
2. PE cliente USD - Shared directo o partner.
3. BO cliente BOB - Shared via partner.
4. BO cliente USD - Partner Dedicated si encaja con fixtures.
5. EC cliente USD - Tenant Dedicated o Shared segun modelo.
6. Partner multi-SaaS con clientes de al menos dos mercados si el dominio lo permite.
7. Cost entries en USD y revenue en moneda local para probar consolidacion.
8. Comisiones en PEN, BOB y USD.

Agregar FX MANUAL de prueba con fecha fija y valores claramente DEMO, nunca presentarlos como tasas reales.

Seeds deben ser idempotentes dentro del flujo `db reset`.
