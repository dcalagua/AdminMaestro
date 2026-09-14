# Baseline V3.2 · Final payment plan hardening

> Tomado el `2026-09-14T01:55Z` (reloj del sistema), antes de modificar código.

## 1. Repositorio

| Dato | Valor |
|---|---|
| `pwd` | `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin` |
| Rama | `dev` |
| HEAD inicial | `1985f1426d109b94416b898546cd3b62e58241ce` (`1985f14` docs(v3.1): baseline, cadence design, test matrix, quality gate and final report) |
| `origin/dev` | `91d8016` docs(v2.1). La rama local va **26 commits por delante**, sin push |
| Migraciones | **36** (`ls supabase/migrations \| wc -l`) |
| Última migración | `20260913001300_v3_1_billing_cadence.sql` |
| Hashes | `BASELINE_MIGRATIONS_PRE_V3_2.sha256` (sha256 de las 36) |
| pgTAP | 20 archivos (`supabase/tests/00` … `19`) |

Cambios locales ya presentes antes de V3.2. No se tocan ni entran en commits:

```
 M .claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh
 M docs/quality/vscode-problems-summary.json
 M docs/quality/vscode-problems.json
 M docs/quality/vscode-problems.md
?? logs/
```

Stack local: `supabase_*_ebim-control-plane` en marcha (API `127.0.0.1:54421`, DB `54422`). El edge
runtime local sirve `payment-setup` desde `supabase/functions`. No tiene variables `CULQI_*`, así que
`resolvePaymentProvider` usa **MOCK**: no hay llamadas a Culqi. En la base, `culqi-pe-test` es la
única cuenta CULQI (TEST, monedas PEN y USD) y `provider_plans` está vacía tras el seed.

## 2. Lectura realizada

`CLAUDE.md`, `README.md`, `package.json`, `docs/nightly-v3-1/FINAL_REPORT_V3_1.md`,
`QUALITY_GATE_V3_1.md`, `supabase/functions/payment-setup/index.ts`, todo
`supabase/functions/_shared/payments/` (`types`, `index`, `mock`, `culqi`, `culqi-mapping`,
`recurring-amount` y sus tests) y las migraciones que definen `provider_plans`,
`payment_provider_accounts`, `provider_subscriptions`, `subscription_items`, `subscriptions`,
`plan_prices`, `currencies`, `v_subscription_collection` y el motor de cadencia V3.1.

Scripts reales (`package.json`): `db:reset` = `supabase db reset`, `db:test` = `supabase test db`,
`test` = `vitest run`, `typecheck`, `lint` = `eslint .`, `build` = typecheck + `vite build`,
`secrets:scan` = `node scripts/secrets-scan.mjs`, `e2e` = `playwright test`.

## 3. Hallazgos del código real (antes del fix)

### P1-A · identidad del Plan del proveedor sin importe (CONFIRMADO en código)

- `20260907000600_payment_provider_mappings.sql:116`:
  `constraint provider_plans_uk unique (provider_account_id, plan_id, billing_interval, currency)`.
  **No incluye `amount`.** La base no puede guardar USD 1000 y USD 1250 del mismo plan.
- `payment-setup/index.ts:219-226`: el lookup filtra por cuenta, plan, intervalo y moneda, **sin
  importe**. Devuelve el `external_plan_id` de otro contrato aunque el importe sea distinto.
- `payment-setup/index.ts:280`: ese id se pasa como `externalPlanId`, y el adapter
  (`culqi.ts:165`) **no crea** plan cuando lo recibe: la suscripción del cliente B se cuelga del Plan
  de A y Culqi le cobra el importe de A.
- `payment-setup/index.ts:329-341`: `upsert` con `onConflict` sobre las mismas 4 columnas. Escribe
  `amount = 1250` sobre la fila de `P1`, que en Culqi sigue siendo 1000. La base deja de reflejar el
  recurso externo (fase 5).
- `amount` es `numeric(14,2)` en `provider_plans` y en `subscription_items` (generada como
  `round(quantity * unit_amount, 2)`).

### P1-B · cadencia e importe futuros (CONFIRMADO en código)

- `recurring-amount.ts:31-36` solo tiene en cuenta líneas vigentes **en `asOf`**:
  `valid_from <= asOf`.
- El test existente `recurring-amount.test.ts:27` («no domicilia líneas vencidas ni futuras») fija
  como correcto aceptar un YEARLY con `valid_from` futuro junto a un MONTHLY actual. Ese es
  exactamente el escenario de subcobro de P1-B.
- Tampoco se detecta que el total recurrente cambie en una fecha futura (línea MONTHLY que empieza
  o termina más adelante).

### Importes hacia el PSP

- `recurring-amount.ts:43`: suma en `Number` y redondea con `Math.round(x*100)/100`.
- `culqi-mapping.ts:106`: `toCulqiAmount(amount) = Math.round(amount * 100)`. Un importe con
  tres decimales reales (p. ej. 12.345) se redondea en silencio.

### Seguridad vigente (se mantiene)

- JWT obligatorio, autorización por RLS sobre `v_subscription_collection`.
- La cuenta de cobro la deriva el servidor; un `provider_account_id` distinto en el cuerpo → 403.
- `service_role` solo después de esa autorización. La clave secreta solo existe en `Deno.env`.
- `provider_plans`: RLS forzada, solo `SELECT` para `authenticated` (finanzas o gestión de
  plataforma). `upsert_provider_subscription` solo para el contexto de servicio.
- Ninguna pantalla de `src/` invoca `payment-setup` (búsqueda `payment-setup` en `src` y `e2e`: 0
  coincidencias).

## 4. Resultados de referencia de V3.1 (no se reutilizan)

V3.1 reportó pgTAP 486/486, unit 115/115 y E2E 65/65. V3.2 vuelve a ejecutar todo desde
`db:reset`: ver `QUALITY_GATE_V3_2.md`.
