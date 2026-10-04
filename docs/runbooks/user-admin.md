# Runbook — usuarios y perfiles (M5)

Spec: `docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md` §6 (y §10, subsección M5).
Seguridad: `docs/security/RBAC_RLS_MATRIX.md` («M5 · Usuarios y perfiles»).

> **Alcance:** LOCAL/DEV. Nada de este runbook se ejecuta contra QAS/PRD sin autorización del operador.
> Las piezas de QAS/PRD que dependen del Dashboard de Supabase (SMTP, registro abierto) se listan en §6
> como **acciones humanas**.

## 1. Piezas

| Pieza | Qué hace |
| --- | --- |
| Gobierno → **Usuarios y accesos** (`/users`) | Lista con buscador único y pestañas Todos/EBIM/Partners/Clientes/Inactivos; «Invitar usuario» |
| Ficha `/users/:id` | Perfil · Rol de consola · Organizaciones · Tenants · Provisioning · Vendedor · Actividad · Desactivar/Reactivar |
| Configuración → **Mi perfil** | Nombre, teléfono, cargo y contraseña propios |
| `/bienvenida` (pública) | Recibe el enlace de invitación o de restablecimiento y pide fijar la contraseña |
| Login → «¿Olvidaste tu contraseña?» | Envía el enlace de restablecimiento al correo del titular (misma respuesta exista o no la cuenta) |
| Edge `user-admin` (`verify_jwt = true`) | `invite`, `resend`, `ban`, `unban`. Autoriza con RPC y el JWT del operador; `service_role` solo para la API de Auth |
| RPC de M5 | `admin_list_users`, `admin_update_profile`, `grant/revoke_platform_role`, membresías, `link_user_sales_agent`, `deactivate/reactivate_user`, invitaciones |
| `platform.user_invitations` | Rastro de invitaciones (`EMAIL` o `LINK`). **Nunca** guarda el enlace |

Secretos / variables de la Edge Function (Supabase secrets; nunca en el repo):

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Inyectadas por Supabase |
| `MASTERADMIN_APP_URL` | URL pública de la consola. `redirectTo` = `${MASTERADMIN_APP_URL}/bienvenida` (si falta, `SITE_URL`; en local `http://127.0.0.1:5199`) |
| `MASTERADMIN_ALLOWED_ORIGINS` | Orígenes CORS adicionales de la consola desplegada (coma) |

## 2. Invitar a una persona

1. Consola → Gobierno → Usuarios y accesos → **Invitar usuario**.
2. Correo, nombre y **tipo de acceso**:
   - **Rol de consola** (solo super admin): `EBIM_PRODUCT_ADMIN` o `EBIM_FINANCE`. `EBIM_SUPER_ADMIN` nunca se ofrece
     y la base lo rechaza (`SUPER_ADMIN_NO_ASIGNABLE`).
   - **Membresía de organización**: organización + rol. Un admin de partner/cliente solo ve su organización y roles
     de su familia, nunca por encima del suyo.
   - **Membresía de tenant**: tenant + `TENANT_USER`/`TENANT_ADMIN` (quien administra el tenant).
3. Resultado:
   - **«Invitación enviada»**: Supabase Auth mandó el correo (SMTP configurado; en local, Inbucket/Mailpit en
     `http://127.0.0.1:54724` en el stack aislado o el puerto de inbucket del stack por defecto).
   - **Enlace para copiar**: no hubo correo (sin SMTP, límite de envíos o fallo). Se muestra **una sola vez**; es de un
     solo uso y vence según la configuración de Auth (OTP, 1 h por defecto). Compártelo por un canal seguro.
   - **«Acceso otorgado»**: el correo ya tenía cuenta; no se envía invitación y solo se aplica el acceso.
   - Si la cuenta se creó pero el acceso falló (p. ej. regla de dominio), el diálogo lo dice; corrígelo en la ficha.
4. La persona abre el enlace → `/bienvenida` → elige su contraseña (≥ 8, letras y números) → entra. La invitación
   pasa a `ACCEPTED`.

Orden interno de `invite`: `authorize_user_invitation` (JWT del operador; si no puede otorgar ese acceso **no se crea
ninguna cuenta**) → `inviteUserByEmail` o `generateLink({type:'invite'})` → RPC del acceso (JWT) →
`record_user_invitation` (JWT).

**Reenviar**: en la ficha, «Reenviar invitación» (solo si nunca aceptó; super admin, admin de producto o quien la
emitió). Una cuenta ya activada **no** recibe enlaces del operador: para eso está «¿Olvidaste tu contraseña?», que
solo llega al correo del titular.

## 3. Desactivar y reactivar

- **Desactivar** (super admin, motivo obligatorio): `deactivate_user` apaga perfil, rol de consola, membresías de
  organización y tenant, roles de provisioning, propiedad técnica de productos e invitaciones pendientes; luego la
  Edge Function bloquea el ingreso en Auth (`ban_duration = 876000h`). El vínculo comercial se conserva (historia de
  comisiones). Un JWT ya emitido deja de abrir datos al instante (las membresías están inactivas) y la consola cierra
  la sesión al detectar el perfil inactivo; caduca solo en ≤ 1 h.
- **Reactivar**: `reactivate_user` reactiva **solo el perfil** y quita el bloqueo (`ban_duration = none`). Los accesos
  se vuelven a otorgar uno por uno, a propósito.
- Si la ficha avisa «Base y Auth desalineados» (Auth no respondió), pulsa **Bloquear ingreso** / **Quitar bloqueo de
  ingreso**: repite la acción; las RPC son idempotentes.

## 4. Regla del último super admin

`EBIM_SUPER_ADMIN` recae solo en `dcalagua@ebim.pe` (trigger `enforce_super_admin_governance`, contrato §13.1) y:

- no se concede por RPC ni por invitación (`SUPER_ADMIN_NO_ASIGNABLE`);
- su rol no se cambia por otro (`SUPER_ADMIN_PROTEGIDO`);
- no se revoca ni se desactiva mientras sea el último super admin activo (`ULTIMO_SUPER_ADMIN`). Como es único,
  **siempre** es el último: la consola ni siquiera ofrece «Desactivar» en su ficha.

Recuperación si el super admin pierde el acceso: es una operación de base, fuera de la consola, con autorización
explícita del operador (no se documenta un atajo).

## 5. Registro abierto desactivado (local)

`supabase/config.toml`:

- `[auth] enable_signup = false` → `POST /auth/v1/signup` responde `signup_disabled` (verificado en local).
- `[auth.email] enable_signup = true` **a propósito**: en el CLI esa clave es el interruptor del proveedor email
  (`GOTRUE_EXTERNAL_EMAIL_ENABLED`); en `false` bloquea también el ingreso con contraseña, las invitaciones y el
  restablecimiento (`email_provider_disabled`, reproducido en local).
- `additional_redirect_urls` incluye `http://127.0.0.1:5199/**` y `http://localhost:5199/**` para `/bienvenida`.

Las cuentas solo se crean por la Auth admin API (Edge Function `user-admin`), que no depende del registro abierto.

## 6. QAS / PRD — acciones humanas (Dashboard)

1. **Registro abierto:** Authentication → Sign In / Providers → desactivar **«Allow new users to sign up»**. Dejar el
   proveedor **Email** habilitado. (`config.toml` no se aplica a proyectos remotos.)
2. **SMTP:** Authentication → Emails → SMTP Settings con un proveedor real (remitente del dominio de EBIM). Sin SMTP,
   Supabase usa su servicio de correo con límites muy bajos: la consola caerá al **enlace para copiar**, que funciona,
   pero exige que el operador lo entregue a mano.
3. **URL Configuration:** `Site URL` = URL de la consola; `Redirect URLs` incluye `https://<consola>/bienvenida`
   (y `?mode=reset`).
4. **Plantillas** (opcional): invitación y restablecimiento en español, con el enlace `{{ .ConfirmationURL }}`.
5. **Secrets de la Edge Function:** `MASTERADMIN_APP_URL` y `MASTERADMIN_ALLOWED_ORIGINS`.
6. Desplegar la migración `20261013000100_user_admin.sql` y la función `user-admin` según el flujo de promoción
   (requiere autorización del operador; este runbook no la da).

## 7. Verificación local

```bash
M5=<directorio del stack local>            # o el stack por defecto
supabase db reset --local --workdir "$M5"
supabase test db --workdir "$M5"           # 49_user_admin.test.sql: 78 aserciones
npx vitest run supabase/functions/_shared/users src/features/users src/features/auth
```

Prueba manual (stack local, fixtures `@ebim.test`, contraseña local documentada en el README):

1. Ingresar como `admin@andina.ebim.test` → Usuarios y accesos → invitar `nuevo@ebim.test` como «Soporte de Partner».
2. Abrir el correo en Inbucket (o copiar el enlace) → `/bienvenida` → fijar contraseña → la persona entra como partner.
3. Como `dcalagua@ebim.pe`: ficha del nuevo usuario → **Desactivar** con motivo → su ingreso responde «cuenta
   desactivada»; **Reactivar** → ingresa, pero sin accesos hasta otorgarlos de nuevo.

## 8. Limitaciones conocidas

- Sin SMTP propio en local/DEV: el correo local va a Inbucket; en remoto, ver §6.
- El edge runtime local puede devolver `WORKER_LIMIT` (546/503) por límite de CPU en arranques en frío de
  `supabase-js`; reintentar. No ocurre por la lógica de la función.
- La sesión de una cuenta desactivada se corta en la consola al recargar roles; su JWT vigente (≤ 1 h) ya no abre
  datos porque las membresías y el rol de consola están inactivos.
- Un usuario creado por invitación que nunca la aceptó y fue desactivado puede recibir el reenvío tras reactivarlo.
