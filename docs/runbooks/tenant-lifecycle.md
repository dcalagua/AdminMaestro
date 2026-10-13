# Runbook · Ciclo de vida del tenant en la suite

Migraciones `20261020000100_tenant_lifecycle.sql` y `20261020000200_tenant_lifecycle_delivery.sql` · pantalla
**Operación SaaS → Centro de la suite** (`/suite`) · tests `supabase/tests/56_tenant_lifecycle.test.sql` y
`57_tenant_lifecycle_delivery.test.sql` · contrato con las apps
[`LIFECYCLE_CONTRACT.md`](../platform-provisioning/LIFECYCLE_CONTRACT.md).

## 1. Qué hace

```
factura vencida ──(gracia del perfil de cobranza)──▶ fuera de gracia
   │                                                     │
   │                          auto_suspend de la suscripción + corte automático global
   │                                                     ▼
   │                                    tenant SUSPENDED (causa NON_PAYMENT)
   │                                    · entitlement marcado → appActive=false a la app
   │                                    · SUSPEND_TENANT DRY_RUN en la cola de infraestructura
   ▼                                                     │
pago CONFIRMED que salda toda la deuda fuera de gracia ──┘
   └──▶ tenant ACTIVE en el acto (trigger de pagos) · appActive=true · RESUME_TENANT DRY_RUN
```

- **D-07 se resuelve como configuración, no como código.** El corte automático nace **apagado**
  (`tenant_lifecycle_settings.auto_suspend_enabled = false`). Solo el super admin lo enciende, desde
  «Política y jobs», y el cambio queda en auditoría (`TENANT_LIFECYCLE_SETTINGS_CHANGED`).
- Doble llave: además del interruptor global, cada suscripción conserva su `auto_suspend` y su
  `grace_period_days` (perfil de cobranza). Sin `auto_suspend`, la matriz muestra «suspensión sugerida»
  y decide una persona.
- **Solo la suspensión por impago se levanta sola.** Una suspensión manual (consola o
  `request_tenant_suspension`) solo la levanta una persona: un pago no la reactiva.
- Historial: `platform.tenant_suspensions` guarda cada suspensión, su causa y cómo terminó
  (`PAYMENT`, `MANUAL`, `TERMINATED`).

## 2. Cómo llega a cada app

Dos canales, separados por la enmienda D-14:

| Canal | Qué lleva | Efecto en la app |
|---|---|---|
| `entitlements.v1` (snapshot) | `appActive` y capacidades | Solo lo **comercial** (D-14) |
| `lifecycle.v1` (PUT `/tenants/{id}/lifecycle`) | `ACTIVE` / `SUSPENDED` + causa, versionado | **Bloqueo operativo**: escritura bloqueada (`TENANT_SUSPENDED`), lectura disponible, aviso en la UI |

Cada cambio de estado del tenant marca el snapshot (`TENANT_STATUS_<estado>`) y sube la versión deseada en
`platform.tenant_lifecycle_delivery` (solo si el tenant tiene alta ACTIVA en su app). `CHURNED`/`ARCHIVED` viajan
como `SUSPENDED` con causa `TERMINATED`. El job `ebim-entitlement-sync` (cada 5 minutos, `job: "all"`) incluye
`lifecycle`: reclama, hace el PUT y registra; ante `409 STALE_LIFECYCLE` re-emite por encima de lo que tiene la app.

La columna «Entrega a la app» del Centro de la suite muestra primero el canal operativo:

| Indicador | Significado |
|---|---|
| Bloqueo aplicado en la app / Reactivado en la app | la app confirmó la versión deseada |
| Bloqueo / Reactivación pendiente en la app | sin confirmar aún (próximo ciclo o reintento con backoff) |
| Incidente de entrega | la app rechazó (`REJECTED`, `CONFLICT`) o falta configuración: requiere a una persona |
| App sin canal de suspensión | la integración no tiene `lifecycle_path`: **la app sigue operando** |

Sin nada que entregar por `lifecycle.v1` (un tenant que nunca se suspendió), la columna muestra el canal de
entitlements: «Aplicado en la app», «Entregado, en sombra», «Entrega pendiente», «Incidente de entrega» o «Sin canal».

### Habilitar el canal en una integración

Cuando la app ya implementa el contrato (rama `dev` de cada repo), un `EBIM_PRODUCT_ADMIN` lo configura con la
misma base que `entitlements_path`:

```sql
select platform.configure_lifecycle_integration(
  '<product_integration_id>',
  '/tenants/{controlPlaneTenantId}/lifecycle',   -- relativo a base_url, igual que entitlements_path
  '<code>:lifecycle:write', '<code>:lifecycle:read');
```

En la app: las variables de scope lifecycle (ver `docs/platform-provisioning/LIFECYCLE.md` de cada repo). Para
apagar el canal: los tres valores en `null`.

## 3. Jobs programados (pg_cron, en la migración)

| Job | Horario (UTC) | Lima | Hace |
|---|---|---|---|
| `ebim-tenant-lifecycle` | `0 11 * * *` | 06:00 | `run_tenant_lifecycle_cycle()`: alertas, suspensiones, reactivaciones |
| `ebim-entitlement-sync` | `*/5 * * * *` | — | `entitlement-sync` `{"job":"all","limit":20}` |
| `ebim-entitlement-sweep` | `15 5 * * *` | 00:15 | `entitlement-sync` `{"job":"issue","sweep":true}` |
| `ebim-payment-autocharge` | `0 13 * * *` | 08:00 | `payment-autocharge` `{"run":true}` (interruptor **apagado** por defecto) |

Los dos jobs HTTP necesitan los secretos del **entorno** en Vault. Sin ellos, cada ejecución queda
como «Sin configurar» (una vez al día en `lifecycle_job_runs`) y no hace nada:

```sql
-- Una vez por entorno, con la sesión del operador. Los VALORES no se commitean.
select vault.create_secret('https://<project-ref>.supabase.co', 'masteradmin_project_url');
select vault.create_secret('<service_role_key>', 'masteradmin_service_role_key');
```

Comprobar:

```sql
select jobname, schedule, active from cron.job where jobname like 'ebim-%';
select job, outcome, ran_at, detail from platform.lifecycle_job_runs order by ran_at desc limit 20;
```

Pausar un job sin tocar la política: `select cron.alter_job(jobid, active := false) from cron.job where jobname = '<job>';`

## 4. Operación diaria

1. **Centro de la suite → Matriz**: una fila por cuenta y una columna por app; lo más grave, arriba.
2. **Cobranza y cortes**: deuda vencida, gracia y entrega a la app; «Suspender» (con motivo) y «Reactivar».
3. **Simular ciclo**: lista quién cumple la regla de suspensión y quién se reactivaría, sin cambiar nada.
4. **Ejecutar ciclo ahora**: lo mismo que el job de las 06:00 (EBIM_PRODUCT_ADMIN o super admin).

## 5. Habilitar el corte automático (decisión de negocio)

Antes de encender `auto_suspend_enabled` en un entorno:

1. Revisar en «Simular ciclo» la lista de tenants que se suspenderían.
2. Confirmar que cada app afectada está en «Aplicado en la app», o aceptar que en las que están en
   sombra el corte será solo un registro.
3. Confirmar que los perfiles de cobranza tienen la gracia acordada (por defecto 10 días).
4. Encender el interruptor (super admin). El próximo ciclo, o «Ejecutar ciclo ahora», suspende.

Para revertir: apagar el interruptor (no reactiva a nadie) y reactivar desde «Cobranza y cortes».

## 6. Seguridad

- `is_system_job()` reconoce al job (sesión `postgres` sin rol de PostgREST ni JWT) y a la clave de
  servicio. Un usuario `authenticated` nunca lo es.
- Los núcleos `_tenant_status_transition`, `_enqueue_provisioning_core`, `_refresh_billing_alerts_core`,
  `_suspend_tenant_for_nonpayment`, `_resume_tenant_after_payment` e `invoke_scheduled_function` no
  tienen GRANT para nadie: solo los llaman funciones de la base.
- Un fallo al reactivar nunca tumba el registro del cobro: queda auditado (`TENANT_AUTO_RESUME_FAILED`)
  y el ciclo diario lo reintenta.
- La infraestructura sigue en DRY_RUN: el worker rechaza LIVE (`MODO_LIVE_NO_HABILITADO`).
