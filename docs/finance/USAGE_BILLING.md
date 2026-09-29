# Facturación de uso, créditos IA, add-ons y correctivos (CCP fase 18)

Spec: `docs/superpowers/specs/2026-09-27-ebim-commercial-control-plane-design.md` §5.3, §12.5, §13.
Migraciones: `20261008000050` (enum `CREDIT_PURCHASE`), `20261008000100` (vínculos y guards), `20261008000200` (emisión).
Test: `supabase/tests/41_ccp_billing_usage.test.sql`. Rollback: `docs/runbooks/ccp-rollback/18.sql`.

## 1. Tipos de línea

| Línea | `charge_kind` | Origen | Recurrente / MRR | Comisión |
| --- | --- | --- | --- | --- |
| Licencia base | `LICENSE`, `TENANT_LICENSE`, `PARTNER_BASE_LICENSE` | `subscription_items` | sí | sin cambios |
| Add-on | `ADDON` | ítem creado al aprobar el add-on; la línea guarda `catalog_item_id` + `price_ref` (tarifa congelada, D-09) | sí | sin cambios |
| Único | `IMPLEMENTATION_FEE`, `PROFESSIONAL_SERVICES` | ítem `ONE_TIME`, se factura una sola vez (una VOID libera) | no | sin cambios |
| Uso | `USAGE_OVERAGE`, `usage_basis=USAGE` | agregado `FINALIZED` de un medidor sin capacidad `ALLOWANCE` | no | solo con regla que nombre `USAGE_OVERAGE` (D-11) |
| Exceso de medidor | `USAGE_OVERAGE`, `usage_basis=OVERAGE` | agregado `FINALIZED` con `allowance_status=OVER` y política `ALLOW` | no | ídem |
| Exceso de créditos | `USAGE_OVERAGE`, `usage_basis=AI_CREDIT_OVERAGE` | saldo negativo de tenant × pool × período, política `ALLOW` | no | ídem |
| Compra de créditos | `CREDIT_PURCHASE` | `purchase_ai_credits`: ítem `ONE_TIME` + entrada `GRANT_PURCHASE` | no | solo con regla que nombre `CREDIT_PURCHASE` (D-11) |
| Descuento | `DISCOUNT` | manual (magnitud positiva) o correctivo negativo con `corrects_line_id` | resta (P-01) | nunca |

`CREDIT_PURCHASE` es una extensión aditiva del enum de la spec §13.1 (la spec solo preveía `GRANT_PURCHASE` en el ledger).

## 2. Reglas de uso

- Una línea de uso **siempre** referencia un agregado `FINALIZED` (`usage_aggregate_id`, `usage_source_hash` = `source_hash` del agregado) o, para créditos, el pool × período y el hash de sus agregados `FINALIZED`. Nunca un evento crudo.
- Consumo **vencido**: la factura del período `P` incluye agregados de períodos anteriores a `P` desde el inicio del contrato. El período en curso sigue abierto. Un agregado que finaliza tarde (gracia de 72 h) entra en la siguiente factura.
- **Una sola vez:** un agregado, o un pool × período, se reclama en una sola factura no anulada. Lo garantizan un bloqueo de fila / advisory y una comprobación en el trigger `invoice_lines_billing_links_guard`. Si la factura se anula (VOID) y se re-emite, la re-emisión vuelve a reclamarlo.
- **Tarifa:** ítem de catálogo `PER_UNIT` ligado con `set_catalog_item_usage_binding` (a un medidor, o `AI_CREDIT` por pool), más tarifa `USAGE_OVERAGE`/`MONTHLY` vigente al cierre del período, en el mercado y la moneda del contrato.
- **Falla cerrado.** Si falta algo, no hay línea y se registra una alerta a finanzas (una por agregado y código, en `usage_alerts`):

  | Falta | Alerta |
  | --- | --- |
  | Tarifa | `TARIFA_ADDON_NO_DEFINIDA` |
  | Valor de la asignación (existe capacidad `ALLOWANCE` sin grant, D-05) | `ASIGNACION_NO_DEFINIDA` |
  | Política de créditos | `POLITICA_CREDITOS_NO_DEFINIDA` |

- **Excesos bajo `BLOCK`.** No se facturan: el SaaS bloqueó, y las alertas `OVERAGE_UNDER_BLOCK_POLICY` / `CREDIT_OVERAGE` vienen de la fase 17. El contrato v1 solo emite `BLOCK` para asignaciones de medidor; la rama `ALLOW` queda lista, pero no se alcanza hasta un contrato v1.1 aprobado.
- **DEMO/SANDBOX y medidores no facturables** (D-06) nunca generan línea: `is_billable=false` en el agregado, y el guard lo rechaza aunque se intente a mano.
- **Cantidad:** la del agregado. Con más de 2 decimales se factura 1 × `round(cantidad × tarifa, 2)`. El importe es el mismo y la cantidad nunca se trunca.
- **Impuestos:** ninguno nuevo (D-13). `tax_amount` queda como hoy.

## 3. Correctivos (spec §13.2)

- `schedule_corrective_discount(línea, importe, motivo)` es solo para finanzas. La línea debe estar en una factura `ISSUED`/`PAID`/`PARTIALLY_PAID` y no ser `DISCOUNT`.
- Crea un ítem `DISCOUNT` `ONE_TIME` que entra en la **siguiente** factura del contrato como línea **negativa** con `corrects_line_id`.
- Σ correcciones (facturadas no anuladas + pendientes) ≤ |línea|; si se supera → `DESCUENTO_EXCEDE_LINEA`, con la misma comprobación en el guard de línea.
- La factura corregida no cambia. No se crea ningún pago negativo ni nota de crédito fiscal (D-13).
- **Una factura con cobros `CONFIRMED` no se anula** (`FACTURA_CON_PAGOS_CONFIRMADOS`, trigger `invoices_void_guard`).

## 4. Límite de la pasarela: importes recurrentes variables

`payment-setup` domicilia en el proveedor (Culqi) un Plan con **un importe fijo por intervalo** (`recurringCardAmount`, V3.2). Por tanto:

- **Uso, excesos, compras de créditos y correctivos nunca se domicilian.**
  - No son ítems recurrentes: las líneas de uso no vienen de `subscription_items`, y las compras y los correctivos son `ONE_TIME`.
  - Se cobran contra la factura del período por los medios existentes (cobro manual confirmado o cargo único), nunca por el Plan recurrente.
  - Test de caracterización: `supabase/functions/_shared/payments/recurring-amount.test.ts`, bloque «CCP fase 18».
- **Un `DISCOUNT` recurrente resta del Plan**, igual que en la factura.
  - Antes se sumaba: una licencia de 100 con un descuento de 10 se domiciliaba en 110. Corregido en esta fase.
  - Si el descuento anula el cargo → `SIN_IMPORTE_RECURRENTE`. Si empieza o termina durante el contrato → `MONTO_RECURRENTE_FUTURO_VARIABLE` (fail-safe, sin reprovisioning).
- **Riesgo operativo.** Un cliente domiciliado paga el importe fijo automáticamente, y el uso de su factura queda como saldo pendiente.
  - La conciliación existente (`v_invoice_balances`) lo muestra.
  - Un esquema de cobro variable (cargo único por factura con tarjeta guardada) **no existe** y no se inventa aquí. Es una decisión de producto aparte, y Culqi live sigue sin usarse sin autorización explícita.

## 5. Configuración (nada se siembra)

| Qué | RPC | Quién | Decisión |
| --- | --- | --- | --- |
| Medidor facturable | `set_usage_meter_billable` | finanzas | D-06 |
| Ítem que tarifa un medidor / exceso de créditos | `set_catalog_item_usage_binding` | `can_manage_regional_catalog` | — |
| Tarifa `USAGE_OVERAGE` / `CREDIT_PURCHASE` | `set_catalog_item_price` | `can_manage_regional_catalog` | D-01/D-02 |
| Créditos por paquete | `set_catalog_item_credit_pack` | `can_manage_regional_catalog` | D-03 |
| Política de créditos (`ALLOW` para facturar el exceso) | `create_ai_credit_policy` | finanzas | D-03 |
| Comisión sobre uso o créditos | `commission_rules.charge_kind` explícito | finanzas | D-11 |

## 6. Pendiente, fuera de esta fase

- **Activación por tenant de add-ons `PER_UNIT`:** `approve_tenant_addon` sigue devolviendo `MODELO_POR_USO_PENDIENTE`. El uso se factura por el vínculo ítem ↔ medidor sin activación por tenant. Si hace falta un "opt-in" comercial, se decide aparte.
- **`get_subscription_billing_status`** (vista previa en la consola) no muestra aún las líneas de uso. La factura emitida sí las incluye.
- **Contrato v1.1** para exceso de medidor bajo `ALLOW`.
