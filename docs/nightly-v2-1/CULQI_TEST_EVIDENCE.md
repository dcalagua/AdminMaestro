# Evidencia de integración real contra Culqi TEST

Fecha: 2026-09-07 · Entorno: **TEST exclusivamente**.

Las credenciales usadas son `pk_test_…` / `sk_test_…`. Vivieron solo en un
fichero fuera del repositorio (`chmod 600`) y en las variables de entorno del
proceso. **No aparecen en este documento, ni en el repositorio, ni en el
historial de Git** (comprobado con `git log --all -S`). El adapter aborta si
detecta un prefijo `sk_live_` o `pk_live_`.

## 1. Alta completa, ejecutada con el adapter de producción

No es un guion que imita al adapter: el ensayo **importa
`supabase/functions/_shared/payments/culqi.ts`**, el mismo módulo que corre en
la Edge Function.

Secuencia real: Token → Customer → Card → Plan → Subscription → cancelación.

| Periodicidad | Plan | Suscripción | Estado | Próximo cobro | Días |
|---|---|---|---|---|---|
| MENSUAL | `pln_test_26ueu0h0MIaIugW8` | `sxn_test_qZDifrg0HVgfNTz6` | `active` | 2026-10-07 | **30** |
| TRIMESTRAL | `pln_test_L6xjZgOZSoPPyshi` | `sxn_test_G3EK1HEsH9acuMsm` | `active` | 2026-12-07 | **91** |
| ANUAL | `pln_test_bufTQC0PSQoNVDCY` | `sxn_test_M1R6dGKTUEPuB1SH` | `active` | 2027-09-07 | **365** |

Customer reutilizado: `cus_test_wdufK2NoTbCCNH5L` · Card: `crd_test_yTFkzX6Luwh5kohc` (Visa ·1111).
Las tres suscripciones se **cancelaron** al terminar (`canceled`).

Los días son la medida que importa: confirman que `interval_unit_time` **4 es
anual y 5 es trimestral**, y no al revés. Una progresión intuitiva
(4=trimestral, 5=semestral) habría facturado a cadencias que nadie contrató.

## 2. Cargo y verificación server-to-server

```
Cargo creado:      chr_test_L8lT1xbkEJFaC8La   (2500 céntimos PEN)
verifyCharge()  →  { amount: 25, currency: "PEN",
                     paidAt: "2026-09-07T16:05:17.174Z", status: "CONFIRMED" }
Cargo inventado →  null   (rechazado, que es la respuesta correcta)
listCharges()   →  19 cargos del periodo
```

El importe vuelve convertido (2500 → 25,00) y la fecha cae en 2026, no en 1970:
el mismo campo llegaba aquí en milisegundos y en el plan en segundos.

## 3. Webhook por HTTP real

Ejecutado contra `supabase functions serve` — HTTP de verdad, función de verdad,
verificación de verdad contra la API TEST de Culqi. Cargo previo real:
`chr_test_ykKih0yFmDkxm9ch`, 45000 céntimos USD.

| Evento enviado | Respuesta | Efecto en la base |
|---|---|---|
| `subscription.charge.succeeded` | `accepted, PAYMENT_SUCCEEDED, mode TEST` | `payments` CONFIRMED 450,00 USD + factura + **1 comisión** |
| el mismo, reenviado | `duplicate: true` | ninguno |
| cargo inexistente, 999.000 USD | `CARGO_NO_VERIFICADO` | evento REJECTED, sin pago |
| `subscription.charge.failed` | `PAYMENT_FAILED` | mapeo a `payment_failed`, sin pago |
| `subscription.canceled` | `SUBSCRIPTION_UPDATED` | evento IGNORED, sin efecto contable |
| cobro real en PEN contra contrato USD | `MONEDA_INCOHERENTE` | evento REJECTED, sin pago |

Comisión devengada, leída de la base:

```
status    | amount | currency | full_name
ELIGIBLE  |  45.00 | USD      | Carla Comercial
```

La primera fila de esa tabla es lo que el fallo F-08 impedía que existiera.

## 4. Autorización de las Edge Functions, sobre HTTP

| Función | Rol | Respuesta |
|---|---|---|
| `payment-reconcile` | TENANT_USER | 403 |
| `payment-reconcile` | ORG_ADMIN | 403 |
| `payment-reconcile` | EBIM_FINANCE | 200, `simulated: false` |
| `provisioning-worker` | sin JWT | 401 |
| `provisioning-worker` | TENANT_USER | 403 |
| `provisioning-worker` | EBIM_FINANCE | 403 |
| `payment-setup` | cuenta impuesta por el cliente | 403 |
| `payment-setup` | organización sin datos fiscales | 409 con la lista de campos |

## 5. Restricciones medidas (no documentadas por el proveedor)

| Qué | Medido |
|---|---|
| Importe de un plan | 300 a 500000 céntimos |
| `interval_unit_time` | 1=diario, 2=semanal, 3=mensual (30 d), **4=anual (365 d)**, **5=trimestral (91 d)**, 6=semestral (181 d) |
| `interval_count` | **No multiplica la cadencia**: unit 3 + count 3 sigue cobrando a 30 días |
| Campos obligatorios del Customer | 7: nombre, apellido, correo, domicilio, ciudad, país, teléfono |
| Caracteres en `name`/`description` | Letras (con tildes), dígitos, espacio, `-`, `.`, `_`. Una coma invalida el campo |
| `customer_id` | Exactamente 25 caracteres |
| Correo del Customer | Único: un correo, un cliente |
| Caducidad de la tarjeta | **No la devuelve** el objeto Card; solo viaja en el token |
| `status` de suscripción | 1 recién creada, 3 vigente, 4 cancelada. 2 y 5 no observados |
| `next_billing_date` | **Ausente** en la respuesta de creación pese al ejemplo de la documentación; presente en el GET |

## 6. Limpieza

Las tres suscripciones del apartado 1 quedaron canceladas. Los planes y los
cargos de prueba permanecen en la cuenta TEST: son inmutables en la pasarela y
no afectan a ningún entorno real. Ningún objeto se creó con credenciales LIVE.
