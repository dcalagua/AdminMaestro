# Fase 10 — EWM (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `IACLAUDE/WMS-by-EBIM/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-10-ewm.md` (+ `docs/platform-provisioning/ENTITLEMENTS.md`).

- Rama EWM `feature/ebim-commercial-control-plane-v1` desde `7c086e8`: `c6ba318` · `9aeaffb` · `ed48657` · `9044930` · `6751192` · `122cffa` · `5150836` · `86cb148`. Sin push (EWM: autorización de Dennis por lote).
- FIX-ENT-v1 consumido sin cambios (`FIX_ENT_V1_SHA256` fijado; JCS Java propio, P-04); no hizo falta v1.1.
- Registro: 7 agentes vendibles `ewm.ai.{copilot,cycle_count,slotting,anomaly,erp_reconcile,replenishment,wave_optimizer}` (alias 1:1 a `ai_agents.code`), `ewm.ai.capture` baseline DRAFT; scope COMPANY; sin LIMIT/ALLOWANCE (ninguna dimensión comercial confirmada, D-05). Manifiesto `2026-09-28.1`.
- Integración en MasterAdmin: `adapter_key=EWM_V1`, `integration_type=HTTP_M2M`, `entitlements_path=/tenants/{controlPlaneTenantId}/entitlements`, `entitlements_manifest_path=/entitlements/manifest`, scopes `ewm:entitlements:write|read`.
- X-07: `scripts/ccp/ewm-x07-e2e.mts` — `buildSnapshot` + `EntitlementSyncClient` reales contra la cadena M2M y el receptor reales de EWM (JVM, `MasterAdminMailboxBridgeTest`) por un buzón de archivos (el sandbox no permite abrir puertos): **19/19** (`logs/EW10-07-x07-e2e.txt`).
- Ejecutar: `EWM_WT=<worktree EWM> JAVA_HOME=<JDK 21> node --experimental-transform-types scripts/ccp/ewm-x07-e2e.mts` (necesita `~/.m2` con mockito-core 5.17.0; Maven offline).
