# V3.2 · Matriz de pruebas

Leyenda de ubicación:

- **pgTAP 20**: `supabase/tests/20_v3_2_provider_plan_identity.test.sql`, 51 pruebas (número al
  inicio de cada descripción).
- **unit R**: `supabase/functions/_shared/payments/recurring-amount.test.ts`, 24.
- **unit M**: `supabase/functions/_shared/payments/money.test.ts`, 34.
- **unit C**: `supabase/functions/_shared/payments/culqi-mapping.test.ts`, 23 (+1 nuevo, 1 ajustado).
- **E2E**: `e2e/v3-2-payment-setup.spec.ts`, 9 pruebas contra la Edge Function `payment-setup`
  local (JWT, RLS, `service_role` y base reales; PSP MOCK), verificadas en `provider_plans` y
  `provider_subscriptions`.

La lógica de cadencia e importe futuro vive en la Edge Function (`recurring-amount.ts`, módulo
puro), no en SQL. Por eso los casos 8–13 de la fase 19 se cubren con unit R (lógica) y con el E2E
contra la base real (filas `subscription_items` reales). No se duplicó en SQL para no tener dos
fuentes de verdad.

## Fase 19 · regresiones mínimas

| # | Caso | pgTAP 20 | Unit | E2E |
|---|---|---|---|---|
| 1 | Mismo plan, intervalo, moneda, importe y cuenta → reutilizable | 08, 09, 23, 24 | — | «mismo importe reutiliza…» (a2 y la repetición de a comparten `external_plan_id`; 1 fila) |
| 2 | Mismo todo, distinto importe → NO reutilizable | 10, 11, 12, 13, 14 | M «1000 y 1250…» | «…distinto importe crea otro y no reescribe el original» |
| 3 | Distinta cuenta de proveedor → NO | 17, 18, 19 | — | — (hay una sola cuenta CULQI en el seed) |
| 4 | Distinta moneda → NO | 20 | — | «aislamiento por moneda y por intervalo» |
| 5 | Distinto intervalo → NO | 21, 22 | — | «aislamiento por moneda y por intervalo» |
| 6 | El precio negociado usa el importe de la suscripción | 15, 16 | R «suma solo las líneas…» | «precio negociado» (tarifa pública PE USD 850 frente al negociado, Planes distintos) |
| 7 | Un mapeo no se sobrescribe con otro importe | 25–30 | — | «…no reescribe el original» (A sigue en su importe) |
| 8 | MONTHLY futuro + YEARLY futuro → cadencia mixta | — | R «MONTHLY futuro + YEARLY futuro» | «MONTHLY y YEARLY que empiezan ambos en el futuro» |
| 9 | MONTHLY actual + YEARLY futuro → rechazado | — | R «MONTHLY vigente + YEARLY que empieza en 3 meses», `it.each` ×3 | «MONTHLY vigente + YEARLY futuro» |
| 10 | MONTHLY actual + MONTHLY futuro con total estable → permitido | — | R «sustitución contigua…», «dos cambios que se compensan…», «cambios después del fin…» | «sustitución MONTHLY por otra del mismo importe» |
| 11 | Importe recurrente futuro variable → rechazado | — | R «addon…», «…termina antes que el contrato», «0 a X», «día sin cobertura» | «addon MONTHLY que empieza en 3 meses» |
| 12 | ONE_TIME no cuenta como cadencia | 40, 41 (no es un Plan) | R «ONE_TIME futuro…», «YEARLY puro…» | «QUARTERLY y YEARLY puros: el ONE_TIME no entra en el Plan», «sustitución…» |
| 13 | Línea recurrente vencida ignorada | — | R «YEARLY ya vencida…», «termina justo el día anterior…» | «sustitución…» (SUPPORT_FEE YEARLY vencida) |
| 14 | Aislamiento por cuenta de proveedor | 17, 18, 19 | — | — |
| 15 | Permisos | 42–51 | — | «sin JWT, con un rol sin acceso o con otra cuenta de proveedor» |

Extra pgTAP 20: estructura 01–06 (unicidad eliminada y creada, FKs, RLS, política), duplicados por
concurrencia 31–33, retiro y reemplazo 34–36, validación sin redondeo 37–39.

## Fase 20 · unit

| Módulo | Qué se prueba | Archivo |
|---|---|---|
| `recurring-amount.ts` | Cadencia actual y futura, importe futuro, vencidas, ONE_TIME, `ends_on`, suma exacta en céntimos, rechazo de 3 decimales, mensajes sin detalle del PSP | unit R |
| `money.ts` | Importe → céntimos (número y texto), los 2001 importes de 0.00 a 20.00 sin error binario, rechazos (`12.345`, `0.1+0.2`, NaN, Infinity, exponentes, rango), formato inverso | unit M |
| `provider-plan.ts` | Argumentos exactos de la RPC (`"1000.00"`, `"875.50"`), 1000 ≠ 1250, validaciones de identidad | unit M |
| `culqi-mapping.ts` | `toCulqiAmount` sobre `money.ts`, `toCulqiPlanAmount` (PEN/USD, rechazo de BOB, enteros positivos) | unit C, unit M |

## Fase 21 · Edge Function

| Caso pedido | E2E |
|---|---|
| Mismo precio reutilizado | «mismo importe reutiliza el Plan…» |
| Precio negociado distinto | «precio negociado…», «…distinto importe crea otro…» |
| Cadencia mixta futura | «MONTHLY vigente + YEARLY futuro», «MONTHLY y YEARLY que empiezan ambos en el futuro» |
| Importe futuro variable | «addon MONTHLY que empieza en 3 meses» |
| Invocación no autorizada | sin JWT → 401; JWT inválido → 401; TENANT_ADMIN de otra organización → 404 |
| Cuenta de proveedor equivocada | `provider_account_id` en el cuerpo → 403 `CUENTA_PROVEEDOR_NO_COINCIDE` |

En los rechazos, el E2E comprueba además que no queda `provider_subscriptions` ni `provider_plans`.

## Fases 24–25 · regresión

| Área | Evidencia (ejecución fresca) |
|---|---|
| MONTHLY / QUARTERLY / YEARLY / ONE_TIME (facturación V3.1) | pgTAP 18 y 19 sin cambios, PASS · E2E `v3-1-billing-cadence` 5/5 |
| Cadencias en tarjeta | unit R (MONTHLY, QUARTERLY, YEARLY) · E2E «QUARTERLY y YEARLY puros» |
| GRUPASA EWM | pgTAP 18 `19`–`19e` PASS · `evidence/security-audit.txt` §6 |
| PEN / BOB / USD, precios regionales, FX, comisiones | pgTAP 06–17 PASS · E2E `v3-regional` 14/14 y `v3-regional-journeys` 5/5 |
| Moneda en la tarjeta | E2E PEN y USD · unit C (BOB no llega a Culqi) |

## Evidencia previa al fix

| Archivo | Resultado |
|---|---|
| `evidence/phase1-e2e-payment-setup-before-fix.txt` | 3/7 fallos: B reutiliza el Plan de A; YEARLY futuro → 200; addon futuro → 200 |
| `evidence/phase1-db-state-before-fix.txt` | 7 contratos USD MONTHLY de importes distintos sobre un único Plan con importe 1128 |
| `evidence/phase1-db-constraint-before-fix.txt` | La unicidad impide 1000 y 1250; el upsert reescribe P1 a 1250 |
| `evidence/phase8-unit-recurring-before-fix.txt` | El módulo V3.1 acepta el YEARLY y el addon futuros |
