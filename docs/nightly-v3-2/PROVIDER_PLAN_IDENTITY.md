# V3.2 · Identidad del Plan del proveedor (P1-A)

## 1. Causa raíz (confirmada antes del fix)

El Plan del proveedor se identificaba **sin importe** en tres sitios:

| # | Dónde | Qué hacía |
|---|---|---|
| 1 | `20260907000600_payment_provider_mappings.sql:116` | `provider_plans_uk unique (provider_account_id, plan_id, billing_interval, currency)`. La base no podía guardar el mismo plan a USD 1000 y a USD 1250 en la misma cuenta. |
| 2 | `payment-setup/index.ts:219-226` (HEAD `1985f14`) | Buscaba el Plan reutilizable por esas 4 columnas y pasaba su `external_plan_id` al adapter. `culqi.ts:165` **no crea** Plan cuando lo recibe, así que el cliente B quedaba suscrito al Plan del cliente A y Culqi le cobraba el importe de A. |
| 3 | `payment-setup/index.ts:329-341` | `upsert` con `onConflict` sobre las 4 columnas y `amount` del cliente B. La fila de `P1` pasaba a decir 1250 aunque `P1` siguiera cobrando 1000 en el PSP. |

Evidencia previa al fix:

- `evidence/phase1-e2e-payment-setup-before-fix.txt`: con la Edge Function real, «B no puede colgarse
  del Plan de A · Expected: not "pln_mock_48fe3937"».
- `evidence/phase1-db-state-before-fix.txt`: 7 contratos USD MONTHLY (970.50, 1102, 1450, 1700, 1839,
  2355 y 3495) colgados del mismo `pln_mock_48fe3937`, registrado en `provider_plans` con 1128 (la
  última escritura).
- `evidence/phase1-db-constraint-before-fix.txt`: (A) el segundo importe choca con `provider_plans_uk`;
  (B) el upsert deja `pln_repro_a_1000` con `amount = 1250.00`.

Para que el mock no escondiera el defecto se ajustó primero: antes devolvía el mismo `pln_`/`sxn_`
para dos contratos de la misma organización y plan. Ahora cada suscripción local produce sus
propios ids, como un PSP real que crea un objeto por alta (`mock.ts`).

## 2. Regla

```
identidad = provider_account_id + plan_id + billing_interval + currency + amount

Professional / MONTHLY / USD / 1000  !=  Professional / MONTHLY / USD / 1250
SAME ECONOMIC PLAN   => SAME PROVIDER PLAN
DIFFERENT AMOUNT     => DIFFERENT PROVIDER PLAN
```

- `amount` es `numeric(14,2)`, el mismo tipo que `subscription_items.amount`, y se compara exacto.
  En TypeScript se trabaja en céntimos enteros (`money.ts`) y hacia la base viaja como texto
  decimal (`"1250.00"`). No hay floats.
- El importe es el **contractual**: la suma de las líneas recurrentes de `subscription_items`. No
  sale de `plan_prices`. Un precio negociado tiene su propio Plan.
- La cuenta de comercio forma parte de la identidad: el mismo contrato económico en la cuenta de
  EBIM y en la de un partner son dos Planes.
- Compartir Planes entre suscripciones **es** el diseño existente (el mapeo está a nivel de
  `plans`, migración 19: «dos tarifas históricas del mismo plan con el mismo importe son el mismo
  Plan externo»). V3.2 lo conserva para contratos económicamente idénticos. Solo corrige que se
  compartiera entre importes distintos.

## 3. Implementación

### Migración 37 · `20260913001400_v3_2_provider_plan_identity.sql`

| Objeto | Detalle |
|---|---|
| `provider_plans_uk` | Eliminada (4 columnas, sin importe). |
| `provider_plans_identity_uk` | Índice único `(provider_account_id, plan_id, billing_interval, currency, amount) WHERE status = 'ACTIVE'`. Toda fila válida con la regla anterior lo es con esta. Un Plan retirado (INACTIVE) no bloquea su reemplazo. También sirve al lookup. |
| `provider_plans_recurring_ck`, `provider_plans_amount_positive_ck` | `billing_interval <> 'ONE_TIME'` y `amount > 0`. `NOT VALID`: se aplican a filas nuevas o modificadas sin fallar por datos históricos de otro entorno. |
| `guard_provider_plan_identity()` + trigger `provider_plans_guard_identity` | `BEFORE UPDATE`. Rechaza (23514 `PROVIDER_PLAN_INMUTABLE`) cambios de cuenta, plan, `external_plan_id`, importe, moneda o intervalo, **también para `service_role`**. Solo pueden cambiar `status`, `metadata` y `synced_at`. |
| `find_reusable_provider_plan(account, plan, interval, currency, amount)` | INVOKER, `STABLE`, `search_path = platform, pg_catalog`. Devuelve el `external_plan_id` ACTIVE con coincidencia exacta o NULL. Si el importe no es positivo o tiene más de 2 decimales, lanza 22023 en vez de redondear. EXECUTE solo `service_role`. |
| `register_provider_plan(account, plan, interval, currency, amount, external_plan_id, metadata)` | DEFINER, `search_path = platform, pg_catalog`, exige `is_service_context()`. Advisory lock por contrato económico. (a) Si el `external_plan_id` ya existe con **otra** identidad, lanza 23514 `PROVIDER_PLAN_IDENTIDAD_DISTINTA`; con la misma, `reused`. (b) Si es nuevo y ya hay un canónico ACTIVE (dos altas simultáneas), lo registra INACTIVE con `duplicate_of`, sin pisar el canónico. (c) Si no, lo inserta ACTIVE. Audita `PROVIDER_PLAN_REGISTERED`. EXECUTE solo `service_role`. |

RLS, política de lectura, FKs e índices de FK no cambian (`evidence/security-audit.txt` §3).

### `payment-setup`

1. `recurringCardAmount` calcula el importe contractual en céntimos (y aplica la regla de P1-B).
2. `providerPlanIdentity` + `providerPlanRpcArgs` (`_shared/payments/provider-plan.ts`) construyen la
   identidad.
3. `find_reusable_provider_plan` → `externalPlanId` solo si coincide el importe.
4. El adapter crea el Plan con `amountMinor`, o reutiliza el encontrado.
5. `upsert_provider_subscription` (sin cambios) y después `register_provider_plan`. Si el registro
   detecta una inconsistencia, la respuesta es 500 `PROVIDER_PLAN_INCONSISTENTE`. La suscripción
   del PSP ya existe y queda enlazada, fiel a la realidad.

Se eliminó el `upsert` directo sobre `provider_plans`.

### Importes (fase 7)

- `money.ts` es la única conversión importe → unidades mínimas: parseo decimal exacto, suma en
  enteros y rechazo `IMPORTE_NO_REPRESENTABLE` de cualquier importe con más de 2 decimales
  significativos o fuera de rango. `USD 1250.00` → `125000`. PEN, BOB y USD tienen 2 decimales.
- `toCulqiAmount` delega en `toMinorUnits`. El test V2.1 que aceptaba `0.1 + 0.2 → 30` ahora espera un
  rechazo: redondear ese valor escondía aritmética flotante aguas arriba, y las sumas ya son en
  céntimos.
- `toCulqiPlanAmount(amountMinor, currency)` valida el entero y que la moneda sea una de las que
  cobra Culqi Perú (PEN, USD). BOB nunca llega a Culqi: el routing V3 no lo permite, y si llegara
  se rechazaría con `IMPORTE_PLAN_INVALIDO`.

## 4. Datos existentes en otros entornos

La migración no puede saber qué importe tiene un Plan en Culqi. Antes de activar la domiciliación
en QAS conviene hacer una conciliación **de solo lectura**:

1. Por cada fila ACTIVE de `provider_plans`: `GET /recurrent/plans/{external_plan_id}` y comparar
   `amount`, `currency` e intervalo.
2. Por cada `provider_subscriptions` ACTIVE: comparar el importe de su Plan con el importe
   recurrente del contrato.

Una fila con deriva no se puede corregir con UPDATE: el trigger lo impide. Hace falta una operación
de datos revisada por finanzas: borrar la fila errónea como servidor y volver a registrar ese
`external_plan_id` con `register_provider_plan` y el importe **real** del PSP.
