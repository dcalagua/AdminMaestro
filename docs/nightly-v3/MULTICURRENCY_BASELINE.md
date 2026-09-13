# V3 · Auditoría multicurrency del baseline

> Fase 01 de `.claude-prompts-v3-multicurrency`. Fecha: 2026-09-13.
> **Cero cambios funcionales en esta fase.** Solo lectura de migraciones, seed, tipos, servicios, formularios y vistas.
> Evidencia de partida ejecutada en esta sesión: `npm run db:reset` (23 migraciones + seed) OK, `npm run db:test` **124/124 PASS**, `npm test` **54/54 PASS**.
> Checksums SHA-256 de las 23 migraciones baseline: `docs/nightly-v3/BASELINE_MIGRATIONS.sha256`.

---

## 0. Resumen ejecutivo

El baseline **ya es consciente de la moneda** en el modelo de datos: toda tabla con dinero tiene `currency char(3)` con `CHECK ~ '^[A-Z]{3}$'` y los agregados principales (`dashboard_summary`, `v_product_margin`...) agrupan por moneda. Lo que **no** existe es:

1. **Catálogo** de monedas y mercados: la moneda es texto libre de 3 letras (`XYZ` es válida).
2. **Mercado**: nada distingue una tarifa PE/USD de una EC/USD. `plan_prices_current_uk` es `(plan, charge_kind, interval, currency)`.
3. **Coherencia transaccional** en la base: nada impide una línea USD en una suscripción BOB, ni un pago PEN sobre una factura USD por inserción directa o por RPC (solo `register_provider_payment` valida moneda desde V2.1).
4. **FX y moneda de reporte**: no existen. Correcto por diseño en V2 (no inventar tipos de cambio), pero impide la consolidación gerencial.

Y hay **siete puntos donde hoy se suman o descartan importes de monedas distintas** (§5). Ninguno afecta al seed actual —todo es USD salvo `companies`— pero todos se volverían cifras falsas en cuanto entre el primer contrato PEN o BOB.

---

## 1. Dónde ya existe moneda

| Tabla | Columna | Default | CHECK formato | FK catálogo |
|---|---|---|---|---|
| `companies` | `country_code char(2)`, `currency char(3)` | `'PE'`, `'PEN'` | sí | no |
| `organizations` | `country_code char(2)` | `'PE'` | sí | — |
| `catalog_items` | `currency` | `'USD'` | sí | no |
| `plan_prices` | `currency` | `'USD'` | sí | no |
| `subscriptions` | `currency` | `'USD'` | sí | no |
| `subscription_items` | `currency` | `'USD'` | sí | no |
| `invoices` | `currency` | `'USD'` | sí | no |
| `invoice_lines` | `currency` | `'USD'` | sí | no |
| `payments` | `currency` | `'USD'` | sí | no |
| `cost_entries` | `currency` | `'USD'` | sí | no |
| `commission_rules` | `currency` (NOT NULL) | `'USD'` | no | no |
| `commission_events` | `currency` | `'USD'` | sí | no |
| `commission_settlements` | `currency` | `'USD'` | sí | no |
| `payment_provider_accounts` | `country_code`, `currency` | `'PE'`, `'PEN'` | sí | no |
| `subscription_collection_profiles` | `currency` | `'USD'` | sí | no |
| `subscription_commercial_documents` | `currency` | `'USD'` | sí | no |
| `provider_plans` | `currency` (sin default) | — | sí | no |
| `platform_defaults.config` | `fiscal.currency` (JSONB) | `PEN` en seed | no | no |

Vistas que exponen `currency`: `v_subscription_mrr`, `v_collected_revenue`, `v_tenant_costs`, `v_tenant_overview`, `v_product_margin`, `v_partner_margin`, `v_tenant_margin`, `v_subscription_collection`, `v_commission_detail`, `v_finance_reconciliation`, `v_product_finance`, `v_partner_finance`, `v_renewal_dashboard`.

**No existe** ninguna tabla `currencies`, `markets`, `exchange_rates` ni setting de moneda de reporte.

---

## 2. Dónde se usa un default peligroso

Un default de moneda es peligroso cuando el contexto **ya conoce** la moneda y el default puede ganarle en silencio.

### 2.1 Base de datos

| Objeto | Default | Riesgo | Clasificación |
|---|---|---|---|
| `onboard_customer_subscription(p_currency default 'USD')` | USD | Una venta en Bolivia sin moneda explícita nace en USD | **PELIGROSO** |
| `settle_commissions(p_currency default 'USD')` | USD | Liquidar sin moneda ignora en silencio las comisiones PEN/BOB | **PELIGROSO** |
| `upsert_catalog_item(p_currency default 'USD')` | USD | Addon en moneda no pedida | PELIGROSO (bajo) |
| `upsert_commission_rule(p_currency default 'USD')` | USD | `fixed_amount`/`max_total_amount` en USD aplicados a cobros PEN (§5.6) | **PELIGROSO** |
| `upsert_company(p_country_code 'PE', p_currency 'PEN')` | PE/PEN | Una sociedad de Ecuador nace PE/PEN | **PELIGROSO** |
| `upsert_organization(p_country_code 'PE')` | PE | Organización boliviana nace PE | medio |
| `upsert_payment_provider_account(country 'PE', currency 'PEN')` | PE/PEN | Cuenta regional mal clasificada | medio |
| `subscriptions.currency default 'USD'` y resto de columnas `default 'USD'` | USD | Un INSERT sin moneda (seed, service_role) no falla | PELIGROSO (defensa en profundidad) |
| `upsert_subscription_item(p_currency default null)` → `coalesce(p_currency, v_sub.currency)` | hereda | Correcto el default, pero **acepta** una moneda distinta explícita | gap de validación |
| `set_subscription_collection_profile(p_currency default null)` → hereda | hereda | Igual que arriba | gap de validación |
| `request_commercial_document(p_currency default null)` → hereda | hereda | Igual que arriba | gap de validación |
| `v_tenant_overview`: `coalesce(mrr.currency, 'USD')` | USD | Un DEMO/TRIAL sin MRR se muestra como `USD 0` aunque su contrato sea PEN | medio (presentación) |
| `v_product_margin` / `v_partner_margin` / `v_tenant_margin`: `coalesce(..., 'USD')` | USD | Fila sin datos rotulada USD | bajo |
| `culqi-webhook`: `?account=` default `culqi-pe-test` | cuenta PE | Cuenta por defecto no regional | medio (Edge Function) |
| `_shared/payments/index.ts`: `currency ?? 'PEN'` | PEN | Adapter asume PEN si la fila no trae moneda | bajo (la columna es NOT NULL) |

### 2.2 Frontend

| Archivo | Default | Clasificación |
|---|---|---|
| `src/lib/format.ts` `formatMoney(amount, currency = 'USD')` y `formatMoneyCompact` | USD | **PELIGROSO**: todo total sin moneda se pinta como USD |
| `OnboardingPage.tsx` `currency: 'USD'` | USD | PELIGROSO |
| `SubscriptionDialogs.tsx` `currency: 'USD'` | USD | PELIGROSO |
| `PlanDialogs.tsx` `currency: 'USD'` | USD | PELIGROSO |
| `CommercialDialogs.tsx` (regla de comisión) `currency: 'USD'` | USD | PELIGROSO |
| ~60 llamadas `formatMoney(x, row.currency ?? 'USD')` | USD | medio: la columna casi nunca es null, pero el fallback oculta el caso |

---

## 3. Dónde se escribe moneda libre

La moneda es un **textbox de 3 letras** validado solo por regex en:

- `OnboardingPage.tsx` (paso 3, campo «Moneda»)
- `SubscriptionDialogs.tsx` (alta de suscripción)
- `PlanDialogs.tsx` (versionar tarifa)
- `CommercialDialogs.tsx` (regla de comisión)
- `OrganizationFormDialog.tsx` → «País» es texto libre (`getByLabel('País').fill('PE')` en E2E J1)

En base de datos, **cualquier** RPC acepta cualquier `char(3)` que cumpla `^[A-Z]{3}$`: `XYZ`, `EUR` o `BOB` en un mercado que no lo admite.

---

## 4. Dónde se agregan importes por moneda correctamente

| Objeto | Cómo |
|---|---|
| `dashboard_summary()` → `mrr_by_currency`, `collected_by_currency`, `cost_by_currency` | `group by currency` + `jsonb_object_agg` |
| `v_subscription_mrr` | agrupa por suscripción (una moneda por suscripción) |
| `v_collected_revenue` | fila por línea × pago, con `i.currency` |
| `v_product_margin` CTEs `revenue`, `product_costs`, `tenant_costs`, `commissions`, `mrr` | cada CTE `group by ..., currency` |
| `v_partner_finance.agent_commissions` | filtra `e.currency = pm.currency` |
| `v_partner_finance.weighted_channel_margin_rate` | filtra `v.currency = pm.currency` |
| `settle_commissions` | `where e.currency = p_currency` |
| `recalc_invoice_totals`, `sync_invoice_payment_status`, `confirm_manual_payment` (sobrecobro) | suman dentro de UNA factura (una moneda) |
| `register_provider_payment` (V2.1) | rechaza `MONEDA_INCOHERENTE` si el cobro ≠ moneda de la suscripción |
| `confirm_manual_payment` | usa `v_invoice.currency` (no acepta moneda del llamante) |
| `reverse_payment` | el contra-evento copia `v_event.currency` |
| `generate_commission_events` | el evento usa `v_line.currency` |
| UI `formatCurrencyMap` (Dashboard KPIs MRR/cobrado/costo) | pinta el mapa por moneda |
| UI `Organization360`, `ProductDetailPage` (pestaña Finanzas), `ReconciliationPage` | una tarjeta/fila por moneda |

---

## 5. Dónde existe riesgo de sumar (o descartar) monedas diferentes

| # | Objeto | Defecto concreto | Efecto con datos multimoneda |
|---|---|---|---|
| R-1 | `dashboard_summary()` `commission_pending` / `commission_paid` | `sum(amount)` **sin** `group by currency` | PEN 100 + USD 100 = «200» pintado como USD |
| R-2 | `v_partner_agreements.channel_mrr` | `sum(m.mrr)` sin moneda (el comentario dice lo contrario) | MRR del canal mezclado |
| R-3 | `v_product_margin` / `v_partner_margin` / `v_tenant_margin` | costos y comisiones se unen con `and currency = r.currency` (moneda del **ingreso**) | Costos USD de un producto que solo cobra PEN **desaparecen**: margen sobreestimado. Si hay 2 monedas de ingreso, la fila de MRR solo se une a la de `coalesce(r.currency,'USD')` |
| R-4 | `settle_commissions()` | código `STL-<agente>-<YYYYMM>` **sin moneda** + `on conflict (code) do update` | Liquidar BOB y luego PEN en el mismo mes **reutiliza la liquidación BOB** y le asigna eventos PEN: liquidación mixta |
| R-5 | `commission_settlements` | ninguna restricción impide `event.currency ≠ settlement.currency` | `recalc_settlement_total` suma monedas |
| R-6 | `generate_commission_events` con regla `FIXED_AMOUNT` o `max_total_amount` | `fixed_amount`/tope están en `commission_rules.currency` pero se aplican a líneas de cualquier moneda; el tope suma eventos de todas las monedas | USD 50 fijos registrados como «PEN 50» |
| R-7 | UI: `CommissionsPage` y `CommercialDashboard` (`totals.pending/paid`), `CostsPage` (`totalCost/Revenue/Margin`), `BillingPage` (`invoiced/collected`), `TenantsPage` (`totalMrr`), `Organization360` (`confirmedCollected`) | `reduce` sobre filas de cualquier moneda + `formatMoney(total)` con default USD | Totales de cabecera falsos |

Riesgos de **coherencia transaccional** (no son sumas, pero las alimentan):

| # | Objeto | Defecto |
|---|---|---|
| T-1 | `subscription_items` | puede tener moneda ≠ `subscriptions.currency` |
| T-2 | `invoice_lines` | puede tener moneda ≠ `invoices.currency` (y `recalc_invoice_totals` las suma) |
| T-3 | `invoices` | puede tener moneda ≠ la de su suscripción |
| T-4 | `payments` | puede tener moneda ≠ la de su factura (inserción directa/service_role) |
| T-5 | `commission_events` | puede tener moneda ≠ la de su pago |
| T-6 | `subscriptions.currency` | se puede cambiar por UPDATE aunque ya tenga líneas y facturas (reescritura histórica) |
| T-7 | `subscription_collection_profiles` | la cuenta de proveedor no se valida contra moneda ni país de la suscripción (hoy `culqi-pe-test` —PEN— cobra suscripciones USD, lo que es **válido** en Culqi Perú: la evidencia V2.1 cobró PEN y USD con la misma cuenta, pero el modelo no lo expresa) |
| T-8 | `plan_prices` | sin mercado: PE/USD y EC/USD son la misma fila; `current_plan_price()` no puede distinguirlos |
| T-9 | `onboard_customer_subscription` | no valida que la moneda sea admitida por ningún mercado; si no hay tarifa y se pasa `p_license_amount`, crea la venta igual |

---

## 6. Qué cambios son estrictamente necesarios

Ordenados por dependencia; cada uno se implementa en una migración **24+** sin tocar las 23 existentes.

1. **Catálogo** `currencies` (código ISO PK, decimales, estado) y `markets` + `market_currencies` (PE: PEN default + USD; BO: BOB default + USD; EC: USD). FK de **todas** las columnas `currency` existentes al catálogo, con backfill previo de monedas presentes (COP/CLP del seed) como inactivas. → Fase 02.
2. **`companies.market_id`** con coherencia país/moneda y las tres sociedades EBIM bajo la organización PLATFORM. → Fase 03.
3. **`plan_prices.market_id`**, índice de tarifa vigente por mercado, no-solapamiento de vigencias y `current_plan_price` con mercado. → Fase 04.
4. **Onboarding regional**: `p_market_code` obligatorio, moneda admitida, tarifa regional obligatoria. → Fase 05.
5. **Invariantes de moneda** por trigger: T-1..T-6, y retirar defaults USD de las RPCs. → Fase 06.
6. **Routing de proveedor** por mercado + moneda + método, resuelto en servidor (T-7). → Fase 07.
7. **`exchange_rates`** MANUAL con helper de conversión explícito. → Fase 08.
8. **Setting `reporting_currency`** y respuesta nativo/reporte con estado de conversión. → Fase 09.
9. **Consolidado**: corregir R-1, R-2, R-3 sin cambiar las columnas de las vistas nativas; añadir funciones de reporte con completitud de FX. → Fase 10.
10. **Comisiones**: corregir R-4, R-5, R-6; liquidación con moneda obligatoria. → Fase 11.
11. **UI**: selectores de mercado/moneda, `formatMoney` sin default y con código ISO, totales por moneda (R-7). → Fases 12-13.

Lo que **no** es necesario y no se hará: conversión FX de documentos, facturación electrónica o impuestos regionales, APIs hacia los SaaS, pagos cross-currency.
