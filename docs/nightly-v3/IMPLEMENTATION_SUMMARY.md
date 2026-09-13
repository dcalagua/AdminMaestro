# V3 Multicurrency · Resumen de implementación

> Rama `dev`, desde `1c6b5ce chore: checkpoint before V3 multicurrency`. Un commit por fase.
> Estado y evidencia por fase: `.claude-prompts-v3-multicurrency/STATE_V3.md`.

## 1. Migraciones V3 (24-34)

| # | Archivo | Fase | Responsabilidad |
|---|---|---|---|
| 24 | `20260913000100_v3_currencies_markets.sql` | 02 | Catálogo `currencies`, `markets`, `market_currencies`; FK de las 16 columnas `currency` |
| 25 | `20260913000200_v3_regional_companies.sql` | 03 | `companies.market_id`, guard país/moneda, `upsert_company` sin PE/PEN, `v_company_markets` |
| 26 | `20260913000300_v3_regional_pricing.sql` | 04 | Tarifas por mercado, no-solape, inmutabilidad, `current_plan_price`/`set_plan_price` con mercado, `subscriptions.market_id`, venta regional |
| 27 | `20260913000400_v3_transaction_currency.sql` | 06 | Cadena de moneda (heredar/rechazar), inmutabilidad, defaults retirados, `v_currency_integrity_issues` |
| 28 | `20260913000500_v3_regional_payment_routing.sql` | 07 | Cuentas por mercado y monedas, métodos por proveedor, elegibilidad y routing en servidor |
| 29 | `20260913000600_v3_fx_engine.sql` | 08 | `exchange_rates` MANUAL, `fx_rate_lookup`, `fx_convert` |
| 30 | `20260913000700_v3_reporting_currency.sql` | 09 | `control_plane_settings`, `to_reporting_amount` |
| 31 | `20260913000800_v3_consolidated_finance.sql` | 10 | Vistas nativas corregidas, `v_finance_facts`, `finance_consolidated` |
| 32 | `20260913000900_v3_multicurrency_commissions.sql` | 11 | Liquidación mono-moneda, fijos y topes en moneda de la regla |
| 33 | `20260913001000_v3_security_hardening.sql` | 16 | Grants mínimos (devengo solo por trigger, funciones de trigger sin EXECUTE) |
| 34 | `20260913001100_v3_subscription_invoicing.sql` | 17 | Factura gerencial del periodo en la moneda del contrato |

## 2. Gaps cerrados

G-01 … G-33 de `GAP_MATRIX_MULTICURRENCY.md` (ver cada commit `feat(v3-NN)`).

## 3. Frontend

- `src/lib/regional.ts`, `src/lib/consolidated.ts`, `formatMoney`/`sumByCurrency` en `src/lib/format.ts`.
- Componentes `MarketSelectField`, `CurrencySelectField`, `Money`, `RegionalPriceList`, `RegionalFinancePanel`, `ManualPaymentDialog`.
- Página **Monedas y FX** (`/regional`): moneda de reporte, tipos de cambio, tarifas por mercado, mercados y rutas de cobro.
- Nueva venta, suscripción, tarifa y regla de comisión con selectores de catálogo; totales por moneda en todas las cabeceras.

## 4. Tests

| Suite | Archivos V3 |
|---|---|
| pgTAP | `06` a `17` (`supabase/tests/*_v3_*.test.sql`) |
| Unit | `regional.test.ts`, `consolidated.test.ts`, `multicurrency.regression.test.ts`, `format.test.ts` ampliado |
| E2E | `e2e/v3-regional.spec.ts` (R1–R6), `e2e/v3-regional-journeys.spec.ts` (A–E) |

## 5. Defectos previos corregidos durante V3

| Defecto | Dónde |
|---|---|
| `upsert_payment_provider_account` nunca completaba (clave de auditoría rechazada por el guard anti-secretos) | DV3-011, migración 28 |
| `settle_commissions` reabría liquidaciones PAGADAS y mezclaba monedas por código sin moneda | DV3-015, migración 32 |
| `formatDate('YYYY-MM-DD')` pintaba el día anterior en UTC−5 | DV3-017 |
| `generate_commission_events` ejecutable por cualquier usuario | DV3-019, migración 33 |

## 6. Fuera de alcance (confirmado)

ERP fiscal (SUNAT/SIN/SRI, e-factura, impuestos), pagos cross-currency, fuentes FX automáticas,
APIs hacia eSupplier/WMS/TMS/GMAO/eChange (provisioning sigue en DRY_RUN), QAS/PRD y cualquier
`push`.
