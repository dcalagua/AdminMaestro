# STATE V2 - EBIM Control Plane

**Estado:** IN_PROGRESS · última actualización 2026-09-07
**Baseline VERIFICADO en Fase 01:** 13 migraciones, 39 tablas, 7 vistas, 26 enums, 42 funciones en `platform`. DB local reconstruible; 52 tests pgTAP PASS.

| Fase | Estado | Evidencia / siguiente acción |
|---|---|---|
| 01 Audit | **PASS** | `docs/nightly-v2/AUDIT_BASELINE.md` + `GAP_MATRIX.md`. db:reset PASS, db:test 52 PASS, typecheck/lint/test/build PASS tras corregir R-01 y R-02. |
| 02 CRUD Admin | **PASS** | `20260907000100_admin_write_rpcs.sql` (25 RPCs SECURITY DEFINER auditadas) + `src/services/mutations.ts` + diálogos en 9 páginas. Autorización negativa verificada en DB (partner admin y anon -> 42501). Corregido R-03: `.js` emitidos en `src/` congelaban el bundle. |
| 03 Suite | **PASS** | `ProductDetailPage` con 6 tabs (Resumen/Planes/Partners/Tenants/Finanzas/Deployments) + alta/edición/archivado de producto y planes desde UI. Gate verificado: sexto producto `efield` creado extremo a extremo solo con RPCs, sin código ni migración nueva. |
| 04 Partners | **PASS** | `20260907000200_channel_agreements_v2.sql`: acuerdo con `allowed_deployment_modes`, `allowed_tenant_types`, `billing_responsibility`, `max_tenants` + trigger `enforce_agreement_scope` + vista `v_partner_agreements` (security_invoker) + `AgreementFormDialog`. |
| 05 Tenants/Licensing | NOT_STARTED | |
| 06 Dedicated | NOT_STARTED | |
| 07 Collection | NOT_STARTED | |
| 08 OS/OC | NOT_STARTED | |
| 09 Culqi Architecture | NOT_STARTED | |
| 10 Culqi Implementation | NOT_STARTED | |
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
- **BE-01** `GUIDELINES_ROOT` no enumerable desde la sesión (gate de permisos de Bash rechaza `ls`/`find` sobre esa ruta). Mitigado con el snapshot local `docs/architecture/EBIM_CONVENTIONS.md`, como prescribe `00_START_HERE_VSCODE.md`. GUIDELINES_ROOT no fue modificado.
