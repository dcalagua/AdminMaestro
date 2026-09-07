# Matriz RBAC / RLS

## 1. Principio

> Ocultar un menú no protege nada.

La autorización vive en PostgreSQL: GRANT mínimos + RLS con *default deny* en
todas las tablas. El menú adaptativo y los guards de ruta son UX — evitan
pantallas vacías, no impiden accesos. El test E2E "un PARTNER_ADMIN no ve la
sección de costos" comprueba las dos capas: que no está en el menú **y** que
forzar la URL tampoco sirve.

## 2. Roles

| Rol | Dónde se define | Alcance |
|---|---|---|
| `EBIM_SUPER_ADMIN` | `platform_admins` | Todo el Control Plane. **Único** en la suite: `dcalagua@ebim.pe` (contrato §13.1). |
| `EBIM_PRODUCT_ADMIN` | `platform_admins` | Productos, organizaciones, tenants, deployments, provisioning. |
| `EBIM_FINANCE` | `platform_admins` | Planes, suscripciones, facturación, cobros, costos, comisiones. |
| `PARTNER_ADMIN` | `organization_memberships` | Su organización, sus acuerdos, sus clientes y tenants. **Nunca** otra organización. |
| `PARTNER_SALES` | `organization_memberships` | Vista comercial de su partner. |
| `PARTNER_SUPPORT` | `organization_memberships` | Metadata de tenants para soporte. **Excluido** de la información comercial/financiera. |
| `SALES_AGENT` | `sales_agents.user_id` | Sus atribuciones y comisiones. Nada operativo. |
| `TENANT_ADMIN` | `tenant_memberships` | Su tenant: metadata, features, settings. |
| `TENANT_USER` | `tenant_memberships` | Lectura de su tenant. |

`anon` no tiene **ni USAGE** sobre el schema `platform`. `service_role` sólo
existe del lado servidor (Edge Functions).

## 3. Helpers de autorización

Todos en `20260902000800_rls_helpers.sql`: `SECURITY DEFINER`, `STABLE`,
`set search_path = platform, pg_catalog`, sin `EXECUTE` para `anon`.

| Helper | Devuelve |
|---|---|
| `is_platform_admin()` | ¿Tiene algún rol de consola activo? |
| `has_platform_role(role)` | ¿Tiene ese rol concreto? |
| `is_super_admin()` | Atajo de `EBIM_SUPER_ADMIN`. |
| `can_read_finance()` | `EBIM_FINANCE` o super admin. |
| `can_manage_platform_entities()` | `EBIM_PRODUCT_ADMIN` o super admin. |
| `my_org_ids()` | Organizaciones con membresía activa. |
| `is_org_admin(org)` | `PARTNER_ADMIN` u `ORG_ADMIN` de esa organización. |
| `has_org_commercial_access(org)` | Admin o comercial de esa organización (**excluye** `PARTNER_SUPPORT`). |
| `my_tenant_ids()` | Tenants por membresía + los de sus organizaciones (como cliente o como partner). |
| `can_read_tenant(t)` / `can_manage_tenant(t)` | Lectura / administración de un tenant. |
| `my_sales_agent_ids()` | Su propio registro de comercial + los comerciales de las organizaciones que administra. |
| `my_attributed_tenant_ids()` | Tenants con visibilidad **comercial**. **No** es acceso operativo. |

**Por qué `SECURITY DEFINER`:** una política de `organizations` necesita
consultar `organization_memberships`, que también tiene RLS. Sin definer,
PostgreSQL entra en recursión de políticas. Con definer, la consulta interna
salta RLS de forma acotada y auditable.

**Por qué `search_path` explícito:** sin él, un schema temporal del atacante
puede shadowear una tabla y cambiar lo que devuelve la función. El test 7 de
`00_structure.test.sql` falla si alguna función definer lo omite.

## 4. Matriz por tabla

| Tabla | SUPER | PRODUCT | FINANCE | PARTNER_ADMIN | PARTNER_SALES | PARTNER_SUPPORT | SALES_AGENT | TENANT_ADMIN | anon |
|---|---|---|---|---|---|---|---|---|---|
| `profiles` | RW | R propio | R propio | R org | R org | R org | R propio | R propio | ✗ |
| `platform_admins` | R | R propio | R propio | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `organizations` | RW | RW | R | RW propia | R propia | R propia | R atribuidas | R | ✗ |
| `organization_capabilities` | R | R | R | R propia | R propia | R propia | ✗ | ✗ | ✗ |
| `companies` | RW | RW | R | RW propia | R propia | R propia | ✗ | ✗ | ✗ |
| `organization_relationships` | R | R | R | R propias | R propias | R propias | ✗ | ✗ | ✗ |
| `organization_memberships` | RW | RW | R | RW propia | R propia | R propia | ✗ | ✗ | ✗ |
| `saas_products` | RW | RW | R | R | R | R | R | R | ✗ |
| `organization_product_agreements` | RW | RW | R | R propios | R propios | R propios | ✗ | ✗ | ✗ |
| `tenants` | RW | RW | R | RW suyos | R suyos | R suyos | **R atribuidos** | RW el suyo | ✗ |
| `tenant_memberships` | RW | RW | R | RW suyos | R suyos | R suyos | ✗ | RW el suyo | ✗ |
| `tenant_features` / `tenant_settings` | RW | RW | R | RW suyos | R suyos | R suyos | ✗ | RW el suyo | ✗ |
| `catalog_items` | R | R | R | R | R | R | R | R | ✗ |
| `tenant_addons` | RW | RW | R | RW suyos | R suyos | R suyos | ✗ | RW el suyo | ✗ |
| `plans` | R | R | R | R | R | R | R | R | ✗ |
| `plan_prices` | R | R | R | R contratados | R contratados | ✗ | ✗ | ✗ | ✗ |
| `subscriptions` | R | R | R | R propias | R propias | ✗ | **R atribuidas** | R del tenant | ✗ |
| `subscription_items` | R | R | R | R propias | R propias | ✗ | ✗ | R del tenant | ✗ |
| `invoices` / `invoice_lines` / `payments` | R | ✗ | R | R propias | R propias | **✗** | **✗** | ✗ | ✗ |
| `cost_entries` / `cost_allocations` | R | R | R | **✗** | **✗** | **✗** | **✗** | **✗** | ✗ |
| `sales_agents` | R | R | R | R de su org | ✗ | ✗ | R propio | ✗ | ✗ |
| `sales_attributions` | R | R | R | R de su canal | R de su canal | ✗ | **R propias** | ✗ | ✗ |
| `commission_plans` / `commission_rules` | R | R | R | R | R | R | R | R | ✗ |
| `commission_events` / `commission_settlements` | R | ✗ | R | ✗ | ✗ | ✗ | **R propias** | ✗ | ✗ |
| `deployment_targets` | R | R | ✗ | R propios | ✗ | R propios | ✗ | R del suyo | ✗ |
| `tenant_deployments` | R | R | ✗ | R suyos | ✗ | R suyos | ✗ | R del suyo | ✗ |
| `provisioning_requests` / `provisioning_events` | R | R | ✗ | R suyos | ✗ | R suyos | ✗ | R del suyo | ✗ |
| `audit_logs` | R | R | R | R de su org | R de su org | R de su org | ✗ | R del suyo | ✗ |

R = SELECT · RW = SELECT + escritura acotada por política · ✗ = sin acceso

**Las celdas en negrita son las que sostienen el modelo de negocio:**

- `SALES_AGENT` ve el **tenant** que vendió (metadata comercial) pero **no** su
  suscripción operativa completa, ni facturas, ni costos, ni deployments — y no
  tiene `tenant_membership`.
- `PARTNER_SUPPORT` ve metadata de tenants para dar soporte pero **no** facturas
  ni comisiones.
- **Nadie fuera de EBIM ve `cost_entries`**: cuánto le cuesta a EBIM operar es
  información interna, incluso frente al partner al que se la provee.

## 5. Protección por COLUMNA, no sólo por fila

Contrato §2.6, lección 1:

> RLS decide qué **filas** se tocan, nunca qué **columnas**.

El caso: en una tabla de entitlements conviven una columna que el cliente decide
legítimamente (encender un addon) y otra que decide la plataforma (su precio).
Partir la política en lectura/escritura no sirve: la escritura de esa fila **es**
legítima, lo ilegítimo es una columna.

La solución aquí es estructural: el precio vive en `catalog_items`, donde
`authenticated` **no tiene GRANT de escritura**; la activación vive en
`tenant_addons`, que no tiene ninguna columna de precio. El test 10 de
`00_structure.test.sql` falla si alguien concede INSERT/UPDATE/DELETE sobre
`catalog_items` a `authenticated`.

## 6. Append-only real en `audit_logs`

`authenticated` tiene **sólo SELECT**. No hay GRANT de UPDATE/DELETE ni política
que los permita. Escribir pasa por `platform.log_audit()` (SECURITY DEFINER) o
por `service_role`.

Esto es deliberado: el `COMMENT` de la tabla describe el enforcement que
**existe**, no una intención. Un "append-only por convención" es exactamente el
error que el contrato §14 registra como lección (`esupplier-030`).

## 7. Tests que respaldan esta matriz

`supabase/tests/01_rls_isolation.test.sql` (20 tests) ejecuta las políticas
reales fijando `request.jwt.claims`, que es de donde `auth.uid()` lee:

| # | Test |
|---|---|
| 1-2 | `EBIM_SUPER_ADMIN` administra entidades globales (10 organizaciones, 13 tenants). |
| 3-6 | Cross-partner denegado: Andina no ve a Pacífico ni sus tenants. |
| 7-8 | Cross-org financiero denegado; un partner no ve **ningún** `cost_entry`. |
| 9-11 | Cross-tenant denegado: el admin de Alpha no ve el tenant de Omega ni sus settings. |
| 12-16 | `SALES_AGENT`: ve lo suyo, no lo de otro comercial, y **no obtiene acceso operacional por haber vendido**. |
| 17-18 | Usuario sin membresía: cero tenants, cero facturas. |
| 19-20 | `anon` recibe permiso denegado (42501), no una lista vacía. |

Más `00_structure.test.sql` (14) para el hardening y `02_business_rules.test.sql`
(18) para las reglas de negocio. **52 tests, todos en verde.**

---

# V2 · Tablas y RPCs nuevas

## 1. Principio: escritura sensible = RPC, no GRANT

La migración 09 del baseline revoca deliberadamente INSERT/UPDATE/DELETE a
`authenticated` sobre casi todo el dominio financiero. **V2 no abre ni uno de
esos GRANTs.** Toda escritura entra por una RPC `SECURITY DEFINER` que:

1. autoriza en la primera línea del cuerpo, con los helpers existentes;
2. valida IDs y estado previo antes de tocar nada;
3. deja rastro con `platform.log_audit()`;
4. revoca `public, anon` y concede lo mínimo.

Comprobado en `03_v2_security.test.sql` §4: **cero** privilegios de escritura
directa de `authenticated` sobre las tablas de cobranza.

## 2. Lectura de las tablas nuevas

| Tabla | Quién la lee |
|---|---|
| `payment_provider_accounts` | EBIM producto/finanzas, o la organización dueña de la cuenta |
| `subscription_collection_profiles` | Quien puede ver la suscripción (finanzas, plataforma, org facturada, o tenant) |
| `subscription_commercial_documents` | Igual que el perfil de cobro |
| `provider_customers` / `provider_payment_methods` | EBIM finanzas/plataforma, o la propia organización |
| `provider_plans` | EBIM finanzas/plataforma (catálogo, no revela clientes) |
| `provider_subscriptions` | Igual que la suscripción asociada |
| `provider_webhook_events` | **Solo EBIM finanzas y super admin.** Diagnóstico de plataforma |
| `billing_alerts` | EBIM, o la organización facturada |

## 3. RPCs por rol

| RPC | `EBIM_SUPER_ADMIN` | `EBIM_PRODUCT_ADMIN` | `EBIM_FINANCE` | Admin de organización |
|---|---|---|---|---|
| `upsert_saas_product`, `upsert_plan`, `set_plan_price` | ✅ | ✅ | — | — |
| `upsert_organization` (alta) | ✅ | ✅ | — | — |
| `upsert_organization` (edición de la suya) | ✅ | ✅ | — | ✅ |
| `upsert_product_agreement`, `end_product_agreement` | ✅ | ✅ | — | ❌ |
| `create_tenant`, `set_tenant_status`, `update_tenant` | ✅ | ✅ | — | ✅ (su tenant) |
| `create_subscription`, `set_subscription_status` | ✅ | ✅ | ✅ | — |
| `upsert_commission_plan`, `upsert_commission_rule` | ✅ | — | ✅ | — |
| `upsert_payment_provider_account` | ✅ | — | ✅ | ❌ |
| `set_subscription_collection_profile` | ✅ | ✅ | ✅ | ✅ (org facturada) |
| `request/receive/approve/reject/cancel_commercial_document` | ✅ | ✅ | ✅ | ✅ (org facturada) |
| `refresh_billing_alerts` | ✅ | ✅ | ✅ | ❌ |
| `apply_due_suspensions` | ✅ | ✅ | ❌ | ❌ |
| `reverse_payment`, `confirm_manual_payment` | ✅ | ❌ | ✅ | ❌ |
| `enqueue_provisioning_request` (DRY_RUN) | ✅ | ✅ | — | ❌ |
| `enqueue_provisioning_request` (**LIVE**) | ✅ | ❌ | ❌ | ❌ |
| `register_provider_payment` | servidor (`service_role`) | — | ✅ | ❌ |

## 4. Invariantes de seguridad verificados

| Invariante | Test |
|---|---|
| Las 9 tablas nuevas están en `platform` con RLS + FORCE | `03_v2_security` §1-2 |
| `anon` sigue sin ningún GRANT | §3 |
| Cero escritura directa sobre cobranza | §4 |
| Toda RPC V2 `SECURITY DEFINER` fija `search_path` | §5 |
| **Todas** las vistas usan `security_invoker` | §6 y `00_structure` §8 |
| Una clave `sk_test_`/`sk_live_` no se puede guardar | §7-9 |
| Un PAN no cabe en `last4` | §11 |
| Un partner no se concede margen ni pasarela | §12-13 |
| Un partner no ve los acuerdos ni los eventos de otro | §14-15 |
| **Comercial ≠ acceso operativo**: 0 `tenant_memberships` | §17-21 |
| Un usuario de tenant no ve finanzas de plataforma | §22-24 |
| La pasarela de un partner no cobra a otra organización | §25-26 |

## 5. El endpoint público, y por qué lo es

`culqi-webhook` se despliega con `verify_jwt = false`: Culqi no puede enviar un
JWT de Supabase. **Y Culqi tampoco firma criptográficamente sus webhooks** —
verificado contra su documentación oficial el 2026-09-07.

No se inventa una firma. Se compensa con cuatro defensas reales, documentadas en
`docs/payments/CULQI_ARCHITECTURE.md` §5.1: idempotencia dura, validación
estricta del payload, verificación server-to-server del cargo y correlación
obligatoria con una suscripción existente. El endpoint **no escribe nada
directamente**: todo pasa por `register_provider_payment()`.
