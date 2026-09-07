# Fase 07 - Modelo de cobranza por suscripción

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

Agregar configuración de COBRO separada del registro de pagos. `payments` representa dinero cobrado; no debe convertirse en configuración.

## Migración nueva

Crear `supabase/migrations/20260907000200_collection_profiles.sql` (o siguiente timestamp libre) con estos conceptos.

### Enums sugeridos

`collection_method`:
- `CULQI_CARD`
- `SERVICE_ORDER`
- `PURCHASE_ORDER`
- `BANK_TRANSFER`
- `MANUAL`

`provider_kind`:
- `CULQI`
- `MANUAL`
- `BANK`
- `OTHER`

`collection_profile_status`:
- `ACTIVE`
- `INACTIVE`
- `PENDING_SETUP`

### `payment_provider_accounts`

Metadata segura de una cuenta de cobro:
- id, code, provider_kind;
- owner_organization_id (normalmente EBIM; futuro partner);
- country_code (`PE` inicialmente);
- environment (`TEST`/`LIVE` como text/check o enum específico);
- public_key si realmente es pública;
- `secret_key_ref` y referencias RSA, **nunca valor secreto**;
- status, metadata segura, timestamps.

### `subscription_collection_profiles`

Una fila activa por subscription:
- subscription_id unique;
- collection_method;
- provider_account_id nullable;
- auto_charge bool;
- invoice_lead_days;
- renewal_notice_days;
- payment_due_days;
- grace_period_days;
- auto_suspend bool;
- requires_service_order bool;
- requires_purchase_order bool;
- currency;
- status;
- effective_from/effective_to o estrategia de versionado equivalente.

### Reglas DB

- `CULQI_CARD` requiere provider Culqi y `auto_charge=true`.
- `SERVICE_ORDER` requiere service_order=true.
- `PURCHASE_ORDER` requiere purchase_order=true.
- no permitir ambos documentos si no tiene sentido, salvo configuración explícita.
- valores de días >= 0 y rangos razonables.
- profile no puede ser LIVE Culqi sin `secret_key_ref` configurada (pero no compruebes valor secreto en DB).

## UI

Nueva sección en detalle de suscripción: **Cobranza**.
Debe permitir escoger método y parámetros por cada SaaS del cliente.

Ejemplo que debe soportar:
- GRUPASA / eSupplier: CULQI_CARD mensual.
- GRUPASA / WMS: SERVICE_ORDER anual, pedir 45 días antes.

## Importante

No cambies todavía el estado de suscripciones automáticamente por cron; eso se implementa en Fase 11.
