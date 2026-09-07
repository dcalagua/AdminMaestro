# Modelo de cobranza

**Fase 07 de V2.** Migración: `20260907000400_collection_profiles.sql`.

---

## 1. La distinción que sostiene todo el módulo

| | Qué es | Dónde vive |
|---|---|---|
| **Cobranza** | Cómo se PRETENDE cobrar | `subscription_collection_profiles` |
| **Cobro** | Dinero que YA entró | `payments` |

Mezclarlas es el error clásico del dominio: acaban existiendo filas en
`payments` que no son cobros sino intenciones, y a partir de ahí el MRR, la
conciliación y las comisiones dejan de significar nada.

**Ningún archivo del módulo de cobranza escribe en `payments`.** Lo comprueban
dos tests (`04_v2_business.test.sql` §5-9): tras aprobar una Orden de Servicio,
el conteo de `payments` y de `commission_events` es **idéntico** al de antes.

---

## 2. Por qué el método cuelga de la SUSCRIPCIÓN y no del cliente

GRUPASA paga eSupplier con tarjeta Culqi mensual y WMS con Orden de Servicio
anual. **Mismo cliente, dos métodos.**

Si el método colgara de la organización, ese caso —que es el caso real— sería
irrepresentable. Por eso `subscription_collection_profiles.subscription_id` es
la clave del modelo, y por eso el seed incluye GRUPASA: para que la decisión de
diseño quede demostrada y no solo argumentada.

---

## 3. Métodos disponibles

| `collection_method` | Qué implica | Requiere |
|---|---|---|
| `CULQI_CARD` | Cargo recurrente automático vía proveedor | Cuenta `provider_kind = 'CULQI'` y `auto_charge = true` |
| `SERVICE_ORDER` | El cliente emite una Orden de Servicio | `requires_service_order = true` |
| `PURCHASE_ORDER` | El cliente emite una Orden de Compra | `requires_purchase_order = true` |
| `BANK_TRANSFER` | Transferencia conciliada por finanzas | — |
| `MANUAL` | Cualquier otro acuerdo, registrado a mano | — |

Una suscripción **sin perfil** se cobra manualmente por omisión. Eso es un
hecho, no un dato faltante, y la vista `v_subscription_collection` lo expone
como `profile_missing = true` en vez de como un `NULL` ambiguo.

---

## 4. Política temporal

Cada perfil lleva la política que alimenta el motor de renovaciones (Fase 11):

| Campo | Significado | Por defecto |
|---|---|---|
| `invoice_lead_days` | Emitir la factura N días antes | 0 |
| `renewal_notice_days` | Avisar de la renovación N días antes | 30 |
| `payment_due_days` | Vencimiento tras la emisión | 15 |
| `grace_period_days` | Gracia tras el vencimiento | 10 |
| `document_lead_days` | Pedir la OS/OC N días antes | 45 |
| `auto_suspend` | Suspender al acabar la gracia | `false` |

Todos con `CHECK` entre 0 y 365: un aviso a tres años vista o un vencimiento
negativo son errores de captura, no configuraciones.

`auto_suspend` **exige al menos 1 día de gracia**. Suspender el mismo día del
vencimiento no le deja al cliente ningún margen de reacción.

---

## 5. Versionado

Cambiar de método **no borra el perfil anterior**: lo cierra
(`effective_to = effective_from - 1`) y abre uno nuevo. El índice parcial
`scp_current_uk` garantiza un solo perfil vigente por suscripción.

Motivo: una factura del año pasado tiene que seguir explicándose con la política
que estaba activa entonces. Editar el perfil en sitio haría que el pasado
cambiara de significado.

---

## 6. Cuentas de proveedor: dónde vive cada secreto

`payment_provider_accounts` guarda **referencias, no credenciales**.

| Dato | Dónde | Por qué |
|---|---|---|
| Llave pública `pk_test_…` | Columna `public_key` | Es pública por diseño: el navegador la necesita para tokenizar |
| Llave secreta `sk_…` | **Secret de Edge Function** | Un `CHECK` rechaza cualquier valor con forma `sk_`/`pk_` en la tabla |
| Nombre de esa variable | `secret_key_ref` (ej. `CULQI_SECRET_KEY`) | La base sabe *dónde buscar*, nunca *qué es* |
| PAN, CVV, token | **En ningún sitio** | El PAN no toca nuestro servidor |

Cuatro defensas, y las cuatro con test:

1. `ppa_no_real_keys_ck` — rechaza `sk_test_`/`sk_live_` en la referencia y `sk_` en la llave pública.
2. `ppa_live_needs_secret_ref_ck` — una cuenta LIVE sin referencia es inválida.
3. `reject_secret_like_json('metadata')` — rechaza claves tipo `api_key` en metadata.
4. La RPC `upsert_payment_provider_account` lanza `SECRETO_EN_BASE` con un
   mensaje explícito antes de que salte el CHECK, porque es el error más fácil
   de cometer.

---

## 7. Guard cross-organización

Una cuenta de proveedor **con dueño** solo puede cobrar suscripciones de ese
dueño. Una cuenta **sin dueño** es de EBIM y sirve a cualquiera.

`enforce_collection_profile_scope()` lo aplica y devuelve `CUENTA_PROVEEDOR_AJENA`.
Sin esto, un partner podría dirigir el cobro de otro cliente a su propia pasarela.

---

## 8. Superficie

| RPC | Quién puede | Qué hace |
|---|---|---|
| `upsert_payment_provider_account` | `EBIM_FINANCE` o super admin | Alta/edición de cuenta de cobro |
| `set_subscription_collection_profile` | EBIM comercial/finanzas, o admin de la organización facturada | Versiona el perfil |

Ninguna tabla del módulo es escribible directamente por `authenticated`: lo
comprueba `03_v2_security.test.sql` §4.

---

## 9. Vista de consulta

`v_subscription_collection` (security_invoker) une suscripción + perfil +
producto + tenant + cuenta de proveedor. Es la fuente tanto de la pestaña
**Cobranza** de la UI como del motor de alertas.
