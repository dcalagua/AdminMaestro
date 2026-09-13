# Escenarios demo V3 · Perú, Bolivia y Ecuador

> Sección `SEED V3` de `supabase/seed.sql`. Datos ficticios y deterministas: UUID fijos,
> fechas relativas a hoy (salvo las tasas DEMO) y dominios `*.ebim.test`. El bloque final
> de verificación hace **fallar** `db reset` si falta un escenario.

## 1. Escenarios

| # | Mercado | Moneda | Modelo | Organización | Contrato | Importe mensual |
|---|---|---|---|---|---|---|
| R1 | PE | PEN | Shared directo | Textiles Arequipa | `SUB-V3-PE-PEN-AREQUIPA` | PEN 3,150.00 (+ implementación PEN 12,950.00) |
| R2 | PE | USD | Shared directo | Empresa Directa Alpha (V2) | `SUB-ALPHA-ESUP` | USD 850.00 |
| R3 | BO | BOB | Shared vía partner Andina | Minera Illimani | `SUB-V3-BO-BOB-ILLIMANI` | BOB 5,900.00 |
| R4 | BO | USD | Partner Dedicated de Andina | Comercial Santa Cruz | `SUB-V3-BO-USD-SANTACRUZ` | USD 480.00 |
| R5 | EC | USD | Shared directo | Exportadora Guayas | `SUB-V3-EC-USD-GUAYAS` | USD 700.00 (+ implementación USD 2,800.00) |
| R6 | PE + BO | — | Partner multi-SaaS | Consultora Andina | eSupplier + EWM; clientes en Perú y Bolivia | — |
| R7 | — | USD | Costos | Soporte BO (Illimani) y mensajería PE (Arequipa) | `cost_entries` USD sobre ingresos BOB/PEN | USD 240 + USD 60 al mes |
| R8 | — | PEN · BOB · USD | Comisiones | Carla (PEN, Arequipa) · Beto (BOB, Illimani) · Equipo EBIM (USD, Guayas) | devengadas por los cobros confirmados | — |

Cada contrato tiene dos meses cobrados y el mes en curso emitido sin cobrar. Las líneas no
declaran moneda: la heredan del contrato (guard de moneda transaccional).

## 2. Tarifas regionales sembradas

| Plan | PE | BO | EC |
|---|---|---|---|
| eSupplier Shared Standard · licencia | USD 850 · PEN 3,150 | BOB 5,900 · USD 850 | **USD 700** |
| eSupplier Shared Standard · implementación | USD 3,500 · PEN 12,950 | BOB 24,000 | USD 2,800 |
| eSupplier Partner · Tenant | USD 480 | USD 480 · BOB 3,300 | — |
| EWM Shared Standard · licencia | USD 700 · PEN 2,600 | — | USD 650 |
| eSupplier Demo | USD 0 | **sin tarifa** (caso E2E «sin tarifa regional») | — |

PE/USD (850) y EC/USD (700) difieren a propósito: misma moneda, distinto mercado.

## 3. Cobranza regional

- R1 cobra con tarjeta en `culqi-pe-test` (Perú, PEN y USD; adapter en MOCK).
- R3 y R5 cobran por transferencia a `banco-bo-demo` (BOB, USD) y `banco-ec-demo` (USD).
- No hay cuenta de tarjeta en Bolivia ni en Ecuador: el routing lo dice
  (`PROVEEDOR_NO_DISPONIBLE_EN_MERCADO`) en vez de usar Culqi Perú.

## 4. Tipos de cambio DEMO

| Fecha | Tasa | Marca |
|---|---|---|
| 2026-09-01 | 1 USD = 3.5000 PEN | DEMO |
| 2026-09-01 | 1 USD = 7.0000 BOB | DEMO |

**No son cotizaciones reales.** Son valores redondos elegidos para que se note que son
ficticios; la UI los rotula «DEMO». La moneda de reporte inicial es USD con tolerancia de
31 días: pasada esa ventana desde el 2026-09-01, el consolidado marca las conversiones como
faltantes (comportamiento correcto) y basta elegir «Fecha de las tasas = 01/09/2026» en el
dashboard para verlo completo.

## 5. Recorrido de 5 minutos

1. `finance@ebim.test` → **Dashboard** → *Finanzas regionales* en **Nativo**: cobrado
   `BOB … · PEN … · USD …`, nunca un total mezclado. Tabla *Por mercado*: BO, EC, PE y
   *Sin mercado* (contratos de Chile).
2. Cambia a **Consolidado** con fecha 01/09/2026: moneda de reporte USD, tasas DEMO
   visibles, margen consolidado calculado.
3. Cambia la fecha a una sin tasas: aviso «Consolidado incompleto», cifras «Incompleto».
4. **Monedas y FX** → *Tarifas por mercado*: PE/USD 850 frente a EC/USD 700.
5. **Nueva venta** con *Minera Illimani*: el mercado sugerido es Bolivia, la moneda BOB, y
   solo se ofrecen BOB y USD.
6. **Comisiones y liquidaciones**: pendiente por moneda; cada liquidación es de una moneda.
