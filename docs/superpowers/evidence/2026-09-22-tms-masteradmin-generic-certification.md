# TMS · Certificación GENERIC MasterAdmin → TMS QAS

**Fecha:** 2026-09-22. **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` (`supabase/.temp/project-ref` verificado). **PRD:** no se toca.
**TMS QAS:** `https://tms-myss.onrender.com`. Contrato: `TMS@origin/qas` `cc104d5`, `docs/platform-provisioning/MASTERADMIN_GENERIC_CONTRACT.md` (leído en modo sólo lectura; el repositorio TMS no se modificó).
**MasterAdmin HEAD:** `9c7abca`. Sin cambios de código en MasterAdmin, TMS, Render ni en el adaptador GENERIC.

**Veredicto: TMS_MASTERADMIN_GENERIC_CERTIFIED**

## 1. Resumen

| Paso | Resultado | Evidencia |
| --- | --- | --- |
| Entorno del operador | PASS | `TMS_QAS_OPERATOR_EMAIL` / `_PASSWORD` presentes (nunca impresos) |
| Login | PASS | `signInWithPassword` con la clave publicable de QAS, igual que el frontend (`src/lib/supabase.ts`). Sin `service_role`, sin admin API |
| Autorización | PASS | Usuario `10000000-0000-4000-a000-000000000001`, `EBIM_SUPER_ADMIN`; `my_provisioning_permissions` incluye `credentials`, `integration`, `deployment` (manage) y `provisioning.{read,execute,retry,cancel}` |
| Secret | PASS | `TMS_QAS_M2M_PRIVATE_KEY` presente (sólo el nombre). El digest que publica la CLI coincide con el SHA-256 del PKCS#8 de una línea de la clave local `~/.ebim-keys/masteradmin/tms/qas` (`d55865d2…`) |
| Producto | PASS | `tms` = `20000000-0000-4000-a000-000000000003` |
| Configuración | PASS | §2 |
| CHECK_HEALTH | PASS | `HEALTHY`, «El producto respondió 200» (una ejecución en DRAFT y una tras habilitar) |
| CREATE (PROVISION) | PASS | Un solo PROVISION: `ACTIVE`, `attempts 1`, mapping `ACTIVE` |
| Replay directo | PASS | `200`, `replayed: true`, mismos IDs |
| GET directo | PASS | `200`, `status ACTIVE`, mismos IDs |
| Duplicados | NONE | §4 |
| Billing | DRY_RUN | Sin suscripción, factura ni pago (§5) |

## 2. Configuración en MasterAdmin (RPC oficiales, sesión de operador)

| Recurso | Id | Valores |
| --- | --- | --- |
| Plan `tms-shared-standard` «TMS Shared Standard» | `d259243f-2681-4db1-ae07-0ec32c925fa6` | SHARED, `ACTIVE`, **sin tarifa** (0 `plan_prices`) |
| Integración `tms-provisioning-v1` «TMS Platform Provisioning v1 (GENERIC)» | `90663d54-f697-4154-b699-dd15d0cf4cc6` | `HTTP_M2M`, `adapter_key GENERIC`, contrato `v1`, ES256, TTL 120, `masteradmin.ebim` → `tms.ebim`, sub `masteradmin-provisioning`, `tms:tenant:create` / `tms:tenant:read`, rutas `/internal/platform-provisioning/{health,tenants,tenants/{controlPlaneTenantId}}`, `allowed_hosts ['tms-myss.onrender.com']`, política `MANUAL`; **`READY`, `enabled true`** |
| Credencial `tms-qas-m2m` | `d128c5d9-a3c1-43bb-90cb-4b6da8e27bf6` | `M2M_ASYMMETRIC_JWT`, QAS, ES256, `masteradmin.ebim`/`tms.ebim`, TTL 120, `secret_ref TMS_QAS_M2M_PRIVATE_KEY` (leído con `reveal_credential_secret_ref`, auditado), `secret_configured true`; **`enabled true`** |
| Destino `tms-shared-qas` «TMS Compartido · QAS» | `90f55252-cf06-4d7b-b788-721be461fb2a` | SHARED, QAS, `https://tms-myss.onrender.com`, `timeout 30000`, `retry 2`, integración y credencial anteriores; **`READY`, `provisioning_enabled true`, `health HEALTHY`** |

Orden: los cuatro recursos se crearon en DRAFT/deshabilitados (`upsert_plan`, `upsert_product_integration`, `upsert_credential_profile`, `upsert_deployment_target`, `configure_deployment_provisioning`) → CHECK_HEALTH → habilitación autorizada por el usuario. La habilitación releyó cada fila y volvió a enviar sus valores actuales. Diff posterior: integración `[enabled, status, updated_at]`; destino `[updated_at, provisioning_status, provisioning_enabled]`; `secret_ref` idéntico antes y después.

## 3. Alta smoke y CREATE

Onboarding **NON_BILLABLE_SANDBOX**, autorizado por el usuario: `onboard_customer_subscription` con `tenant_type SANDBOX`, `billing_interval ONE_TIME`, sin fees y `provisioning_mode DRY_RUN`. La plataforma exige una tarifa regional positiva para cualquier suscripción; sin precio comercial TMS, este es el camino oficial que no crea suscripción ni inventa tarifa.

| Dato | Valor |
| --- | --- |
| Organización | `28ef2ec4-9d64-471b-a30a-904477754f8c`, slug `ebim-tms-qas-smoke-1790087193`, «EBIM TMS QAS Smoke», `PE` |
| Sociedad | `c27e1e8b-588b-48d7-a07b-8388e47c42e3`, «EBIM TMS QAS Smoke Peru», `PE`, `PEN`, por defecto, `erp_code` nulo |
| Tenant (`controlPlaneTenantId`) | `ab65e4cc-581c-4432-91d4-d6dbe40b9b61`, SANDBOX, SHARED |
| `tenantCode` enviado | `EBIM-TMS-QAS-SMOKE-1790087193` (29 caracteres, cumple `^[A-Z0-9][A-Z0-9_-]{1,31}$`) |
| Admin | `tms.masteradmin.smoke+1790087193@ebim.test` (dominio de prueba; no se creó ningún usuario Auth) |
| Suscripción | ninguna (`subscription_id null`) |
| Cola V2 | `4056b47d-de46-442b-81f6-0390b4d56da1`, `CREATE_TENANT_SPACE`, `DRY_RUN`, `PENDING` |
| Solicitud SaaS | `c09c57c5-bdd3-481d-8d7b-3dabce1aadb7`: `READY_TO_PROVISION`, destino `tms-shared-qas`, política `MANUAL`. `check_provisioning_preconditions` → `can_execute true`, sin blockers |
| `idempotencyKey` | `ma-prov-v1-bc817395bf2e1b79d1bcd3c91c1278f88451d1a7ef6016457f6291b17c93c9d6` |
| `correlationId` | `aa78df8e-ff49-4136-b412-195ba952126c` |

**PROVISION** (una sola invocación de `provisioning-orchestrator` con la sesión del operador): `status ACTIVE`, `attempts 1`, mapping `77c2a53d-0be0-4b0f-80ba-a8f04f23eae0` `ACTIVE`, `external_tenant_id 74dc77a0-834b-4cdc-a2ca-069ab9824dd1`.

Código HTTP del CREATE: el flujo GENERIC no registra el `provider_http_status` (a diferencia de EWM_V1, no escribe `PROVIDER_REQUEST_FINGERPRINT`). Fue un 2xx no replay: la solicitud pasó a `ACTIVE` con `attempts 1`, y el replay posterior devolvió el mismo `provisionedAt` (`2026-09-22T14:27:09.210088Z`, dentro del PROVISION), así que ese fue el alta. Por contrato (§4), el primer alta responde `201`.

Timeline (`saas_provisioning_events`): `REQUEST_CREATED` → `PROVISIONING_STARTED` (attempt 1) → `PROVISIONING_COMPLETED`.

## 4. Replay y GET directos

Llamadas desde el equipo del operador, fuera de MasterAdmin. Cada una lleva un JWT ES256 fresco firmado con la clave local de TMS QAS (la misma del secret, §1), con los mismos claims que el orquestador (`iss masteradmin.ebim`, `aud tms.ebim`, `sub masteradmin-provisioning`, TTL 120, `jti` nuevo, `actor_id`/`actor_role` del operador, `correlation_id` de la solicitud). Ni el token ni la clave se imprimieron ni se guardaron.

| Llamada | Petición | Respuesta |
| --- | --- | --- |
| Replay | `POST /internal/platform-provisioning/tenants`, scope `tms:tenant:create`, **misma `Idempotency-Key`**, cuerpo GENERIC reconstruido de las filas de MasterAdmin con el orden de claves del jsonb (SHA-256 del cuerpo enviado `ccd53cf3ad709381f2c58aae3cb60e21026e9fa1ad2843173d1555dba2f91d7f`) | **`200`**, `replayed true`, `status ACTIVE` |
| GET | `GET /internal/platform-provisioning/tenants/ab65e4cc-581c-4432-91d4-d6dbe40b9b61`, scope `tms:tenant:read` | **`200`**, `status ACTIVE` |

`requestHash`: TMS calcula el hash de idempotencia internamente y no lo devuelve. Con la misma clave, un hash distinto habría dado `409 IDEMPOTENCY_CONFLICT`; el `200 replayed:true` prueba que coincide con el del CREATE. El SHA-256 de arriba es la huella del lado de MasterAdmin.

**Identificadores** (mapping = replay = GET):

| Campo | Valor |
| --- | --- |
| `controlPlaneTenantId` | `ab65e4cc-581c-4432-91d4-d6dbe40b9b61` |
| `externalTenantId` = `externalOrganizationId` (TMS `organization.id`) | `74dc77a0-834b-4cdc-a2ca-069ab9824dd1` |
| `externalCompanyId` | `9e6b85f2-2d10-435e-91df-12c37059fb14` |
| `rawReference` (TMS `platform_provisioning_request.id`) | `34ad9867-58b2-4fe0-abd6-082b73539836` |
| `resources` | `organizationCode`/`companyCode` `EBIM-TMS-QAS-SMOKE-1790087193`, `companyTimeZone America/Lima`, `adminStatus PREPROVISIONED`, `adminProfileReused false`, `organizationActive true`, `companyActive true` |

**Sin duplicados:** en MasterAdmin hay 1 solicitud y 1 mapping TMS (el `updated_at` del mapping sigue siendo el del CREATE), 1 organización smoke y 1 sociedad. En TMS, replay y GET devuelven el mismo `rawReference`, la misma organización y la misma sociedad; por contrato (§5), un replay sólo escribe una fila de auditoría `REPLAYED`. El agente no tiene acceso a la base de TMS: la evidencia es la respuesta del contrato. **Admin:** `adminStatus PREPROVISIONED`, leído en vivo en el GET (`auth_user_id` sigue nulo); no hubo activación Auth.

## 5. Billing y aislamiento

- Billing `DRY_RUN`: 0 suscripciones TMS, 0 facturas y 0 pagos de la organización smoke, 0 tarifas en `tms-shared-standard`. La cola V2 queda en `DRY_RUN`.
- EWM y eSupplier: las integraciones `esupplier-manual`, `esupplier-provisioning-v1`, `ewm-mock-local` y `ewm-provisioning-v1`, y los 10 destinos que había antes, son idénticos (hash de fila completo) antes y después.
- PRD: sin tráfico. Todas las llamadas fueron a `jivgwrczgdpsuvqcwqku.supabase.co` y a `tms-myss.onrender.com`.
- Sin `service_role`, sin INSERT/UPDATE directos.

## 6. Estado final

| Elemento | Estado |
| --- | --- |
| TMS QAS | `/actuator/health/readiness` → `200 {"status":"UP"}`; `/internal/platform-provisioning/health` → `200 {"status":"ok"}` |
| Flyway | `V51__platform_provisioning` en servicio (inferido: sus endpoints y tablas responden; `/actuator/flyway` exige autenticación y no se consultó) |
| Credencial / integración / destino | `enabled` / `READY`+`enabled` / `READY`+`provisioning_enabled`, `HEALTHY` |
| Solicitud / mapping | `ACTIVE` / `ACTIVE` |

Se deja habilitado a propósito. El tenant smoke queda en TMS QAS (el contrato no tiene `DELETE`).

## 7. Mutaciones remotas (sólo QAS `jivgwrczgdpsuvqcwqku` y TMS QAS)

1. `upsert_plan` `tms-shared-standard`
2. `upsert_product_integration` `tms-provisioning-v1` (DRAFT) y después (READY, enabled)
3. `upsert_credential_profile` `tms-qas-m2m` (deshabilitada) y después (enabled)
4. `upsert_deployment_target` `tms-shared-qas`
5. `configure_deployment_provisioning` (vínculo, DRAFT) y después (READY, enabled)
6. `CHECK_HEALTH` ×2 → `set_deployment_health HEALTHY`
7. `reveal_credential_secret_ref` (lecturas auditadas)
8. `upsert_organization`, `upsert_company`, `onboard_customer_subscription` (tenant SANDBOX y cola V2 DRY_RUN), `create_saas_provisioning_request`
9. `PROVISION` ×1 → TMS crea organización, sociedad, admin PREPROVISIONED y solicitud
10. TMS directo: replay `POST` ×1 (sólo auditoría `REPLAYED`) y `GET` ×1 (lectura)
