# STATE V3

Status: IN_PROGRESS
Current phase: 04

HEAD inicial V3: `1c6b5ce chore: checkpoint before V3 multicurrency`
Checksums baseline: `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` (23 migraciones)

| Phase | Status | Evidence |
|---|---|---|
| 01 Baseline | COMPLETE | `docs/nightly-v3/MULTICURRENCY_BASELINE.md`, `GAP_MATRIX_MULTICURRENCY.md` (G-01..G-33). Sin cambios funcionales. Gates de partida: db reset OK, pgTAP 124/124, unit 54/54 |
| 02 Currencies/Markets | COMPLETE | Migración 24 `20260913000100_v3_currencies_markets.sql`; FK de 16 columnas `currency`; pgTAP `06_v3_currencies_markets` 22 tests; suite 146/146; typecheck PASS |
| 03 Regional Companies | COMPLETE | Migración 25 `20260913000200_v3_regional_companies.sql` (`companies.market_id`, guard país/moneda, `upsert_company` sin PE/PEN, `v_company_markets`); seed EBIM Perú/Bolivia/Ecuador bajo la org PLATFORM; pgTAP `07_v3_regional_companies` 13 tests; suite 159/159; typecheck PASS; columna «Mercado» en Sociedades |
| 04 Regional Pricing | PENDING | |
| 05 Onboarding | PENDING | |
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
