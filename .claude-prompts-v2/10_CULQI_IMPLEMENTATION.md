# Fase 10 - Implementación Culqi TEST / adapter

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

Implementar el adapter y UI de setup sin requerir secretos LIVE.

## BD

Crear tablas/mapeos con migración nueva, por ejemplo `20260907000400_payment_provider_mappings.sql`:

### `provider_customers`
- provider_account_id;
- organization_id;
- external_customer_id;
- status;
- unique provider+org.

### `provider_payment_methods`
- provider_account_id;
- organization_id;
- external_payment_method_id (Culqi card_id);
- brand/last4/expiry no sensibles;
- is_default;
- status;
- **sin PAN/CVV/token bruto**.

### `provider_plans`
- local plan/price o subscription item según mapeo elegido;
- external_plan_id;
- amount/currency/interval snapshot;
- status.

### `provider_subscriptions`
- local subscription_id unique por provider activo;
- provider_account_id;
- external_subscription_id;
- external_plan_id;
- external_card_id;
- external_customer_id;
- provider_status;
- next_billing_at;
- synced_at;
- metadata sanitizada.

### `provider_webhook_events`
- provider_account_id;
- external_event_key/hash idempotente;
- event_type;
- received_at;
- processed_at;
- status;
- payload sanitizado;
- error_code/error_message sanitizados.

## Edge Functions

Crear funciones enfocadas, por ejemplo:
- `supabase/functions/payment-setup/index.ts` - llamada autenticada para setup/attach de método.
- `supabase/functions/culqi-webhook/index.ts` - endpoint webhook sin JWT Supabase, valida provider en código.
- `supabase/functions/payment-reconcile/index.ts` - reconciliación manual/admin.

Factoriza un adapter en `supabase/functions/_shared/payments/culqi.ts` y tipos comunes. No mezcles toda la lógica en `index.ts`.

## Modo sin credenciales

Si no existen `CULQI_*` secrets:
- no bloquear el resto del proyecto;
- adapter entra en `MOCK/TEST_DISABLED` explícito;
- UI muestra "Culqi pendiente de configurar";
- tests unitarios usan fake provider determinista;
- nunca inventar respuestas de Culqi en producción.

## UI

En collection profile CULQI_CARD:
- botón Configurar tarjeta;
- tokenización con Culqi Checkout solo si public key test disponible;
- mostrar brand/last4 luego del setup;
- cancelar/reemplazar método con confirmación;
- mostrar estado de provider subscription y próxima fecha de cobro.

## Gate

Con fake provider o Culqi test:
- setup es idempotente;
- no se versiona secreto;
- reintentar webhook no duplica `payments` ni comisiones;
- error del provider queda visible/sanitizado.
