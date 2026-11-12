# Runbook — portal de pago (M1) y cobro con tarjeta guardada (M2)

Spec: `docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md` §2–§3.
Arquitectura: `docs/payments/CULQI_ARCHITECTURE.md` (sección M1/M2) y `docs/payments/COLLECTION_MODEL.md` §10.

> **Alcance:** LOCAL/DEV. Culqi solo MOCK/TEST. LIVE exige `CULQI_ALLOW_LIVE=true` y autorización explícita
> y por escrito del operador; este runbook no la da.

## 1. Piezas

| Pieza | Qué hace |
| --- | --- |
| `platform.create_payment_link` / `revoke_payment_link` | Finanzas o super admin. Devuelve el token UNA vez; la base guarda solo su sha256 |
| `v_payment_links`, `payment_link_events` | Estado (ACTIVE/EXPIRED/REVOKED), accesos y bitácora del enlace |
| Edge `pay-portal` (`verify_jwt = false`) | `POST /statement`, `/charge`, `/enroll`, `/unenroll`. Cuerpo ≤ 16 KB |
| Página pública `/pagar#<token>` | Estado de cuenta, «Pagar» por factura, «Pago automático» |
| Edge `payment-autocharge` (`verify_jwt = true`) | «Cobrar ahora» (`{invoice_id}`) y «Ejecutar cobros pendientes» (`{run: true}`) |
| `register_provider_invoice_payment` | Único camino de un cargo de factura a `payments` (idempotente por `culqi:<chr>`) |

## 2. Crear un enlace y compartirlo

1. Consola → Organizaciones → ficha de la organización → pestaña **Portal de pago** (solo finanzas).
2. **Generar enlace**: vigencia (1–90 días, por defecto 30) y si permite guardar la tarjeta.
3. El diálogo muestra el URL **una sola vez** (`https://<consola>/pagar#<token>`): **Copiar** o **Enviar por correo**
   (abre el cliente de correo con el mensaje prellenado; MasterAdmin no envía correos en v1).
4. Si se pierde el URL: **Revocar** (con motivo) y generar otro. El token no se puede recuperar.

Atajos: la pestaña «Facturación y cobros» de una suscripción tiene «Compartir enlace de pago».

SQL (sesión humana de finanzas, p. ej. en pruebas locales):

```sql
select platform.create_payment_link('<organization_id>', 30, true, 'motivo');
select platform.revoke_payment_link('<link_id>', 'motivo');
```

## 3. MOCK frente a TEST

| Situación de la cuenta Culqi de la factura | Modo | Qué ve el cliente |
| --- | --- | --- |
| Sin llave secreta (ni cifrada ni por variable de entorno) o sin URL de la API (ni en la cuenta ni `CULQI_API_BASE`) | MOCK | Con `PAYMENT_PORTAL_ALLOW_MOCK=true`: formulario **«Modo de prueba»** (token `tkn_mock_*`). Sin la variable: «No pagable con tarjeta» |
| Llave `sk_test_…` configurada (cifrada en la cuenta, o por `secret_key_ref`) + URL de la API + `public_key = pk_test_…` | TEST | Culqi Checkout v4 (`https://checkout.culqi.com/js/v4`) con la llave pública de la cuenta |
| LIVE | LIVE | Solo con `CULQI_ALLOW_LIVE=true` (si falta, error ruidoso; nunca degrada a MOCK) |

En MOCK, un origen que contiene `decline` se rechaza (`TARJETA_RECHAZADA`) y uno con `3ds` pide autenticación
(`TARJETA_REQUIERE_AUTENTICACION`); el formulario de prueba ofrece ambos resultados.

## 4. Configurar las credenciales de Culqi (desde la consola)

Desde 2026-10-05 (spec §11) la llave secreta **se configura en la plataforma** y se guarda **cifrada** (Supabase
Vault). Ya no hace falta `supabase secrets set` para la llave.

1. Consola → Configuración → **Cuentas de pago** (rol EBIM_FINANCE o super admin).
2. **Editar** la cuenta (p. ej. `culqi-pe-test`):
   - **Llave pública**: `pk_test_…`.
   - **URL de la API (opcional)**: `https://api.culqi.com/v2`. Vacía = `CULQI_API_BASE` del servidor; si tampoco
     existe, la cuenta opera en MOCK.
   - **Variable de entorno (avanzado, opcional)**: déjala vacía salvo que la llave viva como secret del servidor.
3. En la columna **Llave secreta** → **Configurar llave**: pegar `sk_test_…` (campo de contraseña, «Mostrar» para
   revisarla) y, si se quiere, un motivo. Al guardar, el campo se vacía y la columna muestra
   «Configurada (`sk_test_…abcd`) · fecha». La llave no vuelve a mostrarse nunca.
4. **Reemplazar** sustituye la llave (misma entrada en Vault). **Quitar** (motivo obligatorio) la borra: una cuenta
   TEST vuelve a MOCK; una cuenta LIVE activa sin variable de entorno no puede quedarse sin llave.
5. Cuenta **LIVE** (solo con autorización escrita del operador): crearla **Inactiva**, configurar la `sk_live_…`,
   activarla y definir `CULQI_ALLOW_LIVE=true` en el entorno de funciones. Ese interruptor no se edita desde la UI.

La base valida la forma (`sk_(test|live)_` + ≥10 letras/dígitos) y el entorno (`sk_test_` ↔ TEST, `sk_live_` ↔
LIVE). Cada alta, reemplazo o baja queda en Auditoría (`PROVIDER_ACCOUNT_KEY_*`) con la pista, nunca la llave.

## 4b. Variables de entorno (Edge Functions)

Solo NOMBRES; los valores los carga el operador con `supabase secrets set` (nunca en el repo ni en la base).

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Inyectadas por Supabase |
| `MASTERADMIN_ALLOWED_ORIGINS` | Orígenes CORS de la consola (además de `http://127.0.0.1:5199` y `http://localhost:5199`) |
| `PAYMENT_PORTAL_ALLOW_MOCK` | `true` solo en LOCAL/DEV para cobrar con cuentas sin credenciales |
| `CULQI_API_BASE` | Opcional. URL base de la API si la cuenta no define «URL de la API» (sin ninguna → MOCK) |
| `<secret_key_ref>` (p. ej. `CULQI_SECRET_KEY`) | Opcional/avanzado. Llave `sk_…` como secret del servidor, solo si la cuenta NO tiene llave cifrada (la cifrada gana) |
| `CULQI_ALLOW_LIVE` | Interruptor deliberado para LIVE. Solo de entorno, no editable desde la UI. No se usa en este programa |

Local:

```bash
printf 'PAYMENT_PORTAL_ALLOW_MOCK=true\n' > /ruta/fuera/del/repo/functions.env
supabase functions serve --env-file /ruta/fuera/del/repo/functions.env
# consola en http://127.0.0.1:5199 ; portal en http://127.0.0.1:5199/pagar#<token>
```

## 5. Cobro automático (tarjeta guardada)

- Lo activa el cliente desde el portal (términos `CARD_ON_FILE_V1`). Si faltan datos de facturación que Culqi exige,
  el portal los pide y solo **completa** los vacíos (`set_billing_contact_from_portal`).
- Consola, finanzas:
  - Suscripción → «Facturación y cobros» → **Cobrar ahora** (ignora el calendario; queda auditado).
  - Renovaciones → **Ejecutar cobros pendientes**: procesa la cola según la política (al vencer, +3 d, +7 d; máximo 3)
    y muestra el resumen (procesadas, cobradas, fallidas, omitidas, en revisión).
  - Ficha 360 → Portal de pago / panel de tarjeta → **Revocar autorización** (con motivo).
- Llamada directa (JWT de finanzas):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/payment-autocharge" \
  -H "authorization: Bearer <JWT de finanzas>" -H "apikey: <anon>" \
  -H 'content-type: application/json' -d '{"run": true}'
```

- **D-07: el cron NO está programado.** La función acepta la clave de servicio para un cron futuro (origen `CRON`),
  pero programarlo es una decisión pendiente; no se crea `cron.schedule` en este programa.

### Intentos «En revisión»

Si la pasarela no responde (timeout/5xx) el intento queda `PENDING` y la factura no se vuelve a cobrar
automáticamente (podría haberse cobrado). Revisar en Culqi y en `payment-reconcile`: si el cargo existe, la
reconciliación con `apply_missing = true` lo registra contra su factura (`metadata.invoice_id`). Cerrar un intento
`PENDING` manualmente no tiene pantalla en v1 (limitación conocida).

### Candado de cobro por factura (anti doble cargo)

Antes de llamar a la pasarela, `pay-portal` (`/charge`) y `payment-autocharge` reclaman el candado de la factura
(`claim_invoice_charge_lock`, migración `20261010000400`). Un solo cargo en vuelo por factura:

| Estado (`invoice_charge_locks.status`) | Significado | Se libera |
| --- | --- | --- |
| `ACTIVE` | Cargo en vuelo (TTL 2 min) | Al registrar el pago o con un rechazo definitivo; si la función se cae, al vencer |
| `REVIEW` | Resultado ambiguo (timeout/5xx o cobrado y no registrado → `PAGO_EN_REVISION`) | Al registrarse un pago `CONFIRMED` de la factura (webhook/reconciliación) o a los 30 min |
| `RELEASED` | Libre | — |

Mientras está tomado, el portal responde **409 `COBRO_EN_CURSO`** («Ya hay un pago en curso para esta factura.
Espera un momento y recarga la página.») y el cobro automático omite la factura (`SKIPPED`, `COBRO_EN_CURSO`). Un
intento `PENDING` de cobro automático de los últimos 30 min también cuenta como cobro en curso. El cargo se hace por
el saldo leído con el candado tomado (no por el que vio la página).

## 6. Diagnóstico

| Síntoma | Dónde mirar |
| --- | --- |
| Cliente ve «enlace no válido / venció / ya no está disponible» | `v_payment_links.status` del enlace (pista de 4 caracteres) |
| «Hiciste demasiados intentos» | `payment_link_events` con `kind = 'RATE_LIMITED'` (10/enlace/h, 5/factura/h) |
| Pago cobrado pero «en revisión» | `payment_link_events` `CHARGE_FAILED` con `error_code` de la base; `provider_webhook_events` |
| «Ya hay un pago en curso» (`COBRO_EN_CURSO`) | `invoice_charge_locks` de la factura (`status`, `holder`, `expires_at`, `outcome_code`) |
| Cobro automático agotado | `billing_alerts` con `metadata->>'code' = 'CARD_ON_FILE_EXHAUSTED'` |

## 7. Pendiente para activar Culqi TEST (humano)

- [ ] Cargar `pk_test_…` y la URL de la API en la cuenta (Configuración → Cuentas de pago).
- [ ] «Configurar llave» con la `sk_test_…` (queda cifrada; §4).
- [ ] Pagar una factura desde `/pagar` con una tarjeta de prueba de Culqi; verificar `payments` y comisión únicos.
- [ ] Reenviar el webhook del mismo cargo: debe responder `DUPLICATE`.
- [ ] Guardar tarjeta y ejecutar «Cobrar ahora»; probar una tarjeta de rechazo y la alerta tras 3 fallos.
- [ ] Probar una tarjeta con 3-D Secure: debe responder `TARJETA_REQUIERE_AUTENTICACION`.
