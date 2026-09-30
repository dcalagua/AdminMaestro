# Fase 09 — Piloto eCommerce (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `eCommerce/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-09-ecommerce.md`.

- Rama eCommerce `feature/ebim-commercial-control-plane-v1` desde `7da2ae4`: `99af03f` · `c93e565` · `b25c65e` · `a431368` · `51e2c31` · `e1ab64f`. Sin push (regla eCommerce).
- FIX-ENT-v1 consumido sin cambios (`FIX_ENT_V1_SHA256` fijado); no hizo falta v1.1.
- Criterio de éxito: deseado → apply → gate servidor → GET misma versión/checksum → replay idempotente → stale/conflicto rechazados: PASS en el receptor real (piloto 11/11, fixtures dorados 13/13) y cruzado con el código real de MasterAdmin.
- X-07: `scripts/ccp/ecommerce-pilot-e2e.mts` — `buildSnapshot` + `EntitlementSyncClient` (JWT ES256 con clave en memoria, scopes de entitlements, url-guard) contra `handleEntitlementsRequest` de eCommerce sobre node:http + PGlite con todas sus migraciones: 15/15 (`logs/EC9-07-x07-e2e.txt`). Incluye manifiesto (26 códigos ACTIVE), scope de provisioning → 403, SaaS caído → RETRYABLE con last-good intacto, deriva detectada por GET y cerrada con el push. No ejercita `entitlement_sync_state` (stack API de MasterAdmin no levantado; cubierto por el E2E de la fase 08).
- Ejecutar: `ECOMMERCE_WT=<worktree eCommerce> node --experimental-transform-types scripts/ccp/ecommerce-pilot-e2e.mts` (necesita poder abrir un puerto en 127.0.0.1).
