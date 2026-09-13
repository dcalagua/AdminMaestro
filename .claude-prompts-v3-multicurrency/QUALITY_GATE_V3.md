# QUALITY GATE V3

Última actualización: fase 14. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 14) | 32 migraciones + seed V2 + seed V3 regional (verificación SEED V3 OK) |
| pgTAP | PASS (fase 14) | 15 ficheros, 311/311 sobre el seed regional |
| unit | PASS (fase 13) | 6 ficheros, 84/84 |
| typecheck | PASS (fase 13) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 13) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | PASS (fase 14, parcial de V3) | `playwright test` suite completa 55/55 PASS, 0 skips, sobre el seed regional. Journeys regionales completos pendientes de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
