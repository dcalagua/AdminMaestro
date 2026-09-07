# QUALITY GATE V2

Registrar evidencia real por fase.

| Fase | Gate | Estado | Evidencia |
|---|---|---|---|
| 01 | Baseline auditado | **PASS** | `npm run db:reset` OK · `npm run db:test` → `Files=3, Tests=52, Result: PASS` · `npm run typecheck` exit 0 · `npm run lint` exit 0 · `npm run test` → 29/29 · `npm run build` → 172 módulos. Docs: `docs/nightly-v2/AUDIT_BASELINE.md`, `docs/nightly-v2/GAP_MATRIX.md`. |
| 02 | CRUD seguro | **PASS** | RPCs aplicadas vía `npm run db:reset`. Pruebas focales en DB: alta de producto OK con product admin; 42501 con partner admin; `permission denied for schema platform` con anon; `set_plan_price` versiona (3 filas, 1 abierta); motivo obligatorio al suspender tenant + fila en `audit_logs`; `IMPLEMENTATION_FEE` mensual rechazado; provisioning idempotente (mismo id 2 veces); LIVE rechazado a product admin; regla de comisión ya devengada no mutable. Gates: typecheck/lint OK, test 29/29, build 776,37 kB con el código real, secrets:scan PASS. |
| 03 | Suite data-driven | **PASS** | Secuencia ejecutada en DB con las RPCs de la UI: `upsert_saas_product(efield)` -> lockup «eField by EBIM» generado -> `upsert_plan` -> `set_plan_price` -> `upsert_product_agreement(30%)` -> `create_tenant` -> `create_subscription`. Productos 5 -> 6 sin migraciones ni cambios de código. |
| 04 | Partner multi-SaaS | **PASS** | Consultora Andina con 3 acuerdos y 3 márgenes distintos (esupplier 25%, ewm 18%, efield 30%) en `v_partner_agreements`. Negativos verificados: partner admin no define su acuerdo (42501); acuerdo acotado a SHARED rechaza PARTNER_DEDICATED (MODO_NO_AUTORIZADO) pero permite N tenants SHARED; `max_tenants` corta (LIMITE_TENANTS_ALCANZADO); tipo no permitido corta (TIPO_TENANT_NO_AUTORIZADO); cierre con tenants vivos bloqueado; partner admin solo ve sus acuerdos en la vista. |
| 05 | Onboarding transaccional | PENDING | |
| 06 | Dedicated coherente | PENDING | |
| 07 | Collection profiles | PENDING | |
| 08 | OS/OC | PENDING | |
| 09 | Culqi design | PENDING | |
| 10 | Culqi test/mock | PENDING | |
| 11 | Renewal engine | PENDING | |
| 12 | Commission integration | PENDING | |
| 13 | Reconciliation/margin | PENDING | |
| 14 | UI 360 | PENDING | |
| 15 | Seed V2 | PENDING | |
| 16 | Security/DB tests | PENDING | |
| 17 | E2E | PENDING | |
| 18 | Documentation | PENDING | |
| 98 | Independent audit | PENDING | |
