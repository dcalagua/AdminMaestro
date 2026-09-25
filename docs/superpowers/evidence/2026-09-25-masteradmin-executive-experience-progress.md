# Ledger — MasterAdmin experiencia ejecutiva (corrida local 2026-09-25)

Reanudación tras compactar contexto: leer este archivo y continuar en la primera tarea no DONE.

## Identidad

| Campo | Valor |
|---|---|
| ROOT | `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin` |
| WORKTREE | `ROOT/.worktrees/executive-experience` |
| BRANCH | `feat/masteradmin-executive-experience-20260925-0042` |
| BASE_HEAD | `e2ad6963b2e2d5ca4ffa3fda46c5c6766bcff613` (dev local = origin/dev, 0/0 divergencia) |
| Checkout principal | rama `dev`, sin tocar. Dirty preexistente ajeno: `.claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh`, `docs/quality/vscode-problems*`, `logs/`, `supabase/functions/*/deno.lock`, `.overnight-executive-20260925/`. |
| Otros worktrees | `.worktrees/ewm-adapter` (docs/multi-app-provisioning-readiness) — ajeno, sin tocar. |

## Delta frente al ZIP auditado

Sin delta estructural relevante: 108 TS/TSX en `src`, 32 `*Page.tsx`, 45 migraciones (la última
`20260925000100_precise_secret_key_rule.sql`). Los paths de la spec (Anexo A/C) existen tal cual.

## Runtime local dedicado (T02)

| Recurso | Valor |
|---|---|
| Supabase workdir | `.runtime/` (autoignorado con `.runtime/.gitignore`), `project_id = ebim-exec-exp` |
| API / DB | `127.0.0.1:55421` / `127.0.0.1:55422` (shadow 55420, mail local 55424) |
| Servicios desactivados | studio, analytics/vector, storage, realtime, edge runtime, imgproxy, pooler |
| Frontend de pruebas | `127.0.0.1:5209` (`playwright.executive.config.ts`, `reuseExistingServer: false`) |
| `.env.local` | apunta sólo al stack dedicado; no copiado del checkout principal |
| Stacks ajenos | `ebim-control-plane` (544xx) y `fieldops` (563xx) siguen corriendo; no se tocaron |
| Revisión SQL previa | sin `pg_net`/`http`/cron activos; el cron de `billing_alerts` está sólo comentado; seed usa `*.example.invalid` |
| Red en navegador | `e2e/executive/support.ts` aborta todo host no local; DM Sans (OFL) servido desde `.runtime/fonts` |
| Toolchain | Node 24.20.0, npm 11.19.0, Supabase CLI 2.116.0, Docker 29.7.2, Playwright chromium-1243 |

Limitaciones del sandbox registradas (una vez): socket Docker y `listen` en puertos locales requieren
ejecutar esos comandos fuera del sandbox del agente. No se modificaron permisos.

## Baseline (T03) — HEAD `e2ad696`, 2026-09-25T05:45Z

| Gate | Comando | Resultado | Log |
|---|---|---|---|
| typecheck | `npm run typecheck` | PASS (0) | `.runtime/logs/baseline/typecheck.log` |
| lint | `npm run lint` | PASS (0) | `.runtime/logs/baseline/lint.log` |
| vitest | `npm test` | PASS 29 archivos / 598 tests | `.runtime/logs/baseline/test.log` |
| build | `npm run build` | PASS (0) | `.runtime/logs/baseline/run_build.log` |
| secrets | `npm run secrets:scan` | PASS | `.runtime/logs/baseline/run_secrets_scan.log` |
| pgTAP | `supabase test db --workdir .runtime` | PASS 25 archivos / 809 tests (incluye `24_secret_key_rule`) | `.runtime/logs/baseline/pgtap.log` |
| captura | `CAPTURE_SET=before npx playwright test -c playwright.executive.config.ts capture` | 89 capturas, 0 hosts remotos; overflow horizontal sólo P22 @390 | `screenshots/before/index.json` |

Hashes de archivos protegidos: `docs/superpowers/evidence/executive-experience/protected-baseline.sha256`
(supabase/functions, migrations, tests, seed, config, e2e, tests de `src/lib`).

## Tareas

| Tarea | Estado | Commit | Prueba | Evidencia | Próximo paso |
|---|---|---|---|---|---|
| T01 aislar | DONE | 778c3fb | — | este ledger, plan, spec, aprobación | T02 |
| T02 entorno | DONE | 778c3fb | stack arriba, env local | tabla runtime | T03 |
| T03 baseline | DONE | 778c3fb | tabla baseline | logs + capturas before | T04 |
| T13a lecturas SQL | DONE | a3ed009 | pgTAP `25_executive_read_models` (32) RED→GREEN; suite 26/841 PASS | migración `20260925100000_executive_read_models.sql` (con rollback en cabecera) | UI T13 |
| T04 contratos | DONE | 9be746e | `executive-contracts.test.ts` 20 (RED doc→GREEN) | `src/features/executive/*`, `docs/finance/EXECUTIVE_KPI_DICTIONARY.md` | T05 |
| T05 sesiones (E11) | DONE | f0cddeb | `session-isolation.test.tsx` RED (B reutilizaba la query en vuelo de A) → GREEN | hipótesis E11 REPRODUCIDA y corregida sin tocar RLS | T06 |
| T06 apariencia (E10) | DONE | 325b556 | `AppearanceProvider.test.tsx` 6 | perfil propio vía `profiles_update_self` (contrato U-12) | T07 |
| T07 tokens/botones (E07/E08) | DONE | 0eadd77 | `tokens.test.ts` 38 (19 RED→GREEN) | contraste medido sobre tokens; renderizado en capturas after | T08 |
| T08 diálogos/tabs (E09) | DONE | 5d0ba1f | `dialogs-tabs.test.tsx` 12 (10 RED→GREEN) | 11 consumidores pasan la promesa de confirmación | T09 |
| T09 shell/navegación (E12) | DONE | d53aec9 | `navigation.test.ts` 22, `AppShell.test.tsx` 7 | tests de navegación actualizados a la IA aprobada (spec §5); e2e legacy: sólo etiquetas de menú | T10 |
| T10 tabla paginada | DONE | 5ab09be | `PagedTable.test.tsx` 7 | aditiva; DataTable intacta; orden con desempate por id | T11 |
| T11 exportación | DONE | 5ab09be | `export.test.ts` 10 + ExportMenu 3 | página vs todos, límite 5000 rotulado, fórmulas neutralizadas, columnas `secret` excluidas | T12 |
| T12 período consolidado (E03) | DONE | 7ef7281 | `financeConsolidated.test.tsx` 3 (RED→GREEN) | `asOf` sigue siendo fecha FX | T13 |
| T13 agregados sin truncación (E02) | DONE | a3ed009, a9717cd, badfa98 | pgTAP 25 (34); BillingPage/CostsPage/CommissionsPage tests | >200 facturas/costos, >300 comisiones; filtros idénticos tabla/resumen | T14 |
| T14 cartera y series | DONE | a3ed009, f4c40c1 | pgTAP 25 conciliación al céntimo | antigüedad vigente/1–30/31–60/61–90/>90/sin fecha | T15 |
| T15 gráficos | DONE | b2efbee, 2035d53 | build; paleta validada con dataviz validator | Recharts 3.10.1 MIT exacto; carga diferida | T16 |
| T16/T17 inicio y perspectivas | DONE | f4c40c1, c8872dd | `DashboardPage.test.tsx` 8; states e2e | 6 KPI; sin CHECK_HEALTH; sin 8/8 | T18 |
| T18 cliente 360 (E16) | DONE | a96677b, 95589bf | `Organization360.test.tsx` 3; J7/J13/J14 | lecturas acotadas; sociedades vía `upsert_company` | T19 |
| T19 tenant 360 | DONE | cdf450a | `tenantDimensions.test.ts` 8 | fixture PENDING+ACTIVE+MRR 0+PREPROVISIONED | T20 |
| T20 nueva venta | DONE | 7b32ecc | `onboarding-continuity.spec.ts` (navegador) | 1 RPC con doble clic; sin RPC de alta SaaS | T21 |
| T21 catálogo/comercial | DONE (subagente) | 0dc035c | 15 tests | sin 8/8; «Sin precio definido» | T22 |
| T22 finanzas administrativas | DONE (subagente) | a9717cd | 27 tests | sin mutaciones nuevas; texto DRY_RUN verificado contra SQL | T23 |
| T23 SaaS/gobierno/acceso | DONE (subagente) | 9f57578, c905e01 | 63 tests | sin CHECK_HEALTH al render; login sin anclas vacías | T24 |
| T24 evidencia 32 páginas | DONE | 67670d6 | capture/states/onboarding e2e 6/6 | `executive-experience/page-matrix.md`; 110 + 26 capturas; 0 overflow | T25 |
| T25 gates | DONE | — | ver tabla final | pgTAP 26/843 incl. `24_secret_key_rule`; e2e legacy 80/80 (base 80/80) | T26 |
| Revisión independiente | DONE | 52c8b16 | pgTAP +3 (RED→GREEN), Appearance A→B test | 0 BLOCKER; 2 MAJOR + 3 MINOR corregidos; 1 limitación de export documentada | T26 |
| T26 entrega | DONE | — | — | demo-guide.md, promotion-runbook.md, logs/ | reporte final |

## Gates finales (HEAD tras 52c8b16 + evidencia, 2026-09-25)

| Gate | Resultado | Log |
|---|---|---|
| typecheck | PASS | `executive-experience/logs/final/typecheck.log` |
| lint | PASS | `logs/final/lint.log` |
| Vitest | PASS 54 archivos / 776 tests (incluye golden GENERIC 12/12) | `logs/final/vitest.log` |
| build | PASS (principal 340 kB gzip; dashboard 128 kB diferido) | `logs/final/build.log` |
| secrets:scan (repo + bundle) | PASS | `logs/final/secrets.log` |
| pgTAP (BD limpia) | PASS 26 / 846, incl. `24_secret_key_rule` y `25_executive_read_models` | `logs/final/pgtap.log` |
| e2e legacy UI (BD limpia) | rama 80/80; base e2ad696 80/80 | `logs/final/e2e-legacy-*-clean.log`, `-final.log` |
| e2e mejora (capturas, estados, sesión, onboarding) | PASS 6/6 | `logs/final/e2e-capture-final.log` |
| e2e golden/orquestador/payment por HTTP | NOT_RUN (requieren Edge Functions servidas; backend protegido sin cambios por hash) | — |
| Hash de protegidos | supabase/functions, migraciones previas, tests 00–24, seed, config: idénticos. Cambiaron sólo 5 e2e UI (etiquetas) | `protected-baseline.sha256` |

Subagentes: 3 implementadores en páginas disjuntas (sin commits propios; integración y commits por el integrador) + 1 revisor independiente de la rama.

## Limitaciones conocidas

- Exportación «todos los filtrados»: detecta duplicados, errores y cambios del total; un borrado + alta
  simultáneos con el mismo total podrían omitir una fila sin detectarse (sin snapshot transaccional).
- K03 (saldo) incluye saldos a favor negativos; la banda «Saldo a favor» los separa de la cartera vencida.
- «Cobrado confirmado» de la ficha 360 usa el importe del pago (no el prorrateo por línea): puede diferir
  en céntimos de `v_collected_revenue`.
- e2e HTTP del orquestador/golden/payment-setup: NOT_RUN (requieren Edge Functions servidas).
- Capturas: todas medidas automáticamente; inspección a ojo de una muestra (ver page-matrix.md).
