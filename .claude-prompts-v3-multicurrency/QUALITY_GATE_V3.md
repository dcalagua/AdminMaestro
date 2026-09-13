# QUALITY GATE V3

Última actualización: fase 11. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 11) | 32 migraciones + seed |
| pgTAP | PASS (fase 11) | 15 ficheros, 311/311 |
| unit | PASS (fase 09) | 5 ficheros, 67/67 |
| typecheck | PASS (fase 11) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 09) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | PARCIAL (fase 04) | `v2-journeys` J1, J2 y J10–J14 PASS (10 tests, filtro `-g "J2|J1"`, 2.ª ejecución; la 1.ª tras `db reset` falló por arranque en frío de la sesión). Fase 05: `v3-regional.spec.ts` 6/6 PASS. Fase 07: R3 + J7, J8, J9 6/6 PASS. Fase 09: R4 2/2 PASS. Suite completa pendiente de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
