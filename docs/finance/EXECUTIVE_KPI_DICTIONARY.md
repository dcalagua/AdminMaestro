# Diccionario de indicadores ejecutivos (K01–K06)

Fuente única en código: `src/features/executive/kpis.ts` (`KPI_DICTIONARY`); un test comprueba
que este documento nombra cada indicador y su fuente. Spec: §8 de
`docs/superpowers/specs/2026-09-25-masteradmin-executive-experience-design.md`.

Reglas comunes (spec §8.2):

- **Período transaccional**, **fecha FX** y **foto actual** son parámetros distintos. Cambiar la
  fecha de tasas no mueve el período; elegir un mes pasado no cambia MRR, saldo ni antigüedad.
- Nunca se suman monedas: todo se presenta por moneda nativa; el equivalente en moneda de reporte
  sólo aparece si `finance_consolidated` convirtió TODAS las monedas.
- FX faltante → cobertura parcial rotulada, nunca cero.
- Error de una fuente → «No se pudo leer» / «Parcial», nunca cero.
- Las fórmulas son las existentes; ninguna se redefine aquí.

| KPI | Temporalidad | Fuente real (consulta) | Incluye | Excluye | Precisión | Cobertura | Detalle |
|---|---|---|---|---|---|---|---|
| K01 — MRR vigente | Foto actual | `platform.finance_consolidated` métrica `MRR` ← `v_subscription_mrr` | Ítems recurrentes vigentes hoy de suscripciones ACTIVE (MONTHLY ×1, QUARTERLY ÷3, YEARLY ÷12); el DISCOUNT recurrente vigente resta (DISCOUNT resta de MRR y de la factura una sola vez) | ONE_TIME, suscripciones no ACTIVE, ítems fuera de vigencia, tenants DEMO | numeric(14,2), redondeo por ítem | Foto a hoy; la serie histórica es S01 (definición distinta: ver abajo) | `/subscriptions` |
| K02 — Cobrado del período | Período | `platform.collections_by_month` ← `v_collected_payments` | Pagos CONFIRMED con `paid_at` en el período sobre facturas ISSUED/PARTIALLY_PAID/PAID | PENDING, REVERSED; facturas DRAFT/VOID/UNCOLLECTIBLE o total 0 | Prorrateo por línea a 2 decimales, idéntico a `v_collected_revenue` | Mes en curso = parcial; base cero ⇒ sin comparación | `/billing` |
| K03 — Saldo por cobrar | Foto actual | `platform.invoice_summary` (`receivable`) ← `v_invoice_balances` | total − pagos CONFIRMED de facturas ISSUED/PARTIALLY_PAID/PAID | DRAFT, VOID, UNCOLLECTIBLE (informadas aparte) | numeric(14,2); sobrepago negativo sin recorte (banda «Saldo a favor») | No reconstruye saldos pasados | `/billing` |
| K04 — Cartera vencida | Foto actual | `platform.receivables_aging` ← `v_invoice_balances.aging_bucket` | Bandas 1–30, 31–60, 61–90, >90 días con saldo positivo | Vigente, «Sin fecha» y «Saldo a favor» (se muestran aparte) | numeric(14,2) | Clasificación visual a hoy; no es política de cobro | `/billing?estado=OPEN` |
| K05 — Margen gerencial | Período | `platform.finance_consolidated` (`native_margin`/`margin`) ← `v_finance_facts` | Cobrado − costo asignado − comisión no anulada | No es utilidad neta, EBITDA ni resultado contable; plataforma no se reparte | Suma por moneda antes de convertir | Fuente ausente ⇒ «No calculable» | `/costs` |
| K06 — Renovaciones próximas | Foto actual (ventana desde hoy) | `platform.v_renewal_pipeline` ← `v_renewal_dashboard` + `v_subscription_mrr` | ACTIVE/PAST_DUE con renovación en 7/15/30/45/60 días | Sin fecha de renovación; no es churn | MRR vigente de la suscripción (NULL si no tiene) | Ventana contada desde hoy | `/renewals` |

## Notas de conciliación

- `Σ v_collected_payments.collected_amount = Σ v_collected_revenue.collected_amount` por moneda
  (pgTAP `25_executive_read_models`). La serie mensual (G01) suma exactamente el cobrado total.
- `invoice_summary.row_count` = filas de la tabla con los mismos filtros (buscador + estado).
- Comisión «pendiente» = ELIGIBLE + ACCRUED (definición de `finance_reporting_rows`). Antes la
  página de comisiones sumaba también PENDING bajo la etiqueta «Elegible + devengada»; ahora PENDING
  se muestra por separado como «En espera» y no se pierde.
- «Costo registrado» (Σ `cost_entries.amount`) ≠ costo del margen (Σ asignaciones × peso). La
  diferencia se explica como «Plataforma» (asignaciones PLATFORM) y «Sin asignar».

## Series ejecutivas (S01–S05)

Migración `20261015000100_executive_series.sql`, pgTAP `51_executive_series`. Todas son
`SECURITY INVOKER` (cada rol suma sólo lo que RLS le muestra; sin GRANT a `anon`) y devuelven el
importe en **moneda de reporte** (parámetro o `control_plane_settings`) convertido con el motor FX
existente (`to_reporting_amount`). Si a una moneda le falta tasa, el importe es `NULL`,
`complete = false` y `missing_currencies` la nombra; los importes nativos siguen disponibles.

**MRR contratado a una fecha D** (`platform.executive_mrr_at`, base de S01–S04): Σ, por
suscripción, de los ítems recurrentes vigentes en D (`valid_from ≤ D` y `valid_to` nulo o `≥ D`),
mensualizados (MONTHLY ×1, QUARTERLY ÷3, YEARLY ÷12, ONE_TIME fuera, redondeo a 2 por ítem), con el
DISCOUNT recurrente restando (DISCOUNT resta de MRR y de la factura una sola vez), de suscripciones
ACTIVE, PAST_DUE o CANCELLED con `started_on ≤ D`, `ends_on` nulo o `≥ D` y, si están canceladas,
`coalesce(ends_on, cancelled_at) ≥ D`; excluye tenants DEMO y SANDBOX, DRAFT y PAUSED (no hay
historial de pausas). La conversión se hace **una vez por suscripción**, por eso serie, puente y
mix cuadran entre sí al céntimo.

| Serie | Fuente real (consulta) | Definición | Temporalidad | Cobertura / límites |
|---|---|---|---|---|
| S01 — MRR, ARR, clientes y contratos por mes | `platform.executive_mrr_series(p_from, p_to, p_reporting_currency)` | MRR contratado al cierre de cada mes (el mes en curso a hoy, `is_partial`); ARR = MRR × 12; clientes = organizaciones facturadas con MRR; contratos = suscripciones con MRR | Por defecto 18 meses hasta el mes en curso; máx. 120; sin meses futuros | Tasa a la fecha de cierre del mes. Difiere de K01 en que cuenta PAST_DUE y bajas hasta su fin y excluye SANDBOX |
| S02 — Puente de MRR del mes | `platform.executive_mrr_movements(p_month, p_reporting_currency)` | Por cliente: opening = cierre del mes anterior, closing = cierre del mes. NEW (sin MRR al inicio), CHURN (sin MRR al cierre), EXPANSION / CONTRACTION (diferencia). **opening + new + expansion − contraction − churn = closing** | Mes calendario | Ambos extremos a la tasa del mes analizado (moneda constante); `fx_revaluation` = opening − `prior_closing` (punto de la serie del mes anterior a su propia tasa) |
| S03 — Detalle del puente por cliente | `platform.executive_mrr_movement_customers(p_month, p_reporting_currency)` | Una fila por organización facturada con `movement`, opening, closing y delta; sus sumas son los totales de S02 | Mes calendario | Drill-down del waterfall |
| S04 — Mix de MRR por producto o mercado | `platform.executive_mrr_mix(p_month, p_dimension, p_reporting_currency)` | MRR contratado al cierre del mes agrupado por `PRODUCT` (`saas_products.short_name`) o `MARKET` (`subscriptions.market_id`, «Sin mercado»); `share` sobre el total | Cierre de mes | Σ mix = S01 del mismo mes; `share` NULL si falta una tasa |
| S05 — Cartera por antigüedad a una fecha | `platform.executive_receivables_aging(p_as_of, p_reporting_currency)` | Facturas ISSUED/PARTIALLY_PAID/PAID emitidas hasta la fecha, menos pagos CONFIRMED con `paid_at ≤ fecha`; saldo > 0 en 6 bandas fijas: VIGENTE, D1_30, D31_60, D61_90, D90_MAS, SIN_FECHA | Fecha (por defecto hoy; no futura) | A hoy concilia con `receivables_aging()` (K04). Usa el estado actual de la factura: no hay historial de anulaciones |

Derivables del puente (no son funciones aparte): churn de MRR del mes = churn / opening;
GRR = (opening − contraction − churn) / opening; NRR = (opening + expansion − contraction − churn) /
opening. Con opening 0 no hay tasa (se muestra «—», nunca 0 %).

**Datos locales:** el seed base crea ítems con `valid_from` = fecha del `db reset` en contratos
iniciados meses antes; la serie respeta esa vigencia, así que en local el mes en curso muestra
esos ítems como MRR nuevo/expansión (≈ +25 k USD con la demo `gerencia-v4`). En datos reales
la vigencia la fija el alta del contrato o del ítem.

## Métricas auxiliares (perspectiva correspondiente)

Facturado (no DRAFT/VOID), comisiones pagadas, costos por categoría, cartera por partner,
solicitudes de infraestructura (`provisioning_requests`) y solicitudes SaaS
(`saas_provisioning_requests`). «Falla de infraestructura» y «Falla de alta SaaS» son indicadores
distintos.

## No disponibles (sin fuente)

Churn de clientes por cohortes, CAC/LTV, embudo ponderado, MAU/consumo por SaaS, NPS,
uptime/SLA histórico. La consola lo dice; no rellena.
