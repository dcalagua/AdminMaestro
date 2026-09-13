# V3 · Matriz de gaps multicurrency

> Complementa `MULTICURRENCY_BASELINE.md`. Cada fila tiene un identificador que se cita en commits, tests y en el informe final.
> Severidad: **CRÍTICA** = produce una cifra financiera falsa sin error · **ALTA** = permite un dato incoherente · **MEDIA** = presentación engañosa o defensa en profundidad · **BAJA** = higiene.

| Id | Área | Gap | Severidad | Fase | Resolución prevista | Test que lo cierra |
|---|---|---|---|---|---|---|
| G-01 | Catálogo | Moneda como texto libre `^[A-Z]{3}$` | ALTA | 02 | `currencies` + FK en todas las columnas `currency` | pgTAP FK/moneda inexistente |
| G-02 | Catálogo | No existen mercados ni monedas permitidas por mercado | ALTA | 02 | `markets` + `market_currencies` | pgTAP seeds PE/BO/EC |
| G-03 | Sociedades | `companies` sin mercado; defaults PE/PEN en `upsert_company` | ALTA | 03 | `companies.market_id` + trigger de coherencia | pgTAP PE/PEN, BO/BOB, EC/USD, PE/USD |
| G-04 | Pricing | `plan_prices` sin mercado: PE/USD ≡ EC/USD | CRÍTICA | 04 | `plan_prices.market_id` + índice vigente por mercado | pgTAP PE/USD ≠ EC/USD |
| G-05 | Pricing | Vigencias de tarifa pueden solaparse (solo se protege `valid_to is null`) | ALTA | 04 | Exclusión de rangos por combinación | pgTAP solape DENIED |
| G-06 | Pricing | Tarifa en moneda no admitida por el mercado | ALTA | 04 | Trigger de moneda admitida | pgTAP DENIED |
| G-07 | Onboarding | `p_currency default 'USD'`; sin mercado; crea venta sin tarifa si se pasa importe | CRÍTICA | 05 | `p_market_code` obligatorio, moneda admitida, tarifa regional obligatoria | pgTAP + E2E selector |
| G-08 | Onboarding UI | Moneda como textbox libre | ALTA | 05/12 | Selector de mercado → moneda sugerida/permitida | E2E |
| G-09 | Transacción | `subscription_items.currency` ≠ `subscriptions.currency` (T-1) | CRÍTICA | 06 | Trigger | pgTAP BOB+USD DENIED |
| G-10 | Transacción | `invoice_lines.currency` ≠ `invoices.currency` (T-2) | CRÍTICA | 06 | Trigger | pgTAP |
| G-11 | Transacción | `invoices.currency` ≠ suscripción (T-3) | ALTA | 06 | Trigger | pgTAP |
| G-12 | Transacción | `payments.currency` ≠ factura (T-4) | CRÍTICA | 06 | Trigger | pgTAP PEN vs USD DENIED |
| G-13 | Transacción | `commission_events.currency` ≠ pago (T-5) | ALTA | 06/11 | Trigger | pgTAP |
| G-14 | Transacción | `subscriptions.currency` mutable con historia (T-6) | ALTA | 06 | Trigger inmutabilidad | pgTAP |
| G-15 | Transacción | Moneda explícita distinta aceptada por `upsert_subscription_item`, `set_subscription_collection_profile`, `request_commercial_document` | ALTA | 06 | Rechazo explícito | pgTAP |
| G-16 | Cobranza | Cuenta de proveedor no validada contra mercado/moneda; React envía `provider_account_id` | ALTA | 07 | Monedas por cuenta + elegibilidad + resolución en servidor | pgTAP PE/PEN no sirve BO/BOB |
| G-17 | FX | No existe FX auditable | ALTA | 08 | `exchange_rates` MANUAL + `fx_rate_lookup` | pgTAP |
| G-18 | Reporte | No existe moneda de reporte | ALTA | 09 | `control_plane_settings.reporting_currency_code` | pgTAP + UI |
| G-19 | Consolidado | `dashboard_summary.commission_pending/paid` suman monedas (R-1) | CRÍTICA | 10 | Por moneda | pgTAP PEN+USD no se suman |
| G-20 | Consolidado | `v_partner_agreements.channel_mrr` suma monedas (R-2) | CRÍTICA | 10 | Redefinir sin cambiar columnas | pgTAP |
| G-21 | Consolidado | Márgenes nativos descartan costos/comisiones en moneda ≠ ingreso (R-3) | CRÍTICA | 10 | Unión completa por (entidad, moneda) | pgTAP costo USD visible con ingreso PEN |
| G-22 | Consolidado | Sin completitud de conversión | ALTA | 10 | `missing_fx` en la respuesta | pgTAP FX faltante |
| G-23 | Comisiones | Liquidación reutiliza código sin moneda → mixta (R-4) | CRÍTICA | 11 | Código con moneda + guard | pgTAP USD no toma BOB |
| G-24 | Comisiones | Sin guard evento↔liquidación mono-moneda (R-5) | CRÍTICA | 11 | Trigger | pgTAP mixta DENIED |
| G-25 | Comisiones | `FIXED_AMOUNT` y `max_total_amount` cruzan monedas (R-6) | ALTA | 11 | Solo aplican en la moneda de la regla | pgTAP |
| G-26 | Comisiones | `settle_commissions(p_currency default 'USD')` | ALTA | 11 | Moneda obligatoria | pgTAP |
| G-27 | UI | `formatMoney` default USD, símbolo local ambiguo (`US$`/`S/`) | MEDIA | 12 | Sin default, código ISO siempre | unit |
| G-28 | UI | Totales de cabecera suman monedas (R-7) | CRÍTICA | 12 | `sumByCurrency` | unit |
| G-29 | UI | Textbox de moneda en Plan, Suscripción, Regla | ALTA | 12 | Selectores de catálogo | typecheck + E2E |
| G-30 | Dashboard | Sin filtros regionales ni modo consolidado | ALTA | 13 | NATIVO/CONSOLIDADO | E2E |
| G-31 | Seed | Sin escenarios PE/BO/EC ni FX demo | MEDIA | 14 | Seed regional | `db:reset` + pgTAP |
| G-32 | Vistas | `v_tenant_overview` rotula `USD 0` a tenants sin MRR | MEDIA | 10 | Moneda del contrato o NULL | pgTAP |
| G-33 | Seguridad | `current_plan_price` es SECURITY DEFINER ejecutable por cualquier autenticado: expone tarifas que `plan_prices_select` oculta | MEDIA | 16 | Reemplazo con control de lectura | pgTAP negativo |

## Fuera de alcance (explícito)

| Tema | Motivo |
|---|---|
| SUNAT / SRI / SIN, facturación electrónica, impuestos y retenciones | MasterAdmin no es ERP fiscal |
| Pago en moneda distinta al documento con FX (cross-currency settlement) | Prohibido en V3 (fase 06) |
| Fuentes automáticas de FX (BCRP, BCB, BCE) | Fase 08: MANUAL inicialmente |
| APIs de provisioning hacia eSupplier/WMS/TMS/GMAO/eChange | Fase posterior |
| QAS / PRD | Solo local |
