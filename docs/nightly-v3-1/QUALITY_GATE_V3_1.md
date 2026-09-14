# Quality gate V3.1

> Ejecución fresca y secuencial desde `db:reset`, sobre `3394945` (rama `dev`), entre
> `2026-09-14T01:32:43Z` y `2026-09-14T01:34:28Z`. Los commits posteriores a `3394945` solo añaden
> documentación y evidencia (`docs/nightly-v3-1/`). **No se reutiliza ningún resultado de V3.**
> Cada archivo de `evidence/` guarda la salida completa: comando, HEAD, inicio, fin y código de
> salida.

| Gate | Comando real | Resultado | Detalle | Evidencia |
|---|---|---|---|---|
| DB reset | `npm run db:reset` | **PASS** (exit 0) | 36 migraciones aplicadas (35 previas + `20260913001300_v3_1_billing_cadence.sql`) + seed | `evidence/db-reset.txt` |
| pgTAP | `npm run db:test` | **PASS** (exit 0) | 20 archivos, **486/486** (V3: 380; nuevos: 18 → 64, 19 → 42) | `evidence/db-test.txt` |
| Unit | `npm test` | **PASS** (exit 0) | 10 archivos, **115/115** (V3: 91; nuevos: billing 6, PeriodInvoiceAction 13, recurring-amount 5) | `evidence/unit.txt` |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) | `tsc` app + node sin errores | `evidence/typecheck.txt` |
| Lint | `npm run lint` | **PASS** (exit 0) | `eslint .` sin errores | `evidence/lint.txt` |
| Build | `npm run build` | **PASS** (exit 0) | typecheck + `vite build` en 1.08 s | `evidence/build.txt` |
| Secrets | `npm run secrets:scan` | **PASS** (exit 0) | «SECRETS_SCAN: PASS — sin credenciales detectadas en el repositorio ni en el bundle.» | `evidence/secrets.txt` |
| E2E | `npm run e2e` | **PASS** (exit 0) | **65/65**, 0 skipped, 0 flaky, 0 retries: smoke 21 · v2-journeys 20 · v3-regional 14 · v3-regional-journeys 5 · **v3-1-billing-cadence 5** | `evidence/e2e.txt` |

## Verificaciones adicionales

| Verificación | Resultado | Evidencia |
|---|---|---|
| Migraciones previas intactas byte a byte | **PASS**: 35/35 contra los hashes tomados antes de V3.1 y 23/23 contra el manifest V3 sin modificar; `git diff 133f118..HEAD -- supabase/migrations` solo muestra `A 20260913001300_v3_1_billing_cadence.sql` | `evidence/migration-integrity.txt` |
| Seguridad de las funciones V3.1 | **PASS**: `issue_subscription_invoice` DEFINER; las 3 nuevas INVOKER; las 4 con `search_path=platform, pg_catalog`; EXECUTE solo `authenticated`/`service_role`; 0 funciones de `platform` ejecutables por anon; 0 DEFINER sin `search_path`; emisión permitida solo a SUPER_ADMIN/FINANCE y 42501 para PRODUCT_ADMIN, PARTNER_ADMIN, TENANT_ADMIN y SALES_AGENT | `evidence/security-audit.txt` |
| La emisión y el motor no usan FX | **PASS** (0 coincidencias en `prosrc`) | `evidence/security-audit.txt` · pgTAP 19 |
| Causa raíz reproducida antes del fix | 19/64 fallos en pgTAP 18; con la función antigua, el E2E falla 3/5 (YEARLY, QUARTERLY, MIXED) | `evidence/phase1-*.txt`, `evidence/phase17-e2e-against-old-function.txt` |
| Evidencia sin secretos | `grep` de `sb_secret_`, JWT y `sk_live`/`sk_test_` en `docs/nightly-v3-1`: ninguna coincidencia | — |

## Limitaciones de entorno (no son gates)

- `deno check supabase/functions/payment-setup/index.ts` no se puede ejecutar localmente: Deno no
  resuelve `npm:@supabase/realtime-js` (dependencia de `jsr:@supabase/supabase-js`). Es la misma
  limitación que V3 documentó con `culqi-webhook` y no tiene relación con el cambio. El módulo
  nuevo `_shared/payments/recurring-amount.ts` **sí** pasa `deno check`, y sus 5 tests corren en
  vitest.
- Las Edge Functions no se desplegaron (regla de la tarea). El cambio en `payment-setup` solo se
  probó a nivel unitario.
