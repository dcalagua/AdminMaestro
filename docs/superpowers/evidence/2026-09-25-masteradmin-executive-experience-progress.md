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
| T01 aislar | DONE | (este commit) | — | este ledger, plan, spec, aprobación | T02 |
| T02 entorno | DONE | (este commit) | stack arriba, env local | tabla runtime | T03 |
| T03 baseline | DONE | 778c3fb | tabla baseline | logs + capturas before | T04 |
| T13a lecturas SQL | DONE | a3ed009 | pgTAP `25_executive_read_models` (32) RED→GREEN; suite 26/841 PASS | migración `20260925100000_executive_read_models.sql` (con rollback en cabecera) | UI T13 |
| T04 contratos | DONE | 9be746e | `executive-contracts.test.ts` 20 (RED doc→GREEN) | `src/features/executive/*`, `docs/finance/EXECUTIVE_KPI_DICTIONARY.md` | T05 |
| T05 sesiones (E11) | DONE | f0cddeb | `session-isolation.test.tsx` RED (B reutilizaba la query en vuelo de A) → GREEN | hipótesis E11 REPRODUCIDA y corregida sin tocar RLS | T06 |
| T06 apariencia (E10) | DONE | 325b556 | `AppearanceProvider.test.tsx` 6 | perfil propio vía `profiles_update_self` (contrato U-12) | T07 |
| T07 tokens/botones (E07/E08) | DONE | 0eadd77 | `tokens.test.ts` 38 (19 RED→GREEN) | contraste medido sobre tokens; renderizado en capturas after | T08 |
| T08 diálogos/tabs (E09) | DONE | 5d0ba1f | `dialogs-tabs.test.tsx` 12 (10 RED→GREEN) | 11 consumidores pasan la promesa de confirmación | T09 |
| T09 shell/navegación (E12) | DONE | d53aec9 | `navigation.test.ts` 22, `AppShell.test.tsx` 7 | tests de navegación actualizados a la IA aprobada (spec §5); e2e legacy: sólo etiquetas de menú | T10 |
