# eCommerce · Certificación GENERIC v1 contra MasterAdmin QAS

- **Fecha:** 2026-09-25 · **Resultado:** `ECOMMERCE_MASTERADMIN_QAS_CERTIFIED`
- **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` · **eCommerce DEV/QAS:** `ehxlxbhtlmfgneiagdcj`
- **Git:** `dev` `6b8570a` → PR `dcalagua/eCommerce#11` mergeado → `qas` `fcc3567`

## 1. El tenant es la organización, no la tienda

`public.tenants` tiene como clave primaria el `organization_id` del hub, y una organización tiene N sociedades y N tiendas. El alta crea **organización + sociedad + propietario preaprovisionado** y **no** crea tienda: la tienda es un artefacto posterior que crea el propietario.

El alta de este smoke lo confirma: una sola organización y ninguna tienda.

## 2. Resultado

| Paso | Resultado |
|---|---|
| CHECK_HEALTH | HEALTHY |
| CREATE | solicitud **ACTIVE**, mapping **ACTIVE** `623f76df-…`, 1 intento |
| REPLAY directo | **200 `replayed: true`** |
| GET directo | **200 ACTIVE** |

| Dato | Valor |
|---|---|
| Solicitud | `dd3ad25f-3666-4162-9343-c1dc2cb1ee41` |
| Tenant | `ebim-ecommerce-qas-smoke-1790310172` |
| `externalTenantId` / `externalOrganizationId` | `af82a355-a195-5d2a-81b0-0f4bacf06185` |
| `externalCompanyId` | `8a1f10be-74eb-5951-9a73-f4ec79a965d7` |
| Admin | PREPROVISIONED · sin `auth.users` |

Los identificadores son UUIDv5 derivados del `controlPlaneTenantId`, así que el reintento produce el mismo cuerpo y la misma huella.

`resources` incluye `backofficePath`, que hasta hoy hacía fracasar la escritura del mapeo por un falso positivo del guardia de secretos de MasterAdmin. Por eso el alta de eCommerce se dejó deliberadamente sin lanzar hasta aplicar el arreglo: lanzarla antes habría dejado una organización huérfana del otro lado.

## 3. Comprobaciones

Un mapping único, sin duplicados, tenant `PENDING` sin suscripción ni MRR, y sólo el nombre del secreto en la base.

**PRD_CHANGED:** NO · **SECRETS_EXPOSED:** NO
