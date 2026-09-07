# Fase 15 - Seed V2 con escenarios comerciales completos

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


## Objetivo

Ampliar `supabase/seed.sql` sin destruir los escenarios existentes. El seed debe seguir determinista y autoverificable.

## Escenarios mínimos

### 1. eSupplier Shared directo EBIM
- Cliente Alpha.
- tenant productivo.
- licencia mensual.
- implementation fee one-time.
- Culqi TEST/MOCK collection profile.
- comercial independiente con 12% sobre licencia y 5% implementación, si reglas permiten.

### 2. eSupplier Shared vía Partner
- Consultora Andina administra 3 tenants distintos.
- TODOS SHARED en infraestructura compartida.
- margen partner 25%.
- uno con comercial captador adicional.

### 3. WMS Shared vía mismo Partner
- 2 tenants.
- margen 18%.
- demuestra partner multi-SaaS.

### 4. WMS Partner Dedicated
- licencia base partner.
- 2 tenants productivos.
- infra fee.
- implementation fee.
- target dedicado partner.

### 5. eSupplier Tenant Dedicated Enterprise
- cliente Enterprise X.
- infra exclusiva.
- licencia enterprise + implementation + support SLA.
- payment method BANK_TRANSFER o MANUAL para contraste.

### 6. GRUPASA multi-producto
- eSupplier: CULQI_CARD mensual TEST/MOCK.
- WMS: SERVICE_ORDER anual.
- OS se solicita 45 días antes.
- misma organización, dos subscriptions y dos collection profiles distintos.

### 7. OS pendiente/recibida/aprobada
Tres subscripciones para mostrar estados de ciclo.

### 8. Renovación vencida en gracia
Para dashboard de alertas.

### 9. Payment failure Culqi mock
Para reconciliación/alerta sin secreto real.

## Seed seguro

No incluir tokens, llaves ni IDs Culqi live. Usa IDs `mock_...` claramente artificiales.
