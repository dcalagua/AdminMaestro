# Fase 15 — eExpense: migración comercial (resumen en MasterAdmin)

Evidencia completa en el repo SaaS: `eExpenses/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-15-eexpense.md`
(+ `eexpense-parity-report.md`, `docs/platform-provisioning/ENTITLEMENTS.md`, `docs/runbooks/ccp-rollback/15-eexpense.sql`).

- Solo LOCAL. Sin push, sin QAS, nada contra `uvjmdphlnpyhtohobvzx` (P-05). Base desechable `eexpense-ccp` (DB 55822).
- Commits eExpense (sobre `090645e`, fase 04): `d1d2be7` · `efa9331` · `c021fb2` · `84c6b46` · `a5ae423` · `0c4e9b1` · `0bccc49` · `5f3ebc4` · `444cfe2`.
- MasterAdmin: `scripts/ccp/eexpense-x07-e2e.mts` + `logs/EX15-07-x07-e2e.txt` + esta página + ledger.

## Criterio de éxito

| Prueba | Resultado |
| --- | --- |
| FIX-ENT-v1 pin (`7aab413a…f65d5`) + 11 vectores JCS + checksums de los 13 fixtures | PASS |
| Golden: 13 fixtures por handler + store + RPC reales (service_role real) + jti reutilizado | 14/14 |
| X-07: `buildSnapshot` + `EntitlementSyncClient` reales → receptor eExpense real (node:http) → base real | 29/29 |
| SQL de la fase (receptor 47, puerta 36, outbox 17, paridad 15, facturación 28) + fase 04 57 + provisioning protegido 44 | 244/244 |

X-07 cubre: alta real por `platform_provision_tenant`; manifiesto (8 vendibles + 3 incluidos ACTIVE; DRAFT fuera);
snapshot con 8 vendibles explícitas, sin DRAFT/baseline ni precios; SHADOW guarda y registra la diferencia sin
cambiar la decisión; paridad en rojo (ADDON_ONLY_LOCAL) con reporte sin precios; **billing SHADOW** calcula y
guarda la corrida sin factura ni pasarela; MASTERADMIN_AUTHORITY **bloqueado por la base** sin paridad;
DUAL_READ→PRIMARY; GET misma versión/checksum; PRIMARY niega lo que `tenant_addons` sí tiene; **función IA negada
→ 403 sin llamar al proveedor**; v2 concede; función IA permitida → un evento en el outbox (tokens reales,
`billable=false`, sin contenido); replay → REPLAYED; stale/conflict → 409; scope de provisioning → 403; escritura
legacy bloqueada en PRIMARY; paridad verde + corrida SHADOW verde → **MASTERADMIN_AUTHORITY** y el biller local ya
no factura ni cobra (nunca dos cobradores) → rollback a LEGACY_AUTHORITY; SaaS caído → RETRYABLE; GET delata
deriva; offline → la puerta sigue con el last-good; `appActive=false` retira todo; rollback a SHADOW. Pasarelas:
solo fakes que cuentan (0 llamadas).

## Registro para MasterAdmin (import_capability_manifest)

`eexpense` manifiesto `2026-10-08.1` (TENANT): ACTIVE AI_FEATURE `eexpense.{ai_analytics,ai_copilot,ai_close,
fraud_vision,policy_nlp}`; ACTIVE FEATURE `eexpense.{card_reconcile,whatsapp_bot,white_label}`; baseline
`eexpense.{ai_capture,ai_auditor,cfo_insights}`; DRAFT: 13 módulos solo-UI, `eexpense.users.max` (LIMIT, D-05),
`eexpense.ai.credits` (ALLOWANCE, D-03). Alias `LOCAL_ADDON` 1:1 (`addons.code`) en `ENTITLEMENTS_ALIASES.json`.

## Operador tras GATE C (+ P-05 para eExpense)

- SQL revisado de las 5 migraciones `20261008*` + `migration repair` ANTES de las funciones (nunca `db push`).
- Funciones: `platform-provisioning`, 9 IA, `billing-run`, `billing-charge`.
- Variables `EBIM_MASTERADMIN_M2M_ENTITLEMENTS_{WRITE,READ}_SCOPE`, `EBIM_ENTITLEMENTS_ENVIRONMENT`; columnas
  entitlements de la integración eExpense en MasterAdmin.
- Adoptar tenants pre-MasterAdmin (CMH) antes de cualquier cutover; modos y autoridad de facturación solo con D-14.
- Push (eExpense: solo con orden explícita): `git -C <eExpenses> push origin feature/ebim-commercial-control-plane-v1`.
