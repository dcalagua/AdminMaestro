# Fase 13 — eSupplier rollout (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `eSupplier/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-13-esupplier.md`
(+ `docs/platform-provisioning/ENTITLEMENTS.md`, `docs/runbooks/ccp-rollback/13-esupplier.sql`).

- Solo LOCAL. Sin push (eSupplier: la rama del programa no es `dev`), sin QAS, nada remoto.
- Commits eSupplier (sobre `e942be5`, fase 06): `241a189` · `ebc8852` · `bb4a02b` · `28b6812` · `4d595e8` · `d078ddb` · `04b6f71` · `fdcf0b3`.
- MasterAdmin: `scripts/ccp/esupplier-x07-e2e.mts` + `logs/SU13-X07-esupplier-e2e.txt` + esta página + ledger.

## Criterio de éxito del receptor

| Prueba | Resultado |
| --- | --- |
| FIX-ENT-v1 pin (`FIX_ENT_V1_SHA256 = 7aab413a…f65d5`) + 11 vectores JCS + checksums de los 13 fixtures | PASS |
| FIX-ENT-v1 golden: 13 fixtures por el handler + store + RPC reales (service_role real, base desechable) + jti reutilizado | 14/14 |
| X-07: emisor `buildSnapshot` + `EntitlementSyncClient` reales → receptor eSupplier real (node:http) → gate/outbox en la misma base | 18/18 |
| SQL CCP (fase 06 intacta + receptor + gate por modo + outbox) | 159/159 |

X-07 cubre: manifiesto (11 ACTIVE: 9 IA de pago + 2 incluidos; mesa eChange, límites y créditos DRAFT); v1 sin
concesiones en PRIMARY (legacy supplier_risk sustituido, incluidos intactos); v2 concede dorothy + tender (gate y
barrido programado lo ven); replay → REPLAYED; stale → 409; conflict → 409; scope de provisioning → 403; escritura
legacy bloqueada en PRIMARY; SaaS caído → RETRYABLE; GET delata deriva; offline con el receptor cerrado → el gate
sigue con el last-good; uso IA en el outbox con controlPlaneTenantId, `billable=false`, PENDING; `appActive=false`
retira lo de pago y conserva los incluidos.

## Registro para MasterAdmin (import_capability_manifest)

`esupplier` manifiesto `2026-10-06.1`: `esupplier.ai.{commercial_discovery, contracts, dorothy_copilot, invoice_3way,
invoice_validator, subsanacion, supplier_portfolio, supplier_risk, tender_copilot}` AI_FEATURE ACTIVE;
`esupplier.ai.{auditor, capture}` FEATURE baseline ACTIVE; `esupplier.echange_desk` FEATURE DRAFT;
`esupplier.{companies,users}.max` LIMIT DRAFT; `esupplier.ai.credits` ALLOWANCE DRAFT (`ai.credits`). Alias del hub
(`GMAO_HUB`, snake_case → canónico) en `ENTITLEMENTS_ALIASES.json` (el schema v1 del manifiesto no admite `aliases`);
importarlos en la fase 16.

## Drift y abiertos

Ver la evidencia del SaaS (§ Drift): cadena no reproducible desde cero, historial reparado a mano
(`repair_migrations.ps1`), 63 scripts manuales fuera de `supabase/migrations`, duplicado `20260811120000`, borradores
sin timestamp y un cron del barrido que envía service_role mientras la función exige HMAC. Consecuencia: nunca
`db push`; SQL revisado + `migration repair` por el operador tras GATE C.
