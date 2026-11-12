# Fase 16 — Migración del hub GMAO (resumen para el programa)

Evidencia completa en el repo SaaS: `GMAO/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-16.md`.

- Rama `feature/ebim-commercial-control-plane-v1`, base `39e5889` (la cabeza de la fase 05).
- Sin push, sin QAS. Nada aplicado en `xikbhkfeaosasdltartg`. Nada retirado.

**Máquina de estados** (en la base, por producto, eje y tenant):

`LEGACY_AUTHORITY → DUAL_READ → SHADOW → MASTERADMIN_AUTHORITY → READONLY → RETIRED`

- Guardas de paridad para llegar a MASTERADMIN_AUTHORITY.
- RETIRED exige aprobación humana y un ciclo cerrado.

**Estado al cerrar:**
- gmao ENTITLEMENTS = DUAL_READ.
- gmao BILLING = LEGACY_AUTHORITY.
- `hub:*` = LEGACY_AUTHORITY.

| Lado | Commit | Contenido |
| --- | --- | --- |
| GMAO | `e5686d4`, `124a3ab` | Receptor FIX-ENT-v1 (TS) + rutas PUT/GET/manifest (`index.ts` +29/−1) |
| GMAO | `01223d8` | 5 migraciones: autoridad, receptor + paridad, puerta IA y escrituras legacy, guarda de cobro, export y congelamiento del hub |
| GMAO | `5f0930d`, `a1a1035` | `charge` (autoridad antes de la pasarela + sombra), pre-chequeo en `platform-register`, `X-EBIM-Service` en tiempo constante, función `hub-commercial-export` |
| GMAO | `eb3476a`, `b19dc4d` | Rollback `16.sql` + dry-run, checklist de retiro, evidencia |
| MasterAdmin | `b2d62db`, `f604866` | `_shared/entitlements/hub/{hub-export,hub-mapping,hub-parity}.ts` + `scripts/ccp/gmao-hub-import-dryrun.mts` |
| MasterAdmin | (este) | `scripts/ccp/gmao-x07-e2e.mts` + corrección del test del dry-run (URL sintética sin userinfo) |

## Gate

**GMAO:**
- deno 32 + 58 + 19 + 9 + 9 + 8
- SQL 61 · provisioning 20 · ccp05 40 (+40 con la fase 16) · ccp16 48
- INV-1 vacío · INV-4 sin precios de catálogo
- secret scan PASS

**MasterAdmin:**
- vitest 1123/1123 (70 archivos) · hub 82
- node:test 15/15
- typecheck, eslint y secrets:scan PASS

**E2E:** X-07 MasterAdmin → GMAO 30/30 (`logs/GM16-07-x07-e2e.txt`).
