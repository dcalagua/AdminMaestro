# QUALITY GATE V3

Última actualización: fase 17. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 17) | 34 migraciones + seed V2 + seed V3 regional (verificación SEED V3 OK) |
| pgTAP | PASS (fase 17) | 18 ficheros, 378/378 sobre el seed regional |
| unit | PASS (fase 15) | 7 ficheros, 91/91 |
| typecheck | PASS (fase 17) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 17) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | PASS (fase 16) | `npm run secrets:scan` → SECRETS_SCAN: PASS |
| E2E | PASS (fase 17) | `playwright test` 60/60 PASS en dos ejecuciones consecutivas sin reset, 0 skips (smoke 21 + v2-journeys 20 + v3-regional 14 + v3-regional-journeys 5) |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
