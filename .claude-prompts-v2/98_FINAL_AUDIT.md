# Fase 98 - Auditoría final independiente

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


## Regla

No confíes en `STATE_V2.md`. Verifica desde cero lo entregado.

## Auditoría

1. `git status` limpio o explica cambios pendientes.
2. Lista migraciones y confirma que las 13 baseline no cambiaron (usa git diff/hash si es posible).
3. `npm run db:reset` desde cero.
4. `npm run db:test`.
5. `npm run db:types` y confirma que no deja drift inesperado.
6. `npm run secrets:scan`.
7. `npm run typecheck`.
8. `npm run lint`.
9. `npm run test`.
10. `npm run build`.
11. `npm run e2e`.
12. Revisa RLS/GRANT de todas las tablas nuevas.
13. Busca strings sensibles: `sk_live_`, `sk_test_`, `service_role`, PAN-like, CVV, secretos Culqi/Supabase.
14. Verifica que `GUIDELINES_ROOT` no fue modificado por esta ejecución si Git/metadata permite comprobarlo.
15. Recorre manualmente los 3 deployment modes y los 5 collection methods.
16. Verifica que OS/OC no crea comisiones sin pago.
17. Verifica idempotencia de webhook mock.
18. Verifica `SHARED via Partner` con múltiples tenants.
19. Verifica vista 360.
20. Contrasta contra `99_DEFINITION_OF_DONE.md` ítem por ítem.

## Salida

Actualiza `docs/nightly-v2/FINAL_REPORT_V2.md` con una tabla final:
`Requirement | Status PASS/PARTIAL/FAIL/BLOCKED_EXTERNAL | Evidence | Next action`.

Solo `BLOCKED_EXTERNAL` para credenciales/servicios realmente externos. Nada local puede esconderse allí.
