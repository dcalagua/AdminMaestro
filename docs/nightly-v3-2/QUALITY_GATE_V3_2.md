# Quality gate V3.2

> Ejecución fresca y secuencial desde `db:reset` sobre `92433a6` (rama `dev`), entre
> `2026-09-14T02:12:56Z` y `2026-09-14T02:14:52Z`. Los commits posteriores a `92433a6` solo añaden
> documentación y evidencia (`docs/nightly-v3-2/`). **No se reutiliza ningún resultado de V3.1.**
> Cada archivo de `evidence/` guarda la salida completa: comando, HEAD, inicio, fin y código de
> salida. Entre `db:reset` y `db:test` se reinició el contenedor local
> `supabase_edge_runtime_ebim-control-plane`, que conserva workers, para que sirviera el código del
> HEAD.

| Gate | Comando real | Resultado | Detalle | Evidencia |
|---|---|---|---|---|
| DB reset | `npm run db:reset` | **PASS** (exit 0) | **37** migraciones aplicadas (36 previas + `20260913001400_v3_2_provider_plan_identity.sql`) + seed | `evidence/db-reset.txt` |
| pgTAP | `npm run db:test` | **PASS** (exit 0) | 21 archivos, **537/537** (V3.1: 486; nuevo: `20_v3_2_provider_plan_identity` → 51) | `evidence/db-test.txt` |
| Unit | `npm test` | **PASS** (exit 0) | 11 archivos, **169/169** (V3.1: 115; `money` 34 nuevo; `recurring-amount` 5 → 24; `culqi-mapping` 22 → 23) | `evidence/unit.txt` |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) | `tsc` app + node sin errores | `evidence/typecheck.txt` |
| Lint | `npm run lint` | **PASS** (exit 0) | `eslint .` sin errores ni avisos | `evidence/lint.txt` |
| Build | `npm run build` | **PASS** (exit 0) | typecheck + `vite build` en 1.02 s | `evidence/build.txt` |
| Secrets | `npm run secrets:scan` | **PASS** (exit 0) | «SECRETS_SCAN: PASS — sin credenciales detectadas en el repositorio ni en el bundle.» | `evidence/secrets.txt` |
| E2E | `npm run e2e` | **PASS** (exit 0) | **74/74**, 0 skipped, 0 flaky, 0 retries: smoke 21 · v2-journeys 20 · v3-1-billing-cadence 5 · **v3-2-payment-setup 9** · v3-regional 14 · v3-regional-journeys 5 | `evidence/e2e.txt` |

## Verificaciones adicionales

| Verificación | Resultado | Evidencia |
|---|---|---|
| Migraciones previas intactas byte a byte | **PASS**: 36/36 contra los hashes tomados antes de modificar código (`BASELINE_MIGRATIONS_PRE_V3_2.sha256`) y 35/35 contra el manifest V3.1 sin modificar. `git diff --name-status 1985f14..HEAD -- supabase/migrations` solo muestra `A 20260913001400_v3_2_provider_plan_identity.sql` | `evidence/migration-integrity.txt` |
| `deno check` de las Edge Functions de pago | **PASS**: `payment-setup`, `culqi-webhook`, `payment-reconcile` y los 3 módulos puros, exit 0 | `evidence/deno-check.txt` |
| Seguridad de BD | **PASS**: `register_provider_plan` DEFINER; `find_reusable_provider_plan` y `guard_provider_plan_identity` INVOKER; las 3 con `search_path = platform, pg_catalog`; EXECUTE solo `service_role`; 0 funciones de `platform` ejecutables por anon; 0 DEFINER sin `search_path`; `provider_plans` con RLS forzada, política intacta y solo SELECT para `authenticated` | `evidence/security-audit.txt` §1–3 |
| Permisos por PostgREST con JWT reales | **PASS**: FINANCE, PARTNER_ADMIN, TENANT_ADMIN y SALES_AGENT reciben 42501 en `find_reusable_provider_plan`, `register_provider_plan`, INSERT y UPDATE de `provider_plans` | `evidence/security-audit.txt` §7 |
| Datos tras el E2E | **PASS**: 0 contratos económicos con dos Planes ACTIVE; 0 suscripciones V3.2 cuyo Plan tenga un importe distinto del contractual | `evidence/security-audit.txt` §4 |
| V3.1 intacta | **PASS**: la migración 37 no referencia facturas ni el motor de cadencia; las 4 funciones del motor no usan FX; GRUPASA EWM muestra 1 cargo de USD 12,000 en el período en curso, como en V3.1 | `evidence/security-audit.txt` §5, §5b, §6 |
| Causa raíz reproducida antes del fix | E2E 3/7 fallos; 7 contratos de importes distintos sobre un único Plan; el upsert reescribe P1 a 1250; el módulo V3.1 acepta YEARLY y addon futuros | `evidence/phase1-*.txt`, `evidence/phase8-*.txt` |
| Sin cambios remotos | **PASS**: `dev` va 29 commits por delante de `origin/dev`, sin push; sin `supabase/.temp/project-ref`; 0 variables `CULQI_*` en el runtime local (PSP MOCK, sin llamadas a Culqi) | `evidence/security-audit.txt` §8 |
| Evidencia sin secretos | `grep -rE "sb_secret_\|eyJhbGci\|sk_live\|sk_test_" docs/nightly-v3-2`: la única coincidencia es esta fila, que cita el patrón | — |

## Culqi TEST (fase 22)

No se llamó a la API de Culqi. La corrección es de identidad local, de lectura del contrato y de
conversión a céntimos; no depende de ninguna suposición nueva sobre la API. El formato de importe
(céntimos) ya estaba verificado en TEST en V2.1 (`culqi-mapping.ts`). Culqi LIVE no se tocó.
