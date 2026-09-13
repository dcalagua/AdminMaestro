# Informe final · EBIM Control Plane V3 Multicurrency

> Fecha: 2026-09-13. Rama `dev`, local. HEAD inicial V3: `1c6b5ce chore: checkpoint before V3 multicurrency`.
> Gates finales ejecutados de nuevo entre `2026-09-13T09:34:34Z` y `09:36:12Z` sobre `a6f05ff` +
> la remediación de la auditoría final (migración 35 y dos ajustes de UI), que se consolida en el
> commit `chore(v3-98)`. Salidas completas en `docs/nightly-v3/evidence/`.

## 1. Veredicto

**GO_QAS_CANDIDATE** (y GO_LOCAL).

Los 8 gates locales pasan en ejecución fresca, las 23 migraciones baseline están intactas, no hay
push ni cambios remotos y todos los puntos de la Definition of Done se cumplen con evidencia
(§4). Aplicar en QAS requiere autorización explícita del operador y **no** se ha hecho. Las
observaciones de §6 son límites de diseño documentados o comprobaciones opcionales, no bloqueantes.

## 2. Gates finales (ejecución fresca)

| Gate | Comando | Resultado | Evidencia |
|---|---|---|---|
| DB reset | `npm run db:reset` | **PASS** · 35 migraciones + seed V2 + seed V3 (verificación `SEED V3` sin excepción) | `evidence/01_db_reset.log` |
| pgTAP | `npm run db:test` | **PASS** · 18 ficheros, **380/380** | `evidence/02_db_test.log` |
| Unit | `npm test` | **PASS** · 7 ficheros, **91/91** | `evidence/03_unit.log` |
| Typecheck | `npm run typecheck` | **PASS** · exit 0 | `evidence/04_typecheck.log` |
| Lint | `npm run lint` | **PASS** · exit 0 | `evidence/05_lint.log` |
| Build | `npm run build` | **PASS** · `vite build` en 1.04 s | `evidence/06_build.log` |
| Secrets scan | `npm run secrets:scan` | **PASS** · «sin credenciales detectadas en el repositorio ni en el bundle» | `evidence/07_secrets_scan.log` |
| E2E | `npm run e2e` | **PASS** · **60/60**, 0 skips, 0 flaky (smoke 21 · v2-journeys 20 · v3-regional 14 · v3-regional-journeys 5) | `evidence/08_e2e.log` |

Además, durante la fase 17 la suite E2E completa pasó 60/60 en **dos ejecuciones consecutivas sin
`db:reset`** (repetible).

## 3. Auditoría final (checklist de `98_FINAL_AUDIT.md`)

### 3.1 Diff contra el HEAD inicial

`git diff --stat 1c6b5ce HEAD`: 116 archivos, +13 679 / −364 (antes de la remediación de §3.4).
En `supabase/migrations` solo hay **altas** (`A`): ningún archivo existente modificado.

### 3.2 Migraciones baseline intactas

`shasum -a 256 -c docs/nightly-v3/BASELINE_MIGRATIONS.sha256` → **23/23 OK**. Total en disco: 35 (23 + 12 V3).

### 3.3 Migraciones V3 y su responsabilidad

| # | Archivo | Responsabilidad |
|---|---|---|
| 24 | `20260913000100_v3_currencies_markets.sql` | Catálogo de monedas y mercados; FK de las 16 columnas `currency` |
| 25 | `20260913000200_v3_regional_companies.sql` | Sociedades con mercado; EBIM Perú/Bolivia/Ecuador |
| 26 | `20260913000300_v3_regional_pricing.sql` | Tarifas por mercado, sin solapes ni edición; venta y contrato regionales |
| 27 | `20260913000400_v3_transaction_currency.sql` | Cadena de moneda contractual; defaults retirados |
| 28 | `20260913000500_v3_regional_payment_routing.sql` | Cuentas por mercado/moneda; routing en servidor |
| 29 | `20260913000600_v3_fx_engine.sql` | Tipos de cambio MANUAL auditables |
| 30 | `20260913000700_v3_reporting_currency.sql` | Moneda de reporte y contrato nativo/reporte |
| 31 | `20260913000800_v3_consolidated_finance.sql` | Vistas nativas corregidas; consolidado con completitud FX |
| 32 | `20260913000900_v3_multicurrency_commissions.sql` | Comisiones en moneda de origen; liquidación mono-moneda |
| 33 | `20260913001000_v3_security_hardening.sql` | Grants mínimos (H-1..H-3) |
| 34 | `20260913001100_v3_subscription_invoicing.sql` | Factura gerencial del periodo (habilita journeys) |
| 35 | `20260913001200_v3_organization_country_required.sql` | Sin país implícito en organizaciones (remediación de esta auditoría) |

### 3.4 Defaults `USD`/`PEN` en DB y TS

Consulta a `information_schema.columns`, `pg_get_function_arguments`, `prosrc` y `pg_get_viewdef`
sobre la base local, y `rg` sobre `src/` y `supabase/functions/`:

| Hallazgo | Clasificación | Acción |
|---|---|---|
| Columnas `currency` con default | Ninguna (retiradas en 27 y 28) | — |
| `organizations.country_code default 'PE'` + `upsert_organization(p_country_code default 'PE')` | **Peligroso** en V3: el país sugiere mercado y moneda de la venta | **Corregido** en migración 35 (`PAIS_REQUERIDO`) + formulario sin «PE» por defecto; 2 tests pgTAP nuevos |
| Literales `USD/PEN/BOB` en cuerpos de funciones y vistas | Ninguno | — |
| `ExchangeRatesPanel` publicaba con base `USD` preseleccionada | Peligroso menor (una escritura con par preelegido) | **Corregido**: base vacía obligatoria |
| `ExchangeRatesPanel` probador de conversión con `PEN→USD` | Válido: solo lectura, sin escritura | Se mantiene |
| Catálogo inicial `PEN/BOB/USD`, mercados `PE/BO/EC`, `reporting_currency = USD` | Válido: configuración sembrada, ninguna función lo asume | Documentado (DV3-013) |
| Edge Functions (`?account=culqi-pe-test`, `currency ?? 'PEN'`) | Eran peligrosos | Corregidos en fases 06 y 07 |

### 3.5 `SUM(` sobre importes

Revisadas todas las vistas y funciones vigentes con `sum(`: `v_subscription_mrr` (por suscripción),
`v_product_margin`/`v_partner_margin`/`v_tenant_margin` (por entidad y moneda), `v_product_finance`
(join por moneda), `v_partner_finance` (filtro por moneda), `v_partner_agreements` (NULL si varias
monedas + mapa), `v_finance_reconciliation` (por factura), `dashboard_summary` (por moneda; escalares
NULL si varias), `finance_reporting_rows`/`finance_consolidated` (por moneda antes de convertir;
luego suma de equivalentes en una misma moneda de reporte), `generate_commission_events` (tope
filtrado por moneda), `recalc_invoice_totals`/`sync_invoice_payment_status`/`confirm_manual_payment`/
`refresh_billing_alerts`/`resolve_alerts_on_payment` (dentro de una factura, mono-moneda por la
cadena), `recalc_settlement_total` (liquidación mono-moneda por guard). En el frontend los únicos
`reduce` restantes suman dentro de una suscripción o factura; todo total multi-fila usa `sumByCurrency`.
**Ninguna suma cruza monedas.**

### 3.6 SECURITY DEFINER, `search_path` y grants

- Toda RPC de escritura V3 es SECURITY DEFINER con `search_path = platform, pg_catalog` y autoriza en
  su primera línea (test estructural + negativos por rol en `16_v3_security_rls`).
- Lecturas de tarifa, FX, routing y reporting son SECURITY INVOKER (respetan RLS del llamante).
- `anon` no ejecuta ninguna función de `platform`; ninguna función de trigger concede EXECUTE a
  `authenticated`; `generate_commission_events` solo trigger y `service_role`.
- Detalle: `docs/security/V3_MULTICURRENCY_SECURITY_AUDIT.md`.

### 3.7 Vistas

Las 10 vistas creadas o redefinidas en V3 tienen `security_invoker = true` (test explícito) y el test
global `00_structure` verifica todas las vistas de `platform`.

### 3.8 Secrets

`npm run secrets:scan` PASS (repositorio y bundle, tras el build). `src/` solo menciona `service_role`
en comentarios que lo prohíben. Los logs de `evidence/` se revisaron: sin tokens ni claves.

### 3.9 Sin cambios remotos

- `git status -sb` → `dev...origin/dev [ahead 19]`: nada publicado.
- No existe `supabase/.temp/project-ref`: el proyecto no está enlazado; ningún `db push` ni `link`.
- Ningún cambio en QAS/PRD. Culqi LIVE no se usó; no se repitió la integración Culqi TEST.

### 3.10 Provisioning / APIs SaaS fuera de alcance

`git diff --name-only 1c6b5ce HEAD -- supabase/functions` → solo `_shared/payments/index.ts`
(sin `PEN` implícito) y `culqi-webhook/index.ts` (`?account=` obligatorio). `provisioning-worker`
sin cambios; provisioning sigue en DRY_RUN; ninguna API hacia eSupplier/WMS/TMS/GMAO/eChange.

## 4. Definition of Done

| Criterio | Estado | Evidencia |
|---|---|---|
| 23 migraciones baseline intactas | ✅ | §3.2 |
| Catálogo `currencies` | ✅ | Migración 24 · pgTAP 06 |
| Mercados PE/BO/EC | ✅ | Migración 24 · pgTAP 06 |
| PE: PEN default + USD | ✅ | pgTAP 06 · unit `regional.test.ts` |
| BO: BOB default + USD | ✅ | pgTAP 06 · E2E R1 |
| EC: USD default | ✅ | pgTAP 06 · E2E R1 |
| EBIM Perú/Bolivia/Ecuador como sociedades | ✅ | Migración 25 · seed · pgTAP 07 |
| Pricing distingue mercado con misma moneda | ✅ | pgTAP 08, 15 · E2E D |
| Onboarding usa mercado + moneda admitida + tarifa regional | ✅ | Migración 26 · E2E R1, A, B, C |
| Suscripción/líneas/factura/pago protegen la moneda contractual | ✅ | Migración 27 · pgTAP 09, 15 |
| Payment routing valida mercado/moneda | ✅ | Migración 28 · pgTAP 10, 15 · E2E R3 |
| FX engine auditable | ✅ | Migración 29 · pgTAP 11 |
| FX source inicial MANUAL | ✅ | Enum `fx_rate_source = MANUAL` · pgTAP 11 |
| Reporting currency configurable | ✅ | Migración 30 · pgTAP 12 · E2E R4 |
| Importes nativos nunca se reescriben | ✅ | pgTAP 12, 13, 15 (hash de facturas, cobros y comisiones) |
| Dashboards no suman monedas sin FX | ✅ | Migración 31 · pgTAP 13 · unit R-7 · E2E R5/R6 |
| Consolidado expone FX faltante | ✅ | `missing_fx_count` · pgTAP 13 · E2E E |
| Comisiones conservan moneda original | ✅ | Migración 32 · pgTAP 14, 17 · E2E A (PEN 315), B (BOB 354) |
| Settlements mono-moneda | ✅ | pgTAP 14, 15 |
| UI con selectores controlados de mercado/moneda | ✅ | Fases 04, 05, 12 · E2E R1, R1b |
| Seeds regionales PE/BO/EC | ✅ | `SEED V3` con verificación · `DEMO_SCENARIOS_V3.md` |
| RLS/grants/SECURITY DEFINER auditados | ✅ | Migración 33 · pgTAP 16 · informe de seguridad |
| pgTAP PASS | ✅ | 380/380 |
| Unit PASS | ✅ | 91/91 |
| E2E regional PASS sin skips locales | ✅ | 60/60, 0 skips |
| Typecheck PASS | ✅ | exit 0 |
| Lint PASS | ✅ | exit 0 |
| Build PASS | ✅ | exit 0 |
| Secrets scan PASS | ✅ | PASS |
| Sin push ni cambios remotos | ✅ | §3.9 |
| Sin APIs de SaaS/provisioning en V3 | ✅ | §3.10 |
| Docs V3 actualizadas | ✅ | Fase 18 |
| Este informe con evidencia | ✅ | `docs/nightly-v3/FINAL_REPORT_V3_MULTICURRENCY.md` + `evidence/` |

## 5. Defectos previos encontrados y corregidos

| Defecto | Impacto | Corrección |
|---|---|---|
| `upsert_payment_provider_account` nunca completaba: auditaba `has_secret_ref` y el guard anti-secretos lo rechaza | No se podían crear cuentas de cobro por RPC | DV3-011 |
| `settle_commissions` usaba un código sin moneda y reabría liquidaciones PAGADAS | Liquidaciones mezcladas y pagos alterados | DV3-015 |
| `generate_commission_events` ejecutable por cualquier usuario | Devengo disparable fuera del cobro | DV3-019 |
| `formatDate('YYYY-MM-DD')` pintaba el día anterior en UTC−5 | Fechas de calendario erróneas en toda la consola | DV3-017 |
| Márgenes nativos perdían costos/comisiones en moneda distinta al ingreso | Margen sobreestimado | DV3-014 |

## 6. Observaciones (no bloqueantes)

1. **`deno check` de `culqi-webhook`** no se pudo ejecutar localmente (falla la resolución npm de
   `supabase-js`, ajena al cambio). El adapter `_shared/payments/index.ts` sí pasó `deno check`. El
   cambio en el webhook es de 4 líneas y sin dependencias nuevas. No es uno de los gates exigidos.
2. **Tasas DEMO con fecha fija (2026-09-01).** Con la tolerancia de 31 días, a partir del 2026-10-03
   el consolidado por defecto se mostrará «incompleto» hasta que finanzas publique tasas: es el
   comportamiento correcto. Los E2E fijan la fecha de las tasas.
3. **Criterio de conversión:** tasa de cierre a la fecha del reporte para todo el periodo (lente
   gerencial, no revalorización contable).
4. **Reglas de comisión con importe fijo o tope** no devengan sobre cobros en otra moneda: se debe
   definir una regla por moneda (DV3-015).
5. **Factura gerencial del periodo** (`issue_subscription_invoice`) es una capacidad añadida para
   que los journeys A–C sean ejecutables de punta a punta; no es un comprobante fiscal (DV3-020).
6. **País de la organización** sigue siendo texto ISO de 2 letras (sin catálogo de países); ahora es
   obligatorio.
7. Una ejecución E2E de la fase 04, justo tras `db reset`, falló por arranque en frío de la sesión;
   no se reprodujo en ninguna de las ejecuciones posteriores (incluidas las finales).
8. `.claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh` y `logs/` tenían cambios previos a esta
   ejecución: no se tocaron ni se incluyeron en commits.

## 7. Trazabilidad

- Commits: uno por fase, `docs(v3-01)` … `docs(v3-18)` y `chore(v3-98)`.
- Estado por fase: `.claude-prompts-v3-multicurrency/STATE_V3.md`.
- Gates: `.claude-prompts-v3-multicurrency/QUALITY_GATE_V3.md`.
- Decisiones: `.claude-prompts-v3-multicurrency/DECISIONS_V3.md` (DV3-001 … DV3-021).
- Resumen técnico: `docs/nightly-v3/IMPLEMENTATION_SUMMARY.md`.
