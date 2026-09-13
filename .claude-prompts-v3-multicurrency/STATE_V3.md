# STATE V3

Status: IN_PROGRESS
Current phase: 06

HEAD inicial V3: `1c6b5ce chore: checkpoint before V3 multicurrency`
Checksums baseline: `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` (23 migraciones)

| Phase | Status | Evidence |
|---|---|---|
| 01 Baseline | COMPLETE | `docs/nightly-v3/MULTICURRENCY_BASELINE.md`, `GAP_MATRIX_MULTICURRENCY.md` (G-01..G-33). Sin cambios funcionales. Gates de partida: db reset OK, pgTAP 124/124, unit 54/54 |
| 02 Currencies/Markets | COMPLETE | Migración 24 `20260913000100_v3_currencies_markets.sql`; FK de 16 columnas `currency`; pgTAP `06_v3_currencies_markets` 22 tests; suite 146/146; typecheck PASS |
| 03 Regional Companies | COMPLETE | Migración 25 `20260913000200_v3_regional_companies.sql` (`companies.market_id`, guard país/moneda, `upsert_company` sin PE/PEN, `v_company_markets`); seed EBIM Perú/Bolivia/Ecuador bajo la org PLATFORM; pgTAP `07_v3_regional_companies` 13 tests; suite 159/159; typecheck PASS; columna «Mercado» en Sociedades |
| 04 Regional Pricing | COMPLETE | Migración 26 `20260913000300_v3_regional_pricing.sql`: `plan_prices.market_id` (legacy NULL, DV3-006), índice vigente por mercado, exclusión GiST de solapes, guard de inmutabilidad, `current_plan_price`/`set_plan_price` con mercado (firmas V2 eliminadas), `v_plan_price_catalog`, `subscriptions.market_id` (DV3-007), `create_subscription` y `onboard_customer_subscription` regionales. Seed: tarifas PE/USD. pgTAP `08_v3_regional_pricing` 26 tests; suite 185/185; unit 66/66 (`regional.test.ts` 12); typecheck y lint PASS; E2E J1, J2, J10–J14 PASS (J2 actualizado a mercado/moneda) |
| 05 Onboarding | COMPLETE | Flujo cliente → mercado (sugerido por país, DV3-005) → moneda sugerida/admitida (`<select>`, sin textbox) → plan (rotulado «sin tarifa MKT/CUR») → tarifa regional → suscripción. Sin tarifa regional el paso 3 no avanza; fee de implementación en la moneda contractual con la tarifa regional como sugerencia. La RPC regional se implementó en la migración 26 (fase 04). Unit `regional.test.ts` 12/12; E2E `v3-regional.spec.ts` R1 (5) + R1b (1) PASS |
| 06 Currency Hardening | PENDING | |
| 07 Payment Routing | PENDING | |
| 08 FX Engine | PENDING | |
| 09 Reporting Currency | PENDING | |
| 10 Consolidated Finance | PENDING | |
| 11 Commissions | PENDING | |
| 12 UI | PENDING | |
| 13 Dashboard | PENDING | |
| 14 Seeds | PENDING | |
| 15 Domain Tests | PENDING | |
| 16 Security/RLS | PENDING | |
| 17 E2E Regional | PENDING | |
| 18 Documentation | PENDING | |
| 98 Final Audit | PENDING | |
