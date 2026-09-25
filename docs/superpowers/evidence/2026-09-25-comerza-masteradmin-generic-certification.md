# Comerza · Certificación GENERIC v1 contra MasterAdmin QAS

- **Fecha:** 2026-09-25
- **Resultado:** `COMERZA_MASTERADMIN_QAS_CERTIFIED`
- **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` · **Comerza QAS/DEV:** `rsdyqwdqvezebpopcggj`
- **Git:** `dev` `2c49725` → PR `dcalagua/comerza#5` mergeado → `qas` `b7c11f7`

## 1. Qué se certificó

Que MasterAdmin da de alta un tenant en Comerza hablando **su contrato único**, sin que MasterAdmin cambie nada por este producto y sin inventar negocio.

La brecha era de contrato: la función desplegada aceptaba sólo el cuerpo propio de Comerza. Ahora traduce el cuerpo GENERIC antes de validar, derivando con UUIDv5 los dos ids que Comerza exige y que el contrato no transporta.

## 2. Configuración en MasterAdmin

| Pieza | Valor |
|---|---|
| Producto | `comerza` (alta nueva en el catálogo) |
| Integración | `comerza-provisioning-v1` · HTTP_M2M · adapter **GENERIC** · READY · habilitada |
| Contrato | `iss masteradmin.ebim` · `aud comerza.ebim` · `sub masteradmin-provisioning` · ES256 · TTL 120 |
| Scopes | `comerza:tenant:create` / `comerza:tenant:read` |
| Rutas | `/tenants` · `/tenants/{controlPlaneTenantId}` · `/health` |
| Credencial | `comerza-qas-m2m` · `secret_ref COMERZA_QAS_M2M_PRIVATE_KEY` · habilitada |
| Destino | `comerza-shared-qas` · `https://rsdyqwdqvezebpopcggj.supabase.co/functions/v1/platform-provisioning` · READY · habilitado |
| `allowed_hosts` | `rsdyqwdqvezebpopcggj.supabase.co` |

**CHECK_HEALTH:** `HEALTHY`.

## 3. El alta

| Dato | Valor |
|---|---|
| Tenant smoke | `ebim-comerza-qas-smoke-1790308950` · «EBIM Comerza QAS Smoke» |
| Organización / sociedad | `ebim-comerza-qas-smoke` · PE · PEN · RUC sintético `20500009001` |
| Admin | `comerza.masteradmin.smoke+1790308950@ebim.test` (sintético) |
| `controlPlaneTenantId` | `9f61ab7a-5c86-4bd6-8696-14c77ce085ba` |
| Solicitud | `8d734363-80ad-4051-a469-d6f328b17117` |
| Clave de idempotencia | `ma-prov-v1-c6e7f5ee…d495bcec` |
| Correlación | `1083d9b7-cba4-4691-a440-665054c72040` |
| Intentos | **1** |

| Paso | Resultado |
|---|---|
| **CREATE** (desde MasterAdmin) | solicitud **ACTIVE**, mapping **ACTIVE** `0b22e8f4-…` |
| **REPLAY** (directo, misma clave y mismo cuerpo) | **200** con `replayed: true` |
| **GET** (directo, scope de lectura) | **200**, estado `ACTIVE` |

Identificadores externos, idénticos en las tres respuestas y en el mapping:

| Campo | Valor |
|---|---|
| `externalTenantId` | `2b61d258-2487-50cb-a046-d42a4938f6f1` |
| `externalOrganizationId` | `f49fecc5-6f35-5991-b3d0-755814f99382` |
| `externalCompanyId` | `2b61d258-2487-50cb-a046-d42a4938f6f1` |

Los dos primeros son UUIDv5 derivados del `controlPlaneTenantId`: por eso el reintento produce el mismo cuerpo y la misma huella.

`resources` devueltos y guardados: `storeId`, `registers: 2`, `documentSeries: 10`, `sectorCode: retail`, `countryCode: PE`, `currency: PEN`.

## 4. Lo que se comprobó además

| Comprobación | Resultado |
|---|---|
| Sin duplicados | Un solo mapping para (tenant, producto); el replay no creó nada |
| Admin | **PREPROVISIONED** en las tres respuestas |
| Cuenta de Auth | ninguna: el contrato no la crea |
| Valores canónicos, no inventados | `sectorCode = retail` y local `Principal`, que ya existían en el producto |
| Facturación | el tenant nace `PENDING`, sin suscripción y con MRR 0: no hay factura ni cobro |
| Secretos | en la base sólo el NOMBRE del secreto; ninguna clave ni token impresos |

## 5. Alcance

- **PRD_CHANGED:** NO
- **SECRETS_EXPOSED:** NO
- Un único tenant smoke, con datos sintéticos `@ebim.test`.
- Los tenants certificados de EWM, eSupplier y TMS no se tocaron.
