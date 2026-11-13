# Runbook · Sincronización de tenants con las apps

Migración `20261021000100_tenant_sync.sql` · Edge Function `tenant-sync` · pantalla **Apps → Sincronización con las
apps** (`/apps?tab=sincronizacion-apps`) · tests `supabase/tests/58_tenant_sync.test.sql`,
`supabase/functions/tenant-sync/core.test.ts`, `supabase/functions/_shared/sync/readers.test.ts` · contrato nuevo
[`TENANT_INVENTORY_CONTRACT.md`](../platform-provisioning/TENANT_INVENTORY_CONTRACT.md).

## 1. Qué hace

Una vez al día (05:30 Lima) y con «Sincronizar ahora», la función recorre los destinos activos con integración
(habilitados o con vínculos vivos) y **solo lee** en cada app:

| Comprobación | Cómo | Disponible hoy |
|---|---|---|
| ¿Existe cada tenant vinculado? | `GET_STATUS` del adaptador si la integración lo declara; si no, `GET /tenants/{id}/lifecycle` (404 `TENANT_NOT_PROVISIONED` = no existe) | EWM (GET_STATUS) y las apps con `lifecycle_path` configurado |
| ¿Está en el mismo estado? | `GET /tenants/{id}/lifecycle` frente al estado del tenant en MasterAdmin (ACTIVE → ACTIVE; SUSPENDED/CHURNED/ARCHIVED → SUSPENDED). Con una entrega lifecycle pendiente no es hallazgo | apps con `lifecycle_path` |
| ¿Tiene clientes que MasterAdmin no conoce? | `GET /tenants` del contrato `tenant-inventory.v1` | **ninguna** (las apps deben implementarlo) |

La base decide y deduplica los hallazgos (`tenant_sync_findings`), y cierra sola (`NO_LONGER_DETECTED`) lo que la
corrida comprobó que ya no ocurre. Un inventario incompleto o un vínculo sin verificar no cierran nada.

## 2. Hallazgos y acciones

| Hallazgo | Acción en la consola |
|---|---|
| Vínculo roto (el tenant ya no existe en la app) | Revisar en la app; «Marcar como resuelto» con motivo, o «Descartar» |
| Estado distinto (p. ej. suspendido en la app, activo aquí) | Revisar la entrega de suspensión; marcar resuelto o descartar |
| Existe solo en la app | **Registrar en el Admin Maestro** (cuenta nueva o existente, o vincular un tenant sin alta) o **Descartar** (demo, smoke, interno) |

«Registrar» ejecuta en una transacción `upsert_organization` → `create_tenant` → `create_saas_provisioning_request`
→ `register_manual_provisioning` y deja el tenant ACTIVE si la app lo reporta activo. **No llama a la app.**

Permisos: super admin o `EBIM_PRODUCT_ADMIN` (`can_manage_tenant_sync()`); además, registrar exige los permisos
de las RPC reutilizadas (`platform.provisioning.execute` del producto). RLS: solo ellos leen corridas y hallazgos.

## 3. Despliegue (QAS y luego PRD; nada de esto se hace desde la rama)

1. Aplicar la migración por el flujo normal (merge a `qas` → integración de Supabase). Es idempotente.
2. Desplegar la función: `supabase functions deploy tenant-sync` (la integración de GitHub lo hace al mergear `qas`).
3. Secretos de la función: los mismos que ya usan `entitlement-sync`/orquestador (claves M2M por `secret_ref`,
   `MASTERADMIN_ALLOWED_ORIGINS`). No hay secretos nuevos.
4. El job `ebim-tenant-sync` queda programado por la migración. Sin los secretos de Vault del entorno
   (`masteradmin_project_url`, `masteradmin_service_role_key`, los mismos del ciclo de vida) cada disparo queda
   como `SKIPPED_NOT_CONFIGURED` en `lifecycle_job_runs`.
5. Primera corrida: «Sincronizar ahora». Con el inventario aún sin implementar, esperar solo hallazgos de vínculo
   roto o estado distinto en las apps con `GET_STATUS` o `lifecycle_path`.

## 4. Operación

```sql
-- Últimas corridas y resultado por app
select * from platform.v_tenant_sync_runs order by started_at desc limit 10;
select product_code, deployment_code, last_outcome, last_error_code, last_links_broken,
       last_inventory_status from platform.v_tenant_sync_targets order by product_sort_order;

-- Apagar / encender el job diario (solo super admin; queda en auditoría)
select platform.set_tenant_sync_enabled(false);
```

| Síntoma | Causa probable |
|---|---|
| Fila de la app «No se pudo revisar» con `DEPLOYMENT_WITHOUT_URL` | destino habilitado sin `base_url` (p. ej. `ewm-shared-dev`): deshabilitarlo o completarlo |
| `CREDENTIAL_NOT_USABLE` / `SECRET_NOT_AVAILABLE` | perfil de credencial apagado o secreto de firma no cargado en la función |
| `SINCRONIZACION_EN_CURSO` al pulsar «Sincronizar ahora» | ya hay una corrida; una corrida colgada se marca `INTERRUMPIDA` a los 30 min |
| «Sin forma de comprobar» | la integración no declara `GET_STATUS` ni `lifecycle_path` ni inventario |
