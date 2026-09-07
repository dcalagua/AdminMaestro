# Fase 04 - Partners, Resellers y acuerdos comerciales multi-SaaS

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

Completar el lifecycle del canal: partner/reseller, productos que puede comercializar, modalidad técnica, margen y responsabilidad de facturación.

## Modelo

Reutiliza:
- `organizations`
- `organization_capabilities`
- `organization_relationships`
- `organization_product_agreements`

Extiende `organization_product_agreements` mediante migración nueva solo si faltan campos para expresar de forma normalizada:
- `allowed_deployment_modes` o equivalente;
- `billing_responsibility`: `EBIM`, `PARTNER`, `MIXED`;
- `default_channel_margin_rate` (si el actual ya existe, reutilízalo);
- vigencia del acuerdo;
- estado;
- permiso para crear DEMO/TRIAL/PRODUCTION;
- límite opcional de tenants o NULL ilimitado.

No conviertas a Partner/Reseller en tipos mutuamente excluyentes: son capabilities acumulables.

## Flujos UI

1. Crear partner.
2. Agregar capability PARTNER/RESELLER.
3. Asignar SaaS y condiciones.
4. Elegir modelos permitidos: Shared, Partner Dedicated, Tenant Dedicated.
5. Configurar margen por producto.
6. Ver tenants administrados, MRR/cobrado, comisiones, costos atribuibles y margen.
7. Partner admin ve solo su organización y tenants por RLS.

## Regla Shared clave

Un Partner puede tener 20 clientes/tenants en `SHARED` y seguir usando el mismo deployment target compartido. **Eso no lo convierte en Partner Dedicated.**

## Gate

Seed/prueba con Consultora Andina:
- eSupplier Shared 25% margen;
- WMS Shared 18% margen;
- puede tener múltiples tenants en ambos SaaS;
- no puede crear Tenant Dedicated si el acuerdo no lo autoriza.
