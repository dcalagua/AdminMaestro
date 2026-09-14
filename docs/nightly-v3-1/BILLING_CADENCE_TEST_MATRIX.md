# Billing cadence · matriz de pruebas V3.1

Leyenda de archivos:
- **T18**: `supabase/tests/18_v3_1_billing_cadence.test.sql` (64 pruebas; usa solo la RPC pública).
- **T19**: `supabase/tests/19_v3_1_billing_cadence_engine.test.sql` (42 pruebas).
- **UB**: `src/lib/billing.test.ts` (6).
- **UP**: `src/features/billing/PeriodInvoiceAction.test.tsx` (13).
- **UR**: `supabase/functions/_shared/payments/recurring-amount.test.ts` (5).
- **E2E**: `e2e/v3-1-billing-cadence.spec.ts` (5).

El prefijo numérico de cada prueba pgTAP coincide con la lista mínima de la fase 15.
«Antes del fix» indica si la prueba falló contra la migración 34
(`evidence/phase1-test18-before-fix.txt`, `evidence/phase17-e2e-against-old-function.txt`).

## 1. Lista mínima (fase 15)

| # | Caso | Prueba(s) | Antes del fix |
|---|---|---|---|
| 01 | monthly current period due | T18 `01` · T19 helper MONTHLY · E2E MONTHLY | pasa |
| 02 | monthly next period due | T18 `02`, `02b` · E2E MONTHLY | pasa |
| 03 | quarterly anchor period due | T18 `03` · T19 matriz QUARTERLY · E2E QUARTERLY | pasa |
| 04 | quarterly month +1 not due | T18 `04` · T19 · E2E QUARTERLY | **FALLA** |
| 05 | quarterly month +2 not due | T18 `05` · T19 · E2E QUARTERLY | **FALLA** |
| 06 | quarterly month +3 due | T18 `06` (+ `06b`/`06c` +4/+5 NOT DUE **FALLAN**, `06d` +6 DUE, `06e` total 3 facturas **FALLA**) · E2E | pasa |
| 07 | yearly anchor period due | T18 `07` · T19 · E2E YEARLY | pasa |
| 08 | yearly month +1 not due | T18 `08` · T19 · E2E YEARLY | **FALLA** |
| 09 | yearly month +6 not due | T18 `09` (+ `09b` +11) · T19 (los 11 meses intermedios) · E2E YEARLY (+1, +6, +11) | **FALLA** |
| 10 | yearly month +12 due | T18 `10` · T19 · E2E YEARLY | pasa |
| 11 | one_time first due | T18 `11` · T19 helper ONE_TIME | pasa |
| 12 | one_time second not due | T18 `12`, `12b` (una sola línea de implementación en la vida del contrato) · T19 | pasa |
| 13 | mixed items | T18 `13`–`13g` · T19 `due_items` · E2E MIXED | **FALLA** (`13c`, `13d`: febrero facturaba USD 1,300 en vez de 100) |
| 14 | no due items creates no invoice | T18 `14`, `14b` · E2E (se consulta la base tras cada período sin cargos) | **FALLA** |
| 14c | sin factura en 0 (cargos que suman 0) | T18 `14c`, `14d` | **FALLA** |
| 15 | same period retry does not duplicate | T18 `15` MONTHLY, `15b`, `15c` QUARTERLY, `15d` YEARLY, `15e` ONE_TIME · E2E IDEMPOTENCIA · UP reintento | pasa |
| 16 | valid_from respected | T18 `16`, `16b` (activación a mitad de mes, ancla posterior al inicio del período) · T19 | pasa |
| 17 | valid_to respected | T18 `17` (fin dentro del período DUE), `17b` (después NOT DUE) · T19 | pasa |
| 18 | January 31 monthly works in February | T18 `18`, `18b`, `18c` · T19 (31/01 MONTHLY y QUARTERLY; 29/02 YEARLY) | pasa |
| 19 | GRUPASA EWM annual regression | T18 `19` (fixture real del seed), `19b` inicial USD 36,000, `19c` +1 NOT DUE **FALLA**, `19d`, `19e` +12 USD 24,000 · equivalente independiente `SUB-QA-CAD-YR-USD` en T18 `07`–`12` · T19 | **FALLA** |
| 20 | PEN preserved | T18 `20`, `20b` (PEN MONTHLY → factura y líneas PEN) · E2E MONTHLY | pasa |
| 21 | BOB preserved | T18 `21` (BOB QUARTERLY) · E2E QUARTERLY | pasa |
| 22 | USD preserved | T18 `22` (USD YEARLY) · E2E YEARLY/MIXED | pasa |
| 23 | unauthorized role cannot issue invoice | T18 `23` PARTNER_ADMIN, `23b` TENANT_ADMIN, `23c` PRODUCT_ADMIN, `23d` comercial, `23e` sin factura residual, `23f` anon sin EXECUTE | pasa |
| 24 | EBIM_FINANCE can issue when authorized | T18 `24` (y todas las emisiones de T18) | pasa |
| 25 | EBIM_SUPER_ADMIN can issue | T18 `25` · T19 estado | pasa |

## 2. Cobertura añadida durante la implementación

| Caso | Prueba(s) | Antes del fix |
|---|---|---|
| VOID: re-emitir un período anulado no choca con el número | T18 `10b` | **FALLA** (23505) |
| VOID: la re-emisión vuelve a incluir el ONE_TIME; la anulada se conserva; número distinto | T18 `10c`, `10d`, `10e` | **FALLA** |
| El período funciona con cualquier día del mes | T18 `15` (día 15) · T19 | — |
| YEARLY: aniversario anterior al ancla nunca toca | T19 | — |
| QUARTERLY: aniversario después de `valid_to` no toca | T19 | — |
| Entradas nulas nunca son DUE | T19 | — |
| ONE_TIME pendiente se arrastra al siguiente período emitido | T19 `due_items` · helper | — |
| Helper IMMUTABLE e INVOKER; `due_items` y estado STABLE e INVOKER con `search_path` fijo | T19 seguridad | — |
| `issue_subscription_invoice` sigue DEFINER + `search_path` + EXECUTE solo `authenticated` | T18 `23g` · T19 | — |
| Ni la emisión ni el motor usan FX ni moneda de reporte | T19 multimoneda (2) | — |
| Estado: cargos, total, próxima facturación (YEARLY, QUARTERLY, línea terminada, tras emitir, aniversario) | T19 status (7) | — |
| Estado coincide con la emisión | T19 (`can_issue=false` y la RPC lanza `SIN_LINEAS_FACTURABLES`) | — |
| Estado por RLS: admin del propio cliente sí; TENANT_ADMIN y PARTNER_ADMIN ajenos no; super admin sí | T19 (4) | — |
| E2E: un período sin cargos también se rechaza al llamar a la RPC directamente (no solo con el botón deshabilitado) | E2E YEARLY/QUARTERLY | **FALLA** |
| Tarjeta: no se domicilian cadencias mixtas ni líneas vencidas | UR (5) | lógica previa domiciliaba USD 1,300/mes en el caso mixto (`evidence/phase19-f2-before-fix.txt`) |

## 3. Frontend (fase 16)

| Requisito | Prueba |
|---|---|
| Nuevo copy «Emitir factura del período (MON)», sin «del mes» | UP copy · UB `issueResultTitle` |
| Acción de facturación: RPC con suscripción + período elegido | UP éxito · UP consulta del período elegido |
| No-due: mensaje y botón deshabilitado | UP sin cargos · UB `issueErrorMessage` |
| Errores de la RPC (`SIN_LINEAS_FACTURABLES`, `NO_AUTORIZADO`) | UP (2) · UB |
| Factura emitida (número y total) | UP éxito |
| Cargando (estado y emitiendo) | UP cargando · UP emitiendo |
| Sin factura / factura existente / sin próxima facturación | UP (3) |
| Error al consultar el estado | UP |
| Presentación sin cadence | UB (el módulo no exporta lógica de cadence) |
