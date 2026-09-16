# MasterAdmin — Baseline antes de la fundación de provisioning SaaS

Fecha de la medición: 2026-09-15
Rama: `dev` (30 commits locales por delante de `origin/dev`)
HEAD: `f34aa74bf3d06fa44979a6b616714b518680282a`
_docs(v3.2): baseline, provider plan identity, future recurring contract, test matrix, quality gate and final report_

Todo lo que sigue está **medido contra el repositorio y contra la base local**,
no leído de documentación previa.

---

## 1. Estado del árbol de trabajo

```
## dev...origin/dev [ahead 30]
 M .claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh
 M docs/quality/vscode-problems-summary.json
 M docs/quality/vscode-problems.json
 M docs/quality/vscode-problems.md
?? logs/
```

No hay ningún cambio remoto pendiente ni ninguna referencia a `origin` movida.

## 2. Migraciones

**37 migraciones** en `supabase/migrations/`. El hash SHA-256 de cada una quedó
congelado en `docs/nightly-provisioning-masteradmin/evidence/migrations-baseline.sha256`
antes de tocar nada; la verificación final vuelve a calcularlos y compara.

Bloques históricos:

| Rango | Contenido |
| --- | --- |
| `20260902000100` … `20260902001300` | Baseline V1: schema `platform`, identidad, productos/tenancy, planes, billing, comisiones, deployments+provisioning, RLS, funciones de negocio, vistas, pgTAP, índices de FK |
| `20260907000100` … `20260907000800` | V2: RPCs administrativas, acuerdos de canal, onboarding, perfiles de cobro, documentos comerciales, mapeos de proveedor, alertas/renovaciones, finanzas |
| `20260908000100` … `20260908000200` | V2.1: proveedor server-only, contacto de facturación |
| `20260913000100` … `20260913001200` | V3: multimoneda, mercados, pricing regional, routing de pago, motor FX, moneda de reporte, consolidado, comisiones multimoneda, hardening, facturación por suscripción |
| `20260913001300` | V3.1: cadencia de facturación |
| `20260913001400` | V3.2: identidad de plan del proveedor |

## 3. Objetos de base tras `db:reset` limpio

| Objeto | Cantidad |
| --- | --- |
| Tablas en `platform` | 54 |
| Vistas en `platform` | 22 |
| Funciones en `platform` | 139 |
| Enums en `platform` | 39 |
| Políticas RLS en `platform` | 84 |

## 4. Modelo actual relevante para esta fase

### 4.1 Productos

`platform.saas_products (id, code, name, short_name, lockup_name*, accent_color,
status, is_billable, billing_unit, sort_order, metadata)`.
`code` es un slug kebab-case (`esupplier`, `ewm`, `tms`, `gmao`, `echange`).
**No existe hoy ninguna noción de "cómo se integra MasterAdmin con ese producto".**

### 4.2 Tenancy

`platform.tenants` acopla el tenant lógico a: producto, organización cliente,
organización que administra (partner), sociedad, tipo, estado, `deployment_mode`
y `environment` (`environment_kind`: DEMO/TRIAL/PRODUCTION/SANDBOX).

### 4.3 Deployments

`platform.deployment_targets` ya modela la infraestructura **física** y ya
distingue `SHARED` / `PARTNER_DEDICATED` / `TENANT_DEDICATED`, con un trigger
(`platform.enforce_deployment_coherence`) que impide mezclar modos y un guard
anti-secretos (`platform.reject_secret_like_json`) sobre `metadata`.

Lo que **no** tiene: `base_url`, integración asociada, perfil de credencial,
timeout, reintentos, estado de salud ni ambiente de provisioning (DEV/QAS/DEMO/PRD).

### 4.4 Provisioning existente

`platform.provisioning_requests` + `platform.provisioning_events` son la cola de
provisioning de **infraestructura** (crear proyecto Supabase, adjuntar tenant,
suspender…), con máquina de estados `PENDING → VALIDATING → RUNNING → SUCCEEDED/FAILED/CANCELLED`,
`mode` DRY_RUN/LIVE e idempotencia por `idempotency_key`.

> **Decisión D-P01.** Este eje es *infraestructura*, no *aplicación*. El
> provisioning de esta fase —decirle a EWM "crea este tenant"— es un eje distinto
> y no puede reutilizar esa tabla sin romper su máquina de estados ni su
> semántica de `action`. Por eso la fundación nueva vive en
> `platform.saas_provisioning_requests`, con su propia máquina de estados
> (`PENDING → WAITING_INFRA → READY_TO_PROVISION → PROVISIONING → ACTIVE`).
> Las dos coexisten y ninguna migración histórica se toca.

### 4.5 Permisos

**No hay un modelo de permisos dinámico.** La autorización es por rol enumerado:

- `platform.platform_role`: `EBIM_SUPER_ADMIN`, `EBIM_PRODUCT_ADMIN`, `EBIM_FINANCE`
- `platform.org_role`: `PARTNER_ADMIN`, `PARTNER_SALES`, `PARTNER_SUPPORT`, `ORG_ADMIN`, `ORG_VIEWER`
- `platform.tenant_role`: `TENANT_ADMIN`, `TENANT_USER`

y helpers `SECURITY DEFINER` con `search_path` fijo: `is_platform_admin()`,
`has_platform_role()`, `is_super_admin()`, `can_read_finance()`,
`can_manage_platform_entities()`, `can_manage_commercial()`, `my_org_ids()`,
`my_tenant_ids()`, `can_read_tenant()`, `can_manage_tenant()`,
`can_run_provisioning()`, `my_sales_agent_ids()`…

> **Decisión D-P02.** El prompt pide permisos con nombre
> (`platform.provisioning.execute`, …) y roles nuevos (TECH_LEAD,
> PROVISIONING_ADMIN, PRODUCT_OWNER, PROVISIONING_VIEWER). Como el modelo actual
> **no** es dinámico, se añade una capa de permisos **aditiva** que no toca los
> roles existentes: catálogo de permisos + roles de provisioning + membresías +
> propiedad por producto. `EBIM_SUPER_ADMIN` sigue siendo transversal por
> definición. Ningún rol existente pierde ni gana nada fuera de este subsistema.

### 4.6 Escritura

Decisión previa DV2-001: `authenticated` **no** tiene INSERT/UPDATE/DELETE sobre
el dominio; toda escritura entra por RPC `SECURITY DEFINER` con `search_path`
fijo, autorización explícita en la primera línea y `platform.log_audit()`.
Esta fase mantiene ese patrón sin excepción.

### 4.7 Auditoría

`platform.audit_logs` es append-only real (sin GRANT de UPDATE/DELETE para
`authenticated`, sin política que los permita) y tiene guard anti-secretos en
`metadata`. Se escribe por `platform.log_audit()` o por `service_role`.

## 5. Edge Functions

| Función | `verify_jwt` | Rol |
| --- | --- | --- |
| `payment-setup` | true | canje de token de tarjeta |
| `payment-reconcile` | true | conciliación financiera |
| `culqi-webhook` | false | webhook público con idempotencia dura |
| `provisioning-worker` | true | worker de provisioning de **infraestructura** |

`provisioning-worker` ya implementa el patrón correcto de autorización
(comprobación booleana explícita contra la base **antes** de construir el cliente
`service_role`) y esa es exactamente la plantilla que sigue el orquestador nuevo.

Módulos compartidos: `supabase/functions/_shared/payments/*`.

## 6. Tests existentes (medición fresca, no reutilizada)

| Gate | Resultado baseline |
| --- | --- |
| `npm run db:reset` | PASS |
| `npm run db:test` | **537/537** en 21 ficheros |
| `npm test` | **169/169** en 11 ficheros |

Ficheros pgTAP: `supabase/tests/00_structure` … `20_v3_2_provider_plan_identity`.
E2E Playwright: `smoke`, `v2-journeys`, `v3-regional`, `v3-regional-journeys`,
`v3-1-billing-cadence`, `v3-2-payment-setup`.

## 7. Frontend

React 19 + TypeScript + Vite + TanStack Query + react-hook-form + zod.
`src/features/*` por dominio, `src/services/queries.ts` (lectura por PostgREST,
sin filtros de seguridad en el cliente) y `src/services/mutations.ts` (escritura
**solo** por RPC). `src/hooks/usePermissions.ts` espeja los helpers de la base
para no ofrecer botones que la base va a rechazar — y deja explícito que eso es
UX, no autorización.

Navegación en `src/app/navigation.ts`, agrupada como
Plataforma → Comercial → Tenancy → Cobranza → Infraestructura → Gobierno.

## 8. Lo que esta fase NO puede hacer (verificado contra el repo)

- No hay ni una sola credencial de SaaS en la base: el guard anti-secretos ya
  existe y se extiende a las tablas nuevas.
- No hay conexión directa a bases de datos de ningún SaaS y no se introduce
  ninguna: `DB_DIRECT` no existe como tipo de integración y hay un test que lo
  verifica sobre el catálogo de enums.
- No se toca EWM, no se llama a ningún servicio remoto y no se mueve `origin`.

## 9. Puntos de partida para la fase

1. `deployment_targets` se **extiende** (columnas nuevas), no se reemplaza.
2. `provisioning_requests` se **deja intacto**; el eje SaaS es una tabla nueva.
3. La capa de permisos es **aditiva** sobre los roles existentes.
4. Toda escritura nueva entra por RPC, igual que DV2-001.
5. El orquestador copia el gate de autorización de `provisioning-worker`.
