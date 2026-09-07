# STATE V2 - EBIM Control Plane

**Estado:** IN_PROGRESS · última actualización 2026-09-07
**Baseline VERIFICADO en Fase 01:** 13 migraciones, 39 tablas, 7 vistas, 26 enums, 42 funciones en `platform`. DB local reconstruible; 52 tests pgTAP PASS.

| Fase | Estado | Evidencia / siguiente acción |
|---|---|---|
| 01 Audit | **PASS** | `docs/nightly-v2/AUDIT_BASELINE.md` + `GAP_MATRIX.md`. db:reset PASS, db:test 52 PASS, typecheck/lint/test/build PASS tras corregir R-01 y R-02. |
| 02 CRUD Admin | **PASS** | `20260907000100_admin_write_rpcs.sql` (25 RPCs SECURITY DEFINER auditadas) + `src/services/mutations.ts` + diálogos en 9 páginas. Autorización negativa verificada en DB (partner admin y anon -> 42501). Corregido R-03: `.js` emitidos en `src/` congelaban el bundle. |
| 03 Suite | **PASS** | `ProductDetailPage` con 6 tabs (Resumen/Planes/Partners/Tenants/Finanzas/Deployments) + alta/edición/archivado de producto y planes desde UI. Gate verificado: sexto producto `efield` creado extremo a extremo solo con RPCs, sin código ni migración nueva. |
| 04 Partners | **PASS** | `20260907000200_channel_agreements_v2.sql`: acuerdo con `allowed_deployment_modes`, `allowed_tenant_types`, `billing_responsibility`, `max_tenants` + trigger `enforce_agreement_scope` + vista `v_partner_agreements` (security_invoker) + `AgreementFormDialog`. |
| 05 Tenants/Licensing | **PASS** | `20260907000300_onboarding_rpc.sql`: `onboard_customer_subscription()` atómica + `current_plan_price()` + wizard `/onboarding` de 5 pasos. Verificado: MRR 850 con implementación 1500 ONE_TIME fuera del MRR; 0 tenant_memberships; DEMO sin recurrente; fallo de correo operador no deja tenant huérfano. |
| 06 Dedicated | **PASS** | `request_tenant_suspension` / `request_tenant_resume` (estado + cola en una transacción) + acciones en TenantDetailPage + alta/edición de targets y adjuntar tenant (Fase 02). Aislamiento verificado en DB. |
| 07 Collection | **PASS** | `20260907000400_collection_profiles.sql`: enums `collection_method`/`provider_kind`/`collection_profile_status`/`provider_environment`, tablas `payment_provider_accounts` y `subscription_collection_profiles` (RLS+FORCE), guard cross-org, vista `v_subscription_collection` y RPCs. UI: pestaña Cobranza en `/subscriptions/:id`. |
| 08 OS/OC | **PASS** | `20260907000500_commercial_documents.sql`: `subscription_commercial_documents` con máquina de estados REQUESTED->RECEIVED->APPROVED/REJECTED/EXPIRED/CANCELLED, 5 RPCs, `expire_commercial_documents` idempotente y vista `v_subscription_documents`. Verificado que aprobar NO crea payment ni comisión. |
| 09 Culqi Architecture | **PASS** | `docs/payments/CULQI_ARCHITECTURE.md` con diagramas Mermaid, mapeo local<->Culqi, llaves, idempotencia, reconciliación, fallos y checklist de activación PRD. Fuentes: solo documentación oficial, consultada el 2026-09-07 y citada con lo verificado y lo NO verificado. |
| 10 Culqi Implementation | **PASS** (MOCK/TEST) | `20260907000600_payment_provider_mappings.sql` (5 tablas + `register_provider_payment` idempotente + vista de reconciliación) · adapter en `supabase/functions/_shared/payments/` (types/culqi/mock/index) · Edge Functions `payment-setup`, `culqi-webhook` (verify_jwt=false), `payment-reconcile` · panel Culqi en la UI. **BLOQUEO EXTERNO:** sin credenciales Culqi, opera en MOCK. |
| 11 Renewals | NOT_STARTED | |
| 12 Commissions | NOT_STARTED | |
| 13 Finance | NOT_STARTED | |
| 14 UI | NOT_STARTED | |
| 15 Seed | NOT_STARTED | |
| 16 Security/DB tests | NOT_STARTED | |
| 17 E2E | NOT_STARTED | |
| 18 Docs | NOT_STARTED | |
| 98 Final Audit | NOT_STARTED | |

## Última migración V2
Ninguna todavía (Fase 01 no toca DB).

## Bloqueos externos
- **BE-02** Sin credenciales Culqi (`pk_test_`, `CULQI_SECRET_KEY`, `CULQI_API_BASE`). El adapter opera en modo MOCK determinista y la UI lo declara. El PRD de Culqi NO está validado. Checklist de activación en `docs/payments/CULQI_ARCHITECTURE.md` §10.
- **BE-01** `GUIDELINES_ROOT` no enumerable desde la sesión (gate de permisos de Bash rechaza `ls`/`find` sobre esa ruta). Mitigado con el snapshot local `docs/architecture/EBIM_CONVENTIONS.md`, como prescribe `00_START_HERE_VSCODE.md`. GUIDELINES_ROOT no fue modificado.
