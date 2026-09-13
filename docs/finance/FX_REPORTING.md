# Tipos de cambio y moneda de reporte (V3)

> **Las tasas del seed local son DEMO** (1 USD = 3.50 PEN = 7.00 BOB, 2026-09-01): valores redondos
> deliberadamente irreales para pruebas. **No son cotizaciones.**

## 1. Para qué sirve el FX

Solo para **reporting gerencial**. Ningún documento (factura, cobro, comisión, liquidación) se
convierte ni se reescribe con un tipo de cambio.

## 2. `exchange_rates`

| Campo | Significado |
|---|---|
| `rate_date`, `base_currency`, `quote_currency`, `rate` | `1 base = rate quote` en esa fecha (`rate > 0`, base ≠ quote) |
| `source` | `MANUAL` (única fuente en V3; enum ampliable a BCRP/BCB/BCE en otra fase) |
| `status` | `ACTIVE` · `SUPERSEDED` (republicada para la misma fecha, `superseded_by`) · `VOIDED` (con motivo) |
| `is_demo` | Valor de demostración: la UI lo rotula «DEMO» |
| `created_by`, `status_changed_by/at`, `status_reason` | Auditoría (además de `audit_logs`) |

Una sola tasa ACTIVE por fecha, par y fuente. Una tasa no se edita (`TIPO_CAMBIO_INMUTABLE`).
Publicar y anular: EBIM_FINANCE o super admin (`set_exchange_rate`, `void_exchange_rate`).
Leer: plataforma o finanzas (RLS). UI: **Monedas y FX → Tipos de cambio**, con «Probar una conversión».

## 3. Resolución de una tasa (`fx_rate_lookup`)

1. Misma moneda → **IDENTITY** (tasa 1).
2. Tasa **DIRECT** base→quote: la ACTIVE más reciente con `rate_date ∈ [as_of − tolerancia, as_of]`.
3. Si no hay directa, **RECIPROCAL**: `1 / (quote→base)` con la misma ventana, redondeada a 10 decimales.
4. Si tampoco → **MISSING**. Nunca una tasa futura, nunca una triangulación implícita (PEN→USD→BOB).

`fx_convert` redondea a los decimales ISO de la moneda destino y con MISSING devuelve **NULL, no 0**.
La tolerancia por defecto de la función es 0 días (fecha exacta); la moneda de reporte usa la de su
configuración.

## 4. Moneda de reporte

`control_plane_settings` (una fila): `reporting_currency_code` (inicial USD, como configuración) y
`fx_max_rate_age_days` (inicial 31, pensado para una tasa gerencial mensual). Se cambia en
**Monedas y FX → Moneda de reporte** (EBIM_FINANCE o super admin) entre monedas activas.

Contrato de respuesta de `to_reporting_amount(importe, moneda, fecha, [moneda_reporte], [tolerancia])`:

| Campo | |
|---|---|
| `native_amount`, `native_currency` | El hecho, intacto |
| `reporting_amount`, `reporting_currency` | Equivalente; NULL si falta tasa |
| `conversion_status` | `SAME_CURRENCY` · `CONVERTED` · `MISSING_FX` · `NO_REPORTING_CURRENCY` |
| `fx_method`, `fx_rate`, `fx_rate_date`, `fx_rate_id`, `fx_is_demo` | Qué tasa, de qué día y por qué método |

## 5. Consolidado (`finance_consolidated`)

1. `v_finance_facts`: hechos nativos (MRR, cobrado, costo, comisión) con producto, mercado,
   organización, canal, moneda y fecha.
2. `finance_reporting_rows`: **suma dentro de cada moneda** por grupo y métrica, y convierte cada
   total a la fecha del reporte.
3. `finance_consolidated`: por grupo (TOTAL, MARKET, PRODUCT, PARTNER) y métrica devuelve el nativo
   por moneda, el equivalente (NULL si falta cualquier conversión), `complete` y
   `missing_currencies`; el **margen consolidado** (cobrado − costo − comisión) solo si las tres
   métricas están completas; `completeness.missing_fx_count` y `rates_used`.

Criterio: **tasa de cierre a la fecha del reporte** para todo el periodo. Es una lente gerencial,
no una revalorización contable ni un cálculo de diferencia de cambio.

## 6. Qué cambió en las vistas nativas

| Antes (V2) | V3 |
|---|---|
| `dashboard_summary.commission_pending/paid` sumaban monedas | NULL con varias monedas; mapas `*_by_currency` |
| `v_partner_agreements.channel_mrr` sumaba monedas | NULL con varias; `channel_mrr_by_currency` |
| Márgenes perdían costos y comisiones en moneda distinta al ingreso | Una fila por (entidad, moneda) |
| `v_tenant_overview` rotulaba `USD 0` a tenants sin MRR | Moneda del contrato o NULL |

## 7. Dashboard

**Nativo:** cifras por moneda. **Consolidado:** moneda de reporte, fecha y tolerancia, tasas usadas
(DEMO rotulado); si falta una tasa: aviso «Consolidado incompleto», métricas «Incompleto», margen
«No calculable» y «FX faltante» por mercado. Filtros: mercado, moneda, producto, organización/partner.
