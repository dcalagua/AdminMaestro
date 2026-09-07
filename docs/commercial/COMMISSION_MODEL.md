# Modelo de comisiones

## 1. La regla que lo ordena todo

> **La comisión se devenga desde un COBRO confirmado.**
> No desde crear un tenant. No desde emitir una factura.

Traducido a esquema: `commission_events.payment_id` es **NOT NULL**. Un evento
de comisión no puede existir sin un pago detrás.

Consecuencia práctica: **nunca se paga comisión sobre una factura impaga.** Si
el cliente no paga, la comisión no llega a existir — no hay que "revertirla".

## 2. Piezas

```
commission_plans
   └── commission_rules      (vigencia, base, tasa, topes)

sales_attributions           (comercial + objeto + % + plan)
   │
payments (CONFIRMED) ────────┴──▶ commission_events   ──▶ commission_settlements
   trigger payments_generate_commissions                     (liquidación por periodo)
```

## 3. Bases de cálculo

| `basis` | Se aplica a | Uso típico |
|---|---|---|
| `COLLECTED_LICENSE` | `LICENSE`, `TENANT_LICENSE`, `PARTNER_BASE_LICENSE` cobradas | El caso normal: % del recurrente. |
| `COLLECTED_IMPLEMENTATION` | `IMPLEMENTATION_FEE` cobrado | Sólo si el contrato lo permite. |
| `COLLECTED_ANY` | Cualquier línea cobrada | Planes internos simples. |
| `FIXED_AMOUNT` | — | Monto fijo por evento, independiente del cobro. |

Todas empiezan por `COLLECTED_`. No hay ninguna base sobre lo facturado.

## 4. Modificadores de regla

| Campo | Efecto |
|---|---|
| `is_recurring` | `false` = sólo el primer cobro de esa atribución. |
| `max_months` | Deja de devengar pasados N meses desde `valid_from` de la atribución. |
| `max_total_amount` | Tope acumulado; el último evento se recorta para no pasarse. |
| `charge_kind` | Restringe la regla a un tipo de cargo concreto. |
| `priority` | Orden de evaluación cuando varias reglas del plan aplican. |
| `valid_from` / `valid_to` | Vigencia. |

> **Las reglas no se editan retroactivamente.** Se cierra la vigente (`valid_to`)
> y se abre otra. Si se editara, una comisión pagada hace un año dejaría de ser
> explicable — y esa conversación con un comercial no se gana.

## 5. El algoritmo, paso a paso

`platform.generate_commission_events(payment_id)`:

1. **Sólo pagos CONFIRMED.** Cualquier otro estado devuelve 0.
2. **La factura debe estar emitida.** DRAFT y VOID devuelven 0.
3. **Proporción cobrada:**
   `payment_ratio = min(payment.amount / invoice.total, 1)`.
   Un pago parcial devenga comisión parcial — no todo ni nada.
4. Para cada **línea de la factura** con importe > 0:
   1. buscar las **atribuciones** vigentes que apunten a ese tenant o a esa
      suscripción, con plan de comisión asignado;
   2. para cada **regla** vigente del plan cuyo `basis` case con el
      `charge_kind` de la línea:
      - si la regla no es recurrente y ya hubo eventos → se salta;
      - si `max_months` está superado → se salta;
      - `base_amount = round(línea.amount × payment_ratio, 2)`;
      - `amount = round(base_amount × rate × attribution_pct, 2)`
        (o `fixed_amount × attribution_pct` si `basis = FIXED_AMOUNT`);
      - si `max_total_amount` está alcanzado → se salta; si se pasaría, se
        recorta al remanente;
      - se inserta el evento en estado `ELIGIBLE`.
5. **Idempotencia:** índice único sobre
   `(payment_id, sales_attribution_id, commission_rule_id, invoice_line_id)`.
   Reprocesar el mismo pago crea 0 eventos.

## 6. Trazabilidad: cómo se explica una comisión

Cada evento guarda su propio cálculo en `calculation` (JSONB):

```jsonc
{
  "rule_name": "10% licencia cobrada (12 meses)",
  "basis": "COLLECTED_LICENSE",
  "charge_kind": "LICENSE",
  "rate": 0.1,
  "invoice_line_amount": 850.00,
  "payment_ratio": 1.0,
  "base_amount": 850.00,
  "attribution_pct": 1.0,
  "max_months": 12,
  "max_total_amount": null,
  "formula": "invoice_line_amount * payment_ratio * rate * attribution_pct"
}
```

Es un **snapshot**: si mañana la regla cambia de 10% a 8%, este evento sigue
explicando por qué se pagó lo que se pagó. La UI de Comisiones muestra esa
cadena (`base × tasa × participación`) en la propia tabla, no escondida en un
detalle.

## 7. Estados

| Estado | Significado |
|---|---|
| `PENDING` | Reservado para reglas que exijan una validación previa. |
| `ELIGIBLE` | Devengada por un cobro; aún no liquidada. |
| `ACCRUED` | Asignada a una liquidación abierta. |
| `PAID` | Liquidación pagada. |
| `VOID` | Anulada; se excluye de todos los agregados. |

`platform.settle_commissions(agent, desde, hasta, moneda)` agrupa los eventos
`ELIGIBLE` del periodo en una liquidación `OPEN` y los pasa a `ACCRUED`. **No
paga**: aprobar y pagar son pasos posteriores. Un CHECK exige que una
liquidación `PAID` traiga fecha y referencia de pago.

## 8. Planes del seed

| Plan | Reglas |
|---|---|
| `indep-standard` | 10% de licencia cobrada durante 12 meses **+** 5% del implementation fee cobrado, una sola vez. |
| `partner-agent-standard` | 6% de licencia cobrada, recurrente, sin tope. |
| `ebim-internal` | 3% sobre cualquier cobro elegible. |

## 9. Tests

| Test | Qué verifica |
|---|---|
| `02` #15 | Todo `commission_event` proviene de un pago CONFIRMED. |
| `02` #16 | Comisión pagada y pendiente están separadas por estado. |
| `02` #17 | `amount = round(base × rate × attribution_pct, 2)` para toda comisión porcentual. |
| `02` #18 | Reprocesar un pago devengado crea 0 eventos. |
| `02` #13-14 | DRAFT/VOID no entran en ingreso; no se confirma un cobro sobre DRAFT. |
| `01` #13-15 | Un comercial no ve las atribuciones ni las comisiones de otro. |

---

# V2 · Origen del cobro, reversos y lo que NO devenga

## 1. La regla no cambia

**Solo un `payments.status = 'CONFIRMED'` devenga comisión.** V2 añade caminos
hacia ese estado; no añade excepciones a la regla.

| Origen | Devenga | Por qué |
|---|---|---|
| Cobro recurrente Culqi confirmado | **Sí** | `register_provider_payment` inserta el `payments` y el trigger del baseline devenga |
| Transferencia/manual confirmada por finanzas | **Sí** | `confirm_manual_payment`, mismo trigger |
| **OS/OC recibida o aprobada** | **NO** | Es un documento administrativo. Verificado: los contadores no se mueven |
| Factura emitida y no cobrada | **NO** | Ya era así en el baseline |
| Cobro fallido del proveedor | **NO** | `register_provider_payment_failure` no crea `payments` |

## 2. Implementación comisionable, pero solo por regla

Un `IMPLEMENTATION_FEE` devenga **solo** si la `commission_rule` usa
`COLLECTED_IMPLEMENTATION` o `COLLECTED_ANY`, **y** el fee fue efectivamente
cobrado. No hay comisión por implementación facturada y no pagada.

## 3. Margen de canal ≠ comisión de comercial

Se confunden constantemente, y sumarlos cuenta el mismo dinero dos veces:

| | Qué es | Efecto |
|---|---|---|
| **Margen del canal** (`channel_margin_rate`) | Descuento sobre el precio de lista pactado con el partner | Dinero que EBIM **nunca ingresa** |
| **Comisión del comercial** (`commission_events`) | Pago a una persona por una venta cobrada | Dinero que EBIM ingresa y **luego paga** |

`v_partner_finance` los expone en **columnas separadas** justamente para que
nadie los agregue.

## 4. Reversos: contra-evento, no borrado

Se consideraron tres mecanismos:

| Opción | Por qué se descartó / eligió |
|---|---|
| Borrar los eventos | **Descartada.** Destruye la historia: en marzo el comercial vio una comisión y en abril desapareció sin rastro |
| Marcarlos `VOID` | **Descartada a medias.** Si el evento ya entró en una liquidación PAGADA, anularlo reescribe un periodo cerrado. El dinero ya salió |
| **Contra-evento negativo** | **ELEGIDA.** El original queda intacto y una fila nueva, negativa, netea en la siguiente liquidación. Es una nota de crédito |

Ventaja concreta de la elegida: **todas las sumas existentes siguen siendo
correctas sin tocarlas**. `v_product_margin` hace `sum(e.amount)` y
`recalc_settlement_total` también: el negativo se resta solo. No hubo que
reescribir ni una vista del baseline.

`reverse_payment(p_payment_id, p_reason)`:
- exige motivo auditable;
- marca el pago `REVERSED` (el trigger del baseline recalcula la factura);
- inserta un contra-evento `ELIGIBLE` con importe negativo por cada devengo;
- es idempotente: un segundo reverso devuelve `already_reversed`.

Verificado: comisión de 85,00 → tras el reverso hay **2 filas** cuya suma neta
es **0,00**, el original sigue existiendo y aparece marcado `has_reversal`.

### El CHECK quedó más estricto, no más laxo

```sql
check ((reversal_of_event_id is null and amount >= 0)
    or (reversal_of_event_id is not null and amount <= 0))
```

Un devengo normal negativo se sigue rechazando. Solo un contra-evento puede
serlo, y cada evento admite **un solo** contra-evento (índice único parcial).

## 5. Trazabilidad en pantalla

`v_commission_detail` traduce el origen a lenguaje de negocio —Licencia,
Implementación, Infraestructura, Soporte, **Reverso**— e indica si el devengo ya
fue compensado (`has_reversal`), sin obligar a cruzar tablas a mano.
