# Modelo comercial

## 1. Actores

| Actor | Cómo se representa |
|---|---|
| **EBIM** | `organizations` con `kind = PLATFORM`. Única fila con ese kind (índice único parcial). |
| **Partner / Reseller / Consultora** | `organizations` + capacidad `PARTNER` / `RESELLER` / `CONSULTING`. |
| **Cliente final** | `organizations` + capacidad `CUSTOMER`. |
| **Comercial independiente** | `sales_agents` con `agent_type = INDEPENDENT` y `organization_id` NULL. |
| **Comercial de partner** | `sales_agents` con `agent_type = PARTNER_AGENT` y organización obligatoria. |
| **Comercial interno EBIM** | `sales_agents` con `agent_type = EBIM_INTERNAL`. |

Una organización acumula capacidades: Consultora Andina es `PARTNER` +
`CONSULTING` + `CUSTOMER` a la vez, sin duplicar la cuenta.

## 2. Habilitación por producto

`organization_product_agreements` define qué SaaS puede comercializar o
administrar cada organización:

| Campo | Para qué |
|---|---|
| `can_resell` | Puede vender el producto. |
| `can_manage_tenants` | Puede administrar tenants de ese producto. |
| `margin_rate` | Margen que retiene el canal sobre la licencia (0..1). |
| `default_deployment_mode` | Modelo por defecto de sus ventas. |
| `terms` (JSONB) | Condiciones específicas: nivel, soporte incluido, región. |
| `valid_from` / `valid_to` | Vigencia. |

**Partner multi-SaaS con condiciones distintas** (contrato §11.1). En el seed,
Consultora Andina tiene:

| Producto | Margen | Nivel | Soporte incluido |
|---|---|---|---|
| eSupplier | 25% | GOLD | Sí |
| EWM | 18% | SILVER | No |

Un trigger (`tenants_manager_agreement_guard`) impide asignar un tenant a un
partner sin acuerdo activo para ese producto: `PARTNER_SIN_ACUERDO`.

## 3. Margen del canal vs comisión del comercial

Se confunden con facilidad y son cosas distintas:

| | Margen de canal | Comisión de comercial |
|---|---|---|
| **Quién lo gana** | La organización (partner/reseller) | Una persona (`sales_agents`) |
| **Dónde se define** | `organization_product_agreements.margin_rate`, o `subscriptions.channel_margin_rate` si se negoció caso a caso | `commission_rules` vía `sales_attributions.commission_plan_id` |
| **Cuándo se aplica** | Es parte de la economía del contrato | Se **devenga** con cada cobro confirmado |
| **Puede coexistir** | Sí — el contrato §2.2 lo contempla: el partner retiene margen y el comercial captador puede tener comisión adicional |

## 4. Licenciamiento por modelo de despliegue

### SHARED

| Concepto | `charge_kind` | Recurrente |
|---|---|---|
| Licencia por tenant productivo | `LICENSE` | Sí |
| Fee de implementación / onboarding | `IMPLEMENTATION_FEE` | **No** (one-time) |
| Addons | `ADDON` | Sí |

Un tenant DEMO no genera recurrente — lo impide un trigger, no una convención.
Un TRIAL sí es configurable.

### PARTNER_DEDICATED

| Concepto | `charge_kind` | En qué suscripción |
|---|---|---|
| Licencia base del partner | `PARTNER_BASE_LICENSE` | Suscripción **sin tenant** (`tenant_id` NULL) |
| Infraestructura dedicada | `INFRASTRUCTURE_FEE` | La misma, recurrente |
| Setup de la infraestructura | `IMPLEMENTATION_FEE` | La misma, one-time |
| Licencia por tenant activo | `TENANT_LICENSE` | Una suscripción por tenant |

El plan de la licencia base lleva `is_partner_base = true`.

### TENANT_DEDICATED

| Concepto | `charge_kind` |
|---|---|
| Licencia Enterprise | `LICENSE` |
| Infraestructura exclusiva | `INFRASTRUCTURE_FEE` |
| Setup / implementación | `IMPLEMENTATION_FEE` |
| Soporte premium / SLA | `SUPPORT_FEE` |
| Addons (marca blanca, multi-país) | `ADDON` |

## 5. Atribución comercial

`sales_attributions` responde "¿quién se lleva el crédito de esta venta?":

| Campo | Para qué |
|---|---|
| `sales_agent_id` | El comercial. |
| `saas_product_id` | El producto. Un comercial puede tener atribuciones en varios. |
| `tenant_id` / `subscription_id` | El objeto atribuible (al menos uno). |
| `customer_organization_id` | El cliente. |
| `channel_organization_id` | El canal por el que entró (NULL = directo). |
| `attribution_pct` | Participación (0..1). Permite venta compartida. |
| `source` | DIRECT / PARTNER / REFERRAL / INBOUND / CAMPAIGN. |
| `commission_plan_id` | Qué plan de comisión aplica. |
| `valid_from` / `valid_to` | Vigencia. |

**Venta compartida sin duplicar comisión:** un constraint trigger diferido
valida que la suma de `attribution_pct` de las atribuciones **vigentes y
solapadas** sobre el mismo objeto no supere 1. Ahí es exactamente donde nace la
comisión duplicada.

## 6. La regla que define el producto: comercial ≠ acceso operativo

> Un comercial que vendió un tenant puede ver información comercial autorizada
> (cliente, SaaS, plan, estado, monto atribuible, comisión, settlement).
> **NO** obtiene acceso a proveedores, contratos, inventario, órdenes ni
> documentos del SaaS del cliente.

Cómo está garantizado:

1. Crear un `sales_agent` o una `sales_attribution` **no** inserta nada en
   `tenant_memberships`. No hay ningún trigger que lo haga.
2. Los helpers están separados a propósito:
   `my_attributed_tenant_ids()` alimenta **sólo** las políticas comerciales;
   las tablas operativas usan `my_tenant_ids()`, que exige membresía o
   pertenencia organizacional.
3. El Control Plane **no almacena** los datos operativos: viven en el proyecto
   Supabase de cada app (contrato §7). Aunque una política fallara aquí, no hay
   proveedores ni órdenes que filtrar.
4. Tests: `01_rls_isolation.test.sql` #12-16 y el E2E "un SALES_AGENT ve su
   tablero comercial y nada operativo".

En el seed, Carla Comercial vendió `alpha-esupplier` y `titan-ewm` y cobra
comisión por ambos, sin una sola fila en `tenant_memberships`.

---

# V2 · Los tres esquemas de licenciamiento y el fee de implementación

## 1. Composición por escenario

### SHARED
- 1 tenant productivo = 1 licencia activa (`LICENSE` o `TENANT_LICENSE`).
- Fee de implementación **opcional**, siempre `ONE_TIME`.
- Un partner puede administrar N tenants en SHARED sin infraestructura dedicada.

### PARTNER_DEDICATED
- 1 **licencia base de partner**: una `subscription` SIN `tenant_id`, con un
  plan marcado `is_partner_base = true`. Es del canal, no de un cliente.
- N licencias por tenant activo.
- Fee de infraestructura dedicada, **recurrente** (porque el costo lo es).
- Implementación opcional.

### TENANT_DEDICATED
- 1 licencia Enterprise por cliente/tenant.
- Infraestructura dedicada.
- Implementación / setup.
- Soporte / SLA opcional (`SUPPORT_FEE`).

## 2. El fee de implementación NO infla el MRR

Es la regla que más fácil se rompe y más caro cuesta: un fee de implementación
cargado como mensual convierte un ingreso único en recurrente y falsea el MRR
para siempre.

Tres capas lo impiden:

1. `upsert_subscription_item` **rechaza** `IMPLEMENTATION_FEE` con un intervalo
   distinto de `ONE_TIME` (`FEE_IMPLEMENTACION_RECURRENTE`).
2. `onboard_customer_subscription` lo crea siempre como `ONE_TIME`.
3. `v_subscription_mrr` solo cuenta lo recurrente.

Verificado: un alta con licencia de 850 y fee de 1500 deja **MRR = 850**.

## 3. Alta transaccional

`onboard_customer_subscription()` convierte una venta en tenant + suscripción +
líneas + atribución + provisioning DRY_RUN **en una sola transacción**.

Antes eran cinco llamadas independientes: si la tercera fallaba quedaba un
tenant sin contrato y una atribución sin venta. Ahora, o queda todo o no queda
nada — verificado provocando un fallo de dominio operador a mitad del alta:
tras el error, **0 tenants huérfanos**.

No duplica seguridad: reutiliza `create_tenant()` con su `ADMIN_EMAIL_REQUERIDO`
y su bloqueo de `@ebim.pe`, y las RPCs de la Fase 02.

## 4. DEMO nunca genera recurrente

`onboard_customer_subscription` devuelve `recurring: false` para un tenant DEMO
y solo crea contrato si hay cargos únicos que cobrar — y entonces con intervalo
`ONE_TIME`. El trigger `enforce_demo_not_recurring` del baseline es la segunda
barrera.

## 5. Un canal, N acuerdos

`organization_product_agreements` es la fuente de verdad de qué puede vender
cada canal y en qué condiciones. Consultora Andina con eSupplier al 25 % y WMS
al 18 % son **dos filas**, no dos partners ni dos tipos de organización.

El acuerdo acota, además: modelos de despliegue permitidos, tipos de tenant,
tope de tenants y quién factura al cliente final (`billing_responsibility`).

**Solo EBIM define acuerdos.** Un partner admin que llame a
`upsert_product_agreement` recibe 42501: no puede concederse a sí mismo margen,
modelos ni cupo.
