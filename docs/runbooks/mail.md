# Runbook · Correo del Admin Maestro por EBIM MailHub

Migración `20261022000100_mail_outbox.sql` · Edge Functions `auth-email-hook`, `mail-dispatch`, `mailhub-callback` · Pantalla **Gobierno › Correos enviados** (`/correos`).

Este repositorio es público: aquí no hay tokens, secretos ni ids de clientes.

## 1. Qué correos salen y con qué disparador

| Evento | Plantilla MailHub | Disparador (ya existente) | Destinatario |
|---|---|---|---|
| Invitación a la consola | `masteradmin-acceso-invitacion` | Auth «Send Email Hook» (`user-admin` → `inviteUserByEmail`) | La persona invitada |
| Restablecer contraseña | `masteradmin-acceso-restablecer` | Auth (recovery) | Titular de la cuenta |
| Enlace de ingreso / confirmar correo | `masteradmin-acceso-enlace` / `-confirmar` | Auth (magiclink / signup) | Titular |
| Cambio de correo | `masteradmin-acceso-cambio-correo` | Auth (email_change, seguro: 2 correos) | Dirección actual y nueva |
| Código de verificación | `masteradmin-acceso-codigo` | Auth (reauthentication) | Titular |
| Factura emitida (+ portal de pago) | `masteradmin-factura-emitida` | INSERT/UPDATE de `invoices` a `ISSUED` con total > 0 | `organizations.billing_email` |
| Pago confirmado (recibo) | `masteradmin-pago-confirmado` | `payments.status = CONFIRMED` | `billing_email` |
| Factura vencida (una vez) | `masteradmin-factura-vencida` | Alerta `PAST_DUE` del ciclo diario | `billing_email` |
| Suspensión por impago (+ portal) | `masteradmin-tenant-suspendido` | `tenant_suspensions` con causa `NON_PAYMENT` | `billing_email` (o `admin_email` del tenant) |
| Reactivación | `masteradmin-tenant-reactivado` | Cierre de esa suspensión (pago o manual) | ídem |
| Bienvenida al tenant | `masteradmin-tenant-bienvenida` | Tenant `PENDING → ACTIVE` («Confirmar como activo»); no en registros manuales | `tenants.admin_email` |
| Resumen para operaciones | `masteradmin-ops-resumen` | Sincronización con diferencias nuevas o fallida; alta (`saas_provisioning_requests`) `FAILED` | `mail_settings.ops_recipients` (solo @ebim.pe / @grupoebim.com) |

Los triggers son diferidos (corren al COMMIT) y nunca rompen la operación de negocio: un error de correo deja un WARNING.
El enlace del portal de pago se crea **al enviar** (30 días); un correo retenido no crea enlaces.

## 2. Salvaguarda de QAS

Secretos de la Edge Function `mail-dispatch`:

| Secreto | QAS | PRD |
|---|---|---|
| `MAIL_DELIVERY_MODE` | `allowlist` (también si falta o tiene otro valor) | `live` (decisión explícita) |
| `MAIL_ALLOWED_DOMAINS` | `ebim.pe,grupoebim.com` | — |
| `MAIL_REDIRECT_TO` | opcional (modo `redirect`, buzón @ebim.pe) | — |

- Dominio de prueba (`.test`, `.invalid`, `example.*`) → **Descartado**, en cualquier modo.
- Fuera de los dominios permitidos → **Retenido (QAS)**: queda en la bandeja, no sale. Se puede cancelar.
- Los accesos (Auth) van a personas de la consola y salen siempre (salvo dominios de prueba).
- Una prueba de plantilla (`mail_send_test`) solo acepta @ebim.pe / @grupoebim.com.

## 3. Secretos y configuración

| Dónde | Nombre | Origen |
|---|---|---|
| Edge Functions | `MAILHUB_FUNCTIONS_URL` | `https://<ref-mailhub>.supabase.co/functions/v1` |
| Edge Functions | `MAILHUB_API_KEY` | Token `mh_<env>_…` de la app `masteradmin/<env>` en MailHub (se ve una vez) |
| Edge Functions | `MAILHUB_WEBHOOK_SECRET` | Secreto `mhsec_…` del webhook de retorno de esa app (se ve una vez) |
| Edge Functions | `SEND_EMAIL_HOOK_SECRET` | `v1,whsec_<base64>` (el mismo que `hook_send_email_secrets` de Auth) |
| Edge Functions | `MASTERADMIN_APP_URL` | URL pública de la consola (enlaces de pago y de operaciones) |
| Llavero del operador | `masteradmin-mailhub-<env>` | Copia de respaldo de los tres secretos anteriores |
| Auth (Management API) | `hook_send_email_enabled/uri/secrets` | `PATCH /v1/projects/<ref>/config/auth`, URI `…/functions/v1/auth-email-hook` |
| MailHub (panel o API admin) | Webhook de la app | URL `…/functions/v1/mailhub-callback`, eventos sent/delivered/delivery_delayed/bounced/complained/failed/suppressed |

**Orden seguro:** desplegar funciones → secretos → probar `auth-email-hook` con un payload firmado → recién entonces activar el hook de Auth. Si el hook falla, `user-admin` devuelve el enlace manual (plan B).

Desactivar el hook (vuelta atrás): `PATCH /config/auth` con `hook_send_email_enabled=false`.

## 4. Envío programado

- `pg_cron` `ebim-mail-dispatch` cada minuto, **solo si hay cola**, vía `invoke_scheduled_function('MAIL_DISPATCH')`, y disparo inmediato al encolar (`_mail_kick`).
- Ambos necesitan los secretos de Vault `masteradmin_project_url` y `masteradmin_service_role_key`. Sin ellos no hacen nada; usar **Procesar ahora** en `/correos`.
- **Antes de cargar Vault**, revisar `ENTITLEMENT_SYNC` (ver `docs/operations/ESTADO_2026-11-13.md` §6): los mismos secretos encienden ese job.
- Interruptor: `tenant_lifecycle_settings.mail_dispatch_enabled`.

## 5. Plantillas

Fuente: `supabase/functions/_shared/mail/catalog.ts` (bloques del editor visual de MailHub, español de negocio).
Publicación idempotente (crea en qas y prd; si cambió, nueva versión publicada):

```bash
MAILHUB_FUNCTIONS_URL=https://<ref-mailhub>.supabase.co/functions/v1 MAILHUB_ADMIN_JWT=<jwt de un admin de MailHub> \
MAILHUB_REPO=../ebim-mail node scripts/mailhub/sync-templates.mjs [--dry-run]
```

## 6. Diagnóstico

- `/correos`: estado por correo (Enviado → Entregado vía callback), detalle del error, reenviar (con motivo, clave nueva) o cancelar.
- Ficha 360 de la organización: columna **Correo** en la tabla de facturas. Ficha del tenant: pestaña **Actividad**.
- MailHub: panel → Correos (filtrar por la app `masteradmin`) y Webhooks (entregas a `mailhub-callback`).
- `mail_events` guarda cada callback deduplicado por `eventId`.

## 7. PRD (pendiente)

1. Token y webhook de la app `masteradmin/prd` en MailHub (la app y las plantillas ya existen).
2. Secretos en el proyecto PRD con `MAIL_DELIVERY_MODE=live`.
3. Hook de Auth de PRD (mismo orden seguro de §3).
