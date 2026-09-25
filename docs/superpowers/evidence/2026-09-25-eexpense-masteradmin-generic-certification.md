# eExpense · Certificación GENERIC v1 contra MasterAdmin QAS

- **Fecha:** 2026-09-25 · **Resultado:** `EEXPENSE_MASTERADMIN_QAS_CERTIFIED`
- **MasterAdmin QAS:** `jivgwrczgdpsuvqcwqku` · **eExpense DEV/QAS:** `uvjmdphlnpyhtohobvzx`
- **Git:** `dev` `f282dc4` → PR `dcalagua/eExpenses#3` mergeado → `qas` `1c0abba`

## 1. Antes: la base no tenía las RPC

Con la función desplegada pero sin migración, un GET firmado de un tenant inexistente devolvía **500 `PROVISIONING_FAILED`**: la RPC `platform_get_provisioning` no existía y el `catch` del handler lo traducía a error de servidor.

Aplicada `20260924190000`, el mismo GET devuelve **404 `PROVISIONING_NOT_FOUND`**, que es la respuesta del contrato.

## 2. Resultado

| Paso | Resultado |
|---|---|
| CHECK_HEALTH | HEALTHY |
| CREATE | solicitud **ACTIVE**, mapping **ACTIVE** `1c39f122-…`, 1 intento |
| REPLAY directo (misma clave y cuerpo) | **200 `replayed: true`** |
| GET directo | **200 ACTIVE** |

| Dato | Valor |
|---|---|
| Solicitud | `a6c9c04a-d2f9-4bb9-b698-9afdfb8917ec` |
| `controlPlaneTenantId` | tenant `ebim-eexpense-qas-smoke-1790310145` |
| Clave de idempotencia | `ma-prov-v1-59cc8fbe…fd66e55d` |
| `externalTenantId` / `externalOrganizationId` | `61071317-0859-5f7e-8145-2f7a482b2c44` |
| `externalCompanyId` | `abdda2e2-ce03-558e-8043-43eb93150991` |
| Admin | PREPROVISIONED · sin `auth.users` |

## 3. Hallazgo de seguridad ABIERTO, fuera de esta ruta

El alta por M2M **no** crea cuentas ni toca contraseñas: nace PREPROVISIONED.

Pero el arreglo de `enroll-client` —la ruta que permitía restablecer la contraseña de un correo existente y reasignarlo de tenant— está en `dev` y en `qas` y **no está desplegado**: la función en QAS sigue en la versión del **2026-06-29** (v18), mientras `platform-provisioning` es del 2026-09-24 (v3).

Hasta que se despliegue, el secuestro de cuenta sigue siendo posible por esa otra puerta:

```
supabase functions deploy enroll-client --project-ref uvjmdphlnpyhtohobvzx
```

**PRD_CHANGED:** NO · **SECRETS_EXPOSED:** NO
