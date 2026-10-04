# MasterAdmin — Portal de pago, tarjeta guardada, tarifa de partners, uso/créditos y usuarios
## Especificación de diseño v1.0

**Documento:** `docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md`
**Fecha:** 4 de octubre de 2026.
**Rama:** `feature/masteradmin-cobro-usuarios-v1` (desde `dev` `4d0753e`).
**Estado:** decisiones de negocio tomadas por el usuario en conversación (§1.1); diseño listo para implementación local.
**Alcance de ejecución:** LOCAL/DEV. No toca QAS, PRD ni Supabase remoto. Culqi solo MOCK/TEST.

---

## 1. Propósito

Cerrar las brechas de la revisión del 4 de octubre entre MasterAdmin y la visión del «Admin Maestro»:

1. **M1 Portal de pago:** el cliente recibe un enlace y paga sus facturas con tarjeta (Culqi).
2. **M2 Tarjeta guardada:** desde el portal el cliente autoriza el cobro automático de sus facturas.
3. **M3 Tarifa de plataforma de partners:** el partner le paga a EBIM una parte por usar la plataforma.
4. **M4 Uso, créditos IA y billing shadow:** pantallas para lo que hoy solo existe en la base.
5. **M5 Usuarios y perfiles:** administrar personal EBIM, usuarios de partners y clientes.

### 1.1 Decisiones del usuario (2026-10-04)

| # | Pregunta | Decisión |
|---|---|---|
| U-1 | Qué abre el enlace de pago | **Estado de cuenta por organización**: reutilizable, con vencimiento, revocable; lista las facturas pendientes y permite pagar cualquiera y activar el pago recurrente. |
| U-2 | Modelo de pago recurrente | **Tarjeta guardada** (Culqi Customer + Card). MasterAdmin cobra cada factura emitida, con reintentos. Admite montos variables. |
| U-3 | Cobro al partner | **Configurable por acuerdo**: % sobre precio de lista, tarifa fija por tenant activo, o ambos. Estado de cuenta mensual y factura consolidada al partner, pagable por el mismo portal. |
| U-4 | Alcance de usuarios | **Todos**: personal EBIM, partners y clientes (membresías de organización y tenant), vínculo con vendedores. Invitación por email con enlace copiable mientras no haya SMTP real; desactivación; registro abierto desactivado. |

### 1.2 Invariantes que se conservan

- RLS es la autoridad; la UI solo es UX. Toda escritura sensible va por RPC `SECURITY DEFINER` con `log_audit`.
- `comercial ≠ acceso operativo`: una venta no crea `tenant_memberships`.
- Comisiones solo desde pagos `CONFIRMED` (trigger existente). Las líneas nuevas `PARTNER_PLATFORM_FEE` solo comisionan con una regla que las nombre (igual que `USAGE_OVERAGE`/`CREDIT_PURCHASE`).
- Culqi LIVE sigue bloqueado por `CULQI_ALLOW_LIVE`. Nunca se guarda PAN, CVV ni token `tkn_`; solo ids opacos (`cus_`, `crd_`, `chr_`) y brand/last4.
- Convenciones `docs/architecture/EBIM_CONVENTIONS.md`: buscador único y pestañas de estado (U-06), detalle en `SectionTabs` con `#hash` (U-07), toda la UI en español (U-13), estados vacío/carga/error (U-14), Super Admin único no asignable (S-01), secretos solo en servidor (S-05).
- Decisiones abiertas del CCP (D-01…D-06, D-12) no se resuelven aquí: la UI muestra «No decidido (D-xx)», nunca 0 ni «gratis».

---

## 2. M1 — Portal de pago por enlace

### 2.1 Modelo

`platform.payment_links`

| Columna | Nota |
|---|---|
| `id uuid` | PK |
| `organization_id uuid` | Organización cuyo estado de cuenta se muestra (cliente o partner). |
| `token_hash text unique` | `sha256` hex del token. El token en claro solo se devuelve una vez al crearlo. |
| `token_hint text` | Últimos 4 caracteres, para identificarlo en la UI. |
| `expires_at timestamptz` | Por defecto +30 días; máximo 90. |
| `allow_card_enrollment boolean` | Si el portal ofrece guardar la tarjeta (M2). Por defecto `true`. |
| `revoked_at`, `revoked_by`, `revoke_reason` | Revocación. |
| `last_accessed_at`, `access_count` | Telemetría. |
| `created_by`, `created_at` | |

Estado derivado: `REVOKED` si `revoked_at`, `EXPIRED` si `expires_at <= now()`, si no `ACTIVE`.

`platform.payment_link_events` (append-only): `link_id`, `kind` (`VIEW`, `CHARGE_ATTEMPT`, `CHARGE_OK`, `CHARGE_FAILED`, `ENROLL`, `UNENROLL`, `RATE_LIMITED`), `invoice_id`, `external_id`, `error_code`, `amount`, `currency`, `client_fingerprint` (hash de IP+UA, nunca la IP en claro), `created_at`.

Límite de intentos: máximo 10 `CHARGE_ATTEMPT` por enlace por hora y 5 por factura por hora → `RATE_LIMITED`.

### 2.2 RPCs

| RPC | Quién | Qué hace |
|---|---|---|
| `create_payment_link(p_organization_id, p_expires_in_days, p_allow_card_enrollment, p_reason)` → `{id, token, expires_at}` | Finanzas o super admin | Genera 32 bytes aleatorios (`gen_random_bytes`), base64url; guarda el hash. Audita sin el token. |
| `revoke_payment_link(p_link_id, p_reason)` | Finanzas o super admin | Idempotente. |
| `payment_link_statement(p_token_hash)` → jsonb | Solo servicio | Valida enlace; devuelve organización (nombre, email de facturación enmascarado), facturas `ISSUED`/`PARTIALLY_PAID` con saldo (`total − Σ CONFIRMED`), moneda, cuenta Culqi resuelta por factura (id, `public_key`, entorno), tarjeta guardada (brand/last4) y estado de autorización. Registra `VIEW`. |
| `register_payment_link_event(...)` | Solo servicio | Inserta en `payment_link_events` y aplica el límite de intentos. |
| `register_provider_invoice_payment(p_provider_account_id, p_external_event_key, p_external_charge_id, p_invoice_id, p_amount, p_currency, p_paid_at, p_payload)` → `{payment_id, duplicate}` | Solo servicio | Idempotente por `reference = 'culqi:'||chr`. Valida moneda = factura, estado facturable y **sin sobrecobro** (saldo). Inserta `payments` `CONFIRMED`; el trigger existente genera comisiones. |

Resolución de la cuenta Culqi por factura: perfil de cobranza vigente de la suscripción si es `CULQI_CARD`; si no, el primer candidato de `provider_account_candidates(subscription, 'CULQI_CARD')` para la moneda; las facturas de partner sin suscripción usan la cuenta de la moneda con menor `routing_priority`. Sin cuenta → la factura se lista como «no pagable con tarjeta».

### 2.3 Edge Function `pay-portal` (`verify_jwt = false`)

El token viaja en el **fragmento** de la URL (`/pagar#<token>`), que el navegador no envía al servidor ni en `Referer`; la página lo manda en el cuerpo `POST`.

| Ruta | Cuerpo | Efecto |
|---|---|---|
| `POST /statement` | `{token}` | `payment_link_statement`. |
| `POST /charge` | `{token, invoice_id, source_token, email}` | Revalida enlace y saldo; `createCharge` (Culqi `POST /charges`, `source_id = tkn_`, `metadata {invoice_id, link_id, origin:'pay-portal'}`); verifica con `GET /charges/{id}`; `register_provider_invoice_payment`. |
| `POST /enroll` | `{token, source_token, accepted_terms, billing_contact?}` | M2 (§3). |
| `POST /unenroll` | `{token}` | M2 (§3). |

Respuestas con códigos estables (`ENLACE_INVALIDO`, `ENLACE_VENCIDO`, `ENLACE_REVOCADO`, `FACTURA_NO_PAGABLE`, `SOBRECOBRO`, `TARJETA_RECHAZADA`, `TARJETA_REQUIERE_AUTENTICACION`, `DEMASIADOS_INTENTOS`, `CUENTA_NO_CONFIGURADA`). Un token inválido y uno inexistente responden igual (no se filtra existencia). Cuerpo máximo 16 KB. CORS limitado a `MASTERADMIN_ALLOWED_ORIGINS`.

Proveedor: `PaymentProvider` gana `createCharge(input)` en `culqi.ts` (TEST) y `mock.ts` (determinista). 3DS queda fuera de v1: se informa `TARJETA_REQUIERE_AUTENTICACION` y se ofrece transferencia.

`culqi-webhook` y `payment-reconcile` aceptan cargos con `metadata.invoice_id` sin suscripción del proveedor: si la `reference` ya existe es `DUPLICATE`; si no, `register_provider_invoice_payment` tras verificar el cargo.

### 2.4 Página pública `/pagar`

Ruta hermana de `/login`, fuera de `RequireAuth`/`AppShell`, layout mínimo con marca EBIM.
- Lista facturas pendientes con saldo, vencimiento y estado; botón «Pagar» por factura.
- Tarjeta: Culqi Checkout v4 (`https://checkout.culqi.com/js/v4`) con la `public_key` de la cuenta de esa factura. En cuentas `MOCK` (sin credenciales) la página usa un formulario de prueba que produce `tkn_mock_*` y lo rotula «Modo de prueba».
- Tras pagar, recarga el estado de cuenta y muestra el comprobante (`chr_` enmascarado, monto, fecha).
- Bloque «Pago automático» (M2) si el enlace lo permite.
- Errores en lenguaje de cliente; nunca muestra ids internos.

### 2.5 Consola

- **Ficha 360 de la organización → pestaña «Portal de pago»**: generar enlace (vencimiento, permitir tarjeta guardada) → diálogo que muestra el URL **una sola vez** con «Copiar» y `mailto:` prellenado; lista de enlaces con estado, último acceso, eventos; revocar.
- **Factura / suscripción**: acceso directo «Compartir enlace de pago» hacia la organización facturada.
- Corrección de `CulqiCardPanel`: el estado de credenciales se calcula desde la cuenta resuelta, no desde una suscripción del proveedor previa; muestra tarjeta guardada y autorización (M2).
- Pantalla «Cuentas de pago» en Configuración (finanzas): alta/edición con `upsert_payment_provider_account` (solo `pk_` y el **nombre** del secret; nunca `sk_`). Resuelve el texto de UI hoy sin respaldo.

---

## 3. M2 — Tarjeta guardada y cobro automático

### 3.1 Autorización desde el portal (`POST /enroll`)

1. Valida enlace con `allow_card_enrollment` y `accepted_terms = true` (versión de términos `CARD_ON_FILE_V1`).
2. Completa datos de facturación faltantes (Culqi exige nombre, apellido, email, dirección, ciudad, país, teléfono) con `set_billing_contact` en contexto de servicio.
3. Culqi: Customer (reutiliza `provider_customers` o recupera por email) → Card con `tkn_` → `provider_payment_methods` (`is_default`).
4. Registra `card_on_file_authorizations` y cambia el perfil de cobranza de las suscripciones activas de la organización a `CULQI_CARD` con `recurring_mode = 'CARD_ON_FILE'` y `payment_method_id`.

`platform.card_on_file_authorizations`: `organization_id`, `payment_method_id`, `terms_version`, `accepted_at`, `link_id`, `client_fingerprint`, `revoked_at`, `revoked_by`, `revoke_reason`, `revoke_source` (`PORTAL`, `CONSOLE`). Una vigente por organización y cuenta.

`subscription_collection_profiles` gana `recurring_mode` (`PROVIDER_SUBSCRIPTION` por defecto, compatible con V3.2; o `CARD_ON_FILE`) y `payment_method_id`. CHECK: `CARD_ON_FILE` exige `payment_method_id` y `auto_charge`.

`POST /unenroll` (y la acción de consola) revoca la autorización, marca el método inactivo y deja `auto_charge = false`. No elimina historial.

### 3.2 Cobro automático (`payment-autocharge`)

Edge Function con `verify_jwt = true` que acepta: (a) JWT de finanzas o super admin (`{invoice_id}` para «Cobrar ahora», o `{run: true}` para «Ejecutar cobros pendientes»); (b) contexto de servicio para un cron futuro (no se programa: decisión D-07).

RPC solo servicio `card_on_file_due_invoices(p_limit, p_invoice_id)`: facturas `ISSUED`/`PARTIALLY_PAID`, `due_date <= current_date`, saldo > 0, suscripción con perfil `CARD_ON_FILE` vigente y autorización activa, y que el reintento toque según la política.

`platform.payment_charge_attempts`: `invoice_id`, `payment_method_id`, `attempt_no`, `idempotency_key` (`invoice:attempt_no`, único), `status` (`PENDING`, `SUCCEEDED`, `FAILED`), `external_charge_id`, `error_code`, `next_retry_at`, `trigger_source` (`MANUAL`, `RUN`, `CRON`), `created_by`.

Política de reintentos: intento 1 al vencer; 2 a +3 días; 3 a +7 días. Tras el tercer fallo no se reintenta y se crea una alerta de cobranza (`billing_alerts`, código `CARD_ON_FILE_EXHAUSTED`). Cargo con `source_id = crd_`; éxito → `register_provider_invoice_payment`.

### 3.3 Consola

- Tarjeta guardada y autorización visibles en `CulqiCardPanel` y en la ficha 360 (brand, last4, fecha, origen); acción «Revocar autorización».
- En la factura: «Cobrar ahora» (si hay tarjeta) e historial de intentos.
- En Cobranza/Renovaciones: «Ejecutar cobros pendientes» con resumen (procesadas, cobradas, fallidas).

---

## 4. M3 — Tarifa de plataforma de partners

### 4.1 Términos por acuerdo

`organization_product_agreements` gana:

| Columna | Nota |
|---|---|
| `platform_fee_model` | `NONE` (defecto), `PERCENT_OF_LIST`, `FIXED_PER_TENANT`, `PERCENT_PLUS_FIXED`. |
| `platform_fee_rate numeric(6,4)` | 0–1. Obligatorio si el modelo incluye %. |
| `platform_fee_fixed_amount numeric(14,2)` y `platform_fee_currency char(3)` | Obligatorios si el modelo incluye fijo. |

RPC `set_agreement_platform_fee(p_agreement_id, p_model, p_rate, p_fixed_amount, p_currency, p_reason)` (finanzas o super admin). Rechaza un modelo distinto de `NONE` si `billing_responsibility = 'EBIM'` (`TARIFA_PARTNER_REQUIERE_FACTURACION_PARTNER`): si EBIM factura al cliente, el partner no le debe a EBIM.

### 4.2 Suscripciones facturadas por el partner

`subscriptions` gana `billing_channel` (`DIRECT` por defecto, o `PARTNER_STATEMENT`).
- `onboard_customer_subscription` asigna `PARTNER_STATEMENT` cuando el tenant lo gestiona un partner con acuerdo `billing_responsibility = 'PARTNER'`.
- `set_subscription_billing_channel(p_subscription_id, p_channel, p_reason)` para corregir contratos existentes (finanzas).
- `issue_subscription_invoice` rechaza `PARTNER_STATEMENT` con `SUSCRIPCION_FACTURADA_POR_PARTNER`: EBIM no le factura al cliente final.

### 4.3 Estado de cuenta mensual

`platform.partner_fee_statements`: `partner_organization_id`, `period_start` (primer día del mes), `currency`, `status` (`DRAFT`, `ISSUED`, `VOID`), `base_total`, `fee_total`, `invoice_id`, `source_hash`, `computed_at`, `computed_by`, `issued_at`. Único por (partner, período, moneda) mientras no esté `VOID`.

`platform.partner_fee_statement_lines`: `statement_id`, `agreement_id`, `saas_product_id`, `tenant_id`, `subscription_id`, `base_list_amount` (mensualizado), `fee_rate`, `fee_fixed_amount`, `fee_amount`, `basis jsonb`.

Base por tenant: tenants `ACTIVE` del período, tipo `PRODUCTION`/`TRIAL` (no `DEMO`/`SANDBOX`), con `managing_organization_id = partner`, producto con acuerdo de tarifa ≠ `NONE` y suscripción `ACTIVE` en el período. `base_list_amount` = Σ de ítems recurrentes vigentes (`LICENSE`, `TENANT_LICENSE`, `ADDON`) `amount` mensualizado (`QUARTERLY/3`, `YEARLY/12`; `ONE_TIME` excluido). Uso y créditos fuera de la base en v1 (D-01/D-02 abiertas). `fee_amount = round(base × rate, 2) + fixed`. Una línea por tenant y producto; la moneda de la línea es la de la suscripción, salvo el fijo que usa `platform_fee_currency` (si difiere, línea separada).

RPCs (finanzas o super admin):
- `compute_partner_fee_statement(p_partner_id, p_period_start)` → recalcula el `DRAFT` (idempotente; `source_hash` estable). No toca un `ISSUED`.
- `issue_partner_fee_statement(p_statement_id)` → crea la factura `ISSUED` al partner (sin `subscription_id`), líneas `charge_kind = 'PARTNER_PLATFORM_FEE'` con `tenant_id`/`saas_product_id`, número correlativo existente, vencimiento a 15 días. Idempotente.
- `void_partner_fee_statement(p_statement_id, p_reason)` → solo si la factura no tiene pagos `CONFIRMED`; anula la factura (`VOID`).

El partner paga por el portal (M1) con un enlace a su organización, o por cobro manual.

### 4.4 Consola

- `AgreementFormDialog`: sección «Tarifa de plataforma» (modelo, %, fijo, moneda) vía `set_agreement_platform_fee`.
- Nueva página **Finanzas → «Tarifas de partners»**: selector de período; tabla por partner (tenants, base, tarifa, estado, factura, saldo); acciones calcular, ver detalle por tenant, emitir, anular, compartir enlace de pago.
- Ficha del partner: estado de cuenta y saldo.
- `COMMERCIAL_MODEL.md`/`COMMISSION_MODEL.md` documentan el flujo partner → EBIM y lo distinguen de `commission_events` (EBIM → vendedores).

---

## 5. M4 — Uso, créditos IA y billing shadow

Pantallas sobre el backend existente (fases 17–18), con estos complementos mínimos:
- `close_usage_aggregate(p_aggregate_id, p_reason)` (finanzas): OPEN → CLOSING solo si el período terminó (`period_end <= now()`), para no depender del job no programado.
- `platform.usage_alert_acks` + `acknowledge_usage_alert(p_alert_id, p_note)` (finanzas o admin de producto): `usage_alerts` sigue append-only.
- `end_ai_credit_policy(p_policy_id, p_valid_to, p_reason)` (finanzas).
- Vista `v_usage_period_aggregates` extendida con `meter_id`, `closing_at`, `finalized_by`.

### 5.1 «Uso» (`/usage`, Operación SaaS)

Pestañas: **Medidores** (alta/edición/estado `upsert_usage_meter`; facturable `set_usage_meter_billable` con motivo y badge D-06), **Ingest** (credenciales por producto/entorno, kill-switch `set_usage_ingest_enabled`; aviso de que el flag global `USAGE_INGEST_ENABLED` vive en el entorno y está apagado hasta D-12), **Agregados** (buscador único por producto/tenant/medidor y pestañas de estado OPEN/CLOSING/FINALIZED; «Cerrar período» y «Finalizar» para finanzas), **Eventos** (por tenant y rango; COGS solo finanzas), **Rechazos** (agrupados por código), **Alertas** (con acuse).

### 5.2 «Créditos IA» (`/ai-credits`, Finanzas)

Pestañas: **Saldos** (`v_ai_credit_balances`), **Movimientos** (ledger con detalle, «Revertir»), **Pesos** (versionado `set_ai_credit_weight`, historial), **Políticas** (alta y cierre), **Operaciones** (abrir período por tenant, bono/ajuste con `record_ai_credit_entry` limitado a `GRANT_BONUS`/`ADJUST`, compra con `purchase_ai_credits`), **Catálogo** (paquetes y vínculo `METER`/`AI_CREDIT`).

### 5.3 «Billing shadow» (`/billing-shadow`, Finanzas)

Productos con su eje BILLING y transición gobernada (`set_commercial_cutover_state`, motivo obligatorio); **Vista previa** «lo que MasterAdmin facturaría» por tenant y período (`billing_shadow_expected_lines`); **Historial** de comparaciones con diff línea a línea, checksum y verde/rojo; «Registrar comparación» pegando el JSON local (solo en `BILLING_SHADOW`).

### 5.4 Tenant 360

Pestaña «Uso y créditos»: agregados del tenant, saldo por pool y últimos movimientos.

---

## 6. M5 — Usuarios y perfiles

### 6.1 Modelo

- `profiles` gana `phone` y `job_title`.
- `platform.user_invitations`: `email`, `invited_by`, `user_id`, `grant jsonb` (rol de consola / membresía de organización / membresía de tenant / rol de provisioning / vendedor), `status` (`SENT`, `ACCEPTED`, `REVOKED`), `delivery` (`EMAIL`, `LINK`), `created_at`, `accepted_at`.
- Un rol de consola por usuario (PK actual de `platform_admins`). El gobierno de `EBIM_SUPER_ADMIN` (trigger existente) no cambia.

### 6.2 RPCs (todas con `log_audit`)

| RPC | Quién |
|---|---|
| `admin_list_users(p_search, p_scope_org_id)` → filas con perfil, rol de consola, membresías, roles de provisioning, vendedor, `last_sign_in_at`, `banned` | Super admin o admin de plataforma (todo); `ORG_ADMIN`/`PARTNER_ADMIN` (solo miembros de su organización) |
| `admin_update_profile(p_user_id, p_full_name, p_phone, p_job_title)` | Super admin; o el propio usuario |
| `grant_platform_role(p_user_id, p_role, p_reason)` / `revoke_platform_role(p_user_id, p_reason)` | Super admin |
| `upsert_organization_membership(p_user_id, p_org_id, p_role, p_company_id, p_reason)` / `set_organization_membership_active(p_membership_id, p_active, p_reason)` | Admin de plataforma; admin de la organización solo con roles de su familia (`PARTNER_*` en partner, `ORG_*` en cliente) y nunca superiores al suyo |
| `upsert_tenant_membership(p_user_id, p_tenant_id, p_role, p_reason)` / `set_tenant_membership_active(...)` | `can_manage_tenant` |
| `revoke_provisioning_role(...)` (existente) y `grant_provisioning_role` (existente) | Super admin |
| `link_user_sales_agent(p_sales_agent_id, p_user_id, p_reason)` | Admin comercial |
| `deactivate_user(p_user_id, p_reason)` / `reactivate_user(p_user_id, p_reason)` | Super admin |

`deactivate_user` desactiva perfil, rol de consola, membresías y roles de provisioning en cascada (los helpers RLS ya filtran por `is_active` de esas filas) y no permite desactivar al último super admin activo. `reactivate_user` solo reactiva el perfil; los accesos se vuelven a otorgar explícitamente.

### 6.3 Edge Function `user-admin` (`verify_jwt = true`)

Acciones: `invite` (`auth.admin.inviteUserByEmail` con `redirectTo`; si no hay SMTP o falla, `generateLink({type:'invite'})` y devuelve el enlace para copiar), `resend`, `ban`/`unban` (`updateUserById` con `ban_duration`, acompaña a `deactivate_user`/`reactivate_user`). Autoriza con las mismas reglas de §6.2 llamando RPCs con el JWT del usuario; la service role solo se usa para la API de Auth. Tras invitar aplica el `grant` con las RPCs y registra `user_invitations`.

Página `/bienvenida` (pública): recibe la sesión del enlace de invitación y pide fijar contraseña (`updateUser`). Login gana «¿Olvidaste tu contraseña?» (`resetPasswordForEmail`).

`supabase/config.toml`: `enable_signup = false` (local). En QAS/PRD es un ajuste del Dashboard que se documenta en el runbook.

### 6.4 Consola

- **Gobierno → «Usuarios y accesos»** (`/users`): lista con buscador único (nombre, email, organización) y pestañas Todos/EBIM/Partners/Clientes/Inactivos (U-06), «Invitar usuario» (email, nombre, tipo de acceso y su destino).
- **Detalle de usuario**: Perfil · Rol de consola · Organizaciones · Tenants · Provisioning · Vendedor · Actividad (auditoría del usuario) · Desactivar/Reactivar.
- Admin de partner/cliente ve la misma página limitada a su organización.
- **Configuración → «Mi perfil»**: nombre, teléfono, cargo; cambio de contraseña.
- `CommercialDialogs`: selector de usuario al editar un vendedor.

---

## 7. Migraciones (orden)

| Archivo | Módulo |
|---|---|
| `20261010000100_payment_links.sql` | M1 |
| `20261010000200_provider_invoice_payments.sql` | M1 |
| `20261010000300_card_on_file.sql` | M2 |
| `20261011000050_charge_kind_partner_platform_fee.sql` | M3 (enum aislado) |
| `20261011000100_partner_platform_fee.sql` | M3 |
| `20261012000100_usage_credits_console.sql` | M4 |
| `20261013000100_user_admin.sql` | M5 |

Cada una con su archivo pgTAP (`43_` en adelante).

## 8. Verificación

- pgTAP por migración: permisos (anon/authenticated/servicio), idempotencia, rechazos con código, auditoría, no-regresión de 00–42.
- Vitest: `createCharge` (Culqi TEST mapeo y mock), handlers de `pay-portal`, `payment-autocharge`, `user-admin` con dependencias inyectadas; páginas nuevas.
- Gates: `typecheck`, `lint`, `vitest`, `build`, `secrets:scan`, `supabase test db` desde base vacía.
- Prueba manual local con el portal en MOCK; Culqi TEST solo si existe la llave TEST en el entorno local del operador.

## 9. Fuera de alcance v1

3DS; envío de email propio (se copia el enlace o se usa la invitación de Supabase Auth); programación de crons (D-07); facturación fiscal (D-13); uso y créditos en la base de la tarifa de partner; portal autenticado del cliente; promoción a QAS.
