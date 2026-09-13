# QUALITY GATE V3

Última actualización: fase 08. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 08) | 29 migraciones + seed |
| pgTAP | PASS (fase 08) | 12 ficheros, 255/255 |
| unit | PASS (fase 07) | 5 ficheros, 66/66 |
| typecheck | PASS (fase 08) | tras `db:types`; `deno check` adapter de pagos OK (fase 06); `deno check culqi-webhook` no ejecutable en local por dependencias npm |
| lint | PASS (fase 07) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | PARCIAL (fase 04) | `v2-journeys` J1, J2 y J10–J14 PASS (10 tests, filtro `-g "J2|J1"`, 2.ª ejecución; la 1.ª tras `db reset` falló por arranque en frío de la sesión). Fase 05: `v3-regional.spec.ts` 6/6 PASS. Fase 07: R3 + J7, J8, J9 6/6 PASS. Suite completa pendiente de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
