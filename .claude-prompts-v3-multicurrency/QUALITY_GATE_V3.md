# QUALITY GATE V3

Última actualización: fase 05. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 04) | 26 migraciones + seed |
| pgTAP | PASS (fase 04) | 9 ficheros, 185/185 |
| unit | PASS (fase 04) | 5 ficheros, 66/66 |
| typecheck | PASS (fase 04) | tras `db:types` |
| lint | PASS (fase 04) | `eslint .` exit 0 |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | PARCIAL (fase 04) | `v2-journeys` J1, J2 y J10–J14 PASS (10 tests, filtro `-g "J2|J1"`, 2.ª ejecución; la 1.ª tras `db reset` falló por arranque en frío de la sesión). Fase 05: `v3-regional.spec.ts` 6/6 PASS. Suite completa pendiente de fase 17 |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
