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

`payment_provider_accounts` no guarda credenciales en claro: guarda metadatos y referencias.

| Dato | Dónde | Por qué |
|---|---|---|
| Llave pública `pk_test_…` | Columna `public_key` | Es pública por diseño: el navegador la necesita para tokenizar |
| Llave secreta `sk_…` | **Cifrada en Supabase Vault** (desde 2026-10-05), configurada desde la consola; la cuenta guarda `secret_vault_id` (oculto) y la pista `secret_hint` | Requisito del dueño: se introduce desde la plataforma y se guarda cifrada. Ver `CULQI_ARCHITECTURE.md` §12 |
| Alternativa: nombre de una variable de entorno | `secret_key_ref` (ej. `CULQI_SECRET_KEY`) | Compatibilidad; un `CHECK` rechaza cualquier valor con forma `sk_`/`pk_` en la tabla |
| PAN, CVV, token | **En ningún sitio** | El PAN no toca nuestro servidor |

Cuatro defensas, y las cuatro con test:

1. `ppa_no_real_keys_ck` — rechaza `sk_test_`/`sk_live_` en la referencia y `sk_` en la llave pública.
2. `ppa_live_needs_secret_ref_ck` — una cuenta Culqi LIVE **activa** sin llave (cifrada o de entorno) es inválida.
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

---

## 10. Cobro por factura con tarjeta guardada (M2 · `recurring_mode`)

Migración `20261010000300_card_on_file.sql`. Spec
`docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md` §3.

Hasta V3.2 el único cobro automático con tarjeta era la **suscripción del
proveedor**: Culqi cobra un Plan de importe fijo. M2 añade un segundo modo en el
mismo perfil de cobranza:

| `recurring_mode` | Quién decide el importe | Quién dispara el cargo |
|---|---|---|
| `PROVIDER_SUBSCRIPTION` (por defecto, V3.2) | El Plan del proveedor (fijo) | Culqi, en su calendario |
| `CARD_ON_FILE` (M2) | **Cada factura emitida** (admite uso, add-ons, prorrateos) | MasterAdmin (`payment-autocharge`) |

`CHECK scp_card_on_file_ck`: `CARD_ON_FILE` exige `payment_method_id`,
`auto_charge` y `collection_method = 'CULQI_CARD'`.

### 10.1 Cómo se activa

Lo activa **el cliente** desde el portal de pago (`/pagar#<token>`), aceptando
los términos `CARD_ON_FILE_V1`. `enroll_card_on_file` (solo servidor):

1. guarda Customer + Card (`provider_customers`, `provider_payment_methods`,
   solo `cus_`/`crd_` y brand/last4);
2. registra `card_on_file_authorizations` (una vigente por organización y cuenta;
   la anterior queda revocada con `revoke_source = PORTAL`);
3. **versiona** el perfil de las suscripciones activas de la organización cuya
   ruta admite esa cuenta → `CULQI_CARD` + `CARD_ON_FILE`. El perfil anterior se
   cierra, no se pisa (mismo criterio que §5).

### 10.2 Cómo se desactiva

El cliente (portal, «Desactivar pago automático») o finanzas (consola,
`revoke_card_on_file_authorization` con motivo). La autorización queda revocada,
la tarjeta `INACTIVE` y el perfil pasa a **`MANUAL`** en una versión nueva: el
CHECK de V2 `scp_culqi_autocharge_ck` no permite `CULQI_CARD` sin cargo
automático, así que «sin cobro automático» se representa como cobro manual.

### 10.3 Política de reintentos

| Intento | Cuándo |
|---|---|
| 1 | al vencer la factura (`due_date`) |
| 2 | `due_date + 3 días` |
| 3 | `due_date + 7 días` |
| — | tras el 3.º fallo: alerta `PAYMENT_FAILURE` con `metadata.code = 'CARD_ON_FILE_EXHAUSTED'` (dedupe `<factura>:CARD_ON_FILE_EXHAUSTED`) |

La decide la base (`card_on_file_due_invoices`, `card_on_file_retry_at`); la
Edge Function solo la ejecuta. «Cobrar ahora» desde la consola ignora el
calendario (intento `MANUAL`). Un cobro correcto cierra la alerta por el
trigger existente `resolve_alerts_on_payment`.

Un intento `PENDING` bloquea otro sobre la misma factura (índice parcial único):
nunca se cobra dos veces en paralelo. Un fallo **ambiguo** de la pasarela (sin
respuesta) deja el intento `PENDING` para revisión en vez de reintentarlo.

### 10.4 Superficie

| RPC | Quién | Qué hace |
|---|---|---|
| `enroll_card_on_file`, `unenroll_card_on_file`, `payment_link_enrollment_context`, `set_billing_contact_from_portal` | Solo servidor (`pay-portal`) | Alta/baja desde el portal |
| `card_on_file_due_invoices`, `begin_card_charge_attempt`, `complete_card_charge_attempt` | Solo servidor (`payment-autocharge`) | Cola, intento y cierre |
| `revoke_card_on_file_authorization` | `EBIM_FINANCE` o super admin | Revocación desde la consola (auditada) |

Vistas: `v_card_on_file_authorizations`, `v_payment_charge_attempts`.
