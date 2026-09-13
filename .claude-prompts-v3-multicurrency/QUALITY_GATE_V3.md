# QUALITY GATE V3

Última actualización: fase 16. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 16) | 33 migraciones + seed V2 + seed V3 regional (verificación SEED V3 OK) |
| pgTAP | PASS (fase 16) | 17 ficheros, 369/369 sobre el seed regional |
| unit | PASS (fase 15) | 7 ficheros, 91/91 |
| typecheck | PASS (fase 16) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 15) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | PASS (fase 16) | `npm run secrets:scan` → SECRETS_SCAN: PASS |
| E2E | PASS (fase 14, parcial de V3) | `playwright test` suite completa 55/55 PASS, 0 skips, sobre el seed regional. Journeys regionales completos pendientes de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
