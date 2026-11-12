# Fase 12 — TMS (resumen en MasterAdmin)

La evidencia completa está en el repo SaaS: `TMS/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-12-tms.md`. Ver también `docs/platform-provisioning/ENTITLEMENTS.md` y `docs/architecture/ADR-017-commercial-entitlements.md`.

- **Rama TMS:** `feature/ebim-commercial-control-plane-v1` desde `692ff4f`, con los commits `da4dcdd` · `1f44050` · `7f14b9d` · `a92e1da` · `f009380` · `9397ff5` (evidencia). Sin push: TMS exige una orden humana explícita.
- **FIX-ENT-v1:** se consume sin cambios (`FIX_ENT_V1_SHA256` fijado) y no hizo falta v1.1. Los 13 fixtures corren contra los servicios reales de TMS.
- **Registro:** vacío. El manifiesto `2026-09-28.1` declara sólo el baseline `tms.core` (`isBaseline: true`, TENANT).
  - Al importarlo, MasterAdmin no tiene nada vendible que emitir para TMS: el snapshot lleva `appActive` y listas vacías.
  - Ningún permiso RBAC de TMS se convirtió en capacidad pagada.
  - No hay LIMIT ni ALLOWANCE (D-05) ni medidores, así que la fase 17 no aplica a TMS salvo que D-06 diga lo contrario.
- **Enforcement en TMS:** sólo `appActive`, con los modos DUAL_READ/PRIMARY. En esos modos se suspende el acceso operativo de la organización:
  - responde `403 commercial-access-suspended`, tanto a personas como a credenciales de partner;
  - no borra datos y `/me` queda libre.
  - Esto difiere del criterio de EWM (fase 10); hay que unificarlo antes de PRIMARY (fase 18).
- **Integración esperada en MasterAdmin** (tras GATE C): `entitlements_path=/tenants/{controlPlaneTenantId}/entitlements` y `entitlements_manifest_path=/entitlements/manifest`, sobre la base `…/internal/platform-provisioning`.
  - Scopes `tms:entitlements:write|read`, audiencia `tms.ebim`.
  - El sujeto es el mismo que en provisioning (`masteradmin-provisioning`).
- **X-07:** `scripts/ccp/tms-x07-e2e.mts` usa `buildSnapshot` + `EntitlementSyncClient` reales contra la cadena M2M real de TMS, el controlador y los servicios, dentro de su JVM (`MasterAdminMailboxBridgeTest`), con un buzón de archivos y sin socket. Resultado **18/18** (`logs/TM12-07-x07-e2e.txt`).
- **Cómo se ejecuta:** `TMS_WT=<worktree TMS> JAVA_HOME=<JDK 21> node --experimental-transform-types scripts/ccp/tms-x07-e2e.mts`. Corre dentro del sandbox: no usa red ni Docker.
- **Gate TMS:** `./mvnw -o -B clean test` 1831 → 1904/0/0 en el sandbox; suite completa con PostgreSQL 17 + PostGIS desechable (`TMS_TEST_DB_URL`) **2103/0/0**, 1 skipped (el puente X-07 opt-in). El contenedor `tms_ccp12_pg` se eliminó al cerrar.
