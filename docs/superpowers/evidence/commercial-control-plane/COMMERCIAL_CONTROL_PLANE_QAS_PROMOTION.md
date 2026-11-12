# EBIM Commercial Control Plane — Promoción a QAS (GATE C)

**Fecha:** 2026-09-30. **Autorizaciones humanas:** `PROMOTE_COMMERCIAL_CONTROL_PLANE_TO_QAS=YES` y
`COMMERCIAL_CONTROL_PLANE_QAS_CONTINUE=YES`.
**Resultado:** `COMMERCIAL_CONTROL_PLANE_QAS_PROMOTION=WAITING_EXTERNAL_ACTIONS`.
Ningún valor de secreto aparece en este documento.

## 0. Herramienta Supabase

- Sesión 1 (Wave 0/1 y las 3 migraciones de eCommerce): se usó `supabase` 2.116.0 (`/opt/homebrew/bin`).
  Su sesión apunta a la misma organización EBIM (`leajwlbzzcxuhegawtrk`, mismos 12 proyectos).
- Sesión 2 (desde «CONTINÚA»): **exclusivamente `supabase-cli-ebim`** (función zsh del usuario, CLI 2.118.0),
  invocada como `zsh -ic 'supabase-cli-ebim "$@"'`. `projects list` = los mismos proyectos EBIM.
- Límite del runtime del agente: el clasificador de permisos **denegó** toda mutación remota de esquema y
  todo deploy de Edge Functions (eSupplier SQL, eChange `db push`, eCommerce `functions deploy`), pese a la
  autorización humana. No se intentó evadirlo. Esas operaciones quedan preparadas en §5 para el operador.

## 1. Wave 0 — preflight (sesión 1, read-only)

`git merge-tree origin/qas origin/dev` limpio en los 9 repos. Sin branch protection en `qas`. CI solo en EWM y
eSupplier y solo para `dev`/`main`.

| Producto | Proyecto | Veredicto |
|---|---|---|
| MasterAdmin | `jivgwrczgdpsuvqcwqku` | QAS documentado. 45 migraciones remotas; dry-run = exactamente las 24 CCP |
| EWM | Render `ewm-rsxs` + `qhmouhpwihjeismprhwx` | Flyway V50, checksums OK; V51–V53 aditivas |
| TMS | Render `tms-myss` + `ocxmsluzegpkezkpcqjj` | Flyway **V51** (qas 90d93da nunca desplegó); V52–V56 validadas |
| eSupplier | `glmgxzlloyqhcoercsjh` (DEV+QAS; PRD=AWS) | 7 CCP + prerequisito `upsert_agent_config_rpc__inner` |
| Comerza | `rsdyqwdqvezebpopcggj` | dry-run = 4. Regla formal `CLAUDE.md:56-59` («sube a qas» de Dennis) |
| eChange | `zoveazvwvyayugladuvl` | 8 CCP aditivas; dry-run = exactamente 8 |
| eExpense | `uvjmdphlnpyhtohobvzx` | QAS definido pero es el sistema vivo de CMH → BLOCKED_QAS_ENVIRONMENT |
| eCommerce | `ehxlxbhtlmfgneiagdcj` | 3 pre-D14 aplicadas y verificadas |
| GMAO | `xikbhkfeaosasdltartg` | Es PRD + hub de identidad → BLOCKED_PRD_SHARED |

### Integración GitHub↔Supabase (re-verificada con `supabase-cli-ebim branches list`)

| Proyecto | git_branch | default | status |
|---|---|---|---|
| masteradmin | qas | sí | FUNCTIONS_DEPLOYED (09-21) |
| eSupplier | qas | sí | MIGRATIONS_FAILED (06-30) |
| eExpense | qas | sí | MIGRATIONS_FAILED (06-30) |
| eCommerce | qas | sí | FUNCTIONS_DEPLOYED |
| GMAO | qas | sí | MIGRATIONS_FAILED (runs 09-16 y 09-25 fallidos) |

«Deploy to production» solo se controla en el Dashboard (doc oficial). **No se mergea ninguno de esos 5 repos**
hasta que un humano lo desactive: podría aplicar D-14 o migraciones históricas peligrosas
(p. ej. eSupplier `20260818130000_demo_reset_all_passwords`).

## 2. PRs

| Repo | PR | Estado |
|---|---|---|
| EWM | https://github.com/dcalagua/WMS-by-EBIM/pull/43 | draft; head `dev` = `24a57d6` (fix CI) |
| TMS | https://github.com/dcalagua/TMS/pull/15 | draft (EWM/TMS_WAITING_RENDER) |
| eChange | https://github.com/dcalagua/eChange/pull/8 | draft (BD no aplicada) |
| Comerza | https://github.com/dcalagua/comerza/pull/6 | draft — WAITING_EXTERNAL_APPROVAL |
| masteradmin, eSupplier, eExpense, eCommerce, GMAO | — | sin PR (integración GitHub activa en `qas`) |

`QAS_REPOS_MERGED=0/9`.

## 3. Mutaciones realizadas

| Hora local | Proyecto/repo | Acción | Resultado |
|---|---|---|---|
| 02:16 | masteradmin | `db dump` schema+data+historial → `~/.ebim-backups/qas-ccp-20260930/` (0600) | OK |
| 02:33 | eCommerce | `db dump` schema (167 tablas) + data | OK |
| ~02:35 | eCommerce | `db push --linked` desde `origin/dev` **sin** `20261003100000` (dry-run previo = 3) | OK |
| 03:07 | eSupplier | `db dump` schema (102 tablas) + data | OK |
| 03:10 | eChange | `db dump` schema (88 tablas) + data | OK |
| ~03:30 | EWM repo | commit `24a57d6` en `dev` (fix CI), push fast-forward `8085bb8..24a57d6` | OK |
| ~03:35 | eCommerce | `secrets set` EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE, …_READ_SCOPE, EBIM_ENTITLEMENTS_ENVIRONMENT (valores de configuración no secretos: `ecommerce:entitlements:write`, `ecommerce:entitlements:read`, `QAS`) | OK |

Denegadas por el runtime (no ejecutadas, sin efecto remoto): eSupplier prerequisito+300000; eChange `db push`
de las 8; eCommerce `functions deploy platform-provisioning`.

## 4. Verificaciones

### eCommerce (`supabase-cli-ebim db query`) — `ECOMMERCE_PRE_D14_MIGRATIONS_VERIFIED=YES`
- `schema_migrations`: **229** filas; `20261003100000` **ausente**.
- Esquemas `platform_entitlements` y `platform_usage` presentes.
- `cron.job` = 3 (`ecommerce-notifications-dispatch`, `ecommerce-order-schedules`, `ecommerce-cart-recovery`), ninguno CCP.
- `platform_entitlements.enforcement_mode`: `PRODUCT = SHADOW`.
- Secrets (nombres): 9 `EBIM_MASTERADMIN_M2M_*` preexistentes + los 3 de entitlements. **Ningún** `USAGE_*`.
- `platform-provisioning` desplegado: v7 (pre-CCP) → manifiesto aún 404 hasta el deploy (§5).

### EWM CI — `EWM_CI_FIXED=YES` (GitHub CI run 36688489969 sobre `24a57d6`: 4/4 jobs success)
- Causa 1: `MasterAdminMailboxBridgeTest` es el puente X-07 (`@EnabledIfEnvironmentVariable(CCP_X07_MAILBOX)`),
  no una prueba; en la suite por defecto quedaba SKIPPED. Fix: exclusión en surefire documentada; el script
  `masteradmin/scripts/ccp/ewm-x07-e2e.mts` lo sigue lanzando con `-Dtest=` (que ignora excludes). El receptor
  y la cadena M2M siguen cubiertos por `PlatformEntitlementsSecurityTest`, `PlatformEntitlementsContractTest`,
  `EwmEntitlementsReceiverTest`, `PlatformEntitlementsIT`.
- Causa 2: `PlatformEntitlementsController` (`/internal/platform/v1`, cadena M2M exclusiva `/internal/platform/**`,
  scope por ruta) faltaba en `PLATAFORMA` de `scripts/auditar-alcance-de-almacen.py`. Añadido con justificación.
- Local con Docker/Testcontainers: unit **1535/0/0**, IT **1587/0/0**, `SKIPPED_TOTAL=0`, auditoría `GAP 0`.

### MasterAdmin (read-only)
- 45 migraciones remotas (máx `20260925000100`); dry-run = las 24 esperadas, nada remote-only.
- Advisors seguridad (antes): 0 ERROR; 105 WARN `authenticated_security_definer_function_executable`,
  1 `function_search_path_mutable`, 1 `auth_leaked_password_protection`.
- Secrets (nombres): `{COMERZA,ECHANGE,ECOMMERCE,EEXPENSE,EWM,GMAO,TMS}_QAS_M2M_PRIVATE_KEY`,
  `ESUPPLIER_DEVQAS_M2M_PRIVATE_KEY` + `SUPABASE_*`. No se generan claves nuevas.
- `platform.platform_admins`: **1** `EBIM_SUPER_ADMIN` activo (identidad no impresa). No hay sesión de operador
  disponible en el entorno → `MASTERADMIN_WAITING_REAL_SUPER_ADMIN_SESSION=YES`.

## 5. Comandos exactos para el operador (lo que el runtime del agente no pudo ejecutar)

Todos con `supabase-cli-ebim`; confirmar el `--project-ref` antes de cada uno. Directorio base
`$S` = `~/.ebim-backups/qas-ccp-20260930/operator` (árboles preparados; también reproducibles con `git archive origin/dev supabase`).

### 5.1 eCommerce `ehxlxbhtlmfgneiagdcj`
```bash
cd $S/apply-ecommerce      # origin/dev supabase/ SIN 20261003100000
supabase-cli-ebim functions deploy platform-provisioning --project-ref ehxlxbhtlmfgneiagdcj --no-verify-jwt
curl -s -o /dev/null -w '%{http_code}\n' https://ehxlxbhtlmfgneiagdcj.supabase.co/functions/v1/platform-provisioning/health              # 200
curl -s -o /dev/null -w '%{http_code}\n' https://ehxlxbhtlmfgneiagdcj.supabase.co/functions/v1/platform-provisioning/entitlements/manifest # 401 (no 404)
```
No desplegar `usage-outbox-worker`. No mergear PR eCommerce hasta desactivar «Deploy to production».

### 5.2 eChange `zoveazvwvyayugladuvl`
```bash
cd $S/apply-echange        # 204 migraciones fetch del remoto + las 8 CCP; dry-run verificado = 8
supabase-cli-ebim db push --linked --project-ref zoveazvwvyayugladuvl --dry-run   # debe listar exactamente 8
supabase-cli-ebim db push --linked --project-ref zoveazvwvyayugladuvl
supabase-cli-ebim db query --linked --project-ref zoveazvwvyayugladuvl "select count(*) from supabase_migrations.schema_migrations"   # 212
supabase-cli-ebim db query --linked --project-ref zoveazvwvyayugladuvl "select * from privado.platform_entitlement_enforcement_mode"  # PRODUCT=SHADOW
supabase-cli-ebim secrets set --project-ref zoveazvwvyayugladuvl \
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE=echange:entitlements:write \
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE=echange:entitlements:read \
  EBIM_ENTITLEMENTS_ENVIRONMENT=QAS
# funciones desde un checkout de origin/dev (eChange), primero el receptor:
supabase-cli-ebim functions deploy platform-provisioning --project-ref zoveazvwvyayugladuvl --no-verify-jwt
```
Las demás funciones (registro de usage) no son necesarias para el receptor; si se despliegan, conservar
`--no-verify-jwt` en desk-intake, email-webhook, portal-ticket, voice-recording, whatsapp-webhook, teams-webhook,
triage-worker y comprobar `functions list`. Luego marcar PR #8 ready y mergear (eChange no tiene integración GitHub).

### 5.3 eSupplier `glmgxzlloyqhcoercsjh`
```bash
# 1) prerequisito + 20260928300000 en UNA transacción (sin ventana sin upsert_agent_config_rpc)
supabase-cli-ebim db query --linked --project-ref glmgxzlloyqhcoercsjh -f $S/apply-esupplier/step1-prereq-plus-300000.sql
supabase-cli-ebim db query --linked --project-ref glmgxzlloyqhcoercsjh "select proname, prosecdef, proacl::text from pg_proc where proname in ('upsert_agent_config_rpc','upsert_agent_config_rpc__inner','esup_tenant_has_addon','esup_addon_for_agent')"
#    esperado: __inner existe sin EXECUTE para anon/authenticated; el wrapper sin anon, con authenticated
cd $S/push-esupplier       # 126 fetch + 20260928300000 + las 6 restantes
supabase-cli-ebim migration repair --status applied 20260928300000 --linked --project-ref glmgxzlloyqhcoercsjh
supabase-cli-ebim db push --linked --project-ref glmgxzlloyqhcoercsjh --dry-run   # exactamente 6
supabase-cli-ebim db push --linked --project-ref glmgxzlloyqhcoercsjh
```
**No** marcar `20260815135000` como aplicada (solo se aplicó su bloque de `upsert_agent_config_rpc`).
Nunca aplicar `20260818130000`. Relabel del target `esupplier-shared-dev` a QAS: el único consumidor verificado
es MasterAdmin QAS → seguro; se hace en Wave 4 con sesión de super admin.

### 5.4 MasterAdmin `jivgwrczgdpsuvqcwqku`
```bash
cd $S/apply-masteradmin    # origin/dev supabase/; dry-run verificado = 24
supabase-cli-ebim db push --linked --project-ref jivgwrczgdpsuvqcwqku
supabase-cli-ebim functions deploy entitlement-sync provisioning-orchestrator --project-ref jivgwrczgdpsuvqcwqku
supabase-cli-ebim db advisors --linked --project-ref jivgwrczgdpsuvqcwqku --type security --level warn
```
`usage-ingest`: no desplegar (no hace falta para cerrar QAS). Sin merge de masteradmin a `qas` hasta desactivar
«Deploy to production».

Consola QAS con la sesión del EBIM_SUPER_ADMIN, **un producto a la vez**, solo tras receptor sano:
```sql
select platform.import_capability_manifest('<product_code>', '<manifest json obtenido por GET firmado>');
select platform.configure_entitlements_integration('<integration_id>',
  '<entitlements_path>', '<manifest_path>', '<product>:entitlements:write', '<product>:entitlements:read');
select platform.set_commercial_cutover_state('<integration_id>', 'ENTITLEMENTS', 'SHADOW', 'CCP QAS GATE C');
select platform.set_entitlements_push_enabled('<integration_id>', true, 'CCP QAS GATE C');
```
Rutas: Supabase SaaS `'/tenants/{controlPlaneTenantId}/entitlements'`, `'/entitlements/manifest'`;
EWM `'/internal/platform/v1/tenants/{controlPlaneTenantId}/entitlements'`, `'/internal/platform/v1/entitlements/manifest'`;
TMS `'/internal/platform-provisioning/tenants/{controlPlaneTenantId}/entitlements'`, `'/internal/platform-provisioning/entitlements/manifest'`.
Rollback: `set_entitlements_push_enabled(<id>, false, '<motivo>')` manteniendo SHADOW.

### 5.5 Render (sin credenciales en el agente) — `EWM_WAITING_RENDER=YES`, `TMS_WAITING_RENDER=YES`
- `ewm-rsxs`: `WMS_ENTITLEMENTS_ENVIRONMENT=QAS` (obligatoria: sin ella todo PUT → 422). Verificar
  `WMS_PLATFORM_M2M_ENABLED=true`, `WMS_PLATFORM_M2M_ISSUER=masteradmin.ebim`, `WMS_PLATFORM_M2M_AUDIENCE=ewm.ebim`,
  `WMS_PLATFORM_M2M_PUBLIC_KEY` (pública de `~/.ebim-keys/masteradmin/ewm/qas`), `WMS_DEPLOYMENT_ENVIRONMENT=QAS`.
  Si el perfil incluye `supabase` y `ALLOW_SHARED_DB_MIGRATIONS` no está en 1: ponerlo en `1` solo para el
  arranque que aplica V51–V53, confirmar `flyway_wms_schema_history` = 53 y volver a `0`.
- `tms-myss`: averiguar en el log de deploy por qué 90d93da no quedó vivo; `TMS_ENTITLEMENTS_ENVIRONMENT=QAS`;
  verificar `TMS_PLATFORM_M2M_ENABLED=true` (health M2M ya 200) y `TMS_PLATFORM_M2M_PUBLIC_KEY`.
- Después: PR ready → merge → deploy → Flyway (EWM V53, TMS V56) → health → manifest 401 sin token.
- No aplicar la migración Supabase D-14 de EWM `20260929084334`.

## 6. Estado por producto

| Producto | Estado |
|---|---|
| MasterAdmin | LEGACY_ONLY, push OFF; 24 listas (dry-run); WAITING operador + super admin + integración |
| EWM | CI fix en dev `24a57d6`; EWM_WAITING_RENDER |
| TMS | TMS_WAITING_RENDER |
| eSupplier | ESUPPLIER_PREREQUISITE_FIXED=NO (runtime); paquete listo §5.3 |
| Comerza | WAITING_EXTERNAL_APPROVAL; dry-run = 4 (`20260929130000` ya vigente e idempotente + 3 CCP) |
| eChange | backup OK, dry-run = 8; aplicación denegada por el runtime; paquete listo §5.2 |
| eExpense | BLOCKED_QAS_ENVIRONMENT (CMH live) |
| eCommerce | 3 pre-D14 verificadas, SHADOW, secrets OK; falta deploy del receptor §5.1 |
| GMAO | BLOCKED_PRD_SHARED |

D-14 aplicada: NO. PRIMARY: NO. Billing authority: sin cambio. Usage: OFF. PRD: no tocado. Force push: no.

## 7. eExpense y GMAO — propuesta de QAS aislado (sin ejecutar)

Ninguno de los dos tiene un procedimiento documentado de QAS aislado (a diferencia de eChange, §6 de
`AISLAMIENTO_DE_AMBIENTES_Y_QAS.md`), así que no se creó nada. Propuesta para decisión humana:

1. Crear proyectos Supabase nuevos `eExpense-QAS` y `GMAO-QAS` (Dashboard, org EBIM).
2. Prerequisito: la cadena de migraciones debe reconstruir desde cero. Hoy no está demostrado:
   eExpense tiene 20 migraciones de junio–julio registradas con otro nombre/versión; GMAO comparte solo 3
   versiones entre git e historial remoto (99 divergentes). Primero un rebuild LOCAL (`supabase db reset`)
   con las migraciones de `origin/dev` **excluyendo las D-14**, y pgTAP/tests verdes.
3. Guardia de ref (`[ "$QAS_REF" != "<ref actual>" ] || STOP`), `db push` solo porque el proyecto es nuevo y vacío.
4. Sin copiar datos ni secretos de CMH/PRD: secrets QAS nuevos con las claves públicas M2M QAS existentes
   (`~/.ebim-keys/masteradmin/{eexpense,gmao}/qas`), `EBIM_ENTITLEMENTS_ENVIRONMENT=QAS`, usage OFF.
5. GMAO además es hub de identidad: el QAS aislado necesita su propio hub o apuntar los demás QAS al hub
   aislado; decidirlo antes (afecta `VITE_EBIM_HUB_URL` de los SaaS).
6. Repuntar en MasterAdmin `eexpense-shared-qas` / `gmao-shared-qas` al nuevo ref con sesión de super admin.

Hasta entonces: `EEXPENSE=BLOCKED_QAS_ENVIRONMENT`, `GMAO=BLOCKED_PRD_SHARED`. Nada aplicado en
`uvjmdphlnpyhtohobvzx` ni `xikbhkfeaosasdltartg`.

Nota: `masteradmin/CLAUDE.md` dice «Nunca reset/link/push contra Supabase remoto»; el `db push` de §5.4 contra
QAS lo cubre la autorización GATE C explícita, pero conviene que lo ejecute el operador consciente de esa regla.
