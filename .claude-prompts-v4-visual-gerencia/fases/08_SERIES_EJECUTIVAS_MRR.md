# FASE 08 — Módulo nuevo: series ejecutivas (MRR histórico y movimientos)

## Objetivo
El dashboard necesita series temporales reales. Hoy no hay MRR histórico (sin snapshots). Se calcula desde la vigencia
de los ítems de suscripción, que ya existe en la base, sin inventar datos.

## Backend (migración nueva `supabase/migrations/20261015000100_executive_series.sql` + pgTAP `51_executive_series.test.sql`)
- Función/RPC `executive_mrr_series(p_from date, p_to date, p_reporting_currency char(3) default null)` → por mes:
  `mrr`, `arr`, `active_customers`, `active_subscriptions`, convertido a moneda de reporte con el motor FX existente (reutiliza
  las funciones de `v3_reporting_currency`/`v3_fx_engine`; no dupliques lógica de FX).
  MRR del mes = Σ ítems recurrentes vigentes al cierre del mes (`valid_from <= fin_de_mes` y `valid_to` nulo o ≥ fin de mes),
  de suscripciones no canceladas a esa fecha, mensualizados (`QUARTERLY/3`, `YEARLY/12`, `ONE_TIME` fuera), menos descuentos recurrentes,
  excluyendo tenants DEMO/SANDBOX. Documenta la definición en el COMMENT y en `docs/finance/EXECUTIVE_KPI_DICTIONARY.md`.
- RPC `executive_mrr_movements(p_month date, p_reporting_currency)` → `opening`, `new`, `expansion`, `contraction`, `churn`, `closing`
  por cliente (organización facturada) comparando mes vs mes anterior; `opening + new + expansion - contraction - churn = closing` (invariante probado).
- RPC `executive_receivables_aging(p_as_of date, p_reporting_currency)` → buckets 0–30/31–60/61–90/90+ con total y n° facturas, si
  `receivables_aging` existente no lo cubre ya (revisa `20260925100000_executive_read_models.sql` antes; reutiliza si existe).
- Mix por producto y por mercado al cierre de mes (si no existe ya en los read models).
- Autorización igual a los read models ejecutivos existentes (finanzas/super admin/lo que ya use el dashboard), `security definer`
  con chequeo explícito o `security invoker` según el patrón del archivo de read models ejecutivos. Sin grant a `anon`.
- pgTAP: invariante del puente, mensualización, exclusión de DEMO/SANDBOX, conversión de moneda, permisos (tenant admin/partner no ven
  totales globales), estabilidad (mismos datos → mismo resultado).

## Frontend
- Hooks `useExecutiveMrrSeries`, `useExecutiveMrrMovements`, `useExecutiveAging` en `src/services/queries.ts` (o en `features/executive`).

## Pasos
1. Revisa los read models ejecutivos existentes para no duplicar. 2. Migración + pgTAP. 3. `db reset` + recargar demo + `supabase test db`.
4. Verifica con el demo que la serie de 18 meses es creíble y que el puente cuadra al centavo. 5. Tipos + gates. 6. Commits `feat(executive): …`.

## Hecho cuando
RPCs probadas (pgTAP verde completo), invariante del puente garantizado, hooks listos, documentación del KPI actualizada.
