# EWM V1 · Acta de certificación QAS

**Proyecto QAS MasterAdmin:** `jivgwrczgdpsuvqcwqku` («AdminMaestro»). **PRD:** no se toca.
**EWM QAS:** `https://ewm-rsxs.onrender.com` (contrato `WMS-by-EBIM@origin/qas` `7e45d70`).
**Rama:** `feat/ewm-adapter`. **Plan:** `docs/superpowers/plans/2026-09-21-ewm-masteradmin-adapter-implementation.md`.

## 1. Estado

| Paso | Estado | Evidencia |
| --- | --- | --- |
| Gate local (Task 13) | PASS | pgTAP 797/797 · vitest 598/598 · E2E local 63 + dorada 2 · typecheck, lint, build, `secrets:scan` · advisors locales: 0 hallazgos nuevos |
| Huella de la clave (H5) | PASS | P-256 SEC1; pública derivada = `masteradmin-public.pem` (`6fac1a327f7e5813…`) |
| Formato PKCS#8 de una línea (H15, local) | PASS | Importa con WebCrypto; misma huella `6fac1a327f7e5813…` |
| Secret `EWM_QAS_M2M_PRIVATE_KEY` (Task 14) | PASS (operador) | Ver §1.1 |
| Migración `20260921000100` (Task 15) | PASS (operador) | Aplicada; advisors en §1.1 |
| Despliegue `provisioning-orchestrator` (Task 16) | PASS (operador) | v4; CORS en §1.1 |
| Configuración EWM (Task 17) | PASS | Tres registros en DRAFT/deshabilitados; §1.1 |
| Pre-activación y habilitación (Task 18) | PASS | Prechecks §1.1; habilitación en orden §1.2 |
| Test Connection M2M (Task 19) | PASS | `GET_STATUS` → `404` + `RESOURCE_NOT_FOUND` de EWM; §1.3 |
| Create / Replay / Get (Tasks 20–22) | PASS | `201` / `200 replayed:true` / `200 found`; §1.4 |
| Seguridad y advisors (Task 23) | PASS_WITH_ACCEPTED_EXCEPTIONS | 107 WARN / 0 ERROR, idéntico al post-migración; sin fugas; §1.5 |
| Dorada GENERIC (Task 24) | PASS | `http-m2m.generic-golden.test.ts` 12/12; un solo commit (`06e95aa`) |

**Veredicto: EWM_CERTIFIED** (2026-09-21, HEAD `c007f79`, `provisioning-orchestrator` v4).

## 1.1 Prechecks de certificación (2026-09-21, HEAD `c007f79`, sólo lectura)

| Precheck | Resultado | Evidencia |
| --- | --- | --- |
| Proyecto enlazado | PASS | `supabase/.temp/project-ref` = `jivgwrczgdpsuvqcwqku` |
| Secret | PASS | `secrets list`: `EWM_QAS_M2M_PRIVATE_KEY` presente (sólo el nombre); `credential_profiles.secret_configured = true` |
| Función | PASS | `provisioning-orchestrator` v4 `ACTIVE`, `verify_jwt = true`; la fuente descargada contiene el hardening de `a3aa1fc` (`AMBIENTE_NO_CERTIFICABLE`, `ADMIN_EMAIL_NOT_ALLOWED`, `TIMEZONE_INVALID`) |
| CORS | PASS | `OPTIONS` → `204`, `access-control-allow-origin: http://127.0.0.1:5199`; `POST` sin sesión → `401` |
| EWM QAS alcanzable | PASS (sólo infraestructura) | `GET /actuator/health` → `200 {"status":"UP"}`. No certifica el M2M |
| `ewm-provisioning-v1` | PASS | `adapter_key EWM_V1`, `HTTP_M2M`, ES256, TTL 300, `masteradmin.ebim` → `ewm.ebim`, `ewm:tenant:create` / `ewm:tenant:read`, rutas create/status/health del contrato, `allowed_hosts ['ewm-rsxs.onrender.com']`; `DRAFT`, `enabled false` |
| `ewm-qas-m2m` | PASS | `M2M_ASYMMETRIC_JWT`, ES256, `secret_ref EWM_QAS_M2M_PRIVATE_KEY`, QAS; `enabled false` |
| `ewm-shared-qas` | PASS | `base_url https://ewm-rsxs.onrender.com` (host ∈ `allowed_hosts`), QAS, `timeout 30000`, `retry 2`; `DRAFT`, `provisioning_enabled false` |
| Otros SaaS (H3) | PASS | `ewm-mock-local`, `esupplier-manual` y sus destinos DEV: `adapter_key GENERIC`, `updated_at` del seed (sin cambios) |

### SECURITY_ADVISORS: PASS_WITH_ACCEPTED_EXCEPTIONS

`supabase db advisors --linked --type security`: **107 WARN, 0 ERROR** (línea base previa a la migración: 104). El conjunto es idéntico al capturado tras la migración (sin cuarto warning nuevo). Las 3 diferencias son `authenticated_security_definer_function_executable` sobre:

| Excepción aceptada | Verificación en QAS |
| --- | --- |
| `platform.can_read_saas_provisioning(uuid)` | `SECURITY DEFINER`, `search_path=platform, pg_catalog`; ACL `postgres, authenticated, service_role` (anon y PUBLIC sin `EXECUTE`). Solicitud inexistente → `false`; si no, `has_product_permission('platform.provisioning.read', producto)` |
| `platform.can_certify_saas_provisioning(uuid)` | Igual ACL y `search_path`. Inexistente → `false`; `provisioning_environment <> 'PRD'` **y** `has_product_permission('platform.provisioning.retry', producto)` |
| `platform.set_saas_provisioning_configuration(uuid, jsonb)` | Igual ACL y `search_path`. Inexistente → `P0002`; sin `platform.provisioning.execute` → `42501`; congelada tras el primer intento; `resolvedCurrency` la fija el servidor |

`has_product_permission` descansa en `auth.uid()`: sin sesión devuelve `false` (fail-closed). No hay ninguna función sobrecargada en el esquema `platform` (no quedan versiones viejas; `upsert_product_integration` tiene una sola firma, con `p_adapter_key`). Los otros dos warnings no provienen de `20260921000100` (`next_renewal_date`, `auth_leaked_password_protection`).

### Intentos previos bloqueados (histórico, sin cambios en QAS)

La activación debe hacerse por la UI/RPC oficial con una sesión de operador. El worktree no tiene `.env.local`, y el harness denegó materializar la clave pública de QAS para el dev server; tampoco hay credenciales de operador (`EWM_QAS_OPERATOR_EMAIL`/`_PASSWORD`) en el entorno. No se habilitó nada: credential, integration y deployment siguen DRAFT/deshabilitados. No se ejecutó ninguna llamada a EWM fuera del health check.

**Reintento (2026-09-21, HEAD `c007f79`):** el operador copió `.env.local` y exportó `EWM_QAS_OPERATOR_EMAIL`/`_PASSWORD` (ambas presentes; no se leyó su valor). La guardia previa 1 (verificar que `.env.local` apunta a `jivgwrczgdpsuvqcwqku`) no pudo completarse: el harness denegó toda lectura de `.env.local`, incluida una comprobación de sólo sí/no, y por la misma razón el dev server no puede cargarlo para autenticar al operador. HARD STOP antes de autenticar: no hubo activación, ni Test Connection, ni Create/Replay/Get. Estado final sin cambios: `ewm-qas-m2m` `enabled false`; `ewm-provisioning-v1` `DRAFT`, `enabled false`; `ewm-shared-qas` `DRAFT`, `provisioning_enabled false`.

**Resolución:** el operador verificó por fuera del agente que `.env.local` apunta a `https://jivgwrczgdpsuvqcwqku.supabase.co` con `VITE_APP_ENV=QAS`, levantó el frontend en `http://127.0.0.1:5199` y exportó las credenciales. El agente no leyó `.env.local`: la guardia se hace dentro del navegador, tras el login, sobre `env.supabaseUrl` y `env.appEnv` de la propia app (§1.2).

## 1.2 Ejecución de certificación (2026-09-21, HEAD `c007f79`)

**Camino:** navegador Chromium (Playwright) → `http://127.0.0.1:5199/login` → login por la UI con `EWM_QAS_OPERATOR_EMAIL`/`_PASSWORD` (variables de proceso; nunca impresas) → cliente Supabase de la app con la sesión del operador. Las escrituras usan las mismas RPC que llaman los diálogos de la consola, y la ejecución invoca `provisioning-orchestrator` desde el navegador (atraviesa CORS): MasterAdmin → `provisioning-orchestrator` → `EWM_V1` → firmante ES256 → EWM QAS. El script del driver vivió en `$TMPDIR`, fuera del repositorio. La spec `e2e/v4-ewm-qas-certification.spec.ts` hace las mismas llamadas, pero no se usó porque su `playwright.config.ts` arranca su propio servidor (`reuseExistingServer: false`) y el puerto 5199 ya lo ocupaba el frontend QAS del operador.

**Guardia y red:** en cada corrida, tras el login, `env.supabaseUrl` → host `jivgwrczgdpsuvqcwqku.supabase.co` y `env.appEnv = QAS`; si no, se abortaba antes de cualquier llamada. Hosts de red observados en el navegador, además de `127.0.0.1:5199`: sólo `https://jivgwrczgdpsuvqcwqku.supabase.co` y los CSS/fuentes estáticos de `fonts.googleapis.com`/`fonts.gstatic.com`. EWM nunca recibe llamadas del navegador, sólo de la Edge Function.

**Operador:** `10000000-0000-4000-a000-000000000001`, `is_super_admin true`; `my_provisioning_permissions` incluye `platform.credentials.manage`, `platform.integration.manage`, `platform.deployment.manage` y `platform.provisioning.{read,execute,retry,cancel}`.

**Pre-estado:** `ewm-qas-m2m` `enabled false` (`secret_configured true`); `ewm-provisioning-v1` `DRAFT`, `enabled false`, `adapter_key EWM_V1`; `ewm-shared-qas` `DRAFT`, `provisioning_enabled false`. En QAS no había ninguna `saas_provisioning_request`.

**Habilitación, en orden.** Cada paso relee la fila, compara el resto de columnas y hace una foto de todas las integraciones, credenciales y destinos:

| # | Recurso | RPC | Persistencia | Auditoría (`audit_logs`) | Otros recursos cambiados |
| --- | --- | --- | --- | --- | --- |
| 1 | `ewm-qas-m2m` | `upsert_credential_profile` con los valores actuales y `p_enabled true`. Las referencias se leen con `reveal_credential_secret_ref` (auditado, #13/#15) para no borrarlas | `enabled true`; `secret_ref` y `public_key_ref` idénticos antes y después | #14 `CREDENTIAL_PROFILE_UPDATED`, `changed_fields [enabled, updated_at]` | ninguno |
| 2 | `ewm-provisioning-v1` | `upsert_product_integration` con los valores actuales, `p_adapter_key EWM_V1`, `p_status READY`, `p_enabled true` | `READY`, `enabled true`, `EWM_V1`; ninguna otra columna cambió | #16 `INTEGRATION_UPDATED`, `changed_fields [status, enabled, updated_at]` | ninguno |
| 3 | `ewm-shared-qas` | `configure_deployment_provisioning` con sólo `p_provisioning_status READY` y `p_provisioning_enabled true` | `READY`, `enabled true`; `base_url`, `timeout 30000`, `retry 2` y QAS intactos | #17 `DEPLOYMENT_PROVISIONING_CONFIGURED`, `changed_fields [updated_at, provisioning_status, provisioning_enabled]` | ninguno; no había solicitudes `WAITING_INFRA` que promover |

Los demás SaaS no cambian (H3): `esupplier-manual` y `ewm-mock-local` siguen `GENERIC`/`READY` con el `updated_at` del seed, `ewm-dev-none` sin cambios, y los otros 9 destinos igual.

**Datos del alta (Task 19, sólo MasterAdmin, sin llamadas a EWM):**

| Dato | Valor |
| --- | --- |
| Organización | `6b893f04-d406-4f74-8858-56f93f41fbd4`, slug `ebim-ewm-qas-smoke-1790019193`, «EBIM EWM QAS Smoke», `PE` |
| Sociedad por defecto | `9b67552f-4afc-4da0-a80e-5bc69b4b09db`, `PEN`, mercado `PE` |
| Tenant (`controlPlaneTenantId`) | `1d429f6f-599b-4813-8500-7512f7687b4a`, SHARED, alta por `onboard_customer_subscription` (plan `ewm-shared-standard`, suscripción `7d77c737-…` en DRAFT, sin activar ni facturar; cola V2 `DRY_RUN` `a0c3c5e0-…`) |
| Admin | `ewm.masteradmin.smoke+1790019193@ebim.test` · `admin.fullName` «EBIM QAS Smoke Admin» |
| Solicitud | `a6923dfd-7927-4506-af8e-893f37903978` → `READY_TO_PROVISION`, destino resuelto `ewm-shared-qas` (1 candidato), política `MANUAL` |
| Clave de idempotencia | `ma-prov-v1-8b40f9d52ae11bf63809f9c6e7ff66b5c4111877e1bcb25f7c47542a688313bd` |
| `product_configuration` (congelada) | `organizationTimezone America/Lima`; `initialWarehouse {code WH-001, name «Almacen Principal», timezone America/Lima}`; `admin.fullName`; `resolvedCurrency PEN`, fijada por el servidor |
| Capacidades | `adapter_key EWM_V1`, `{PROVISION, GET_STATUS, REPLAY_CERTIFICATION}`; `check_provisioning_preconditions` → `can_execute true`, sin blockers |

## 1.3 Test Connection M2M (Task 19) — PASS

`GET_STATUS` sobre la solicitud, antes del alta (el `controlPlaneTenantId` todavía no existe en EWM). El JWT lo firma la función con la configuración de `ewm-provisioning-v1`: `iss masteradmin.ebim`, `aud ewm.ebim`, ES256, TTL 300 y scope `ewm:tenant:read`. Que `getStatus` firme con el scope de lectura y nunca con `ewm:tenant:create` lo prueba `ewm-v1.test.ts`. El JWT no sale de la función.

| Campo | Valor |
| --- | --- |
| HTTP de la función | `200` |
| `provider_http_status` | **`404`** |
| `provider_code` | **`RESOURCE_NOT_FOUND`**, el código RFC 7807 de EWM (no `PROVIDER_NOT_FOUND`: H14 no aplica) |
| `found` / `mapping_consistent` | `false` / `true` |
| Solicitud | sigue `READY_TO_PROVISION`, `attempt_count 0` |
| Evento | `STATUS_CHECKED` (`provider_http_status 404`) |

EWM validó la firma ES256, el `iss`, el `aud` y el scope, y llegó a la capa de negocio. No hubo `401`/`403`, 404 genérico, HTML, timeout ni error de conexión.

## 1.4 Create / Replay / Get (Tasks 20–22) — PASS

| Paso | Acción | Resultado |
| --- | --- | --- |
| Create | `PROVISION` | Función `status ACTIVE`, `attempts 1`. **EWM `201`** (evento `PROVIDER_REQUEST_FINGERPRINT`, `provider_http_status 201`, `body_sha256 e582206e…208a24`). Sin evento `PROVIDER_REPLAYED`: fue un alta nueva |
| Replay | `REPLAY_CERTIFICATION` (misma solicitud, misma clave, misma configuración congelada; la huella del cuerpo coincide antes de llamar) | **EWM `200`**, `replayed true`, `identifiers_match true`, `duplicate false`, `certified true`. Evento `REPLAY_CERTIFICATION_PASSED` |
| Get | `GET_STATUS` | **EWM `200`**, `found true`, `remote.status ACTIVE`, `mapping_consistent true`, `provider_code null`. Evento `STATUS_CHECKED` |

**Identificadores** (Create = Replay = Get = mapping):

| Campo | Valor |
| --- | --- |
| `controlPlaneTenantId` | `1d429f6f-599b-4813-8500-7512f7687b4a` |
| `externalTenantId` (= EWM `companyId`) | `9b67552f-4afc-4da0-a80e-5bc69b4b09db` |
| `externalOrganizationId` | `6b893f04-d406-4f74-8858-56f93f41fbd4` (la organización enviada) |
| `externalCompanyId` | `9b67552f-4afc-4da0-a80e-5bc69b4b09db` (la sociedad enviada) |
| `resources.initialWarehouseId` | `dc8c040d-0874-49e1-b4d4-d2146817be40` |
| `resources.adminAppUserId` · `adminProvisioningStatus` · `deploymentMode` | `97b69a03-b619-4d45-a9b6-dc7cafa5de18` · `PREPROVISIONED` · `SHARED` |
| `external_reference` (EWM `provisioningId`) | `cea8fd83-15f4-40b7-9c4b-6442e873d580` |

**Mapping:** un solo `tenant_product_mappings` (`b61d42db-2bf3-4bc8-a179-f6435fe4b8e7`, `ACTIVE`, destino `ewm-shared-qas`) y una sola solicitud para el tenant. Replay y Get no cambian ni la solicitud (`ACTIVE`, `attempt_count 1`, misma clave) ni el mapping (`updated_at` del Create).

**Sin duplicados en EWM:** con la misma clave, EWM respondió `200 replayed:true` y devolvió los mismos `organizationId`, `companyId`, `initialWarehouseId` y `adminAppUserId` que en el `201`. Por el contrato de idempotencia de EWM (`API_CONTRACT.md`), un replay no crea nada nuevo: se queda en 1 organización, 1 sociedad, 1 almacén y 1 mapping. El agente no tiene acceso a la base de EWM; la evidencia es la respuesta del contrato más el `GET` posterior.

**Timeline** (`saas_provisioning_events`; todos con actor `…0001`, rol `EBIM_SUPER_ADMIN` y correlation `04af4eb4-88a6-452b-b79f-3dd123ab6485`): `REQUEST_CREATED` → `PRODUCT_CONFIGURATION_SET` → `STATUS_CHECKED (404)` → `PROVISIONING_STARTED` (attempt 1, clave de idempotencia) → `PROVISIONING_COMPLETED` → `PROVIDER_REQUEST_FINGERPRINT (201)` → `REPLAY_CERTIFICATION_PASSED (200)` → `STATUS_CHECKED (200)`.

**Auditoría** (`audit_logs` #13–#27): las tres habilitaciones (#14, #16, #17) y las dos lecturas auditadas de la referencia (#13, #15); `ORGANIZATION_CREATED`, `COMPANY_CREATED`, `TENANT_CREATED`, `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_ITEM_CREATED`, `PROVISIONING_ENQUEUED`, `CUSTOMER_ONBOARDED`, `SAAS_PROVISIONING_REQUESTED` con actor `…0001`; `SAAS_PROVISIONING_STARTED`/`_COMPLETED` escritos por la función (`service_role`, actor nulo en la fila de auditoría; el actor queda en el evento).

## 1.5 Post-check de seguridad (Task 23)

| Control | Resultado |
| --- | --- |
| Material sensible en QAS | Recorridas `audit_logs` (24 filas), `saas_provisioning_events` (8), `saas_provisioning_requests`, `tenant_product_mappings`, `product_integrations`, `credential_profiles` (columnas legibles), `deployment_targets` y `tenants` buscando `BEGIN … PRIVATE KEY`, `eyJhbGciOi` (JWT), `service_role`, `sb_secret_` y la contraseña del operador: **0 coincidencias** en todas |
| Navegador | Consola: 0 coincidencias de esos patrones en todas las corridas. Ninguna respuesta del orquestador trae token, cuerpo crudo ni clave |
| Logs de la función | La CLI 2.116.0 no tiene `functions logs`. `provisioning-orchestrator` y los módulos `_shared/provisioning` no contienen ningún `console.*`. El panel de logs de Supabase no se revisó |
| Repositorio | `npm run secrets:scan` PASS; `git grep` de `BEGIN … PRIVATE KEY`/`eyJhbGciOi`/`sb_secret_` sólo encuentra documentación que cita los patrones |
| Advisors | `supabase db advisors --linked --type security`: **107 WARN / 0 ERROR**, conjunto idéntico al post-migración (sin cuarto warning). Excepciones aceptadas sin cambios: `can_read_saas_provisioning`, `can_certify_saas_provisioning`, `set_saas_provisioning_configuration` |
| Dorada GENERIC | `http-m2m.generic-golden.test.ts` **12/12 PASS**; el archivo tiene un solo commit (`06e95aa`) |
| Código | Sin cambios de código desde `c007f79` (`supabase/`, `src/`, `e2e/`). EWM: sin cambios de código ni configuración. Otros SaaS: sin cambios |
| PRD | Intacto. Todo el tráfico fue a `jivgwrczgdpsuvqcwqku`, con `supabase/.temp/project-ref` verificado antes de los advisors |

**Estado final en QAS:** `ewm-qas-m2m` `enabled true`; `ewm-provisioning-v1` `READY`, `enabled true`, `EWM_V1`; `ewm-shared-qas` `READY`, `provisioning_enabled true`. Queda habilitado a propósito. Para volver a DRAFT, ver RB1.

## 2. Runbook del operador (en este orden)

Guardia previa, en el worktree: `[ "$(cat supabase/.temp/project-ref)" = "jivgwrczgdpsuvqcwqku" ] || echo STOP`.

1. **Secret** (ver [M2M.md §5](./M2M.md)):
   ```bash
   supabase secrets set --project-ref jivgwrczgdpsuvqcwqku \
     --env-file <(printf 'EWM_QAS_M2M_PRIVATE_KEY="%s"\n' \
       "$(openssl pkcs8 -topk8 -nocrypt -in "$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem" | tr -d '\n')")
   ```
2. **Migración:** `supabase db push --linked --dry-run` (debe listar sólo `20260921000100`) y después `supabase db push --linked`.
3. **Función:** `supabase functions deploy provisioning-orchestrator --project-ref jivgwrczgdpsuvqcwqku` (sin `--no-verify-jwt`, sin `--prune`).
4. **Configuración** (consola local apuntando a QAS, o RPC como super admin), manteniendo DRAFT/deshabilitado:
   - `ewm-provisioning-v1`: contrato «EWM v1» (`p_adapter_key 'EWM_V1'`), `status_path_template = /internal/platform/v1/tenants/{controlPlaneTenantId}`; el resto ya está en QAS (ES256, TTL 300, `masteradmin.ebim`/`ewm.ebim`, `ewm:tenant:create`/`ewm:tenant:read`, `/internal/platform/v1/tenants`, `/actuator/health`, `allowed_hosts ['ewm-rsxs.onrender.com']`).
   - `ewm-qas-m2m`: `secret_ref EWM_QAS_M2M_PRIVATE_KEY`, ES256 (ya en QAS), deshabilitado hasta los prechecks.
   - `ewm-shared-qas`: `base_url https://ewm-rsxs.onrender.com` (ya en QAS), `timeout 30000`, `retry 2`, DRAFT.
5. **Verificación:** `OPTIONS` 204 con CORS, `POST` sin sesión 401, advisors `--linked --type security` comparados con la línea base (104 hallazgos antes de la migración).

## 3. Rollback

Ver «Rollback QAS» del plan (RB1–RB5). No se ejecutó ningún rollback: no saltó ningún hard stop. Cambios hechos en QAS por esta certificación: la habilitación de §1.2 (revertible con RB1) y las entidades de humo (organización, sociedad, tenant, suscripción DRAFT, solicitud y mapping). Por RB5, el tenant de prueba se queda en EWM QAS (`companyId 9b67552f-4afc-4da0-a80e-5bc69b4b09db`, `controlPlaneTenantId 1d429f6f-599b-4813-8500-7512f7687b4a`), porque el contrato no tiene `DELETE`.
