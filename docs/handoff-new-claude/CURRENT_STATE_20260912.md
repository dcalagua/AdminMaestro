# EBIM Control Plane: estado actual verificado

> Sesión de toma de control técnico, ejecutada el 2026-09-13 (hora local de Lima). El archivo mantiene el nombre solicitado.
> Todas las cifras de este documento salen de comandos ejecutados **en esta sesión**. No se reutilizó ningún PASS de informes anteriores.
> No se cambió código, migraciones, RLS, seed ni configuración. Solo se creó este archivo.

---

## 1. Estado general

**Veredicto: el proyecto está operativo en local y listo para continuar el desarrollo.**

- Todos los quality gates pasan.
- Hay que atender primero un conjunto de defectos de autorización en RPCs (§25) antes de cualquier paso hacia QAS o PRD con usuarios reales de partner o cliente.

| Área | Estado |
|---|---|
| Supabase local (544xx) | ✅ arriba, sin colisión con el otro stack (`lumi-growth`, 5432x), que no se tocó |
| `db reset` (23 migraciones + seed) | ✅ ejecutado 2 veces: inicial y tras E2E, para dejar el seed limpio |
| Frontend `http://127.0.0.1:5199` | ✅ dev server arriba y login verificado |
| pgTAP | ✅ 124/124 |
| Unit (Vitest) | ✅ 54/54 |
| E2E (Playwright) | ✅ 41/41 |
| typecheck / lint / build / secrets | ✅ / ✅ (0 problemas) / ✅ (aviso: bundle de 867 kB) / ✅ |
| Recorrido manual automatizado (22 rutas × 10 usuarios) | ✅ 0 respuestas 4xx/5xx de la API en navegación normal; 3 defectos de UI (§25) |
| Seguridad (RPC SECURITY DEFINER) | ⚠️ 6 huecos de autorización **confirmados** contra la BD viva (§25-A) |

---

## 2. Branch + HEAD

- Branch: `dev`, que sigue a `origin/dev`, sin commits pendientes de push.
- HEAD: `91d8016 docs(v2.1): informe, evidencia Culqi TEST y correcciones de seguridad`.
- Historial: 22 commits. `cf8ad75..91d8016` corresponde a V2 y V2.1.
- Working tree: limpio salvo `?? docs/quality/`, que no se generó en esta sesión. Es una exportación de VS Code Problems con 0 diagnósticos y «Repos: 0», o sea que no analizó nada. No sirve como evidencia.
- `supabase/.temp/project-ref`: **no existe**. El proyecto no está enlazado a ningún remoto, y `supabase status` reporta `linked_project: null`.
- Residuos `.js` en `src/`: 0. Tampoco hay `vite.config.js` ni `playwright.config.js` en la raíz. `.gitignore` los cubre.

---

## 3. Stack tecnológico (versiones reales)

| Herramienta | Versión | Nota |
|---|---|---|
| Node | v24.19.0 vía `nvm use` (`.nvmrc`) | El Node por defecto de la shell es **v24.20.0**. Hay que ejecutar `nvm use` antes de trabajar |
| npm | 11.17.0 (con Node 24.19.0) | Con 24.20.0 es 11.19.0 |
| Docker | 29.7.2 | El socket requiere salir del sandbox de Claude Code |
| Supabase CLI | 2.116.0 | El README dice 2.115.0; hay disponible 2.117.0 y no se actualizó |
| React / React DOM | 19.2.8 | |
| Vite | 7.3.6 | |
| TypeScript | 5.9.3 | |
| TanStack Query | 5.102.8 | |
| supabase-js | 2.113.0 | |
| React Router | 7.18.3 | |
| Zod | 4.5.4 | |
| react-hook-form | 7.87.0 | |
| Tailwind | 3.4.19 | |
| Vitest | 3.2.7 | |
| Playwright | 1.62.1 | Chromium instalado |
| Postgres | 17 | `major_version = 17` |
| Edge runtime | 1.74.3 | Deno 2.1.4 |

**Dependencias:** `node_modules` coincide exactamente con `package-lock.json`: 417 entradas, 0 diferencias de versión y 0 paquetes faltantes. Por eso **no se ejecutó `npm ci`** y el lockfile no se tocó. `npm ls` marca 3 paquetes sobrantes e inocuos: `ajv`, `fast-uri` y `json-schema-traverse`.

---

## 4. Arquitectura

```
Browser (SPA React 19 + Vite, puerto 5199)
   │  supabase-js con la clave anon, schema 'platform'
   ▼
Kong :54421 ─► PostgREST ─► Postgres :54422, schema platform
   │                          ├─ 48 tablas, todas con RLS y FORCE RLS
   │                          ├─ 17 vistas, todas con security_invoker
   │                          └─ 99 funciones: 71 SECURITY DEFINER no-trigger, 68 ejecutables por authenticated (RPC de negocio + helpers RLS)
   └─► Edge Runtime: /functions/v1/{payment-setup, payment-reconcile, culqi-webhook, provisioning-worker}
```

- **Control Plane = gobierno de la suite.** Cubre catálogo, organizaciones, tenants, suscripciones, cobranza, comisiones, costos y despliegues. **No** guarda datos operativos de eSupplier, EWM, TMS, GMAO ni eChange.
- **Autoridad = RLS + RPC.** Los guards de la UI (`RequirePersona`) son solo UX.
- Toda escritura financiera y comercial pasa por RPC. El baseline mantiene escritura directa por PostgREST en `organizations`, `companies`, `memberships`, `tenants`, `tenant_*` y `*_config`, con políticas RLS (ver riesgo R5).
- **El frontend no invoca ninguna Edge Function.** No existe `functions.invoke` ni `fetch` a `/functions/v1` en `src/`.

---

## 5. Migraciones

- **23 migraciones aplicadas**, verificadas en `supabase_migrations.schema_migrations`.
- Última: `20260908000200_billing_contact.sql`.

| Bloque | Migraciones | Contenido |
|---|---|---|
| Baseline `20260902*` | 13 | schema + enums, identidad, productos/tenancy, planes/suscripciones, billing/costos, ventas/comisiones, deployments/provisioning, helpers RLS, políticas, funciones de negocio, vistas de métricas, pgTAP, índices de FK |
| V2 `20260907*` | 8 | RPC de administración, acuerdos de canal v2, onboarding, perfiles de cobro, OS/OC, mapeos de proveedor, alertas/renovaciones, comisiones/finanzas |
| V2.1 `20260908*` | 2 | `provider_server_only` (F-01..F-05) y `billing_contact` |

Objetos vivos en `platform`:

| Objeto | Cantidad |
|---|---|
| Tablas | 48 |
| Vistas | 17 |
| Enums | 37 |
| Funciones distintas | 99 |
| Políticas | 78 |
| Tablas sin RLS+FORCE | 0 |
| Grants a `anon` | 0 |
| USAGE de `anon` sobre el schema | false |

---

## 6. Modelo de datos (resumen)

**Identidad**
- `profiles` es un espejo de `auth.users`.
- `platform_admins`: un trigger impide asignar `EBIM_SUPER_ADMIN` a nadie que no sea `dcalagua@ebim.pe`.
- `organization_memberships` bloquea correos `@ebim.pe` en organizaciones que no son PLATFORM.
- `tenant_memberships` da el acceso operativo.

**Organization / Partner / Customer**
- Una sola tabla `organizations` (`org_kind` PLATFORM|COMPANY).
- `organization_capabilities` son acumulables: PARTNER, RESELLER, CONSULTING, CUSTOMER. Andina tiene las tres primeras y además CUSTOMER.
- `organization_relationships` guarda MANAGES, RESELLS_TO y SUBCONTRACTS.
- `companies` son las sociedades; `erp_code` es un atributo, no una clave.
- Datos de facturación del titular: `billing_*` (V2.1).

**Acuerdos de canal**
- `organization_product_agreements`, por organización y producto.
- Campos: margen, `can_resell`, `can_manage_tenants`, `allowed_deployment_modes[]`, `allowed_tenant_types[]`, `billing_responsibility` (EBIM|PARTNER|MIXED) y `max_tenants`.
- Los límites los hacen cumplir triggers al crear o editar tenants.

**Tenant**
- Un tenant = un producto SaaS para un cliente.
- Campos: `customer_organization_id`, `managing_organization_id` (el partner, opcional), `tenant_type` (DEMO|TRIAL|PRODUCTION|SANDBOX), `status` y `deployment_mode`.
- Un tenant DEMO no admite suscripción recurrente ACTIVE (lo impide un trigger).

**Deployment modes**, con la infraestructura física en `deployment_targets` + `tenant_deployments` y un trigger de coherencia:
- `SHARED`: target sin dueño que aloja muchos tenants.
- `PARTNER_DEDICATED`: target cuyo dueño es el partner. Aloja los tenants de sus clientes y lleva una licencia base del partner (suscripción con `tenant_id` NULL).
- `TENANT_DEDICATED`: target exclusivo de un solo tenant.

**Suscripciones y licencias**
- `plans`, `plan_prices` (versionados) y `subscriptions`, que se facturan a `billed_organization_id` (el partner o el cliente) con `channel_margin_rate`.
- `subscription_items` según `charge_kind`: LICENSE, PARTNER_BASE_LICENSE, TENANT_LICENSE, IMPLEMENTATION_FEE (ONE_TIME), INFRASTRUCTURE_FEE, SUPPORT_FEE, ADDON, PROFESSIONAL_SERVICES y DISCOUNT.

**Implementación**
- Existe solo como `charge_kind = IMPLEMENTATION_FEE` y como paso del wizard de onboarding.
- **No hay** entidad de proyecto de implementación (hitos, estado, responsables).

**Facturación y pagos**
- `invoices`, `invoice_lines` y `payments` (PENDING|CONFIRMED|REVERSED).
- **No hay RPC para emitir facturas manualmente o por renovación.** Solo las crean el seed y `register_provider_payment`.

**Cobranza (V2)**
- `subscription_collection_profiles`: versionado, un método por suscripción (CULQI_CARD|SERVICE_ORDER|PURCHASE_ORDER|BANK_TRANSFER|MANUAL).
- `subscription_commercial_documents`: OS/OC con máquina de estados. Aprobar no es cobrar.
- `billing_alerts`: alertas idempotentes.
- `payment_provider_accounts`: un CHECK rechaza claves reales `sk_`/`pk_`.
- `provider_*`: mapeos Culqi y ledger idempotente de webhooks.

**Comercial**
- `sales_agents` (EBIM_INTERNAL|INDEPENDENT|PARTNER_AGENT) y `sales_attributions`, con vigencia y porcentaje.
- `commission_plans` y `commission_rules`.
- `commission_events` los genera un trigger **solo** sobre pagos CONFIRMED; el reverso es un contra-evento negativo.
- `commission_settlements`.

**Costos**
- `cost_entries` + `cost_allocations` (ponderadas por scope).
- Vistas `v_*_margin`, `v_product_finance` y `v_partner_finance`, siempre por moneda y sin FX.

**Provisioning**
- `provisioning_requests` (idempotency_key, máquina de estados, mode DRY_RUN|LIVE) y `provisioning_events`.

**Auditoría**
- `audit_logs`. `authenticated` solo tiene SELECT, pero ver R2.

**Invariante verificado en BD:** 0 comisiones sin pago y 0 comisiones sobre pagos no CONFIRMED.

---

## 7. Roles y RLS

### 7.1 Roles
- Plataforma: `EBIM_SUPER_ADMIN`, `EBIM_PRODUCT_ADMIN`, `EBIM_FINANCE`.
- Organización: `PARTNER_ADMIN`, `PARTNER_SALES`, `PARTNER_SUPPORT`, `ORG_ADMIN`, `ORG_VIEWER`.
- Tenant: `TENANT_ADMIN`, `TENANT_USER`.
- `SALES_AGENT` **no es un rol**: se deriva de `sales_agents.user_id`.

La UI resuelve una *persona* (`src/features/auth/session.ts`) con este orden de precedencia:

| Persona | Condición |
|---|---|
| EBIM | Tiene rol de plataforma |
| PARTNER | Tiene **cualquier** membresía de organización, incluido el ORG_ADMIN de un cliente |
| SALES_AGENT | Es un agente activo |
| TENANT | Tiene rol de tenant |
| UNKNOWN | Ninguna de las anteriores |

### 7.2 Alcance real medido por API (PostgREST, conteo de filas con RLS)

| Usuario | orgs | tenants | subs | invoices | payments | comm_events | cost_entries | tenant_features | tenant_deploy | prov_req | audit | alerts | fin | com | prov |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dcalagua (SUPER) | 11 | 15 | 15 | 41 | 25 | 19 | 27 | 8 | 15 | 4 | 5 | 30 | ✔ | ✔ | ✔ |
| product.admin | 11 | 15 | 15 | 0 | 0 | 0 | 27 | 8 | 15 | 4 | 5 | 30 | ✗ | ✔ | ✔ |
| finance | 11 | 15 | 15 | 41 | 25 | 19 | 27 | 8 | 15 | 4 | 5 | 30 | ✔ | ✔ | ✗ |
| admin@andina (PARTNER_ADMIN) | 3 | 6 | 6 | 17 | 11 | 4 | 0 | 0 | 6 | 0 | 1 | 12 | ✗ | ✗ | ✗ |
| ventas@andina (PARTNER_SALES) | 3 | 6 | 6 | 17 | 11 | 4 | 0 | 0 | 6 | 0 | 1 | 12 | ✗ | ✗ | ✗ |
| soporte@andina (PARTNER_SUPPORT) | 3 | 6 | 6 | **0** | **0** | 0 | 0 | 0 | 6 | 0 | 1 | 12 | ✗ | ✗ | ✗ |
| admin@pacifico (PARTNER_ADMIN) | 3 | 2 | 3 | 10 | 6 | 0 | 0 | 0 | 2 | 1 | 0 | 8 | ✗ | ✗ | ✗ |
| comercial@indep (SALES_AGENT) | 3 | 3 | 3 | **0** | **0** | 6 | 0 | **0** | **0** | **0** | 0 | 0 | ✗ | ✗ | ✗ |
| admin@alpha (ORG_ADMIN+TENANT_ADMIN) | 1 | 3 | 2 | 8 | 4 | 0 | 0 | 3 | 3 | 1 | 1 | 5 | ✗ | ✗ | ✗ |
| user@alpha (TENANT_USER) | 0 | **1** | 1 | 0 | 0 | 0 | 0 | 3 | 1 | 1 | 1 | 0 | ✗ | ✗ | ✗ |
| admin@omega (ORG_ADMIN+TENANT_ADMIN) | 1 | 1 | 1 | 3 | 2 | 0 | 0 | 3 | 1 | 0 | 0 | 2 | ✗ | ✗ | ✗ |

Columnas `fin`, `com` y `prov`: resultado de `can_read_finance()`, `can_manage_commercial()` y `can_run_provisioning()`.

**Organizaciones y tenants visibles:**
- **Andina:** organizaciones `consultora-andina`, `cliente-partner-uno` y `cliente-partner-dos`. Tenants: los 5 que administra más su DEMO.
- **Pacífico:** organizaciones `reseller-pacifico`, `cliente-ewm-norte` y `cliente-ewm-sur`. Tenants: `ewm-norte` y `ewm-sur`.

**Conclusiones sobre lo que pediste comprobar:**
- ✅ **Partner A no ve Partner B.** Andina y Pacífico ven conjuntos disjuntos.
- ✅ **Sales Agent sin datos operativos.** Carla ve 0 filas en features, settings, deployments, provisioning, memberships, facturas y pagos. Sí ve la *fila* de los 3 tenants que tiene atribuidos, sus organizaciones y suscripciones, y sus 6 comisiones. Es el diseño; la UI le muestra la ficha del tenant sin datos operativos.
- ✅ **Tenant Admin solo ve su tenant.** El `TENANT_USER` puro ve 1 tenant. `admin@alpha` ve 3 porque además es `ORG_ADMIN` de la organización cliente, que tiene 3 tenants.
- ✅ **Finance tiene las capacidades financieras esperadas.** Ve todo lo financiero y reconciliación, gestiona comercial y cobranza, y **no** puede ejecutar provisioning ni `upsert_plan`/`set_plan_price`.
- ⚠️ **Lo que se ve y no coincide con la matriz documentada:**
  - `PARTNER_SUPPORT` ve suscripciones, líneas con importes (9), precios (8) y alertas de cobranza (12).
  - `commission_plans` y `commission_rules` son legibles por **cualquier** autenticado, incluido `user@alpha`. La política es `using (true)`.

---

## 8. Módulos frontend

- `src/app`: App y rutas, AppShell, guards y `navigation.ts` con 22 entradas en 6 grupos.
- `src/features`: auth, dashboard, catalog, organizations, commercial, onboarding, tenants, billing, deployments y settings.
- `src/services`: `queries.ts` (TanStack Query) y `mutations.ts` (`callRpc`).

| Grupo | Menú → ruta | Personas |
|---|---|---|
| Plataforma | Dashboard `/` · Suite SaaS `/products` · Planes y licencias `/plans` · Feature flags `/feature-flags` | todas |
| Comercial | Partners / Resellers `/partners` · Clientes `/customers` · Todas las organizaciones `/organizations` · Comerciales `/sales-agents` · Planes de comisión `/commission-plans` | EBIM, PARTNER |
| Comercial | Atribuciones `/attributions` · Comisiones y liquidaciones `/commissions` | todas |
| Tenancy | Nueva venta `/onboarding` | EBIM |
| Tenancy | Tenants `/tenants` | todas |
| Tenancy | Suscripciones y licencias `/subscriptions` | EBIM, PARTNER |
| Cobranza | Facturación y cobros `/billing` · Renovaciones y alertas `/renewals` | EBIM, PARTNER |
| Cobranza | Reconciliación `/reconciliation` | EBIM |
| Infraestructura | Deployments `/deployments` · Provisioning `/provisioning` | EBIM, PARTNER |
| Gobierno | Costos y margen `/costs` | EBIM |
| Gobierno | Auditoría `/audit` | EBIM, PARTNER |
| Gobierno | Configuración `/settings` | todas |

**Rutas de detalle (con pestañas):**
- `/products/:id`: Resumen, Planes, Partners, Tenants, Finanzas, Deployments.
- `/organizations/:id`: **Vista 360**, Resumen, Productos autorizados, Tenants, Comerciales, Margen.
- `/tenants/:id`: Resumen, Atribución, Suscripción, Infraestructura, Features, Costos y margen, Auditoría.
- `/subscriptions/:id`: Contrato, Cobranza, Facturación y cobros.

Número de entradas de menú visibles, medido por persona: EBIM 22, PARTNER 19, SALES_AGENT 8.

---

## 9. Funcionalidades actualmente utilizables

### 9.1 Recorrido funcional ejecutado en esta sesión
- Playwright recorrió en headless las 22 rutas y 4 detalles con todas sus pestañas, con 10 usuarios.
- Se registraron errores de consola, respuestas HTTP ≥ 400 de la API, filas visibles y enlaces de detalle.
- Con el superadmin, **las 22 rutas cargan con datos del seed y hay 0 respuestas de error de la API.**

| Ruta | Filas (superadmin) | Observación |
|---|---|---|
| Dashboard | KPIs: 5 SaaS, 11 organizaciones (2 partners · 9 clientes), 13 productivos, 2 demo/trial, MRR USD 27,6 K, ARR 331,2 K, cobrado 98,6 K, costo 16,6 K, comisión pendiente 1.593,60, pagada 1.390, 1 provisioning fallido, 9/2/4 por modelo | ✅ |
| Suite SaaS | 5 productos; detalle con 6 pestañas | ✅ (h1 dice «SaaS Products») |
| Planes y licencias | 9 | ✅ |
| Feature flags | 8 | ✅ solo lectura (no hay toggle) |
| Partners | 2 | ✅ |
| Clientes | 9 | ✅ |
| Todas las organizaciones | 11 | ✅ (h1 «Organizaciones») |
| Comerciales | 3 | ✅ |
| Atribuciones | 6 | ✅ |
| Planes de comisión | 3 planes / 4 reglas | ✅ |
| Comisiones y liquidaciones | 19 eventos · 1 liquidación | ✅ sin acción de liquidar |
| Nueva venta | wizard de 5 pasos, DRY_RUN fijo | ✅ (no se envió) |
| Tenants | 15 · MRR agregado USD 21.500 | ✅ |
| Suscripciones y licencias | 15 | ✅ (h1 «Suscripciones») |
| Facturación y cobros | 41 facturas | ✅ solo lectura |
| Renovaciones y alertas | 30 alertas, ventanas D7..D60 | ✅ |
| Reconciliación | 7 hallazgos (1 error, 6 revisar) | ✅ |
| Deployments | 6 targets / 15 vínculos | ✅ |
| Provisioning | 4 solicitudes (2 SUCCEEDED, 1 FAILED, 1 PENDING) | ✅ + warning React `key` |
| Costos y margen | por producto, partner y tenant | ✅ |
| Auditoría | 5 | ✅ |
| Configuración | entorno, apariencia, modo | ✅ |

### 9.2 Escritura disponible en UI (vía RPC)
- **Catálogo:** productos, planes y precios.
- **Organizaciones y acuerdos de canal:** incluye datos de facturación.
- **Onboarding transaccional:** tenant, suscripción, líneas, atribución y provisioning DRY_RUN en una sola transacción.
- **Tenants:** alta y estado, suspensión y reanudación.
- **Comercial:** comerciales, atribuciones, planes y reglas de comisión.
- **Suscripciones:** alta, estado y líneas.
- **Cobranza:** perfil de cobro y ciclo OS/OC.
- **Renovaciones:** recalcular alertas, aplicar suspensiones (DRY_RUN) y estado de alertas.
- **Infraestructura:** deployment targets, adjuntar tenant, encolar y reintentar provisioning.

### 9.3 Existe en BD pero no tiene UI
- Checkout y domiciliación de tarjeta Culqi: el botón «Configurar tarjeta» está siempre deshabilitado.
- Alta de cuentas de proveedor de pago.
- Confirmar pago manual y revertir pago.
- Liquidar comisiones.
- Toggle de feature flags.
- Expirar documentos, cerrar líneas de suscripción, editar tenant y sociedades.
- Recuperar contraseña: el enlace `#recuperar` no lleva a ningún sitio.
- Ejecutar `payment-reconcile` desde Reconciliación.
- **Emitir facturas:** tampoco existe RPC.

---

## 10. Edge Functions (4)

`supabase start` las sirve automáticamente en `http://127.0.0.1:54421/functions/v1/*`. Sin JWT responden 401, verificado con `provisioning-worker` y `payment-setup`.

| Función | verify_jwt | Autorización interna | Modo por defecto local |
|---|---|---|---|
| `payment-setup` | true | Suscripción visible por RLS; cuenta resuelta en servidor; exige datos de facturación completos | MOCK |
| `payment-reconcile` | true | `can_read_finance()` | MOCK |
| `culqi-webhook` | **false** (público) | Ledger idempotente; verificación servidor-a-servidor del cargo (en MOCK no verifica) | MOCK |
| `provisioning-worker` | true | `can_run_provisioning()` o cabecera `x-provisioning-secret` | DRY_RUN |

**Necesarias para navegar la plataforma local: ninguna.** El frontend no las invoca. Solo hacen falta para ensayos de Culqi o para ejecutar solicitudes de provisioning.

---

## 11. Estado de Culqi

**Servidor (implementado):**
- Adapter completo con endpoints `/recurrent/*`, importes en céntimos, 3DS y recuperación de customer.
- Mock determinista.
- Mapeos, con 22 tests unitarios.
- Webhook idempotente y reconciliación.

**Local (esta sesión):**
- Cuenta `culqi-pe-test` (TEST) **sin** `public_key` ni `secret_key_ref`, y ningún secreto cargado en el edge runtime. Por eso todo resuelve a **MOCK**.
- No se ejecutó ningún pago, ni TEST ni LIVE.
- La evidencia TEST previa está en `docs/nightly-v2-1/CULQI_TEST_EVIDENCE.md` y no se repitió.

**LIVE:**
- Requiere `CULQI_ALLOW_LIVE=true`, una clave `sk_live_` coherente con `environment = LIVE` y fallo ruidoso si falta configuración.
- No está configurado ni autorizado.

**Frontend:**
- Solo lectura y configuración del perfil `CULQI_CARD` y de los datos de facturación.
- **No existe** integración de Checkout ni tokenización.

**Pendiente externo (V2.1):** entrega del webhook desde internet, 3DS con desafío real y cobro recurrente automático a 30 días sin observar.

---

## 12. Estado de provisioning

- `PROVISIONING_MODE` sin definir equivale a **DRY_RUN**.
- `SupabaseManagementProvider` (LIVE) es un esqueleto que siempre rechaza con `MODO_LIVE_NO_HABILITADO`.
- **Protecciones de LIVE:** la RPC solo acepta LIVE si lo pide el super admin, la UI solo lo ofrece al super admin, el onboarding fija DRY_RUN y `apply_due_suspensions` recibe DRY_RUN.
- **Seed:** 4 solicitudes DRY_RUN (2 SUCCEEDED, 1 FAILED, 1 PENDING).
- **Nadie ejecuta el worker:** no hay cron (los `cron.schedule` están comentados) ni botón en la UI, así que las solicitudes nuevas quedan en PENDING.

---

## 13. Usuarios demo

Contraseña común local: `Ebim.Demo2026!`. Verificada con `crypt()` para los 12 usuarios, todos con email confirmado.

| Email | Rol real | Organización / tenant |
|---|---|---|
| **dcalagua@ebim.pe** | EBIM_SUPER_ADMIN | — (login verificado por UI y API) |
| product.admin@ebim.test | EBIM_PRODUCT_ADMIN | — |
| finance@ebim.test | EBIM_FINANCE | — |
| admin@andina.ebim.test | PARTNER_ADMIN | Consultora Andina |
| ventas@andina.ebim.test | PARTNER_SALES + agente `beto-andina` | Consultora Andina |
| soporte@andina.ebim.test | PARTNER_SUPPORT | Consultora Andina |
| admin@pacifico.ebim.test | PARTNER_ADMIN | Reseller Pacífico |
| comercial@indep.ebim.test | agente `carla-independiente` (INDEPENDENT), sin membresías | — |
| admin@alpha.ebim.test | ORG_ADMIN + TENANT_ADMIN | Empresa Directa Alpha / `alpha-esupplier` |
| admin@omega.ebim.test | ORG_ADMIN + TENANT_ADMIN | Empresa Enterprise Omega / `omega-esupplier` |
| user@alpha.ebim.test *(no listado en README)* | TENANT_USER | `alpha-esupplier` |
| admin@clientep1.ebim.test *(no listado en README)* | ORG_ADMIN + TENANT_ADMIN | Cliente Partner Uno / `cliente-p1-esupplier` |

### Escenarios de demo gerencial (todos presentes y visibles en la UI)

| # | Escenario | Dónde mostrarlo |
|---|---|---|
| 1 | Cliente directo EBIM en SHARED | Organización **Empresa Directa Alpha** → Vista 360 (eSupplier + EWM, cobrado USD 10.100) · tenant `alpha-esupplier` |
| 2 | Partner con múltiples tenants en SHARED | **Consultora Andina** → Vista 360: 5 tenants administrados, acuerdos eSupplier 25% / EWM 18%, 3 métodos de cobro (Manual, OS, OC) |
| 3 | PARTNER_DEDICATED | Tenants `andina-pd-cliente-a/b` (target `andina-esupplier-dedicated`, SUB-ANDINA-PD-BASE) · **Reseller Pacífico** con `ewm-norte/sur` en `pacifico-ewm-dedicated` · Deployments |
| 4 | TENANT_DEDICATED | `omega-esupplier` (Omega, MRR USD 7.150) · `titan-ewm` · Deployments |
| 5 | Tenant DEMO | `demo-andina-esupplier`: MRR 0, sin plan |
| 6 | Tenant TRIAL | `trial-ewm-alpha`: MRR 0, sin plan |
| 7 | Comercial independiente | Login `comercial@indep.ebim.test` → «Mi tablero comercial»: 3 atribuciones (Alpha eSupplier, Titán EWM, GRUPASA eSupplier), 6 comisiones, 8 entradas de menú |
| 8 | Partner multi-SaaS | Consultora Andina: eSupplier + EWM (Suite SaaS → EWM → pestaña Partners) |
| 9 | Cliente con más de un SaaS | **GRUPASA**: eSupplier con Tarjeta Culqi (mock) + EWM con OS aprobada · también Alpha y Cliente Partner Uno |

---

## 14. URLs locales

| Servicio | URL |
|---|---|
| Frontend | http://127.0.0.1:5199 |
| Supabase Studio | http://127.0.0.1:54423 |
| API / REST | http://127.0.0.1:54421 · http://127.0.0.1:54421/rest/v1 |
| Edge Functions | http://127.0.0.1:54421/functions/v1 |
| Mailpit | http://127.0.0.1:54424 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (credencial local por defecto del CLI) |

## 15. Puertos

| Servicio | Puerto | Estado |
|---|---|---|
| Vite (strictPort) | 5199 | en uso por este proyecto |
| API Kong | 54421 | ✅ |
| Postgres | 54422 | ✅ |
| Studio | 54423 | ✅ |
| Mailpit | 54424 | ✅ |
| Analytics | 54427 | ✅ |
| Shadow DB | 54420 | configurado (solo `db diff`) |
| Pooler | 54429 | deshabilitado |
| Inspector del edge runtime | 8083 | configurado |

- Otro stack (`lumi-growth`) ocupa 54321-54324 y 54327. **Sin colisión**; no se detuvo.
- El 5173 lo ocupa históricamente otro proyecto.

---

## 16. Resultado de db reset

- `npm run db:reset` → exit 0.
- 23 × «Applying migration», «Seeding data from supabase/seed.sql», «Finished supabase db reset».
- Se ejecutó 2 veces: la segunda tras E2E, para restaurar el seed.

**Estado final verificado:**

| Dato | Valor |
|---|---|
| Migraciones | 23 |
| auth.users | 12 |
| Organizaciones | 11 |
| Tenants | 15 (9 SHARED · 4 PD · 2 TD; 1 DEMO, 1 TRIAL) |
| Suscripciones | 15 (todas USD, ACTIVE) |
| Facturas | 41 |
| Pagos CONFIRMED | 25 |
| Eventos de comisión | 19 |
| Alertas | 30 |
| Solicitudes de provisioning | 4 |
| Productos | 5 |
| Deployment targets | 6 |

**Nota:** el seed usa fechas relativas a `now()`, así que las cifras de facturas y pagos pueden variar ±1 según el día en que se ejecute el reset.

## 17. pgTAP

`npm run db:test` → **PASS: 6 archivos, 124 tests.**

| Archivo | Tests |
|---|---|
| `00_structure` | 14 |
| `01_rls_isolation` | 20 |
| `02_business_rules` | 18 |
| `03_v2_security` | 26 |
| `04_v2_business` | 24 |
| `05_v2_1_hardening` | 22 |

Observaciones de calidad, que no afectan el PASS:
- **04 #23 es tautológico:** compara el conteo consigo mismo.
- **05 #3 es no determinista:** usa `limit 1` sin ORDER BY.
- **Los tests de F-01/F-02** pasan por la falta de GRANT, no por el guard `is_service_context()`, porque pgTAP corre como `postgres`.

## 18. Unit tests

`npm test` → **PASS: 4 archivos, 54 tests.**

| Archivo | Tests |
|---|---|
| `navigation` | 9 |
| `format` | 11 |
| `session` | 12 |
| `culqi-mapping` | 22 |

## 19. E2E

`npm run e2e` → **41 passed (28,4 s), 0 failed, 0 skipped.**
- `e2e/smoke.spec.ts`: 21 tests.
- `e2e/v2-journeys.spec.ts`: 20 tests.
- El dev server tuvo que pararse antes de ejecutar la suite: `reuseExistingServer: false` + `strictPort`.
- La suite crea datos: J1, J2 y J5.

## 20. typecheck

`npm run typecheck` (`tsc --noEmit` ×2) → exit 0. Ejecutado 3 veces: inicio, gates y dentro de build.

## 21. lint

`npm run lint` → exit 0, 0 errores y 0 warnings.

## 22. build

`npm run build` → exit 0. 292 módulos; `index.js` pesa 867,18 kB (241,48 kB gzip).
- Aviso: el chunk supera 500 kB y no hay code-splitting.
- Aviso de anotación de Rollup en `zod`, inocuo.

## 23. secrets scan

`npm run secrets:scan` → `SECRETS_SCAN: PASS — sin credenciales detectadas en el repositorio ni en el bundle.`

Sobre `.env.local`:
- La sesión no pudo leerlo (lectura denegada por permisos), así que **no se modificó**.
- Su configuración correcta queda demostrada funcionalmente: login por UI y E2E contra `127.0.0.1:54421` y badge `LOCAL` visible.
- Está gitignorado.

---

## 24. Documentación desactualizada detectada (no corregida)

Severidad: **A** = alta, M = media, B = baja.

### Configuración y arranque

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 1 | `supabase/config.toml:159,163` | `site_url` y redirects usan **5173** | La app corre en 5199. Afecta recuperación de contraseña y magic links, no el login con contraseña | **A** |
| 2 | `docs/operations/LOCAL_DEVELOPMENT.md:15` | «Abre http://127.0.0.1:5173» | 5199 | **A** |
| 3 | `LOCAL_DEVELOPMENT.md:68-70` | 52 pgTAP / 29 unit / 21 E2E | 124 / 54 / 41 | M |
| 4 | `LOCAL_DEVELOPMENT.md` | — | No explica Edge Functions, variables Culqi, `nvm use` ni que E2E exige el 5199 libre | M |
| 5 | `CLAUDE.md:8,11` | «13 migraciones baseline y Control Plane funcional de lectura»; «sigue las fases V2» | 23 migraciones, consola con escritura, V2/V2.1 cerradas | M |
| 6 | `README_EJECUTAR_EN_VSCODE.md` | Instrucciones de copiar el pack | Ya está integrado; es histórico | B |

### README

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 7 | `README.md:135-150` | Solo V2, «8 migraciones nuevas», Culqi «MOCK sin credenciales» | Falta V2.1: 2 migraciones más, Culqi TEST verificado, billing contact, funciones server-only | M |
| 8 | `README.md:78-84` | Tabla de variables de servidor incompleta | Faltan `CULQI_API_BASE`, `CULQI_ALLOW_LIVE`, `CULQI_SECRET_KEY` (vía `secret_key_ref`) y `EBIM_ALLOW_REMOTE_DEV`; esta última no la usa ningún código | M |
| 9 | `README.md:109-128` | 10 cuentas demo | El seed crea 12: faltan `user@alpha` y `admin@clientep1` | B |
| 10 | `README.md:21-23` | Supabase CLI 2.115.0; Node sin aclarar | CLI 2.116.0; Node por defecto 24.20.0 frente al 24.19.0 de `.nvmrc` | B |
| 11 | `README.md:62-68` | Tabla de puertos | Omite el shadow DB (54420) | B |
| 12 | `README.md:176-205` | Índice apunta a `docs/nightly/FINAL_REPORT.md` como estado de gates | El estado vigente es V2.1 y `docs/nightly-v2-1/*` no está enlazado | M |
| 13 | `README.md:125` | `SALES_AGENT` como «Rol» | Es una persona derivada | B |
| 14 | `README.md:142` | «25 RPCs» | 24 RPC + 1 helper | B |

### Seguridad y RBAC

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 15 | `docs/security/RBAC_RLS_MATRIX.md:199` | `register_provider_payment`: FINANCE ✅ | Solo `service_role` desde V2.1 | **A** |
| 16 | `RBAC_RLS_MATRIX.md` | — | No incluye `is_service_context`, `can_run_provisioning`, `set_billing_contact`, `v_billing_contact_readiness` ni `x-provisioning-secret` | M |
| 17 | `RBAC_RLS_MATRIX.md` | PARTNER_SUPPORT ✗ en subs/prices; PARTNER_ADMIN ✗ en comisiones; FINANCE y PARTNER_SALES ✗ en deployments/provisioning | Medido en §7.2: sí ven esas filas | M |
| 18 | `RBAC_RLS_MATRIX.md` | «Todos los helpers en M08»; tabla de RPC incompleta; «toda escritura por RPC»; 52 tests; 10 orgs / 13 tenants | Helpers en M14, M18 y M22; hay escritura directa del baseline; 124 tests; 11 orgs / 15 tenants | M |

### Modelo de datos y arquitectura

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 19 | `docs/architecture/DATA_MODEL.md` | 13 migraciones, 39 tablas, 7→16 vistas, 42→96 funciones, 52 tests; ERD sin tablas V2; nombres de trigger incorrectos | 23 / 48 / 17 / 99 / 124 | M |
| 20 | `DEPLOYMENT_MODEL.md:144-145` | «Los cinco errores cubiertos por tests» | Solo `TARGET_PARTNER_AJENO` tiene test | M |
| 21 | `EBIM_CONVENTIONS.md:120` | «GRANT por columna» implementado | No existe; la solución es estructural | M |
| 22 | `EBIM_CONVENTIONS.md:16` vs `OVERVIEW.md:9` | Uno dice que el hub vive en GMAO; el otro, que este repo es el hub | Contradicción; decisión pendiente | M |

### Culqi, provisioning y cobranza

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 23 | `docs/payments/CULQI_ARCHITECTURE.md:3-5` | «MOCK/TEST… sin credenciales» | TEST verificado de punta a punta en V2.1 | **A** |
| 24 | `CULQI_ARCHITECTURE.md` | Árbol de resolución, clase `MockCulqiProvider`, §10 «nada hecho», orden Customer→Plan | Árbol incompleto; la clase es `MockPaymentProvider`; §10 parcialmente hecho; el código crea Plan antes que Customer | M |
| 25 | `CULQI_TEST_EVIDENCE.md:9`, `QUALITY_GATE_V2_1.md:45` | «Aborta con `sk_live_` o `pk_live_`» | Solo compara `sk_live_` con el entorno de la cuenta | M |
| 26 | `FINAL_REPORT_V2.md:144` | `SUPABASE_ACCESS_TOKEN` | El código lee `SUPABASE_MANAGEMENT_TOKEN` | M |
| 27 | `PROVISIONING.md` | — | No documenta `can_run_provisioning` ni `x-provisioning-secret`; tampoco que nadie ejecuta el worker | M |
| 28 | `COLLECTION_MODEL.md` | — | No menciona que CULQI_CARD exige datos de facturación | M |

### Comercial, finanzas y demo

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 29 | `COST_MARGIN_MODEL.md:107-112`, `DEMO_SCENARIOS.md:135-142` | MRR 24.750 / ARR 297.000 / 13 tenants / 7 SHARED / 10 orgs | UI actual: MRR USD 27,6 K / ARR 331,2 K / 15 tenants / 9 SHARED / 11 orgs | M |
| 30 | `COMMERCIAL_MODEL.md:194`, `DEMO_SCENARIOS_V2.md:39`, `COLLECTION_MODEL.md:26` | «WMS» | El producto es **EWM** | B |
| 31 | `DEMO_SCENARIOS.md:158` | «SaaS Products → pestaña Organizaciones habilitadas» | Menú «Suite SaaS», pestaña «Partners» | M |
| 32 | `DEMO_SCENARIOS_V2.md:146` | Partner ve «solo Consultora Andina» | Ve Andina y sus 2 clientes | M |
| 33 | `DEMO_SCENARIOS_V2.md:6,167` | «falla también en CI»; 102 / 32 / 39 tests | No hay `.github/` en el repo; 124 / 54 / 41 | M |
| 34 | `COMMISSION_MODEL.md:74` | Índice de idempotencia con 4 columnas | 5 columnas (incluye `reversal_of_event_id`) | B |

### Informes y estado

| # | Documento | Afirma | Realidad | Sev. |
|---|---|---|---|---|
| 35 | `E2E_REPORT.md` | 39 tests / 18 journeys | 41 / 20 | B |
| 36 | `SECURITY_FIXES.md:136` | «5 pruebas» de F-07 | Son 4 | B |
| 37 | `.claude-prompts-v2/STATE_V2.md` | Última migración `…0800`, Culqi sin credenciales, navegación 32 tests | Desactualizado; es el archivo de recuperación de contexto | M |
| 38 | `QUALITY_GATE_V2_1.md:43` | «21 migraciones baseline» | 13 baseline + 8 V2 | B |

---

## 25. Bugs reales encontrados (no corregidos)

### A. Seguridad: confirmados contra la BD viva

Cada caso se ejecutó dentro de `BEGIN … ROLLBACK` simulando el JWT del usuario (`set local role authenticated` + `request.jwt.claims`). Tras el rollback se comprobó que no quedaron cambios.

| ID | Severidad | Hallazgo | Evidencia de esta sesión |
|---|---|---|---|
| **R1** | **Crítica** | `create_sales_attribution` autoriza por `is_org_admin(p_channel_organization_id)` y **no valida** que tenant, cliente o agente pertenezcan al canal. Un PARTNER_ADMIN se atribuye clientes ajenos, gana visibilidad RLS sobre ellos (vía `my_attributed_*`) y devenga comisión sobre sus cobros futuros, incluso con `valid_from` retroactivo | `admin@andina` atribuyó `omega-esupplier` (venta directa EBIM) a su agente: **ACEPTADO**. Visibilidad del tenant Omega: **0 → 1** |
| **R4** | Alta | El tope del 100% de atribución agrupa por la tupla exacta (tenant, subscription). Las combinaciones (tenant, null) y (tenant, sub) son grupos distintos, y `generate_commission_events` usa ambas: comisión doble | Tras R1, las atribuciones activas sobre Omega sumaban **200%** |
| **R3** | Alta | `upsert_sales_agent`, rama de edición: `where id = p_id` sin comprobar la organización actual del agente. Un PARTNER_ADMIN reasigna un agente ajeno a su organización y a su propio usuario | `admin@andina` reasignó a Carla (independiente) a Andina con su `user_id`: **ACEPTADO** |
| **R2** | Alta | `log_audit` es SECURITY DEFINER con EXECUTE para `authenticated` y sin control: cualquier usuario escribe auditoría falsa sobre cualquier organización o tenant | `admin@alpha` insertó `FAKE_ACTION` sobre la organización Andina: **ACEPTADO** |
| **R5** | Alta | La política `tenants_update` permite PATCH directo de **cualquier columna** a TENANT_ADMIN, ORG_ADMIN y partner. Salta la RPC auditada, la máquina de estados, el `demo_guard` y la coherencia de deployment | `admin@alpha`: `UPDATE tenants SET tenant_type='DEMO'` → **1 fila**. Eso borraría el MRR de su propio tenant |
| **R6** | Media | `current_plan_price` es SECURITY DEFINER y no tiene control: salta la RLS de `plan_prices` | `admin@alpha` ve 0 precios de `ewm-partner-base` por RLS, pero la función devuelve **1900.00** |

**Reportados por el análisis de código y no reproducidos en esta sesión:**
- **R7:** el org admin facturado puede resolver alertas SUSPENSION_DUE, desactivar `auto_suspend` y aprobar sus propias OS/OC.
- **R8:** `settle_commissions` reutiliza liquidaciones PAID (`on conflict do update`).
- **R9:** la segunda suspensión de un tenant devuelve la solicitud antigua por la clave de idempotencia determinista.
- **R10:** las vistas `v_*_margin` pierden costos o comisiones de otra moneda o sin ingreso, y `v_tenant_margin` duplica filas con varias suscripciones.
- **R12:** el cron documentado fallaría porque las RPC exigen `auth.uid()`.
- **R14:** `register_provider_payment` no controla sobrecobro y el número de factura puede colisionar.
- **R16:** `attach_tenant_to_target` puede violar `primary_uk`.
- **R17:** el trigger anti-secretos busca subcadenas: `pat` rechaza `path` y solo mira el primer nivel.
- **R20:** un org admin puede cambiar el `status` y `slug` de su propia organización.
- **R24:** datos personales de facturación visibles para ORG_VIEWER, PARTNER_SUPPORT y el comercial atribuido.
- **Webhook en MOCK:** `culqi-webhook` en MOCK acepta eventos sin verificar. Solo es riesgo si se despliega una cuenta TEST sin credenciales.

### B. Frontend: confirmados en el recorrido

| ID | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| F1 | Alta | **Fechas un día antes.** `formatDate` hace `new Date('YYYY-MM-DD')`, que se interpreta como UTC, y en Lima (UTC-5) se muestra el día anterior. Afecta renovaciones, vigencias y vencimientos en toda la UI | Alerta «renueva el 2026-09-13» mostrada como «12 set. 2026 (0d)». `TZ=America/Lima`: `formatDate("2026-09-13")` → «12 set. 2026» (`src/lib/format.ts:47-52`) |
| F2 | Alta | **Persona silenciosamente degradada.** `loadSessionRoles` ignora los errores de las consultas de roles. Un 401 transitorio deja al usuario con la persona equivocada hasta recargar | Login de `admin@andina`: 2 × `401 PGRST303 "JWT issued at future"` (desfase de reloj de Docker de ~1 s). La UI mostró «Usuario de tenant» con 8 entradas de menú en vez de 19 (`src/features/auth/session.ts:43-59`, `AuthContext.tsx:37-42`) |
| F3 | Alta | **Caché de otra sesión.** `signOut` no vacía el `QueryClient`. Otro usuario en la misma pestaña puede ver datos cacheados de la sesión anterior | Revisión de código (`AuthContext.tsx:62-65`, `App.tsx:42-50`). E2E no lo detecta porque usa un contexto nuevo por test |
| F4 | Media | Totales que suman monedas distintas y los etiquetan como USD (Billing, Costs, Tenants, Commissions, Dashboard, Vista 360). Hoy es invisible porque el seed solo tiene USD | Revisión de código |
| F5 | Media | Vista 360 de un partner: la columna «Modelo» de «Cobranza por SaaS» sale «—» en tenants administrados, porque solo busca entre los tenants donde la organización es cliente | Captura de Consultora Andina (`Organization360.tsx:190`) |
| F6 | Media | Un ORG_ADMIN o ORG_VIEWER de un **cliente** puro recibe la persona PARTNER: menú de 19 entradas con Partners, Comerciales, Planes de comisión, Deployments y Provisioning | `admin@alpha` y `admin@omega` con nav(19) |
| F7 | Media | Dos caminos de suspensión incoherentes. «Cambiar estado» en Tenants usa `set_tenant_status` (no encola provisioning); el detalle usa `request_tenant_suspension` (sí encola) | Revisión de código |
| F8 | Media | `CulqiCardPanel`: la rama «Sin método de pago domiciliado» es inalcanzable | Revisión de código |
| F9 | Baja | Warning de React «unique key» en `/provisioning` (Fragment en `.map`) | Consola en todos los roles con acceso (`ProvisioningPage.tsx:119`) |
| F10 | Baja | Inconsistencias de rótulo menú/página: «Suite SaaS» / «SaaS Products»; «Todas las organizaciones» / «Organizaciones»; «Suscripciones y licencias» / «Suscripciones» | Recorrido |
| F11 | Baja | Onboarding: el selector «Organización cliente» ofrece «EBIM» (PLATFORM) y «Reseller Pacífico» (sin capacidad CUSTOMER) | Recorrido |
| F12 | Baja | «Última lectura de infraestructura» siempre muestra la fecha actual (`ProductDetailPage.tsx:465`) | Revisión de código |
| F13 | Baja | Enlaces muertos en el login: `#recuperar` y `#solicitar` | Revisión de código |

### C. Funcional / modelo

- `provisioning-worker` no lo ejecuta nadie (ni cron ni UI): las solicitudes nuevas quedan en PENDING.
- No existe emisión de facturas (ni RPC ni UI). El ciclo mensual y de renovación no se puede operar desde la plataforma.
- `commission_plans` y `commission_rules` son legibles por todo usuario autenticado (`using (true)`). Clientes y soporte ven las tasas de comisión.

---

## 26. Bloqueos externos

| Bloqueo | Impacto |
|---|---|
| Credenciales Culqi TEST no cargadas en el edge runtime local | Pagos en MOCK. No bloquea navegar; sí bloquea un ensayo TEST local |
| Culqi LIVE | No autorizado ni configurado (correcto) |
| Entrega del webhook Culqi desde internet | Requiere un endpoint público, fuera del alcance local |
| 3DS con desafío real; cobro recurrente a 30 días | Requiere tiempo y escenario real en Culqi |
| `SUPABASE_MANAGEMENT_TOKEN` | Provisioning LIVE imposible, y además es un esqueleto |
| GUIDELINES_ROOT | Lectura denegada a los subagentes: las citas del contrato EBIM en `EBIM_CONVENTIONS.md` no se contrastaron |
| `.env.local` | La sesión no tiene permiso de lectura; se validó solo funcionalmente |
| Docker Desktop | Un desfase de reloj de ~1 s puede generar 401 «JWT issued at future» en el primer request tras el login (dispara F2) |

---

## 27. Recomendaciones para la siguiente fase

Orden sugerido: cada bloque es una tarea separada, con tests primero.

1. **Hardening de autorización en RPC** (antes de QAS con usuarios reales):
   - R1: validar pertenencia al canal de tenant, cliente y agente, plan y `valid_from`.
   - R3: comprobar la organización **actual** del agente al editar.
   - R2: revocar `log_audit` a `authenticated` o validar el alcance.
   - R4: agrupar el tope de atribución por tenant **o** suscripción.
   - R5: restringir `tenants_update` a columnas no sensibles o eliminarla y forzar RPC.
   - R6: controlar `current_plan_price`.
   - Añadir pgTAP que ejecute cada guard **como el rol humano** (no como `postgres`) y corregir los tests 04 #23 y 05 #3.
2. **Bugs de UI de alto impacto en la demo:**
   - F1 (fechas): parsear `YYYY-MM-DD` como fecha local.
   - F2: propagar el error o reintentar la hidratación de roles.
   - F3: `queryClient.clear()` en el logout.
   - F5 y F9.
3. **Corrección de documentación** con la lista del §24, empezando por los tres de severidad alta: `config.toml` `site_url` → 5199, `LOCAL_DEVELOPMENT.md` y `RBAC_RLS_MATRIX.md`, junto con `CULQI_ARCHITECTURE.md`. Actualizar `CLAUDE.md` y `STATE_V2.md` para que un nuevo agente no parta de un estado viejo.
4. **Decisiones de producto pendientes:**
   - Si PARTNER_SUPPORT debe ver importes.
   - Si los clientes deben ver las tasas de comisión.
   - La persona para un ORG_ADMIN de cliente puro (F6).
   - Si un cliente puede auto-resolver alertas de suspensión (R7).
   - Dónde vive el hub `platform` (GMAO o este repo).
5. **Huecos funcionales:** emisión de facturas y ciclo de renovación; ejecución del `provisioning-worker` (cron o botón DRY_RUN); UI de liquidación de comisiones, pago manual y reverso; Checkout Culqi en el frontend.
6. **Técnico:** code-splitting por ruta (bundle de 867 kB), cron de alertas compatible con `is_service_context()` (R12) y actualización del Supabase CLI a 2.117.0, solo con autorización.

---

### Anexo: cómo reproducir esta sesión

```bash
cd /Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin
nvm use                       # Node v24.19.0
supabase start                # stack 544xx
npm run db:reset              # 23 migraciones + seed
npm run db:test               # 124
npm test                      # 54
npm run typecheck && npm run lint && npm run build && npm run secrets:scan
npm run e2e                   # 41; exige el 5199 libre (parar npm run dev)
npm run db:reset              # restaurar el seed tras E2E
npm run dev                   # http://127.0.0.1:5199
```
