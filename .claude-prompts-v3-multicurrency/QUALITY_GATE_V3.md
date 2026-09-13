# QUALITY GATE V3

Última actualización: fase 03. Solo se marca PASS con salida de comando ejecutada en la fase indicada.

| Gate | Result | Evidence |
|---|---|---|
| db reset | PASS (fase 03) | 25 migraciones + seed |
| pgTAP | PASS (fase 03) | 8 ficheros, 159/159 |
| unit | PASS (fase 01, baseline) | 4 ficheros, 54/54 |
| typecheck | PASS (fase 03) | tras `db:types` |
| lint | NOT_RUN | |
| build | NOT_RUN | |
| secrets scan | NOT_RUN | |
| E2E | NOT_RUN | |
| baseline migrations intact | PASS (fase 01) | checksums en `docs/nightly-v3/BASELINE_MIGRATIONS.sha256` |
| multicurrency audit | PASS (fase 01) | `docs/nightly-v3/MULTICURRENCY_BASELINE.md` + `GAP_MATRIX_MULTICURRENCY.md` |
