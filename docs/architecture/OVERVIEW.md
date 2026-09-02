# Arquitectura — visión general

## 1. Dónde encaja el Control Plane en la suite EBIM

El contrato de plataforma EBIM describe una topología de **un proyecto Supabase
por app** más **un hub central de identidad y catálogo** (schema `platform`):

```
        ┌─ EBIM Control Plane  (este repo — el HUB) ──────────────┐
        │  auth.users              -> login único                 │
        │  schema platform:                                       │
        │    organizations · companies · memberships              │
        │    saas_products · organization_product_agreements      │
        │    tenants · tenant_deployments · deployment_targets    │
        │    plans · subscriptions · invoices · payments          │
        │    sales_agents · attributions · commissions            │
        │    cost_entries · cost_allocations · audit_logs         │
        └─────────────────────────────────────────────────────────┘
                 ▲ las apps confían en esta identidad
        ┌────────┼──────────┬──────────┬──────────┐
    eSupplier   EWM        TMS       GMAO      eChange
    (su data)  (su data)  (su data) (su data)  (su data)
```

Cada app conserva su propio proyecto y su propio schema de datos. El Control
Plane administra **metadatos y gobierno**, nunca los datos operativos
(contrato §7).

## 2. Los tres ejes que no se deben confundir

| Eje | Pregunta que responde | Dónde vive |
|---|---|---|
| **Comercial** | ¿Quién vende, quién administra, quién paga? | `organizations`, `organization_relationships`, `organization_product_agreements` |
| **Lógico** | ¿Qué espacio usa un cliente de un producto? | `tenants` |
| **Físico** | ¿Sobre qué infraestructura corre? | `deployment_mode` + `deployment_targets` + `tenant_deployments` |

La confusión clásica es tratar la jerarquía comercial como jerarquía de
infraestructura ("el partner tiene su base de datos, luego sus clientes son
tenants dentro de ella"). Este modelo los separa:

- Un partner puede administrar tenants en infraestructura **compartida**
  (escenario 2 del seed).
- Un mismo cliente puede tener un tenant compartido de un producto y uno
  dedicado de otro.
- No existe `parent_tenant_id`: la relación partner→cliente es
  `tenants.managing_organization_id`, que es una relación **organizacional**.

## 3. Por qué las organizaciones tienen capacidades y no un tipo

Un enum `organization_type = PARTNER | CUSTOMER` obliga a duplicar la cuenta en
cuanto una consultora compra el producto que revende — que es exactamente el
caso de Consultora Andina en el seed. En su lugar:

- `organizations.kind` distingue sólo EBIM (`PLATFORM`) del resto (`COMPANY`);
- `organization_capabilities` acumula `PARTNER`, `RESELLER`, `CONSULTING`,
  `CUSTOMER`;
- `organization_relationships` guarda las aristas con vigencia.

## 4. Cómo se añade un SaaS nuevo

Insertando una fila en `saas_products`. No hay columnas `is_esupplier`, no hay
ramas de código por producto, y el test 13 de `00_structure.test.sql` falla si
alguien añade una.

Lo que sí varía por producto:
- `saas_products.billing_unit` (`TENANT`, `COMPANY`, `WAREHOUSE`, `USER`) — el
  contrato §11.1 registra que WMS cobra por almacén, no por sociedad;
- `organization_product_agreements.terms` y `margin_rate` — el mismo partner
  puede tener 25% en eSupplier y 18% en EWM;
- `plans` y `plan_prices` por producto y modo de despliegue.

## 5. Seguridad: dónde vive de verdad

```
Navegador (clave anon)  ->  PostgREST  ->  RLS  ->  datos
                                          ^^^
                              aquí, y sólo aquí
```

El frontend **no** filtra por seguridad. `src/services/queries.ts` pide
`select('*')` sin cláusulas de alcance: si un partner pide `tenants`, la base ya
le devuelve sólo los suyos. Añadir un `.eq('organization_id', …)` en el cliente
daría la falsa impresión de que ahí está la protección.

Los guards de ruta (`RequirePersona`) y el menú adaptativo son **UX**: evitan
pantallas vacías y confusas. El test E2E "un PARTNER_ADMIN no ve la sección de
costos" verifica ambas cosas: que no está en el menú **y** que forzar la URL
tampoco funciona.

## 6. Decisiones estructurales

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Schema `platform`, `public` vacío | Todo en `public` | Coincide con el hub EBIM existente; permite exponer `platform` a PostgREST sin arrastrar objetos del sistema. |
| Helpers RLS `SECURITY DEFINER` | Subconsultas inline en cada política | Una política de `organizations` que consulte `organization_memberships` (que tiene RLS) entra en recursión. El definer la corta de forma acotada y auditable. |
| `FORCE ROW LEVEL SECURITY` | Sólo `ENABLE` | `ENABLE` no aplica al owner de la tabla. `FORCE` evita que una función definer mal escrita se salte el filtro sin querer. |
| Vistas con `security_invoker = true` | Vistas normales | Una vista normal corre con los permisos de su owner: sería un bypass total de RLS. El test 8 lo verifica. |
| `numeric(14,2)` + `currency char(3)` | `float` o un solo campo | Los binarios flotantes acumulan error en sumas de dinero. El test 11 falla si aparece uno. |
| Agregados por moneda, sin FX | Convertir todo a USD | Un tipo de cambio implícito produce un número que nadie puede auditar. Se documenta como deuda. |
| TanStack Query + PostgREST directo | Capa de servicios propia sobre HTTP | Es hacia donde migra GMAO (su §3.9). Menos código intermedio que pueda "olvidar" un filtro. |
