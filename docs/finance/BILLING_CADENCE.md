# Billing cadence de la factura del período

> Vigente desde V3.1 (migración `20260913001300_v3_1_billing_cadence.sql`). Factura **gerencial**,
> no comprobante fiscal (SUNAT/SIN/SRI fuera de alcance).

## 1. Qué decide

Qué líneas de una suscripción entran en la factura de un **período**. La emisión
(`platform.issue_subscription_invoice`) y la pantalla (`platform.get_subscription_billing_status`)
usan la misma función, `platform.subscription_due_items`. La UI no calcula periodicidades ni
fechas; solo muestra lo que devuelve la base.

## 2. Reglas

| Concepto | Regla |
|---|---|
| Período | Mes de calendario. `p_period_start` puede ser cualquier día: se normaliza al día 1. `period_end` = último día del mes. |
| Billing anchor | `subscription_items.valid_from` de **cada línea**. No se usa `subscriptions.started_on` ni `subscriptions.billing_interval`, porque una suscripción puede mezclar cadencias. |
| Cálculo | Diferencia en **meses de calendario** entre el mes del ancla y el mes del período. Nunca en días: un ancla del 31/01 factura en febrero. |
| MONTHLY | Toca todos los meses desde el mes del ancla. |
| QUARTERLY | Toca cuando la diferencia es múltiplo de 3 (ancla en enero → ene, abr, jul, oct). |
| YEARLY | Toca cuando la diferencia es múltiplo de 12 (ancla en marzo 2026 → mar 2026, mar 2027…). |
| ONE_TIME | Una sola vez: en el primer período que se emita desde su ancla. No vuelve a tocar mientras exista una línea suya en una factura que no esté `VOID`. |
| `valid_from` | Antes del mes de `valid_from`, la línea no toca. Si se activa a mitad de mes, ese mes sí toca. |
| `valid_to` | La línea toca si `valid_to` cae dentro del período o después. No toca en períodos que empiezan después de `valid_to`. |
| Prorrateo | No hay. Si la línea está vigente en el período, se factura el importe completo. |
| Moneda | La del contrato. Las líneas la heredan. La emisión nunca usa FX ni la moneda de reporte. |

Helper puro: `platform.is_subscription_item_due_for_period(interval, anchor, valid_to, period_start, already_invoiced)`.
Es IMMUTABLE, no lee tablas y siempre devuelve `true`/`false`, nunca NULL.

### Items mixtos (ejemplo)

LICENSE MONTHLY + SUPPORT YEARLY + IMPLEMENTATION ONE_TIME, las tres con ancla en enero:

| Período | MONTHLY | YEARLY | ONE_TIME |
|---|---|---|---|
| Enero | sí | sí | sí |
| Febrero | sí | no | no |
| Enero del año siguiente | sí | sí | no |

## 3. Emisión (`issue_subscription_invoice`)

1. Autorización: solo EBIM_FINANCE o EBIM_SUPER_ADMIN (`42501` en cualquier otro caso).
2. Solo se emite para suscripciones `ACTIVE` o `PAST_DUE` (`SUSCRIPCION_NO_FACTURABLE`).
3. **Idempotencia.** Se toma un advisory lock por (suscripción, período). Si ya existe una factura
   no `VOID` para ese período, se devuelve esa factura con `created: false`, sin crear otra.
4. **Sin cargos debidos, no hay factura.** El error `SIN_LINEAS_FACTURABLES` (23514) se lanza
   **antes** de insertar nada. Si los cargos debidos suman 0, el error es `SIN_IMPORTE_FACTURABLE`.
   Nunca se crea una factura vacía ni una factura en 0.
5. Cada línea recurrente (MONTHLY/QUARTERLY/YEARLY) queda con `is_recurring = true`. La ONE_TIME
   queda con `false`.
6. Número: `INV-YYYYMM-<código de suscripción>`. Si ese número ya lo tiene una factura anulada, la
   re-emisión usa el sufijo `-R2`, `-R3`, etc.

Respuesta: `invoice_id`, `number`, `created`, `currency`, `total`, `status`, `period_start`,
`period_end` y, cuando se crea la factura, `lines`.

### VOID

Una factura `VOID` no cuenta como facturada. Su período se puede volver a emitir, y la re-emisión
vuelve a incluir los ONE_TIME que solo estaban en la anulada. `UNCOLLECTIBLE` sí cuenta como
facturada. No existe un estado `CANCELLED` de factura, y no hay RPC de anulación: hoy el paso a
`VOID` lo hace el operador del servidor.

## 4. Estado para la UI (`get_subscription_billing_status`)

Solo lectura (STABLE) y SECURITY INVOKER: respeta RLS del llamante. Devuelve, para el mes pedido:

- `has_due_items`, `due_item_count` y `estimated_total` en la moneda del contrato;
- `existing_invoice`, si el período ya tiene una factura vigente;
- `can_issue`: la suscripción es facturable, no hay factura vigente y hay cargos por encima de 0;
- `next_billing_period`: el primer mes desde el consultado que tiene cargos y no tiene factura
  vigente. La búsqueda llega hasta 12 meses después; si no encuentra ninguno, devuelve `null` y la
  UI no inventa una fecha.

En Suscripción → Facturación y cobros, finanzas elige el período, ve el estado y pulsa
«Emitir factura del período (MON)».

## 5. Límites conocidos

- Si se añade una línea después de emitir la factura de un período, esa factura no se
  complementa. Un ONE_TIME nuevo entra en el siguiente período que se emita; un cargo recurrente
  de ese período queda sin facturar.
- Editar `valid_from` o `billing_interval` de una línea (`upsert_subscription_item`) cambia su
  ancla o su cadencia hacia adelante. Las facturas ya emitidas no cambian.
- `next_renewal_date` (renovaciones y alertas) es otra regla: cuenta meses completos por día
  exacto a nivel de contrato. No se usa para facturar.
- La domiciliación con tarjeta (`payment-setup`) cobra un único importe por intervalo. Si la
  suscripción tiene líneas recurrentes vigentes de otra cadencia, se rechaza con
  `CADENCIA_MIXTA_NO_DOMICILIABLE`.

## 6. Pruebas

- pgTAP `supabase/tests/18_v3_1_billing_cadence.test.sql`: comportamiento de la RPC por cadencia,
  items mixtos, sin factura vacía, idempotencia, vigencia, 31/01, GRUPASA EWM, PEN/BOB/USD, VOID y
  roles.
- pgTAP `supabase/tests/19_v3_1_billing_cadence_engine.test.sql`: helper puro, `subscription_due_items`,
  estado y seguridad.
- Unit: `src/lib/billing.test.ts`, `src/features/billing/PeriodInvoiceAction.test.tsx` y
  `supabase/functions/_shared/payments/recurring-amount.test.ts`.
- E2E `e2e/v3-1-billing-cadence.spec.ts`: MONTHLY, YEARLY, QUARTERLY, MIXED e idempotencia,
  verificados contra la base.
