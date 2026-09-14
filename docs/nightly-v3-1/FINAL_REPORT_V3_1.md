# Informe final · EBIM Control Plane V3.1 Final Hardening (billing cadence)

> Rama `dev`, solo trabajo local. HEAD inicial `133f118`. Gates frescos sobre `3394945`
> (`QUALITY_GATE_V3_1.md`). Los commits posteriores solo añaden documentación y evidencia.

## 1. Veredicto

**GO_QAS**

YEARLY y QUARTERLY se probaron de forma explícita en pgTAP (helper, RPC y estado) y en E2E
verificado contra la base. Los 8 gates pasaron en una ejecución fresca desde `db:reset`. Las 35
migraciones previas siguen intactas byte a byte, no hay cambios remotos y no se empezó EWM. Aplicar
la migración en QAS sigue requiriendo la autorización del operador, y **no** se ha hecho.

## 2. Causa raíz

`platform.issue_subscription_invoice` (migración 34) solo usaba `billing_interval` para separar
ONE_TIME: **toda** línea recurrente vigente entraba en la factura de **cualquier** mes. Reproducido
sobre el contrato real `SUB-GRUPASA-EWM`: marzo USD 36,000, **abril USD 24,000** y **septiembre USD
24,000** (la licencia anual se refacturaba). Detalle en `BILLING_CADENCE_DESIGN.md` §1.

Defecto adicional: re-emitir un período cuya factura estaba VOID fallaba por
`invoices_number_uk` (23505).

## 3. Corrección

Migración nueva `20260913001300_v3_1_billing_cadence.sql` (nº 36):

- `is_subscription_item_due_for_period(...)`: helper puro e IMMUTABLE. Cuenta meses de calendario
  desde el ancla `subscription_items.valid_from`: MONTHLY cada 1, QUARTERLY cada 3, YEARLY cada
  12, ONE_TIME una vez. Respeta `valid_from` y `valid_to`.
- `subscription_due_items(sub, period)`: fuente única de las líneas debidas (INVOKER, STABLE).
- `issue_subscription_invoice`: misma firma, seguridad y errores. Ahora factura solo las líneas
  debidas y valida **antes** de insertar: sin cargos → `SIN_LINEAS_FACTURABLES`, cargos en 0 →
  `SIN_IMPORTE_FACTURABLE`. Añade advisory lock por (suscripción, período) y sufijo `-R2` al
  re-emitir tras VOID.
- `get_subscription_billing_status(sub, period)`: estado de solo lectura para la UI (cargos, total
  estimado, factura vigente, `can_issue`, próxima facturación).

UI: «Emitir factura del período (MON)» con selector de período. Muestra el estado del servidor,
«No existen cargos facturables en este período.» y «Próxima facturación: DD/MM/YYYY». La tabla
añade la columna Período. React no calcula ninguna cadence.

Hallazgo de la revisión final (F2), corregido: `payment-setup` domiciliaba cadencias mixtas y
líneas vencidas en un solo plan de tarjeta. Ahora usa `recurringCardAmount`, módulo puro con tests.

## 4. Definition of Done

| Criterio | Estado | Evidencia |
|---|---|---|
| MONTHLY | **PASS** | pgTAP 18 `01`, `02`, `02b`, `15` · pgTAP 19 · E2E MONTHLY |
| QUARTERLY | **PASS** | pgTAP 18 `03`–`06e`, `15c` · pgTAP 19 matriz · E2E QUARTERLY |
| YEARLY | **PASS** | pgTAP 18 `07`–`10`, `09b`, `15d` · pgTAP 19 (11 meses intermedios) · E2E YEARLY (+1, +6, +11, +12) |
| ONE_TIME | **PASS** | pgTAP 18 `11`, `12`, `12b`, `15e` · pgTAP 19 |
| MIXED ITEMS | **PASS** | pgTAP 18 `13`–`13g` · E2E MIXED |
| NO EMPTY INVOICE | **PASS** | pgTAP 18 `14`, `14b`, `14c`, `14d` · E2E (RPC directa + consulta a la base) |
| IDEMPOTENCY | **PASS** | pgTAP 18 `15`–`15e` (las 4 cadencias) · E2E IDEMPOTENCIA · advisory lock |
| VALID_FROM | **PASS** | pgTAP 18 `16`, `16b` · pgTAP 19 |
| VALID_TO | **PASS** | pgTAP 18 `17`, `17b` · pgTAP 19 |
| JAN 31 EDGE CASE | **PASS** | pgTAP 18 `18`–`18c` · pgTAP 19 (31/01 MONTHLY/QUARTERLY, 29/02 YEARLY) |
| GRUPASA EWM REGRESSION | **PASS** | pgTAP 18 `19`–`19e` (seed real) + fixture independiente |
| PEN / BOB / USD REGRESSION | **PASS** | pgTAP 18 `20`, `20b`, `21`, `22` · E2E (moneda de factura y líneas en la base) |
| SECURITY | **PASS** | pgTAP 18 `23`–`25`, `23b`–`23g` · pgTAP 19 seguridad · `evidence/security-audit.txt` |
| MIGRATION INTEGRITY | **PASS** | `evidence/migration-integrity.txt` (35/35 + 23/23) |
| PGTAP | **PASS** 486/486 | `evidence/db-test.txt` |
| UNIT | **PASS** 115/115 | `evidence/unit.txt` |
| E2E | **PASS** 65/65 | `evidence/e2e.txt` |
| TYPECHECK / LINT / BUILD / SECRETS | **PASS** | `evidence/{typecheck,lint,build,secrets}.txt` |

VOID: la re-emisión funciona, se conserva la anulada y el ONE_TIME vuelve a incluirse (pgTAP 18
`10b`–`10e`). No existe estado `CANCELLED` de factura. `UNCOLLECTIBLE` cuenta como facturada.

## 5. Revisión acotada V3 (fase 19)

Sin P0/P1 en el código multicurrency. Se comprobó:

- RLS forzada en las 54 tablas y `security_invoker` en las 22 vistas;
- ninguna función de `platform` ejecutable por anon y todo DEFINER con `search_path`;
- FX solo en lecturas de reporting;
- toda `sum(` agrupada o filtrada por moneda;
- sin defaults de moneda ni país;
- `v_currency_integrity_issues` = 0.

P1 relacionado con cadence fuera del código V3: **F2** (`payment-setup`), corregido con test.
Pendientes P2, documentados para después:

| id | Observación | Sugerencia |
|---|---|---|
| F1 | `culqi.ts:433/460`: si falta `currency_code` se usa la moneda de la cuenta. `register_provider_payment` sigue rechazando una moneda distinta | Tratar el cargo como no verificado |
| F3 | `enforce_company_market` sin mercado no valida moneda activa en escrituras directas a `companies` | Exigir `is_currency_active` en esa rama |
| F4 | `payment-setup` no revalida la elegibilidad de la cuenta al cobrar | Llamar a `provider_account_candidates` antes de domiciliar |
| F5 | `v_finance_facts`: el MRR usa siempre `CURRENT_DATE`; `p_as_of` solo cambia la fecha FX | Documentar o calcular a `p_as_of` |
| F6 | `isCurrencyAllowed` (TS) y `market_id_by_code` (SQL) no se usan fuera de los tests | Retirar o mantener por los tests |
| F7 | `ExchangeRatesPanel`: el probador de conversión arranca con PEN→USD (solo lectura) | Moneda de reporte por defecto |
| F8 | `SubscriptionDetailPage`: la tarjeta «Recurrente» suma importes de líneas con cadencias distintas (solo visual, misma moneda) | Desglosar por cadencia |

## 6. Observaciones

1. **ONE_TIME pendiente se arrastra** (decisión D6). Tras `db:reset`, `SUB-GRUPASA-EWM` (ancla
   marzo 2026, nunca facturado) muestra en septiembre 2026 **un** cargo: la implementación, USD
   12,000. La licencia anual no aparece y la próxima facturación posterior es 2027-03-01
   (`evidence/security-audit.txt`).
2. Límites conocidos: no hay facturas complementarias para líneas añadidas después de emitir, y
   editar el ancla de una línea solo afecta a los períodos siguientes (`docs/finance/BILLING_CADENCE.md` §5).
3. `deno check` de `payment-setup/index.ts` no se puede ejecutar localmente por la resolución npm
   de `supabase-js`, ajena al cambio. `recurring-amount.ts` sí pasa `deno check`.
4. `.claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh` y `logs/` ya tenían cambios antes de
   esta sesión: no se tocaron ni se incluyeron en commits.

## 7. Trazabilidad

| Commit | Contenido |
|---|---|
| `32aba3e` fix(billing) | Migración 36 + pgTAP 18/19 + evidencia previa al fix |
| `e43d2e0` fix(ui) | Acción de factura por período, estado del servidor, tipos, unit tests |
| `875bf55` test(billing) | E2E de cadence verificado contra la base + evidencia con la función antigua |
| `b829ff5` fix(payments) | F2: `recurringCardAmount` + unit tests |
| `3394945` docs(billing) | `docs/finance/BILLING_CADENCE.md` + arquitectura |
| (siguiente) docs(v3.1) | Este informe, gates y evidencia |

Sin push, merge, PR, `db push`/`link`, despliegues ni cambios en QAS/PRD. Culqi LIVE no se usó.
EWM no se empezó y no se creó ninguna API de provisioning.
