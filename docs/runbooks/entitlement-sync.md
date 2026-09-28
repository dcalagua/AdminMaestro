# Runbook — sincronización de entitlements (`entitlement-sync`)

Fase 08 del Commercial Control Plane. Spec §8–§9, §15, §18. Contrato: `contracts/entitlements/v1/README.md`.

> **Alcance del programa:** solo LOCAL/DEV hasta GATE C. Nada de este runbook se ejecuta contra QAS sin
> `PROMOTE_COMMERCIAL_CONTROL_PLANE_TO_QAS=YES`, y **nunca** contra PRD en este programa.

## 1. Piezas

| Pieza | Qué hace |
| --- | --- |
| `platform.issue_entitlement_snapshot` | Emite la versión N+1 si el contenido cambió (advisory lock por tenant×producto) |
| `platform.entitlement_sync_state` | Deseado frente a aplicado; 13 estados (spec §9) |
| Edge `entitlement-sync` | Jobs `issue` · `push` · `verify` · `registry-verify` · `all` (solo canal servidor) |
| Orquestador `SYNC_ENTITLEMENTS` / `GET_ENTITLEMENTS` | "Sincronizar ahora" / "verificar ahora" desde la consola |
| `product_integrations.entitlements_*` | Ruta, manifiesto y scopes del contrato; kill-switch `entitlements_push_enabled` |
| `product_integrations.cutover_state_entitlements` | Eje §15.1; por tenant se puede fijar `entitlement_sync_state.cohort_state` |

## 2. Enrolar una integración (consola o SQL con sesión humana)

1. El SaaS tiene desplegado el receptor (fases 09–16) y su manifiesto importado (`import_capability_manifest`).
2. `platform.configure_entitlements_integration(integración, '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest', '<product>:entitlements:write', '<product>:entitlements:read')` — `platform.integration.manage`. El scope de escritura no puede coincidir con los de provisioning.
3. `platform.set_commercial_cutover_state(integración, 'ENTITLEMENTS', 'SHADOW', '<motivo>')`. Los tenants pasan de `NOT_ENROLLED` a `PENDING_PUSH`.
4. `platform.set_entitlements_push_enabled(integración, true, '<motivo>')`. Hasta este paso **nada** se empuja.
5. Avanzar a `DUAL_READ` / `MASTERADMIN_PRIMARY` exige la cohorte `IN_SYNC` (verificado por GET). `LEGACY_RETIRED` no se alcanza en este programa.

## 3. Programar los jobs (operador, por entorno)

La programación **no** va en migraciones: la URL del proyecto y la clave de servicio son del entorno. Patrón de Supabase (pg_cron + pg_net, secretos en Vault):

```sql
-- Una vez por entorno. Los VALORES los carga el operador; no se commitean.
select vault.create_secret('<project_url>', 'ccp_project_url');
select vault.create_secret('<service_role_key>', 'ccp_entitlement_sync_key');

select cron.schedule('ccp-entitlement-sync', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ccp_project_url') || '/functions/v1/entitlement-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ccp_entitlement_sync_key'),
      'x-provisioning-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ccp_entitlement_sync_key')),
    body := '{"job":"all","limit":20}'::jsonb,
    timeout_milliseconds := 30000);
$$);

-- Barrido diario: cambios por paso del tiempo (grants que entran en vigor, bajas programadas, cambio de mes).
select cron.schedule('ccp-entitlement-sweep', '15 0 * * *', $$ …mismo http_post con body '{"job":"issue","sweep":true,"limit":100}' $$);
```

Las claves privadas M2M de cada integración se cargan como secretos de la Edge Function con el **nombre** de `credential_profiles.secret_ref` (`supabase secrets set` lo ejecuta el operador del entorno; en LOCAL, variables del proceso de `functions serve`).

## 4. Operación

- Estado: `select * from platform.v_entitlement_sync_status` (consola: Comercial → Sincronización).
- Bitácora: `platform.entitlement_sync_attempts` (solo códigos, estados HTTP y versiones).
- Solo el GET produce `IN_SYNC`; la respuesta del PUT deja `AWAITING_VERIFY`.

| Estado | Acción |
| --- | --- |
| `UNREACHABLE` | Se reintenta sola cada hora. Revisar salud del destino |
| `REJECTED` | Revisar `state_reason` (scope, ambiente, checksum, tenant no aprovisionado). Corregir y "Sincronizar ahora" |
| `DRIFT_CHECKSUM` | **Incidente.** No se sobrescribe: investigar y emitir una versión nueva (cualquier cambio comercial o un override auditado) |
| `DRIFT_AHEAD` | **Incidente.** El SaaS tiene una versión mayor que la deseada. No hay push automático |
| `REGISTRY_DRIFT` | Manifiesto ≠ registro. Importar el manifiesto o corregir el SaaS; al resolverse vuelve a `AWAITING_VERIFY` |

## 5. Rollback (spec §18)

1. **Kill-switch:** `set_entitlements_push_enabled(integración, false, '<motivo>')` — lo pueden operar finanzas o el product admin.
2. **Eje un paso atrás:** `set_commercial_cutover_state(…, 'ENTITLEMENTS', '<estado anterior>', '<motivo>')`; el SaaS vuelve a su fuente legacy según su `enforcementMode`.
3. **Versión correctora:** nunca se edita un snapshot (append-only); se emite uno nuevo.
4. **Esquema:** `docs/runbooks/ccp-rollback/08.sql` revoca EXECUTE de las RPCs nuevas y apaga todos los kill-switch. Los datos no se borran.
