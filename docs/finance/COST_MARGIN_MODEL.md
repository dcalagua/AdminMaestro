# Modelo de costos y margen

Capa **gerencial**, no contabilidad. Responde una pregunta: *¿qué SaaS, partner
o tenant es rentable?*

## 1. Fórmulas

### MRR (`v_subscription_mrr`)

```
MRR = Σ  subscription_items.amount × factor(billing_interval)

factor:  MONTHLY = 1 · QUARTERLY = 1/3 · YEARLY = 1/12 · ONE_TIME = 0
```

Excluye:
- ítems `ONE_TIME` (un implementation fee cobrado **no** aumenta el recurrente);
- `charge_kind = DISCOUNT`;
- suscripciones que no estén `ACTIVE`;
- ítems fuera de vigencia;
- **tenants DEMO** (regla §2.2).

### ARR

```
ARR = MRR × 12
```

Es una **proyección**, no un cobro. Se etiqueta como "estimado" en la UI.

### Ingreso cobrado (`v_collected_revenue`)

```
cobrado(línea) = línea.amount × (pago.amount / factura.total)
```

Sólo con `payments.status = CONFIRMED` y facturas en `ISSUED`,
`PARTIALLY_PAID` o `PAID`. **DRAFT y VOID nunca cuentan.**

El reparto proporcional permite separar licencia cobrada de implementation fee
cobrado incluso con pagos parciales. `is_recurring` distingue ambos.

### Costo directo (`v_tenant_costs`)

Dos caminos, ambos con regla explícita:

| Camino | Cuándo |
|---|---|
| `DIRECT` (`scope = TENANT`) | Costo imputado a un tenant concreto (infra exclusiva, soporte dedicado). |
| `VIA_TARGET` (`scope = DEPLOYMENT_TARGET`) | Costo del target, dividido entre sus tenants activos. |

`cost_allocations.weight` es la fracción imputada. Un constraint trigger diferido
impide que las asignaciones de un costo sumen más de 1 — repartir el 120% de un
costo es un error de datos, no un matiz.

### Margen bruto

```
margen bruto = ingreso COBRADO − costo directo − comisión
```

Disponible por producto (`v_product_margin`), partner (`v_partner_margin`) y
tenant (`v_tenant_margin`).

## 2. Estimado vs cobrado — qué es cada número

| Métrica | Naturaleza | Se puede llevar al banco |
|---|---|---|
| MRR | Proyección del contrato vigente | No |
| ARR | Proyección × 12 | No |
| Ingreso cobrado | Hecho: hay un pago confirmado | Sí |
| Fees de implementación cobrados | Hecho | Sí |
| Costo directo | Hecho: gasto registrado | Sí |
| Comisión devengada (`ELIGIBLE`/`ACCRUED`) | Obligación futura | Compromiso |
| Comisión pagada | Hecho | Sí |
| **Margen bruto** | **Basado en cobros, no en facturado** | Sí |

El margen usa cobrado a propósito: un facturado impago no es margen, es riesgo.

## 3. Sin conversión de monedas

**No hay FX.** Todos los agregados van agrupados por `currency`, y la UI muestra
`USD 24.750 · S/ 12.000` en vez de un total único.

Convertir con un tipo de cambio implícito produce un número que nadie puede
auditar: ¿de qué día? ¿compra o venta? ¿de qué fuente? Cuando el negocio lo
necesite, se añade una tabla de tipos de cambio con fecha y fuente, y el
convertido se marca como tal.

Test: `format.test.ts` verifica que `formatCurrencyMap({USD:1000, PEN:2000})` no
produzca `3.000`.

## 4. Categorías de costo

`DATABASE`, `COMPUTE`, `STORAGE`, `BANDWIDTH`, `MESSAGING`,
`FRONTEND_HOSTING`, `DOMAIN`, `SUPPORT`, `DEDICATED_INFRA`, `THIRD_PARTY`,
`ADMIN_MANUAL`.

Ámbitos de imputación: `PLATFORM`, `PRODUCT`, `ORGANIZATION`, `TENANT`,
`DEPLOYMENT_TARGET`. Un CHECK verifica que el ámbito y el destino sean
coherentes (un costo `PRODUCT` sin `saas_product_id` no entra).

## 5. Cifras del seed (3 meses)

| Métrica | Valor |
|---|---|
| MRR | USD 24.750,00 |
| ARR estimado | USD 297.000,00 |
| Ingreso cobrado | USD 98.600,00 |
| Costo registrado | USD 16.584,00 |
| Comisión pendiente | USD 1.593,60 |
| Comisión pagada | USD 1.390,00 |

Ejemplo de reparto explícito: el costo de mensajería (USD 300/mes) se imputa
60% a eSupplier y 40% a EWM, con `allocation_rule = 'REPARTO_60_40'`. La regla
está escrita en el dato, no en la cabeza de quien la definió.

## 6. Deuda técnica declarada

| # | Deuda | Impacto |
|---|---|---|
| 1 | Sin conversión FX | Un dashboard multi-moneda muestra varias cifras, no un consolidado. |
| 2 | MRR desde `subscription_items` vigentes, no desde un snapshot mensual | No se puede reconstruir el MRR histórico de hace 6 meses. Requiere una tabla de snapshots. |
| 3 | Sin reconocimiento diferido de ingresos | Un pago anual se cuenta cobrado el día que entra, no prorrateado. Es correcto para caja, no para devengo contable. |
| 4 | El costo de plataforma (`scope = PLATFORM`) no se prorratea a productos | Aparece en el total pero no en el margen por producto. Requiere una regla de asignación acordada con negocio. |

---

# V2 · Reconciliación y paneles gerenciales

## 1. La regla de precisión sigue en pie

**No se mezclan monedas.** No hay tabla de tipos de cambio, así que todas las
vistas de V2 agrupan por `currency`. Consolidar PEN y USD con un FX implícito
produciría un número que nadie puede auditar, y eso es peor que no darlo.

La conversión consolidada queda **explícitamente fuera de alcance de V2**. Para
habilitarla haría falta una tabla de tipos de cambio con fecha y fuente (riesgo
R-02 del baseline, sigue abierto).

## 2. Reconciliación: describe, no corrige

`v_finance_reconciliation` devuelve hallazgos tipados con estado
`OK` / `REVIEW` / `ERROR`:

| Hallazgo | Cuándo |
|---|---|
| `PROVIDER_DRIFT` | El estado del proveedor no coincide con el local |
| `OPEN_INVOICE` | Factura emitida y vencida sin cobrar (ERROR pasados 30 días) |
| `EXPIRED_DOCUMENT` | OS/OC vencida en una suscripción que exige documento |
| `REVERSED_PAYMENT` | Cobro revertido; avisa si le falta el contra-evento |
| `REJECTED_WEBHOOK` | Evento del proveedor que no superó la validación |
| `MISSING_COLLECTION_PROFILE` | Suscripción activa sin perfil: se cobra a mano |

**Ninguna corrige nada.** Un ajuste contable automático a partir de una
comparación hace que el número cuadre y que nadie sepa por qué. La Edge Function
`payment-reconcile` solo registra pagos faltantes si se la llama explícitamente
con `apply_missing: true`, y aun entonces pasa por
`register_provider_payment()`, con su idempotencia y su auditoría.

## 3. Panel por producto

`v_product_finance` separa las partidas que gerencia pide ver:

| Columna | Qué es |
|---|---|
| `mrr` / `arr` | Solo lo recurrente |
| `collected_license` | Licencia efectivamente cobrada |
| `collected_implementation` | Implementación cobrada (one-time) |
| `collected_infrastructure` | Infraestructura dedicada cobrada |
| `collected_support` | Soporte / SLA cobrado |
| `direct_cost` | Costo imputado |
| `commission_total` | Comisiones **netas** de contra-eventos |
| `gross_margin` | Cobrado − costo − comisiones |
| `margin_rate` | Margen sobre cobrado |

## 4. Panel por canal

`v_partner_finance` muestra margen de canal y comisión de comerciales en
columnas **separadas**: son conceptos distintos y sumarlos contaría el mismo
dinero dos veces (ver `COMMISSION_MODEL.md` §3).

## 5. Dónde se ve

`/reconciliation`, con cuatro pestañas: Hallazgos, Por producto, Por canal y
Eventos del proveedor.

---

# V3 · Multicurrency: la deuda FX queda cerrada sin romper la regla

La regla de precisión sigue en pie: **ningún total nativo mezcla monedas**. V3 añade lo que la
deuda #1 pedía —tipos de cambio con fecha y fuente— como **capa de reporte separada**:

- Los márgenes nativos pasan a una fila por (entidad, moneda): un costo USD de un producto que
  cobra PEN ya no desaparece del margen.
- El consolidado (`finance_consolidated`) suma por moneda, convierte cada total con una tasa MANUAL
  explícita a la fecha del reporte y devuelve NULL + `missing_fx_count` si falta una tasa. El margen
  consolidado solo existe con todas las conversiones.
- Detalle en `docs/finance/FX_REPORTING.md`.
