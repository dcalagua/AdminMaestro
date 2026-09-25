# GMAO · Certificación GENERIC v1 contra MasterAdmin QAS

- **Fecha:** 2026-09-25 · **Resultado:** `GMAO_MASTERADMIN_QAS_CERTIFIED`
- **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` · **GMAO QAS:** `xikbhkfeaosasdltartg`
- **Git:** `dev` `90e501f` → PR `dcalagua/GMAO#1` mergeado → `qas` `72bdec6`

## 1. Entorno

`xikbhkfeaosasdltartg` es QAS por decisión del dueño del entorno. El smoke usa datos sintéticos `@ebim.test`, identificables y desechables.

## 2. La deriva que había que reconciliar

El proyecto ya tenía desplegada una v1 de provisioning cuyos objetos no estaban en el historial de migraciones. Se reconcilió en tres pasos, aplicados de uno en uno y con verificación antes de anotar la versión:

| Migración | Qué hace |
|---|---|
| `20260925001118` | captura en el historial lo que ya vivía en el proyecto |
| `20260925001454` | **reemplaza** la RPC de alta por el contrato GENERIC con admin PREPROVISIONED: sin ella, el alta no habría seguido el contrato |
| `20260925002308` | cierra un agujero: `provision_or_attach_tenant` era SECURITY DEFINER, sin autorización interna y ejecutable por `authenticated`, lo que permitía insertarse como dueño de un tenant ajeno |

El guardia de esa tercera migración es la propia comprobación del script del operador: la versión sólo se anota si `has_function_privilege('authenticated', …)` ya es falso. **No se volvió a probar con una llamada viva**, a propósito: comprobar un fallo de autorización ejecutándolo contra un proyecto con datos reales no es una prueba, es un riesgo.

## 3. Resultado

| Paso | Resultado |
|---|---|
| CHECK_HEALTH | HEALTHY |
| CREATE | solicitud **ACTIVE**, mapping **ACTIVE** `2f91a3cb-…`, 1 intento |
| REPLAY directo | **200 `replayed: true`** |
| GET directo | **200 ACTIVE** |

| Dato | Valor |
|---|---|
| Solicitud | `3e2d8838-a65f-4044-b731-e52b9dab6f62` |
| Tenant | `ebim-gmao-qas-smoke-1790310201` |
| `externalTenantId` | `69fe04ba-484e-4533-9e41-28291fa0a473` |
| `resources` | `tenantSlug`, `adminStatus: PREPROVISIONED`, `tenantStatus: active` |

GMAO no modela organización ni sociedad separadas del tenant, así que `externalOrganizationId` y `externalCompanyId` llegan nulos. El contrato sólo exige `externalTenantId`, y es el que se guarda y se vuelve a ver en el GET.

## 4. Comprobaciones

Un mapping único, sin duplicados, admin PREPROVISIONED sin `auth.users`, tenant `PENDING` sin suscripción ni MRR, y sólo el nombre del secreto en la base.

**PRD_CHANGED:** NO · **SECRETS_EXPOSED:** NO
