# eChange · Certificación GENERIC v1 contra MasterAdmin QAS

- **Fecha:** 2026-09-25 · **Resultado:** `ECHANGE_MASTERADMIN_QAS_CERTIFIED`
- **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` · **eChange QAS:** `zoveazvwvyayugladuvl`
- **Git:** `dev` `3d6f34e` → PR `dcalagua/eChange#7` mergeado → `qas` `77e42c2`

## 1. Un alta, dos intentos, un solo tenant

El primer intento **creó el tenant en eChange** y falló de este lado al escribir el mapeo: el guardia de secretos de MasterAdmin leía `resources.portalPath` como si contuviera un PAT. No fue un defecto de eChange.

La recuperación **no creó nada nuevo**. Se reintentó la MISMA solicitud, con la misma clave de idempotencia y la misma correlación (verificado antes de reintentar), y eChange respondió con el mismo alta.

| Dato | Valor |
|---|---|
| Solicitud | `de260cdf-42ff-4b8a-b075-4e2433bc3e22` |
| `controlPlaneTenantId` | `2ea979b5-5702-4430-8389-b105e436d20a` |
| Tenant | `ebim-echange-qas-smoke-1790308481` |
| Admin | `echange.masteradmin.smoke+1790308481@ebim.test` (sintético) |
| Intentos | 2 · el primero murió en el guardia de MasterAdmin, no en eChange |

## 2. Resultado

| Paso | Resultado |
|---|---|
| CHECK_HEALTH | HEALTHY |
| CREATE (reintento con la misma identidad) | solicitud **ACTIVE**, mapping **ACTIVE** `7e6b04a6-…` |
| REPLAY directo | **200 `replayed: true`** |
| GET directo | **200 ACTIVE** |

| Campo | Valor |
|---|---|
| `externalTenantId` | `1f73bc9d-3dc2-5a55-b3a3-9b4be1870e5e` |
| `externalOrganizationId` | `1f73bc9d-3dc2-5a55-b3a3-9b4be1870e5e` |
| `externalCompanyId` | `ed3e5710-69f2-53c7-9046-8866c11b1326` |

Idénticos en el alta, en el replay, en el GET y en el mapping.

`resources`: `portalPath`, `tenantSlug`, `adminProvisioningStatus: PREPROVISIONED`, `adminInvitationExpiresAt: 2026-10-09T03:54:44Z`. Esa fecha de invitación es del alta original: confirma que el replay devolvió el mismo registro y no uno nuevo.

## 3. Comprobaciones

| Comprobación | Resultado |
|---|---|
| Tenants en el proveedor | **uno**; el replay no creó otro |
| Mappings | **uno** para (tenant, producto) |
| Admin | PREPROVISIONED · invitación pendiente, sin `auth.users` ni contraseña |
| Facturación | tenant `PENDING`, sin suscripción, MRR 0: sin factura ni cobro |
| Secretos | sólo el NOMBRE del secreto en la base |

**PRD_CHANGED:** NO · **SECRETS_EXPOSED:** NO
