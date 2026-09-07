# Fase 02 - Cerrar gaps de CRUD administrativo

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

Convertir la consola actual de lectura en una consola administrable sin debilitar RLS.

## Diseño obligatorio

- Extiende `src/services/queries.ts` con hooks de mutación usando `@tanstack/react-query` `useMutation` + invalidación de query keys.
- Para operaciones multi-tabla usa RPC transaccional, no varias inserciones desde React.
- Reutiliza `ConfirmDialog`, `PageContainer.actions`, `Card`, `EmptyState` y tokens existentes.
- Añade un patrón reusable de `FormDialog`/`Drawer` solo si encaja con las convenciones existentes; no introduzcas una UI library nueva.
- Agrega validación Zod + React Hook Form ya instalados.

## Mutaciones mínimas que deben existir

1. Organización/cliente: crear, editar estado/datos seguros, capacidades.
2. Partner/Reseller: alta sobre organization existente o nueva; capacidades acumulables.
3. Producto SaaS: alta/edición/activación.
4. Plan y precio vigente: crear plan; crear nueva versión de precio cerrando la anterior, nunca editar precio histórico.
5. Tenant: crear con `platform.create_tenant()`; editar metadata/config permitida; activar/suspender con flujo auditable.
6. Sales Agent: crear/editar.
7. Sales Attribution: crear/terminar vigencia sin superar 100%.
8. Commission Plan/Rules: crear nueva versión; evitar retroactividad silenciosa.
9. Subscription: crear/activar/pausar/cancelar mediante RPC con validaciones.
10. Provisioning request: encolar DRY_RUN desde UI.

## BD

Crea una migración nueva `supabase/migrations/20260907000100_admin_write_rpcs.sql` (si ya existe, usa el siguiente timestamp libre) que incluya únicamente los RPCs/guards necesarios que no existan. No copies `create_tenant`; reutilízala.

Todo RPC debe:
- `SECURITY DEFINER` cuando requiera atomicidad/privilegios;
- `set search_path = platform, pg_catalog`;
- validar actor mediante helpers existentes;
- validar IDs y estado previo;
- llamar `platform.log_audit`;
- revocar `public, anon` y otorgar lo mínimo a `authenticated`/`service_role`.

## UI

Añade botones visibles solo por UX para roles autorizados, pero deja la autoridad final en DB. Muestra errores de negocio devueltos por Postgres en mensajes entendibles.

## Verificación focal

- Crear un cliente y verlo sin reload manual.
- Crear tenant vía RPC.
- Usuario sin permiso recibe 42501 incluso invocando el RPC directamente.
- `npm run typecheck`, `npm run lint`, `npm run build`.

No hagas todavía el rediseño completo de billing; eso viene en Fase 07.
