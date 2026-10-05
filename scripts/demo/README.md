# Datos de demostración para Gerencia (`gerencia-v4`)

Dataset **solo local** para que cada gráfico y tabla de MasterAdmin cuente una historia creíble en la
presentación a Gerencia: 18 meses de negocio de una suite SaaS en Perú, Bolivia y Ecuador.

> No está en `supabase/seed.sql`: los pgTAP dependen del seed base y este dataset lo rompería
> (por ejemplo, `40_ccp_ai_credits` exige que no haya pesos ni políticas de créditos sembrados).
> No se ejecuta nunca contra QAS ni PRD.

## Uso

```bash
bash scripts/demo/load-demo-data.sh            # carga o recarga + informe de cifras
bash scripts/demo/load-demo-data.sh --quiet    # sin informe
bash scripts/demo/unload-demo-data.sh          # borra el dataset (el seed queda intacto)
```

- **Destino:** el contenedor local `supabase_db_ebim-control-plane` (por defecto) o `DEMO_DB_URL`, que
  solo se acepta con host `localhost` / `127.0.0.1` / `::1`. Cualquier otro host o contenedor aborta.
  El SQL vuelve a comprobarlo dentro de la base (fixtures del seed local y dirección del servidor).
- **Idempotente:** `load` ejecuta `demo-unload.sql` + `demo-data.sql` en **una sola transacción**:
  recargar es borrar y regenerar, con UUID deterministas. Si algo falla, se revierte todo.
- **Después de `supabase db reset --local`** hay que volver a cargarlo.
- **pgTAP:** `supabase test db` se corre sobre la base recién reseteada (sin demo), o tras `unload`.
- **Fechas relativas al mes en curso** (M0 = mes actual, M-18 … M0): el dataset no envejece; si se
  recarga otro mes, la historia se desplaza con él.

## Archivos

| Archivo                                     | Qué hace                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `demo-data.sql`                             | Genera el dataset (guardas, datos declarativos, motor y verificación final).              |
| `demo-unload.sql`                           | Borra solo lo marcado como demo y lo que cuelga de ello.                                  |
| `demo-verify.sql`                           | Informe de solo lectura: MRR mensual, facturado vs cobrado, % de cobro, cartera, conteos. |
| `load-demo-data.sh` / `unload-demo-data.sh` | Entradas con guard de host local.                                                         |
| `_demo-db.sh`                               | Guard y ejecución de `psql` compartidos.                                                  |

## Qué genera

| Área              | Contenido                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mercados          | PE (PEN/USD), BO (BOB/USD), EC (USD). Tasas DEMO USD→PEN/BOB el 1.º de cada mes (M-24 … M0), `is_demo`, nota `DEMO gerencia-v4`.                                                                                                                                                                                                          |
| Catálogo          | Plan _Business_ (SHARED) para los 8 productos y _Enterprise_ (TENANT_DEDICATED) para GMAO y TMS, con tarifas por mercado y moneda. Destinos compartidos para los 6 productos que no tenían, y 2 exclusivos.                                                                                                                               |
| Canal             | 4 partners: Andes Digital (PE), Altiplano Tecnología (BO, reseller), Costa Cloud (EC) — factura EBIM con margen 18–22 % — y Nexo Integradores (PE), que factura él mismo y paga a EBIM una **tarifa de plataforma** del 30 % de la lista desde M-6.                                                                                       |
| Comerciales       | 6: 2 internos EBIM (3 % de todo cobro), 1 independiente (10 % licencia 12 meses + 5 % implementación) y 3 de partner (6 % recurrente). Usan los planes de comisión del seed.                                                                                                                                                              |
| Clientes          | 48 empresas ficticias (25 PE, 12 BO, 11 EC) con sector, sociedad, datos de facturación `@ebim.test`.                                                                                                                                                                                                                                      |
| Contratos         | 83 suscripciones (1 tenant cada una) con altas escalonadas desde M-24, 11 expansiones de usuarios, 3 contracciones, **7 bajas en 5 clientes** y 2 altas en el mes en curso. 3 tenants TRIAL en evaluación.                                                                                                                                |
| Facturación       | Emitida con `issue_subscription_invoice` (motor de cadencia real: licencia mensual, implementación una sola vez) para M-18 … M0, el 1.º de cada mes con vencimiento a 15 días.                                                                                                                                                            |
| Cobros            | `confirm_manual_payment`: la mayoría puntuales (3–14 días; tarjeta Culqi MOCK en 1–3 días), algunos tardíos (30–75 días), un cliente que paga en dos partes y 5 morosos que dejan de pagar desde M-6, M-5, M-4, M-3 y M-2.                                                                                                                |
| Comisiones        | Devengadas por el trigger de cobros. Liquidaciones trimestrales **PAGADAS** hasta el trimestre anterior; el trimestre anterior queda **ABIERTO** para Lucía Paredes (USD); lo reciente queda ELEGIBLE.                                                                                                                                    |
| Costos            | USD por producto (BD, cómputo, soporte, inferencia IA), plataforma (hosting, mensajería, dominios) e infraestructura exclusiva; solo meses cerrados (el costo se reconoce al cierre).                                                                                                                                                     |
| Uso y créditos IA | Manifest `demo-gerencia-v4` (eSupplier: copiloto y OCR; EWM: pronóstico), medidores, pesos y políticas DEMO; 8 tenants con eventos M-6 … M0 ingeridos con `ingest_usage_events`, cerrados y finalizados (consumo en el ledger); un bono comercial. Exceden su cupo Minera Cordillera Negra (ALLOW) y, un mes, Industrias Illampu (BLOCK). |
| Cobranza          | 2 enlaces de pago (`create_payment_link`); alertas de `refresh_billing_alerts` (las que el refresco genere fuera de la demo se revierten); estados de cuenta de Nexo: M-2 emitido y cobrado, M-1 en borrador.                                                                                                                             |
| Bitácora          | Las entradas que escriben las RPCs se fechan con la fecha de negocio y se etiquetan.                                                                                                                                                                                                                                                      |

Los datos maestros (organizaciones, tenants, contratos, ítems) se insertan directamente — como hace el
seed — porque las RPCs de alta fechan hoy y encolan provisioning; todos los triggers de negocio siguen
activos. Los flujos (facturar, cobrar, devengar, liquidar, uso, créditos, tarifa de partner, enlaces)
pasan por las RPCs reales.

## Marcas (cómo se reconoce y se borra)

- `metadata ->> 'demo' = 'gerencia-v4'` en organizaciones, tenants, suscripciones, planes, facturas,
  comerciales, destinos, costos, mappings y bitácora.
- `notes LIKE 'DEMO gerencia-v4%'` en tasas de cambio; `manifest_version = 'demo-gerencia-v4'` en capacidades.
- Todo lo demás (cobros, comisiones, liquidaciones, alertas, enlaces, estados de cuenta, uso, ledger) se
  borra por su relación con lo anterior.

Uso, agregados, ledger de créditos, mappings y eventos de enlaces son append-only por diseño. La descarga
desactiva **esos triggers concretos** dentro de su transacción y los reactiva al final; si algo falla,
el ROLLBACK los deja como estaban. Es una operación de desarrollo local, nunca de un entorno compartido.

## Cifras de referencia (carga del 2026-10-05)

| Indicador                                     | Valor                                                                                                                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MRR demo (USD equiv.)                         | 14.084 (abr-25) → 29.890 (oct-25) → 41.065 (abr-26) → 50.082 (oct-26)                                                                                                                                                                  |
| % de cobro de lo facturado, 12 meses cerrados | 94,4 %                                                                                                                                                                                                                                 |
| Cartera vencida (USD equiv.)                  | 1–30: 18.350 · 31–60: 3.907 · 61–90: 3.165 · 90+: 5.099                                                                                                                                                                                |
| Volumen                                       | 48 clientes · 4 partners · 6 comerciales · 86 tenants · 83 contratos (7 bajas) · 910 facturas · 832 cobros · 946 comisiones · 51 liquidaciones (50 pagadas, 1 abierta) · 571 costos · 450 eventos de uso · 135 movimientos de créditos |
| Margen bruto aproximado                       | costos ≈ 10,5 k USD/mes frente a ≈ 52 k USD facturados (≈ 80 %)                                                                                                                                                                        |

**Ojo con el MRR total del mes en curso:** los ítems del seed base nacen con `valid_from` = fecha del
reset, así que una serie histórica por ítems ve aparecer todo el MRR del seed ese día (55,7 k → 80,6 k
USD). Es una propiedad del seed, no de la demo.
