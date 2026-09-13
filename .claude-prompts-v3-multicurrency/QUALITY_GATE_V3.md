# QUALITY GATE V3

Última actualización: fase 13. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 11) | 32 migraciones + seed |
| pgTAP | PASS (fase 11) | 15 ficheros, 311/311 |
| unit | PASS (fase 13) | 6 ficheros, 84/84 |
| typecheck | PASS (fase 13) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 13) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | PASS (fase 13, parcial de V3) | `playwright test` suite completa 55/55 PASS, 0 skips (smoke + v2-journeys + v3-regional R1–R6). Journeys regionales completos pendientes de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
