# Billing cadence · diseño V3.1

Regla permanente: `docs/finance/BILLING_CADENCE.md`. Este documento explica **por qué** el diseño
es así y cómo se confirmó el defecto.

## 1. Causa raíz (ROOT CAUSE CONFIRMED)

En la migración 34, `issue_subscription_invoice` seleccionaba las líneas así:

```sql
where si.valid_from <= v_period_end
  and (si.valid_to is null or si.valid_to >= v_period_start)
  and (si.billing_interval <> 'ONE_TIME' or not exists (…ya facturado…))
```

`billing_interval` solo se usaba para separar ONE_TIME. Una línea YEARLY o QUARTERLY vigente
entraba en **todos** los meses.

Reproducción sobre el contrato real `SUB-GRUPASA-EWM`, ejecutada en una transacción con rollback
(`evidence/phase1-root-cause-repro.txt`):

| Período | Resultado antes del fix |
|---|---|
| 2026-03 (ancla) | `INV-202603-SUB-GRUPASA-EWM` USD 36,000.00 (licencia + implementación) |
| 2026-04 | `INV-202604-SUB-GRUPASA-EWM` **USD 24,000.00**: la licencia anual se vuelve a facturar |
| 2026-09 | `INV-202609-SUB-GRUPASA-EWM` **USD 24,000.00** |

El pgTAP `18_v3_1_billing_cadence` ejecutado **antes** del fix: **19/64 fallan**
(`evidence/phase1-test18-before-fix.txt`). Fallan QUARTERLY +1/+2/+4/+5, YEARLY +1/+6/+11, items
mixtos en febrero, importe 0, GRUPASA +1 y re-emisión tras VOID.

**Defecto adicional encontrado al probar VOID.** La función trata una factura VOID como «no
facturada», pero re-emitir su período reutilizaba el número `INV-YYYYMM-<código>` y fallaba con
`23505 invoices_number_uk`. Ninguna UI ni RPC anula facturas hoy, así que el impacto era latente.

## 2. Decisiones

| # | Decisión | Alternativas descartadas y motivo |
|---|---|---|
| D1 | Ancla = `subscription_items.valid_from` | No se crea un campo nuevo: `valid_from` ya existe, es NOT NULL y es por línea. `subscriptions.started_on` y `subscriptions.billing_interval` son del contrato, y un contrato puede mezclar cadencias (GRUPASA: YEARLY + ONE_TIME). |
| D2 | Contar **meses de calendario** (año·12 + mes) | `age()` o el día exacto (como `next_renewal_date`) hacen que un ancla del 31/01 no toque en febrero. `EXTRACT(day)` es frágil. |
| D3 | El período sigue siendo el mes calendario | Es el período que ya usaban la RPC, el seed y las vistas de MRR (`invoices.period_start/end`). Una línea anual se factura en su mes aniversario; la factura no «cubre» 12 meses en `period_end`. Así no cambia ninguna vista. |
| D4 | Helper puro `is_subscription_item_due_for_period(interval, anchor, valid_to, period, already_invoiced)` | Es IMMUTABLE y no lee tablas, así que se puede probar con matrices. El dato «ONE_TIME ya facturado» entra como parámetro para que el helper siga siendo puro. |
| D5 | Una única lectura `subscription_due_items(sub, period)` usada por la emisión **y** por el estado | Si la UI y la RPC calcularan por separado, la pantalla podría decir «no toca» mientras la base factura. |
| D6 | ONE_TIME = primera factura emitida desde su ancla, no «solo el mes del ancla» | Si nadie emite ese mes, un fee de implementación atado al mes del ancla se perdería. Encaja con «primera factura → DUE, segunda → NOT DUE» y con lo que ya hacía V3. Una línea en factura VOID no cuenta. |
| D7 | Sin cargos debidos → se mantiene `SIN_LINEAS_FACTURABLES` (23514), ahora **antes** de insertar | Reutiliza el contrato de error que ya tenían V3, pgTAP 17 y la UI. No se crea ni se revierte ninguna fila. |
| D8 | Cargos debidos que suman 0 → `SIN_IMPORTE_FACTURABLE` | Evita crear por accidente una factura en cero (fase 7). |
| D9 | Idempotencia: advisory lock por (suscripción, período) + búsqueda de factura no VOID | Serializa dos emisiones concurrentes del mismo período. No se añade un índice único parcial porque podría chocar con facturas históricas del seed o del webhook. |
| D10 | Re-emisión tras VOID con sufijo `-R2`, `-R3` | La anulada conserva su número (trazabilidad) y el comportamiento «VOID es refacturable», que ya estaba en el código, pasa a funcionar. |
| D11 | Nueva RPC `get_subscription_billing_status` (INVOKER, STABLE) | Hace falta para que la UI muestre cargos, total estimado y próxima facturación sin replicar la cadence. Es de solo lectura y respeta RLS. |
| D12 | `next_billing_period` = primer mes, desde el consultado y hasta +12, con cargos y sin factura vigente | 13 meses cubren cualquier cadencia. Si no hay ninguno, devuelve `null` y la UI no inventa una fecha. |
| D13 | La API pública no cambia | Misma firma, mismos errores y mismo JSON; solo se añaden `period_start`, `period_end` y `lines`. Seguridad idéntica: DEFINER, `search_path` fijo, autoriza en la primera línea, `revoke … from public, anon`. |

## 3. Multimoneda

Ni la emisión ni el motor de cadence leen `exchange_rates`, `fx_*` ni la moneda de reporte
(verificado por pgTAP 19 sobre `prosrc`). La factura no lleva `currency` explícita: la hereda del
contrato mediante `enforce_currency_chain`. Hay regresiones para PEN MONTHLY, BOB QUARTERLY y USD
YEARLY.

## 4. UI

«Emitir factura del mes» pasa a ser **«Emitir factura del período (MON)»** con un selector de
período (`<input type="month">`, por defecto el mes en curso). La pantalla muestra lo que devuelve
`get_subscription_billing_status`:

- con cargos: «N cargos facturables en MM/AAAA · Total estimado MON X»;
- sin cargos: «No existen cargos facturables en este período.», con el botón deshabilitado;
- con factura vigente: su número y total, con el botón deshabilitado;
- «Próxima facturación: DD/MM/AAAA», o «Sin cargos pendientes de facturar en los próximos 12 meses.».

Si la consulta de estado falla, el botón sigue activo: decide la RPC. La tabla de facturas añade la
columna «Período». `src/lib/billing.ts` solo formatea; un test garantiza que no exporta lógica de
cadence.

## 5. Hallazgo de la revisión final aplicado (F2)

`payment-setup` sumaba todas las líneas no ONE_TIME, incluidas las vencidas, en un único plan de
tarjeta con el intervalo del contrato. Una licencia MONTHLY con un soporte YEARLY habría
domiciliado el soporte cada mes. Se extrajo `recurringCardAmount` (módulo puro con unit tests):
solo líneas recurrentes vigentes de la cadencia del contrato, y cadencias mixtas → 409
`CADENCIA_MIXTA_NO_DOMICILIABLE`. El cambio es local y la función no se desplegó.
