# Modelo país · mercado · sociedad · moneda (V3)

## 1. Cuatro conceptos que no son lo mismo

| Concepto | Dónde vive | Qué es | Ejemplo |
|---|---|---|---|
| **Moneda** | `currencies` (PK ISO 4217) | Unidad de un importe, con sus decimales | `PEN`, `BOB`, `USD` |
| **País** | `country_code char(2)` en organizaciones, sociedades y cuentas | Jurisdicción | `PE`, `BO`, `EC`, `CL` |
| **Mercado** | `markets` + `market_currencies` | Dónde vende EBIM y en qué monedas | PE: PEN (sugerida) + USD · BO: BOB (sugerida) + USD · EC: USD |
| **Sociedad** | `companies` (`market_id`) | Entidad legal de una organización en un mercado | EBIM Perú (PE/PEN), EBIM Bolivia (BO/BOB), EBIM Ecuador (EC/USD) |

Un mercado **no es** un país (podría existir un mercado regional) ni una moneda (Perú vende en dos).
Por eso la moneda admitida es una relación (`market_currencies`), no un atributo.

## 2. Mercados iniciales

| Código | País | Moneda sugerida | Monedas admitidas |
|---|---|---|---|
| PE | PE | PEN | PEN, USD |
| BO | BO | BOB | BOB, USD |
| EC | EC | USD | USD |

Son **catálogo** (migración 24), no demo: existen en todo entorno. Se mantienen con `upsert_currency`
y `upsert_market` (EBIM_FINANCE o super admin). Retirar una moneda de un mercado la desactiva, no la
borra: los contratos existentes en esa moneda siguen explicándose. Una moneda no se desactiva mientras
un mercado la admita. Las monedas de datos históricos fuera de los mercados (COP, CLP) quedan
`INACTIVE`: sostienen la historia, no admiten ventas nuevas.

## 3. EBIM regional

EBIM es **una** organización `PLATFORM` con tres sociedades (DV3-005): partir EBIM en tres cuentas
rompería el super admin único y `organizations_single_platform_uk`. En QAS/PRD las sociedades se
crean con `upsert_company(p_market_code => 'BO', ...)`; `upsert_company` ya no asume PE/PEN.

## 4. Dónde se asigna el mercado

| Entidad | Regla |
|---|---|
| Sociedad | Explícito, o el único mercado activo del país si la moneda está admitida; si no, NULL («fuera del modelo regional») |
| Tarifa | **Siempre explícito** en tarifas nuevas; tarifas previas a V3 sin mercado inferible quedan como legacy y no se usan para vender |
| Contrato | **Explícito en las RPC** (`p_market_code`); por inserción directa, el único mercado del país de quien paga. Inmutable una vez fijado |
| Cuenta de cobro | Explícito en la RPC; atiende un único mercado y declara sus monedas |

Un contrato sin mercado (p. ej. clientes de Chile del seed V2) sigue operando; el consolidado lo
agrupa como «Sin mercado» y el routing de cobro solo le ofrece cuentas del país de quien paga.

## 5. Sugerencias en la UI

- **Nueva venta:** el mercado se sugiere por el país del cliente si hay un único mercado activo; la
  moneda se sugiere por el mercado y solo se ofrecen las admitidas (`<select>`, sin texto libre).
- **Tarifa y contrato:** mismo selector mercado → monedas admitidas.
- El país de una organización sigue siendo texto ISO: no hay catálogo de países y una organización
  fuera de PE/BO/EC es legítima.
