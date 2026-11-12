# Fase 11 — Comerza (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `comerza/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-11-comerza.md` (+ `docs/platform-provisioning/ENTITLEMENTS.md`).

- Rama Comerza `feature/ebim-commercial-control-plane-v1` desde `2c49725`: `e56e79c` · `ac54c31` · `e6bad15` · `9c1dedd` · `a4c167d` · `c9a7bd9`. Sin push (Comerza: solo con orden de Dennis).
- FIX-ENT-v1 consumido sin cambios (`FIX_ENT_V1_SHA256` fijado); no hizo falta v1.1. Los 13 fixtures pasan por el manejador HTTP real contra las RPC reales (paso 13 de `npm run test:db`).
- Registro (manifiesto `2026-10-03.1`, `scopeLevel: TENANT`): `comerza.ai.whatsapp_agent` ACTIVE (AI_FEATURE); `comerza.storefront` (Vitrina) y `comerza.erp_connector` DRAFT (módulos inexistentes, D-15). Sin LIMIT/ALLOWANCE (D-03/D-05). Al importar, MasterAdmin solo emite el agente.
- Integración esperada en MasterAdmin (tras GATE C): `entitlements_path=/tenants/{controlPlaneTenantId}/entitlements`, `entitlements_manifest_path=/entitlements/manifest`, scopes `comerza:entitlements:write|read`, audiencia `comerza.ebim`.
- X-07: `scripts/ccp/comerza-x07-e2e.mts` — `buildSnapshot` + `EntitlementSyncClient` reales contra el receptor real de Comerza (node:http) y su base de trabajo con todas las migraciones, rol service_role real: **17/17** (`logs/CZ11-07-x07-e2e.txt`). La primera corrida dio 16/17 por `PROVIDER_TIMEOUT` (30 s) en el paso stale: latencia de `docker exec` con Docker cargado, no del receptor (`logs/CZ11-07-x07-e2e-run1-timeout.txt`); timeout local subido a 180 s y todo el escenario repetido desde cero.
- Ejecutar: `COMERZA_WT=<worktree Comerza> COMERZA_DB_CONTAINER=<contenedor> COMERZA_SCRATCH_DB=<base de trabajo de db-rebuild-check --keep> node --experimental-transform-types scripts/ccp/comerza-x07-e2e.mts` (fuera del sandbox: Docker y puerto local).
