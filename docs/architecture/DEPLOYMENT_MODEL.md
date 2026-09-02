# Modelo de despliegue — Shared / Partner Dedicated / Tenant Dedicated

## 1. El principio

**Tenant lógico ≠ infraestructura física.** Un tenant es el espacio de un
cliente en un producto. Dónde corre lo decide `deployment_mode` más su fila en
`tenant_deployments`.

Esto permite que un partner administre 3 clientes en infraestructura compartida
(no necesita un proyecto propio para "tener sus clientes") y que ese mismo
partner tenga además un dedicado para otros 2.

## 2. Los tres modelos

### SHARED

```
deployment_target: shared-esupplier-sa-east  (owner: EBIM)
    ├── alpha-esupplier          (cliente directo EBIM)
    ├── cliente-p1-esupplier     (administra Consultora Andina)
    ├── cliente-p2-esupplier     (administra Consultora Andina)
    └── demo-andina-esupplier    (DEMO — sin cobro recurrente)
```

- Infraestructura de EBIM, compartida.
- `deployment_targets.owner_organization_id` es **NULL** (constraint).
- Admite venta directa **y** venta por canal en el mismo target.
- Cada tenant productivo puede representar una licencia recurrente.
- Un tenant DEMO no genera recurrente (trigger `subscriptions_demo_guard`).
- Puede existir fee de implementación (one-time, no suma a MRR).
- El canal puede retener margen (`subscriptions.channel_margin_rate`) y/o
  generar comisión al captador.

### PARTNER_DEDICATED

```
deployment_target: andina-esupplier-dedicated  (owner: Consultora Andina)
    ├── andina-pd-cliente-a
    └── andina-pd-cliente-b

Suscripciones:
  SUB-ANDINA-PD-BASE  (tenant_id = NULL)  -> licencia base + infra + setup
  SUB-ANDINA-PD-A     (tenant A)          -> licencia por tenant activo
  SUB-ANDINA-PD-B     (tenant B)          -> licencia por tenant activo
```

- El target pertenece al **partner** (`owner_organization_id` obligatorio).
- La **licencia base** es una suscripción **sin tenant**: es del partner, no de
  ninguno de sus clientes. Su plan lleva `is_partner_base = true`.
- Encima, **N licencias** por tenant activo (`TENANT_LICENSE`).
- Fee de implementación (one-time) + fee recurrente de infraestructura dedicada.
- Un trigger valida que el target pertenezca al partner que administra el tenant
  (`TARGET_PARTNER_AJENO`).

### TENANT_DEDICATED

```
deployment_target: omega-esupplier-dedicated  (owner: Empresa Enterprise Omega)
    └── omega-esupplier   ← exactamente uno
```

- Cliente Enterprise con infraestructura exclusiva.
- Licencia Enterprise + infra dedicada + setup + soporte premium/SLA.
- Dos triggers lo garantizan: `TARGET_DEDICADO_OCUPADO` (un target exclusivo
  aloja exactamente un tenant) y `TARGET_DEDICADO_AJENO` (el dueño del target es
  el cliente).

## 3. Qué NO puede pasar (validado en la base)

| Intento | Error |
|---|---|
| Tenant SHARED sobre target dedicado | `MODO_DESPLIEGUE_INCOMPATIBLE` |
| Segundo tenant en un target TENANT_DEDICATED | `TARGET_DEDICADO_OCUPADO` |
| Target dedicado de otra organización | `TARGET_DEDICADO_AJENO` / `TARGET_PARTNER_AJENO` |
| Target que sirve a otro producto | `PRODUCTO_INCOMPATIBLE` |
| Target SHARED con dueño | CHECK `deployment_targets_owner_ck` |
| Target dedicado sin dueño | CHECK `deployment_targets_owner_ck` |

## 4. Seguridad de la metadata de infraestructura

`deployment_targets` guarda **sólo referencias públicas**:

| Sí | No |
|---|---|
| `provider`, `region`, `environment` | contraseña de la base |
| `provider_project_ref` (id público del proyecto) | clave de servicio |
| `cost_center`, `status` | PAT / token de Management API |
| `metadata` no sensible | cadena de conexión |

El trigger `reject_secret_like_json` inspecciona las claves del JSONB y rechaza
cualquiera que contenga `password`, `secret`, `token`, `api_key`,
`connection_string`, etc. Un CHECK sobre JSONB no puede hacer eso; un trigger sí,
y es barato.

## 5. Cómo se imputa el costo de cada modelo

| Modelo | `cost_allocations.scope` | Reparto |
|---|---|---|
| SHARED | `DEPLOYMENT_TARGET` | Se divide entre los tenants activos del target. |
| PARTNER_DEDICATED | `DEPLOYMENT_TARGET` | Se divide entre los tenants del partner en ese target. |
| TENANT_DEDICATED | `TENANT` | Imputación directa: es de ese cliente. |

El reparto es una regla **explícita** (`allocation_rule`), no un prorrateo
implícito, y la suma de `weight` por costo no puede exceder 1 (constraint
trigger diferido).
