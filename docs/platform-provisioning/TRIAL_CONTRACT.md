# Contrato `trial.v1` · periodo de prueba del tenant en cada app

Estado: **v1 IMPLEMENTADO en MasterAdmin** (migración `20261024000100_echange_trial_period.sql`).
Primera app que lo implementa: **eChange** (en su repositorio, en paralelo).
Pruebas: `supabase/tests/61_trial_period.test.sql`, `supabase/functions/_shared/trial/client.test.ts`.

## 1. Quién decide qué

- **MasterAdmin es la fuente**: los días de prueba se configuran por producto
  (`saas_products.trial_days`, 1..90, **7 por defecto**) y cada tenant TRIAL nace con su vencimiento
  (`tenants.trial_ends_at = now() + días del producto`, en el alta, sea por la venta, por «Nuevo
  tenant» o por el registro manual de tenant-sync).
- **La app aplica el vencimiento sola**: con lo que recibe en el alta y por este canal decide que un
  tenant vencido ya no opera. No espera a que MasterAdmin lo suspenda.
- Extender o convertir la prueba **solo** se hace en MasterAdmin (`set_tenant_trial_end`, rol de
  plataforma, con motivo y auditoría). Un PATCH directo a `tenants` sobre las columnas de prueba, o
  para salir de `TRIAL`, se rechaza en la base: comercial ≠ acceso operativo.

## 2. En el alta (payload estándar de provisioning)

Solo para `tenantType: "TRIAL"` con vencimiento, el payload lleva una clave más. Un tenant
`PRODUCTION` recibe exactamente el payload de antes.

```json
{
  "tenantCode": "acme-echange",
  "tenantType": "TRIAL",
  "…": "…",
  "trial": { "days": 7, "endsAt": "2026-11-24T15:04:05Z" }
}
```

`endsAt` va siempre en ISO-8601 UTC, sin milisegundos y con `Z` (`platform.trial_iso_utc`).

## 3. Transporte y cuerpo del PUT

Mismo transporte que `entitlements.v1` y `lifecycle.v1`: HTTP M2M con JWT asimétrico (ES256) firmado
por MasterAdmin, mismo `iss` (`masteradmin.ebim`), `aud` y `sub` de la integración, `jti` de un solo
uso, token nuevo por intento, sin seguir redirecciones.

| Operación | Ruta (relativa a `deployment.base_url`) | Scope del token |
|---|---|---|
| Aplicar | `PUT /tenants/{controlPlaneTenantId}/trial` | `trial_write_scope` (eChange: `echange:lifecycle:write`) |
| Leer | `GET /tenants/{controlPlaneTenantId}/trial` | eChange: `echange:lifecycle:read` |

Cabeceras: `Authorization: Bearer <jwt>`, `X-MasterAdmin-Contract: trial.v1`,
`Content-Type: application/json`, `X-Correlation-Id`.

```json
{
  "contractVersion": "trial.v1",
  "productCode": "echange",
  "controlPlaneTenantId": "2f6c…",
  "endsAt": "2026-11-24T15:04:05Z",
  "reason": "EXTENDED"
}
```

- `endsAt: null` = la prueba se convirtió: ya no vence.
- `reason`: `STARTED` (el tenant quedó dado de alta en la app), `EXTENDED` (fecha posterior),
  `CONVERTED` (sin vencimiento), `MANUAL` (cualquier otra corrección de fecha).
- Es declarativo y sin versión: repetir el mismo cuerpo no cambia nada.

## 4. Respuestas

`200`:

```json
{ "controlPlaneTenantId": "2f6c…", "endsAt": "2026-11-24T15:04:05Z", "state": "TRIAL", "appliedAt": "2026-11-17T12:00:02Z" }
```

`state ∈ TRIAL | EXPIRED | CONVERTED`. MasterAdmin solo da por aplicado un 200 que repite el mismo
tenant y el mismo `endsAt` (al segundo) y trae un `state` válido; si no, lo registra como
`REJECTED / RESPONSE_INVALID`. El `GET` devuelve el mismo cuerpo.

| HTTP | `error` | Qué hace MasterAdmin |
|---|---|---|
| 400 | `INVALID_TRIAL` | Rechazo; reintenta cada hora (requiere a una persona) |
| 401 / 403 | — | Rechazo (`HTTP_401` / `HTTP_403`); reintenta cada hora |
| 404 | `TENANT_NOT_PROVISIONED` | Rechazo; reintenta cada hora |
| 503 | `TRIAL_NOT_CONFIGURED` | Reintentable con backoff (1, 2, 4… hasta 32 min) |
| 5xx / 429 / red | — | Reintentable con backoff |

## 5. Lado MasterAdmin

- Configuración por integración HTTP_M2M: `product_integrations.trial_path` y `trial_write_scope`
  (los dos o ninguno; el scope no puede ser el de alta ni los de entitlements; sí puede ser el de
  lifecycle). RPC: `platform.configure_trial_integration(integración, ruta, scope)`, con
  `platform.integration.manage`. Sin ellos, la app no recibe el canal (la entrega queda pendiente).
- Estado deseado/aplicado: `platform.tenant_trial_delivery` (solo lectura para la consola).
- Envío: job `trial` de la Edge Function `entitlement-sync` (también dentro de `job: "all"`, que
  `pg_cron` dispara cada 5 minutos cuando el entorno tiene los secretos de Vault; sin ellos no corre
  nada, igual que entitlements y lifecycle). Cliente: `supabase/functions/_shared/trial/client.ts`.

**Por entorno** hay que configurar la integración de eChange (no viene en el seed):

```sql
select platform.configure_trial_integration(
  '<id de la integración HTTP_M2M de eChange>',
  '/tenants/{controlPlaneTenantId}/trial',
  'echange:lifecycle:write');
```

con su `deployment_targets.base_url` apuntando a la Edge Function de eChange
(`…/functions/v1/platform-provisioning`).

## 6. Vencimiento en MasterAdmin (no programado)

`platform.apply_due_trial_expirations(p_as_of timestamptz default now(), p_mode text default 'DRY_RUN')`:

- `DRY_RUN` (rol de plataforma): lista las pruebas vencidas no convertidas (`action: WOULD_SUSPEND`,
  o `SKIPPED_NOT_ACTIVE` si el tenant no está activo). No cambia nada.
- `LIVE` (super admin o job del sistema): suspende cada tenant vencido con causa `MANUAL` y
  `detail.source = 'TRIAL_EXPIRED'`; el apagado viaja a la app por `lifecycle.v1` (trigger de
  estado) y la orden de infraestructura queda en simulación, como en el ciclo de vida.
- Extender o convertir una prueba suspendida por vencer la **reactiva** sola; una suspensión por
  otra causa la sigue levantando una persona.

**No está programado**, igual que `apply_due_suspensions`: correrlo en LIVE es decisión del super
admin. Si se decide automatizar:

```sql
select cron.schedule('ebim-trial-expirations', '30 11 * * *',
  $$select platform.apply_due_trial_expirations(now(), 'LIVE')$$);
```

## 7. Tenants TRIAL anteriores a la migración

No se les inventó un vencimiento retroactivo (quedarían vencidos al migrar). Quedan «sin
vencimiento registrado»; la ficha del tenant ofrece «Extender prueba» para fijarlo.
