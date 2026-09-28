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
| K01 — MRR vigente | Foto actual | `platform.finance_consolidated` métrica `MRR` ← `v_subscription_mrr` | Ítems recurrentes vigentes hoy de suscripciones ACTIVE (MONTHLY ×1, QUARTERLY ÷3, YEARLY ÷12); el DISCOUNT recurrente vigente resta (DISCOUNT resta de MRR y de la factura una sola vez) | ONE_TIME, suscripciones no ACTIVE, ítems fuera de vigencia, tenants DEMO | numeric(14,2), redondeo por ítem | Sin serie histórica (deuda #2 de COST_MARGIN_MODEL) | `/subscriptions` |
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

## Métricas auxiliares (perspectiva correspondiente)

Facturado (no DRAFT/VOID), comisiones pagadas, costos por categoría, cartera por partner,
solicitudes de infraestructura (`provisioning_requests`) y solicitudes SaaS
(`saas_provisioning_requests`). «Falla de infraestructura» y «Falla de alta SaaS» son indicadores
distintos.

## No disponibles (sin fuente)

Serie histórica de MRR, churn/NRR/GRR, CAC/LTV, embudo ponderado, MAU/consumo por SaaS, NPS,
uptime/SLA histórico. La consola lo dice; no rellena.
