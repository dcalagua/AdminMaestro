# Arquitectura multicurrency (V3)

> Estado a 2026-09-13. Migraciones `20260913000100` a `20260913001100` (24 a 34) sobre las 23
> baseline, que no se modificaron. Decisiones en `.claude-prompts-v3-multicurrency/DECISIONS_V3.md`
> (DV3-001 a DV3-020).

## 1. La regla

**Cada operación conserva su moneda transaccional para siempre.** Una factura PEN 5 000 es PEN
5 000 hoy y dentro de diez años. La plataforma añade una **moneda de reporte** configurable
(inicialmente USD) solo para lectura gerencial, con un tipo de cambio explícito y auditable.

```
          CAPA TRANSACCIONAL (nativa)                     CAPA DE REPORTE (lente)
  ┌───────────────────────────────────────┐        ┌─────────────────────────────────┐
  │ contrato BOB → líneas BOB → factura BOB│        │ to_reporting_amount()           │
  │ → cobro BOB → comisión BOB → liquid. BOB│ ─────▶│  native_amount / native_currency│
  │ (guards: heredar o rechazar)           │  lee   │  reporting_amount / _currency   │
  └───────────────────────────────────────┘        │  conversion_status + tasa usada │
          nunca se escribe desde la derecha         └─────────────────────────────────┘
```

## 2. Capas y responsabilidades

| Capa | Objetos | Qué garantiza |
|---|---|---|
| Catálogo | `currencies`, `markets`, `market_currencies` | Toda columna `currency` tiene FK; un mercado dice qué monedas admite y cuál sugiere |
| Sociedades | `companies.market_id` | País y moneda coherentes con el mercado; EBIM = 1 organización + sociedades PE/BO/EC |
| Pricing | `plan_prices.market_id`, `current_plan_price`, `set_plan_price`, `v_plan_price_catalog` | Tarifa por plan + mercado + cargo + periodicidad + moneda + vigencia, sin solapes ni edición |
| Venta | `subscriptions.market_id`, `create_subscription`, `onboard_customer_subscription` | Mercado obligatorio, moneda admitida, tarifa regional obligatoria |
| Transacción | `enforce_currency_chain`, `enforce_currency_immutability`, `v_currency_integrity_issues` | La moneda baja del contrato sin cambiar; los hijos heredan o se rechazan |
| Cobro | `payment_provider_account_currencies`, `provider_account_candidates`, `set_subscription_collection_profile(p_route_provider)` | La cuenta la elige el servidor por mercado + moneda + método |
| FX | `exchange_rates`, `fx_rate_lookup`, `fx_convert` | Tasas MANUAL auditables; directa → recíproca → MISSING, sin triangular |
| Reporte | `control_plane_settings`, `reporting_settings`, `to_reporting_amount` | Moneda de reporte configurable; nativo intacto + equivalente + estado |
| Consolidado | `v_finance_facts`, `finance_reporting_rows`, `finance_consolidated` | Sumar por moneda, convertir cada total, declarar faltantes |
| Comisiones | `settle_commissions(..., p_currency)`, `enforce_settlement_currency` | Devengo en moneda del cobro; liquidación mono-moneda |
| Facturación | `issue_subscription_invoice`, `subscription_due_items`, `get_subscription_billing_status` | Factura gerencial del periodo en la moneda del contrato, solo con las líneas que tocan según su billing cadence (V3.1, `docs/finance/BILLING_CADENCE.md`) |

## 3. Reglas de enforcement (todas en la base)

| Regla | Mecanismo | Error |
|---|---|---|
| Moneda existe | FK a `currencies` | 23503 |
| Moneda admitida por el mercado | `is_currency_allowed_in_market` en triggers y RPC | `MONEDA_NO_PERMITIDA_EN_MERCADO` |
| Hijo en la moneda del padre | `enforce_currency_chain` (7 tablas) | `MONEDA_INCOHERENTE` |
| Moneda de un padre con historia | `enforce_currency_immutability` | `MONEDA_CONTRACTUAL_INMUTABLE`, `MONEDA_DOCUMENTO_INMUTABLE` |
| Sin moneda implícita | columnas sin `default 'USD'`; RPC sin defaults | 23502, `MONEDA_REQUERIDA`, `MERCADO_REQUERIDO` |
| Tarifa regional para vender | `create_subscription`, onboarding | `TARIFA_REGIONAL_NO_DEFINIDA` |
| Cuenta de cobro elegible | `enforce_collection_profile_scope` | `CUENTA_PROVEEDOR_OTRO_MERCADO`, `MONEDA_NO_SOPORTADA_POR_CUENTA`, `PROVEEDOR_INCOMPATIBLE` |
| Liquidación mono-moneda | `enforce_settlement_currency` | `LIQUIDACION_MULTIMONEDA` |
| Tasa válida | CHECK + RPC | `TASA_INVALIDA`, `PAR_INVALIDO` |

La UI replica las reglas solo para no ofrecer lo imposible (`src/lib/regional.ts`,
`src/lib/consolidated.ts`); si divergen, gana la base.

## 4. Presentación

- Todo importe se pinta con su código ISO: `PEN 1,250.00`, `BOB 890.00`, `USD 250.00`
  (`formatMoney`, sin moneda por defecto). El símbolo solo aparece como ayuda si es inequívoco.
- Todo total de pantalla se agrupa por moneda (`sumByCurrency`); nunca `PEN + USD`.
- El dashboard ofrece **Nativo** (por moneda) y **Consolidado** (moneda de reporte, fecha y tasas
  a la vista, «Incompleto» y aviso si falta una tasa).

## 5. Límites de V3 (fuera de alcance)

- **No es un ERP fiscal:** sin SUNAT / SIN / SRI, sin facturación electrónica, impuestos ni
  retenciones regionales. La factura es de control gerencial.
- **Sin pagos cross-currency:** una factura PEN no se paga en USD; un flujo con FX de documentos
  sería un diseño explícito futuro.
- **FX solo MANUAL:** sin BCRP, BCB, BCE ni APIs externas.
- **Sin revalorización contable:** el consolidado usa la tasa de cierre a la fecha del reporte.
- **Sin APIs hacia los SaaS** (eSupplier, WMS, TMS, GMAO, eChange): el provisioning sigue en
  DRY_RUN y las integraciones quedan para una fase posterior.
- **Sin cambios en QAS/PRD** ni `supabase db push`.

## 6. Documentos relacionados

- `docs/architecture/COUNTRY_MARKET_MODEL.md` — país, mercado, sociedad y moneda.
- `docs/commercial/REGIONAL_PRICING.md` — tarifas por mercado y venta regional.
- `docs/finance/FX_REPORTING.md` — tipos de cambio, moneda de reporte y consolidado.
- `docs/security/V3_MULTICURRENCY_SECURITY_AUDIT.md` — RLS, grants y hallazgos.
- `docs/demo/DEMO_SCENARIOS_V3.md` — escenarios del seed regional.
