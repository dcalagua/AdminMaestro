# EBIM Control Plane V2 - START HERE (Claude Code VS Code)

# Contrato global de ejecución V2

**PROJECT_ROOT (ESCRITURA PERMITIDA):** `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`

**GUIDELINES_ROOT (SOLO LECTURA):** `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma`

Reglas obligatorias para TODAS las fases:

1. Trabaja únicamente dentro de `PROJECT_ROOT`. Puedes LEER `GUIDELINES_ROOT` para copiar convenciones y decisiones arquitectónicas, pero **no crear, editar, mover, borrar, formatear ni ejecutar comandos destructivos allí**.
2. Este es un proyecto EXISTENTE. No ejecutes `vite create`, `supabase init`, `git init` ni reconstruyas el proyecto desde cero.
3. Antes de modificar código, lee `docs/nightly/FINAL_REPORT.md`, `docs/nightly/STATE.md`, `docs/nightly/DECISIONS.md`, `docs/architecture/*`, `docs/commercial/*`, `docs/finance/*`, las migraciones existentes y `src/services/queries.ts`.
4. Las 13 migraciones `20260902000100` a `20260902001300` son baseline histórico: **NO se editan**. Todo cambio de BD es una migración NUEVA posterior a `20260902001300_fk_indexes.sql`.
5. Conserva `schema platform`; no crees negocio en `public`.
6. Conserva la regla `comercial != acceso operativo`: vender un tenant jamás crea `tenant_memberships`.
7. Conserva comisiones basadas en `payments.status = CONFIRMED`; factura emitida u OS/OC recibida no devengan comisión por sí solas.
8. React usa la clave pública/publishable de Supabase y RLS. Nunca pongas `service_role`, secret keys de Supabase, `CULQI_SECRET_KEY`, PAN/CVV ni secretos equivalentes en React, Git, SQL o metadata.
9. Para operaciones sensibles prefiere RPCs transaccionales `SECURITY DEFINER` con `search_path` fijo + autorización explícita + auditoría. No confíes solo en ocultar botones.
10. Mantén compatibilidad con los tres `deployment_mode`: `SHARED`, `PARTNER_DEDICATED`, `TENANT_DEDICATED`.
11. `SHARED` también permite que un Partner/Reseller/Empresa administre múltiples tenants sin infraestructura dedicada.
12. Los cobros deben modelarse por `subscription`, porque un mismo cliente puede pagar eSupplier con tarjeta y WMS por Orden de Servicio.
13. La integración Culqi será provider-adapter; Culqi es el primer proveedor, no una dependencia rígida del dominio.
14. No hagas llamadas Culqi LIVE ni provisioning remoto real. Usa test/sandbox y mocks hasta que el usuario configure secretos y autorice producción.
15. No hagas `git push`, no enlaces ni resetees un Supabase remoto, no borres proyectos Supabase. `supabase db reset` solo contra el stack local del proyecto.
16. Después de cada fase actualiza `.claude-prompts-v2/STATE_V2.md`, `.claude-prompts-v2/QUALITY_GATE_V2.md` y, si tomas una decisión nueva, `.claude-prompts-v2/DECISIONS_V2.md`.
17. Si una fase falla, corrige lo que sea local y seguro. Si depende de una credencial/servicio externo, marca `BLOCKED_EXTERNAL`, deja mock/adapter funcional, y continúa con las fases que no dependan del bloqueo.
18. No declares PASS sin evidencia: comando ejecutado, resultado y archivos relevantes.
19. Mantén cambios pequeños y coherentes. Si Git está disponible, crea commits descriptivos por fase; nunca push.
20. Tests de regresión exhaustivos quedan concentrados al final, pero cada fase debe hacer al menos `typecheck`/`build` o una verificación focal suficiente para no acumular errores triviales.


## Objetivo de esta ejecución

Evolucionar la base actual de **EBIM Control Plane / masteradmin** a una consola realmente gestionable para toda la suite EBIM:

- Catálogo y administración de múltiples SaaS.
- Organizaciones, clientes, partners, resellers y comerciales.
- Partner Shared con N tenants, Partner Dedicated y Tenant Dedicated.
- CRUD administrativo real, no solo pantallas de lectura.
- Licencias/suscripciones y fees de implementación.
- Configuración de cobro distinta por suscripción/producto.
- Culqi para tarjeta/recurrente en Perú, diseñado como provider desacoplado.
- Orden de Servicio / Orden de Compra / transferencia / manual como formas administrativas de cobro.
- Anticipación de renovaciones, vencimiento, gracia y suspensión configurable.
- Comisiones y margen reconciliados solo contra cobros confirmados.
- Provisioning seguro y DRY_RUN.
- Auditoría, RLS y certificación final.

## Baseline que DEBES respetar

El reporte actual declara:

- 39 tablas en `platform`.
- 13 migraciones baseline.
- 5 productos SaaS de seed.
- 3 deployment modes.
- 102 tests PASS en la ejecución anterior.
- `ADMIN_UI` quedó `PARTIAL`: lectura completa, escrituras pendientes.

No asumas que el reporte sigue siendo verdad: la Fase 01 lo verifica.

## Modo de trabajo en un solo chat

Ejecuta estas fases EN ORDEN y sin pedir aprobación entre fases, salvo una acción destructiva no contemplada:

1. `01_AUDIT_CURRENT_STATE.md`
2. `02_CLOSE_ADMIN_CRUD_GAPS.md`
3. `03_SUITE_PRODUCT_MANAGEMENT.md`
4. `04_PARTNERS_COMMERCIAL_AGREEMENTS.md`
5. `05_TENANTS_LICENSING_IMPLEMENTATION.md`
6. `06_DEDICATED_DEPLOYMENTS.md`
7. `07_BILLING_COLLECTION_MODEL.md`
8. `08_SERVICE_ORDER_PURCHASE_ORDER.md`
9. `09_CULQI_ARCHITECTURE.md`
10. `10_CULQI_IMPLEMENTATION.md`
11. `11_RENEWALS_REMINDERS_SUSPENSION.md`
12. `12_COMMISSIONS_PAYMENT_INTEGRATION.md`
13. `13_FINANCE_RECONCILIATION.md`
14. `14_UI_CONTROL_PLANE_COMPLETE.md`
15. `15_SEEDS_BUSINESS_SCENARIOS.md`
16. `16_SECURITY_RLS_TESTS.md`
17. `17_E2E_CERTIFICATION.md`
18. `18_DOCUMENTATION_HANDOFF.md`
19. `98_FINAL_AUDIT.md`
20. Contrasta el resultado con `99_DEFINITION_OF_DONE.md`.

### Antes de empezar

- Lee `CLAUDE.md` en la raíz.
- Lee `docs/superpowers/specs/2026-09-07-ebim-control-plane-v2-design.md`.
- Lee `docs/superpowers/plans/2026-09-07-ebim-control-plane-v2.md`.
- Lee esta carpeta completa para entender el orden y los gates.
- Verifica `pwd`. Si no coincide con `PROJECT_ROOT`, DETENTE sin modificar archivos.
- Verifica acceso de lectura a `GUIDELINES_ROOT`. Si no está disponible desde la extensión, registra el bloqueo y usa `docs/architecture/EBIM_CONVENTIONS.md` como snapshot local; no inventes convenciones.

## Gestión de contexto

Antes de que el contexto del chat se vuelva grande:

1. Actualiza `STATE_V2.md` con fase actual, migraciones nuevas, archivos tocados, tests ejecutados y siguiente acción exacta.
2. Actualiza `DECISIONS_V2.md` con decisiones no obvias.
3. Actualiza `QUALITY_GATE_V2.md` con evidencia.
4. Si la conversación se compacta o se reabre, lee `90_RECOVERY_CONTEXT.md` y continúa.

## Fin

No termines con una explicación genérica. Debes dejar:

- aplicación compilable;
- DB local reconstruible;
- CRUD administrativo operativo;
- modelo de cobranza configurable;
- Culqi en TEST/mocked si faltan credenciales;
- OS/OC y renovaciones funcionales;
- RLS y tests negativos;
- E2E de flujos principales;
- `docs/nightly-v2/FINAL_REPORT_V2.md` con evidencia y gaps reales.
