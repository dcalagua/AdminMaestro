# Informe final · EBIM Control Plane V3.2 Final payment plan hardening

> Rama `dev`, solo trabajo local. HEAD inicial `1985f14`. Gates frescos sobre `92433a6`
> (`QUALITY_GATE_V3_2.md`). El commit posterior solo añade este informe, la documentación y la
> evidencia.

## 1. Veredicto

**GO_QAS**

Un contrato con el mismo plan, moneda e intervalo pero **distinto importe** ya no puede reutilizar el
Plan del proveedor. Lo impiden el lookup exacto de `payment-setup`, la unicidad de la base y el
trigger de inmutabilidad. Tampoco se puede domiciliar hoy un contrato cuyas líneas conocidas
cambien de cadencia o de importe en el futuro (409 antes de hablar con el PSP). Los 8 gates
pasaron en una ejecución fresca desde `db:reset`. Las 36 migraciones previas siguen intactas byte a
byte, no hay cambios remotos y no se empezó EWM.

Aplicar la migración 37 en QAS requiere la autorización del operador, y **no** se ha hecho. Antes de
activar tarjeta en QAS, ver §5.1.

## 2. Causas raíz

**P1-A.** `provider_plans` se identificaba por `(provider_account_id, plan_id, billing_interval,
currency)`, **sin `amount`**: la unicidad (migración 19), el lookup de `payment-setup` y su `upsert`.
El cliente B (USD 1250) recibía el `external_plan_id` del Plan del cliente A (USD 1000), el adapter no
creaba otro y Culqi le cobraba 1000. Después el upsert escribía 1250 sobre la fila de ese Plan, que
en el PSP seguía siendo 1000. Reproducido con la Edge Function real: 7 contratos USD MONTHLY de
importes distintos colgados de un único Plan registrado con 1128.
Detalle: `PROVIDER_PLAN_IDENTITY.md` §1.

**P1-B.** `recurringCardAmount` (V3.1) solo evaluaba las líneas vigentes **hoy**. MONTHLY hoy +
YEARLY dentro de 3 meses, o MONTHLY + addon MONTHLY futuro, se domiciliaban con un Plan fijo que
después cobraría de menos (o de más si una línea terminaba antes). Un test V3.1 fijaba ese
comportamiento como correcto. Detalle: `FUTURE_RECURRING_CONTRACT.md` §1.

## 3. Corrección

- **Migración 37** `20260913001400_v3_2_provider_plan_identity.sql`: unicidad
  `(cuenta, plan, intervalo, moneda, importe)` sobre Planes ACTIVE; trigger que impide reescribir la
  identidad o el `external_plan_id` de una fila; `find_reusable_provider_plan` (coincidencia exacta,
  sin redondeo); `register_provider_plan` (solo servidor, nunca sobrescribe, duplicados
  concurrentes como INACTIVE); checks `amount > 0` y no ONE_TIME. Solo `service_role` puede ejecutar
  las funciones.
- **`payment-setup`**: importe contractual de `subscription_items` en céntimos exactos → identidad →
  lookup exacto → PSP → `upsert_provider_subscription` → `register_provider_plan`. Se eliminó el
  upsert directo sobre `provider_plans`. Los errores de contrato devuelven `error` (código) y
  `message` (texto para el usuario).
- **`recurring-amount.ts`**: evalúa todas las líneas recurrentes conocidas (también futuras).
  Devuelve `CADENCIA_MIXTA_NO_DOMICILIABLE` o `MONTO_RECURRENTE_FUTURO_VARIABLE` (fail-safe, sin
  reprovisioning).
- **`money.ts`**: única conversión importe → unidades mínimas, sin floats ni redondeo silencioso.
  `toCulqiAmount` delega en ella y `toCulqiPlanAmount` valida céntimos y moneda Culqi.
- **Mock**: ids de Plan y Subscription por suscripción local, para que un Plan reutilizado por error
  no sea indistinguible de uno nuevo.
- Corrección de tipos preexistente en `payment-setup` (`body as unknown as Record…`): la función
  pasa ahora `deno check`.

## 4. Definition of Done

| Criterio | Estado | Evidencia |
|---|---|---|
| PROVIDER PLAN SAME AMOUNT REUSE | **PASS** | pgTAP 20 `08`, `09`, `23`, `24` · E2E «mismo importe reutiliza el Plan…» |
| PROVIDER PLAN DIFFERENT AMOUNT ISOLATION | **PASS** | pgTAP 20 `10`–`14` · E2E «…distinto importe crea otro y no reescribe el original» |
| NEGOTIATED PRICE | **PASS** | pgTAP 20 `15`, `16` · E2E «precio negociado» (tarifa USD 850 frente al negociado) |
| PROVIDER ACCOUNT ISOLATION | **PASS** | pgTAP 20 `17`–`19` |
| CURRENCY ISOLATION | **PASS** | pgTAP 20 `20` · E2E USD frente a PEN |
| INTERVAL ISOLATION | **PASS** | pgTAP 20 `21`, `22` · E2E MONTHLY frente a YEARLY |
| FUTURE MIXED CADENCE | **PASS** | unit R (5 casos) · E2E (2 casos) |
| FUTURE VARIABLE RECURRING AMOUNT | **PASS** | unit R (4 rechazos, 3 estables) · E2E addon y sustitución estable |
| ONE_TIME EXCLUSION | **PASS** | unit R · pgTAP 20 `40`, `41` · E2E QUARTERLY/YEARLY con ONE_TIME |
| PAYMENT SECURITY | **PASS** | E2E 401/401/404/403 · pgTAP 20 `42`–`51` · `evidence/security-audit.txt` §1–3, §7 |
| MONTHLY / QUARTERLY / YEARLY / ONE_TIME REGRESSION | **PASS** | pgTAP 18 y 19 · E2E `v3-1-billing-cadence` 5/5 |
| GRUPASA EWM REGRESSION | **PASS** | pgTAP 18 `19`–`19e` · `evidence/security-audit.txt` §6 |
| MULTICURRENCY REGRESSION | **PASS** | pgTAP 06–17 · E2E `v3-regional` 14/14 y `v3-regional-journeys` 5/5 |
| MIGRATION INTEGRITY | **PASS** | `evidence/migration-integrity.txt` (36/36 y 35/35) |
| DB TESTS | **PASS** 537/537 | `evidence/db-test.txt` |
| UNIT | **PASS** 169/169 | `evidence/unit.txt` |
| E2E | **PASS** 74/74 | `evidence/e2e.txt` |
| TYPECHECK / LINT / BUILD / SECRETS | **PASS** | `evidence/{typecheck,lint,build,secrets}.txt` |

Matriz completa: `TEST_MATRIX_V3_2.md`.

## 5. Observaciones y riesgos residuales

1. **Datos existentes en QAS.** Si QAS ya tiene filas en `provider_plans` escritas por el código
   anterior, alguna puede tener un importe distinto del real en Culqi. La migración no puede saberlo.
   Antes de activar la domiciliación, hay que conciliar en solo lectura (`PROVIDER_PLAN_IDENTITY.md` §4).
2. **Cambios del contrato después de domiciliar.** Añadir o editar líneas de una suscripción ya
   domiciliada no reprovisiona el Plan ni se bloquea todavía. Queda fuera de P1-B (el contrato no se
   conocía al domiciliar), pero es el mismo tipo de riesgo. Se recomienda cerrarlo antes de uso
   intensivo de tarjeta (`FUTURE_RECURRING_CONTRACT.md` §4.1).
3. **Seed demo.** `SUB-ALPHA-ESUP` (recurrente 1200) y `SUB-GRUPASA-ESUP` (850) comparten
   `pln_mock_esup850` en `provider_subscriptions` y no tienen fila en `provider_plans`. Son datos de
   demostración anteriores a V3.2 y no se tocaron.
4. P2 heredados de V3.1 sin cambios: F1, F3, F4 (revalidar la elegibilidad de la cuenta al
   domiciliar), F5–F8.
5. `asOf` usa la fecha UTC del servidor, igual que V3.1.
6. `.claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh`, `docs/quality/vscode-problems*` y `logs/`
   ya tenían cambios antes de esta sesión: no se tocaron ni se incluyeron en commits.

## 6. Trazabilidad

| Commit | Contenido |
|---|---|
| `f1b1563` fix(payments) | Migración 37, `payment-setup`, `money.ts`, `provider-plan.ts`, `recurring-amount.ts`, Culqi mapping/adapter, mock, tipos y tests unitarios ajustados |
| `c4731d8` test(payments) | pgTAP 20, `money.test.ts`, E2E `v3-2-payment-setup` |
| `92433a6` docs(payments) | `docs/payments/CULQI_ARCHITECTURE.md`, `docs/finance/BILLING_CADENCE.md` |
| (siguiente) docs(v3.2) | Este informe, baseline, matriz, gate y evidencia |

Sin push, merge, PR, `db push`/`link`, despliegues ni cambios en QAS/PRD. No se desplegaron Edge
Functions remotas ni se tocaron secretos remotos. No hubo llamadas a Culqi (ni TEST ni LIVE). Sin
EWM, sin APIs de provisioning y sin cambios en otros SaaS. Los únicos contenedores tocados son
locales de este proyecto: `supabase_edge_runtime_ebim-control-plane` se reinició para servir el
código nuevo.
