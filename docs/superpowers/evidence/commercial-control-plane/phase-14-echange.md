# Fase 14 — eChange rollout (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `eChange/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-14-echange.md`
(+ `echange-parity.md`, `echange-parity-report.md`, `docs/platform-provisioning/ENTITLEMENTS.md`, `docs/runbooks/ccp-rollback/14-echange.sql`).

- Solo LOCAL. Sin push, sin QAS, nada remoto. Base desechable `echange-ccp14` (Docker, puertos 5592x).
- Commits eChange (sobre `ad3133b`, fase 06): `a8040d4` · `e07f0b2` · `23a90a5` · `9123942` · `1035875` · `cf0bf97` · `90d932d` · `741a994`.
- MasterAdmin: `scripts/ccp/echange-x07-e2e.mts` + `logs/EC14-07-x07-e2e.txt` + esta página + ledger.

## Criterio de éxito del receptor

| Prueba | Resultado |
| --- | --- |
| FIX-ENT-v1 pin (`7aab413a…f65d5`) + 11 vectores JCS + checksums de los 13 fixtures | PASS |
| Golden: 13 fixtures por handler + store + RPC reales (service_role real) + jti reutilizado | 14/14 |
| X-07: `buildSnapshot` + `EntitlementSyncClient` reales → receptor eChange real (node:http) → base real | 24/24 |
| SQL CCP de la fase (receptor 74, puerta 34, uso 30, paridad 18) | 156/156 |

X-07 cubre: alta real por `platform_provision_tenant`; manifiesto (6 vendibles + 7 incluidos ACTIVE; DRAFT
fuera); snapshot sin DRAFT/baseline ni precios; SHADOW guarda y compara sin tocar filas; DUAL_READ→PRIMARY
materializa (WhatsApp legacy revocado, incluidos intactos); v2 concede WhatsApp + reportería; replay →
REPLAYED; stale → 409; conflict → 409; scope de provisioning → 403; escritura legacy bloqueada en PRIMARY;
**dual-read en paridad** tras materializar; SaaS caído → RETRYABLE; GET delata deriva; offline → la puerta
sigue con el last-good; caso nuevo y llamada IA en el outbox (controlPlaneTenantId, `billable=false`);
`appActive=false` retira lo de pago y conserva lo operativo; rollback a SHADOW restaura lo legacy exacto.

## Registro para MasterAdmin (import_capability_manifest)

`echange` manifiesto `2026-10-07.1` (TENANT): `echange.ai.{report_writer,voice_transcriber}` AI_FEATURE ACTIVE;
`echange.channels.{whatsapp,phone,email,esupplier}` FEATURE ACTIVE; baseline `echange.ai.{triage,deflector,
intake_assistant,adoption_analyst,survey_sentiment}`, `echange.channels.{portal,teams}`; DRAFT
`echange.ai.{asset_clerk,email_intake}`, `echange.service_line`, `echange.cases.included` (ALLOWANCE, meter
`echange.cases`). Alias locales (`ECHANGE_AI_AGENT` / `ECHANGE_CHANNEL`) en `ENTITLEMENTS_ALIASES.json`.
`service_rates` (tarifa del proveedor a su cliente) fuera de alcance.

## Dual-read comercial

`echange_modelo_comercial_local` (sin precios) + `commercialParity.ts` → diferencias tipadas
(`LOCAL_ONLY`, `MASTERADMIN_ONLY`, `BILLED_NOT_ENTITLED`, `SOLD_BUT_LOCALLY_INCLUDED`, `LOCAL_ONLY_DRAFT`,
`ALLOWANCE_MISMATCH`, `OVERAGE_POLICY_MISMATCH`, `NO_SNAPSHOT`). El pricing local de eChange no se retira;
los criterios (un ciclo sin diferencias, IN_SYNC, D-01/D-05/D-06, contrato v1.1 para excedente facturable,
DUAL_READ sin caídas, BILLING_SHADOW conciliado, D-14) están en `echange-parity.md`.
