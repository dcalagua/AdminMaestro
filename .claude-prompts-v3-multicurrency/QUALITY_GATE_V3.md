# QUALITY GATE V3

Última actualización: fase 98 (auditoría final). Todos los gates se ejecutaron DE NUEVO el
2026-09-13 entre 09:34:34Z y 09:36:12Z; salidas completas en `docs/nightly-v3/evidence/`.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 98) | `npm run db:reset`: 35 migraciones + seed V2 + seed V3 (verificación SEED V3 sin excepción) · `evidence/01_db_reset.log` |
| pgTAP | PASS (fase 98) | `npm run db:test`: 18 ficheros, 380/380 · `evidence/02_db_test.log` |
| unit | PASS (fase 98) | `npm test`: 7 ficheros, 91/91 · `evidence/03_unit.log` |
| typecheck | PASS (fase 98) | `npm run typecheck` exit 0 · `evidence/04_typecheck.log` |
| lint | PASS (fase 98) | `npm run lint` exit 0 · `evidence/05_lint.log` |
| build | PASS (fase 98) | `npm run build` (typecheck + vite build) exit 0 · `evidence/06_build.log` |
| secrets scan | PASS (fase 98) | `npm run secrets:scan` PASS (repo + bundle) · `evidence/07_secrets_scan.log` |
| E2E | PASS (fase 98) | `npm run e2e`: 60/60, 0 skips, 0 flaky (smoke 21 · v2-journeys 20 · v3-regional 14 · v3-regional-journeys 5) · `evidence/08_e2e.log` |
| baseline migrations intact | PASS (fase 98) | `shasum -a 256 -c docs/nightly-v3/BASELINE_MIGRATIONS.sha256` → 23/23 OK |
| multicurrency audit | PASS (fase 01 + 98) | `MULTICURRENCY_BASELINE.md`, `GAP_MATRIX_MULTICURRENCY.md` (G-01..G-33 cerrados) y §3 del informe final |
| deno check (opcional) | PARCIAL | adapter `_shared/payments` PASS (fase 06); `culqi-webhook` no ejecutable en local por resolución npm de supabase-js |
| sin remoto | PASS (fase 98) | `dev...origin/dev [ahead N]`, sin `supabase/.temp/project-ref`, sin push/link |
