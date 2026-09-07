# AUDIT BASELINE — EBIM Control Plane V2 (Fase 01)

**Fecha de auditoría:** 2026-09-07
**Branch:** `dev`
**PROJECT_ROOT:** `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
**Método:** verificación contra la base de datos LOCAL en ejecución, no contra el reporte previo.

---

## 1. Entorno verificado

| Herramienta | Versión detectada | Comando |
|---|---|---|
| node | v24.20.0 | `node -v` |
| supabase CLI | 2.116.0 | `npx supabase --version` |
| docker | 29.7.2 (daemon activo) | `docker info` |
| Stack local | `supabase_*_ebim-control-plane` UP | `docker ps` |
| DB local | `postgresql://…@127.0.0.1:54422/postgres` | `npx supabase status` |
| API local | `http://127.0.0.1:54421` | `npx supabase status` |

**Nota de sandbox:** los comandos que hablan con el daemon Docker (`supabase status`,
`db:reset`, `db:test`, `psql` vía `docker exec`) requieren ejecución fuera del sandbox
por defecto de la sesión (`unix:///…/docker.sock` da *permission denied* dentro).
No es un problema del proyecto.

---

## 2. Baseline declarado vs. baseline REAL

El `docs/nightly/FINAL_REPORT.md` afirmaba 39 tablas / 13 migraciones / 5 productos /
102 tests. **Verificado contra la DB viva:**

| Afirmación previa | Verificación | Resultado |
|---|---|---|
| 13 migraciones baseline | `supabase_migrations.schema_migrations` = `20260902000100`…`20260902001300` | ✅ CONFIRMADO |
| 39 tablas en `platform` | `information_schema.tables` → 39 BASE TABLE | ✅ CONFIRMADO |
| 3 deployment modes | enum `deployment_mode` = `SHARED, PARTNER_DEDICATED, TENANT_DEDICATED` | ✅ CONFIRMADO |
| 5 productos SaaS de seed | `select count(*) from platform.saas_products` = 5 | ✅ CONFIRMADO |
| 52 tests DB | `npm run db:test` → `Files=3, Tests=52 … Result: PASS` | ✅ CONFIRMADO |
| 29 tests unitarios | `npm run test` → `Test Files 3 passed, Tests 29 passed` | ✅ CONFIRMADO |
| build PASS | `npm run build` | ❌ **REGRESIÓN** (ver §5) |
| typecheck PASS | `npm run typecheck` | ⚠️ **SCRIPT ROTO** (ver §5) |
| `ADMIN_UI` PARTIAL, escrituras pendientes | `src/services/queries.ts` = 0 mutaciones | ✅ CONFIRMADO (y es peor de lo que suena: ver §4) |

### 2.1 Inventario real del schema `platform`

**39 tablas:**
`audit_logs, catalog_items, commission_events, commission_plans, commission_rules,
commission_settlements, companies, company_config, cost_allocations, cost_entries,
deployment_targets, invoice_lines, invoices, org_config, organization_capabilities,
organization_memberships, organization_product_agreements, organization_relationships,
organizations, payments, plan_prices, plans, platform_admins, platform_defaults,
profiles, provisioning_events, provisioning_requests, saas_products, sales_agents,
sales_attributions, subscription_items, subscriptions, tenant_addons,
tenant_deployments, tenant_features, tenant_memberships, tenant_settings, tenants,
workspace_apps`

**7 vistas:**
`v_collected_revenue, v_partner_margin, v_product_margin, v_subscription_mrr,
v_tenant_costs, v_tenant_margin, v_tenant_overview`

**26 enums:** `attribution_source, billing_interval, charge_kind, commission_basis,
commission_status, cost_category, cost_scope, deployment_mode, entity_status,
environment_kind, infra_provider, invoice_status, org_capability, org_kind,
org_relationship_type, org_role, payment_status, platform_role, provisioning_action,
provisioning_status, sales_agent_type, settlement_status, subscription_status,
tenant_role, tenant_status, tenant_type`

**42 funciones**, entre ellas los helpers de autorización
(`is_platform_admin, has_platform_role, is_super_admin, can_read_finance,
can_manage_platform_entities, my_org_ids, is_org_member, is_org_admin,
has_org_commercial_access, my_direct_tenant_ids, my_tenant_ids, can_read_tenant,
can_manage_tenant, my_sales_agent_ids, is_sales_agent, my_attributed_org_ids,
my_attributed_tenant_ids`), las de negocio (`create_tenant,
generate_commission_events, on_payment_confirmed, settle_commissions,
dashboard_summary, effective_config, effective_tenant_config, log_audit`) y 9
triggers de invariante (`enforce_attribution_total, enforce_cost_allocation_weight,
enforce_demo_not_recurring, enforce_deployment_coherence, enforce_operator_domain,
enforce_payment_invoice_status, enforce_provisioning_transition,
enforce_super_admin_governance, enforce_tenant_manager_agreement,
reject_secret_like_json`).

### 2.2 Volumen del seed actual

```
products=5 orgs=10 tenants=13 subs=13 invoices=40 payments=25
agents=3 commevents=19 targets=6 plans=9
```
12 usuarios `auth.users` (11 fixtures `*.ebim.test` + `dcalagua@ebim.pe` como super admin).

---

## 3. Modelo de permisos existente (que V2 DEBE respetar)

De `20260902000900_rls_policies.sql`:

- `anon`: **sin `USAGE` del schema**. No puede evaluar ninguna política. Correcto.
- `authenticated`: `SELECT` amplio filtrado por RLS. Escritura **acotada**.
- `service_role`: todo, solo server-side.
- RLS `ENABLE` + `FORCE` aplicado en bucle a **todas** las tablas `relkind='r'` de `platform`.
- `alter default privileges … revoke all on tables from public, anon` → **las tablas
  nuevas de V2 heredan la denegación por defecto**, pero NO heredan RLS: cada tabla
  nueva debe declarar `enable`+`force` explícitamente.

### 3.1 Superficie de escritura ya concedida a `authenticated`

| Tabla | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `profiles` | — | ✅ | — |
| `organizations` | ✅ | ✅ | — |
| `companies` | ✅ | ✅ | — |
| `organization_memberships` | ✅ | ✅ | ✅ |
| `saas_products` | ✅ | ✅ | — |
| `organization_product_agreements` | ✅ | ✅ | — |
| `tenants` | ✅ | ✅ | — |
| `tenant_memberships` | ✅ | ✅ | ✅ |
| `tenant_features` | ✅ | ✅ | ✅ |
| `tenant_settings` | ✅ | ✅ | — |
| `org_config` / `company_config` | ✅ | ✅ | — |
| `tenant_addons` | ✅ | ✅ | ✅ |

### 3.2 Superficie EXPLÍCITAMENTE denegada a `authenticated` (solo lectura)

`plans`, `plan_prices`, `catalog_items`, `subscriptions`, `subscription_items`,
`invoices`, `invoice_lines`, `payments`, `cost_entries`, `cost_allocations`,
`sales_agents`, `sales_attributions`, `commission_plans`, `commission_rules`,
`commission_events`, `commission_settlements`, `deployment_targets`,
`tenant_deployments`, `provisioning_requests`, `provisioning_events`, `audit_logs`.

> **Consecuencia de diseño para V2:** toda escritura sobre estas tablas tiene que pasar
> por RPC `SECURITY DEFINER` con `search_path` fijo, autorización explícita y auditoría.
> No se van a abrir GRANTs directos: eso desmontaría el modelo del baseline.
> `audit_logs` se queda append-only real (solo `platform.log_audit()` o `service_role`).

---

## 4. Estado real de la UI

`src/services/queries.ts` (353 líneas) contiene **24 hooks, todos `useQuery`. Cero
`useMutation`. Cero llamadas `.insert()`, `.update()`, `.delete()` o `.rpc()` de
escritura** en todo `src/`. La única RPC invocada es `dashboard_summary()`, que es de
lectura.

Por tanto **las 22 páginas de `src/features/**` son 100 % read-only**. El
`FINAL_REPORT.md` previo llamaba a esto "PARTIAL"; el estado exacto es:

| Área | Página(s) | Lectura | Escritura |
|---|---|---|---|
| Dashboard | `DashboardPage` | ✅ | n/a |
| Catálogo | `ProductsPage`, `ProductDetailPage`, `PlansPage`, `FeatureFlagsPage` | ✅ | ❌ |
| Cuentas | `OrganizationsPage`, `OrganizationDetailPage`, `PartnersPage`, `CustomersPage` | ✅ | ❌ |
| Tenants | `TenantsPage`, `TenantDetailPage` | ✅ | ❌ |
| Comercial | `SalesAgentsPage`, `AttributionsPage`, `CommissionPlansPage`, `CommissionsPage` | ✅ | ❌ |
| Finanzas | `SubscriptionsPage`, `BillingPage`, `CostsPage` | ✅ | ❌ |
| Infraestructura | `DeploymentsPage`, `ProvisioningPage` | ✅ | ❌ |
| Gobierno | `AuditPage`, `SettingsPage` | ✅ | ❌ (salvo apariencia local) |

Primitivos reutilizables ya existentes y que V2 **no** debe duplicar:
`PageContainer, Card, StatCard, Badge, LoadingState, EmptyState, ErrorState,
SearchBar, DataTable` (`src/components/ui/primitives.tsx`), `ConfirmDialog`,
`SectionTabs`, `ErrorBoundary`, `EbimMark`.
Falta un primitivo de **formulario/modal** y un primitivo de **toast/feedback**: los
crea la Fase 02.

---

## 5. Regresiones encontradas y corregidas en Fase 01

El contrato de Fase 01 autoriza "corregir únicamente problemas de entorno/configuración
o regresiones obvias y documentar cada corrección". Se corrigieron dos:

### R-01 — `npm run build` FALLABA (regresión real, no ambiental)

```
$ npm run build
vite.config.ts(13,3): error TS2769: No overload matches this call.
    Object literal may only specify known properties,
    and 'test' does not exist in type 'UserConfigExport'.
```

`vite.config.ts` importaba `defineConfig` de `'vite'` pero declaraba la clave `test`
(configuración de Vitest). Con la versión de Vitest instalada (3.2.7) esa clave ya no
está en el tipo de Vite, así que `tsc -b` — primer paso de `build` — abortaba.

**Corrección:** `import { defineConfig } from 'vitest/config'` (un solo carácter de
diferencia semántica: `vitest/config` re-exporta `defineConfig` con la clave `test`
tipada). No se cambió ninguna opción de build.

### R-02 — `npm run typecheck` era un script inválido que se auto-ocultaba

```
"typecheck": "tsc -b --noEmit false --emitDeclarationOnly false || tsc -p tsconfig.app.json --noEmit"
```

`--noEmit false` contradice `allowImportingTsExtensions: true` de ambos tsconfig, así que
la primera mitad **siempre** emitía `TS5096` y el `||` la tapaba con la segunda. Efecto
práctico: `tsconfig.node.json` (que cubre `vite.config.ts`, `playwright.config.ts`,
`tailwind.config.ts`) **nunca se comprobaba**, que es exactamente por qué R-01 pasó
inadvertido.

**Corrección:**
```
"typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit"
"build":     "npm run typecheck && vite build"
```

Ambos gates PASS tras la corrección (§6).

### R-03 — Secuela de R-02: `tsc` había emitido `.js` DENTRO de `src/`

**Detectado en la Fase 02, no en la 01.** Documentado aquí porque su causa es R-02.

La primera ejecución del `typecheck` roto (`tsc -b --noEmit false …`) llegó a **emitir
JavaScript junto a cada `.tsx`**: 50 archivos `src/**/*.js`. Se colaron en el commit de
la Fase 01 por un `git add -A`.

El daño no es cosmético. `resolve.extensions` de Vite pone `.js` **antes** que `.tsx`, así
que `import { ProductsPage } from '@/features/catalog/ProductsPage'` resolvía al `.js`
congelado. Consecuencia: **el bundle dejó de reflejar el código fuente**. Se detectó porque
tras añadir ~2.500 líneas de UI el bundle seguía pesando exactamente 586,64 kB y
`grep "Nuevo producto SaaS" dist/assets/*.js` no encontraba nada.

**Corrección:**
1. `git rm --cached` + borrado en disco de los 50 `.js` (se conserva `src/vite-env.d.ts`,
   que es fuente real, no artefacto).
2. Regla en `.gitignore` (`src/**/*.js`) con el porqué escrito al lado, para que un `tsc`
   mal invocado no vuelva a congelar el bundle en silencio.

**Verificación:** el bundle pasó de 586,64 kB a **776,37 kB** y los textos nuevos
(`Nuevo producto SaaS`, `Encolar solicitud`, `Versionar tarifa`…) aparecen en `dist`.

> Lección para el gate: «build PASS» no significa «build correcto». A partir de aquí, la
> evidencia de build incluye comprobar que un string nuevo del código aparece en `dist/`.

---

## 6. Evidencia de ejecución del baseline

| Comando | Resultado |
|---|---|
| `npm run db:reset` | ✅ 13 migraciones aplicadas + `seed.sql` — `Finished supabase db reset` |
| `npm run db:test` | ✅ `Files=3, Tests=52` — `Result: PASS` |
| `npm run typecheck` | ✅ exit 0 (tras R-02) |
| `npm run lint` | ✅ exit 0, sin warnings |
| `npm run test` | ✅ `Test Files 3 passed (3) · Tests 29 passed (29)` |
| `npm run build` | ✅ tras R-01. **Nota:** ese build usaba los `.js` obsoletos de R-03; el build fiable es el de la Fase 02 (`776.37 kB`, 172→186 módulos reales). |

`npm ci` **no** se ejecutó: `node_modules/` está íntegro y `npm ci` lo borraría y
re-descargaría sin aportar información al baseline. Las versiones instaladas se
verificaron contra `package.json` mediante la ejecución real de los gates.

E2E (Playwright) queda para la Fase 17 según el propio prompt de Fase 01 §7.

---

## 7. Bloqueo registrado

| ID | Bloqueo | Impacto | Mitigación aplicada |
|---|---|---|---|
| **BE-01** | `GUIDELINES_ROOT` no es enumerable desde esta sesión: `ls` y `find` sobre `…/My Drive/EBIM-Plataforma` son rechazados por el gate de permisos de la herramienta Bash (la ruta existe — `stat` devuelve EISDIR — pero no se puede listar ni leer su contenido). | No se puede contrastar en vivo el contrato de plataforma v1.15. | Se usa `docs/architecture/EBIM_CONVENTIONS.md` como **snapshot local**, tal y como instruye `00_START_HERE_VSCODE.md` §"Antes de empezar". Ese snapshot documenta 16 convenciones de datos (C-01…C-16), 8 de seguridad (S-01…S-08), 15 de UX (U-01…U-15) y 6 de proceso (P-01…P-06) con su origen citado en el contrato. **No se inventa ninguna convención nueva.** GUIDELINES_ROOT no fue modificado (ni podría serlo: ni siquiera es legible). |

---

## 8. Conclusión de la Fase 01

- El baseline **es real y reproducible**: DB reconstruible desde cero, 52 tests DB PASS.
- El reporte previo era **exacto salvo en `build`/`typecheck`**, que estaban rotos y
  quedaron corregidos aquí con dos cambios mínimos y documentados.
- No se duplicará ninguna tabla existente: el inventario de §2.1 es la referencia.
- Las escrituras faltantes están enumeradas en §4 y priorizadas en `GAP_MATRIX.md`.
- El modelo de permisos de §3 fija la regla arquitectónica de todo V2:
  **escritura sensible = RPC `SECURITY DEFINER` auditada, no GRANT directo.**

**Gate 01: PASS.**
