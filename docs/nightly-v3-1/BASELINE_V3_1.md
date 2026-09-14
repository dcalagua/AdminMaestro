# Baseline V3.1 · Final hardening (billing cadence)

> Tomado el 2026-09-13 (hora local; los logs del contenedor marcan 2026-09-14 UTC) **antes de modificar
> nada**. Rama `dev`, solo trabajo local.

## 1. Repositorio

| Dato | Valor |
|---|---|
| `pwd` | `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin` |
| Rama | `dev` (`dev...origin/dev [ahead 20]`: nada publicado) |
| HEAD inicial | `133f118 chore(v3-98): auditoría final, remediación de defaults e informe V3` |
| Cambios previos sin commit | `M .claude-prompts-v3-multicurrency/RUN_WITH_CLAUDE2.sh` y `?? logs/`. Son anteriores a esta sesión: no se tocan y no entran en ningún commit V3.1 |
| Enlace remoto Supabase | No hay: no existe `supabase/.temp/project-ref` y `supabase status` → `linked_project: null` |

`git log --oneline --decorate -20`: desde `133f118 (HEAD -> dev)` hasta `bf8e542 feat(v3-02)`, con los
commits `v3-01` … `v3-18` y `v3-98`. Antes de V3 está `1c6b5ce chore: checkpoint before V3 multicurrency`.

## 2. Migraciones

| Dato | Valor |
|---|---|
| Migraciones en disco | **35** |
| Última | `20260913001200_v3_organization_country_required.sql` |
| Migración de la emisión de facturas V3 | `20260913001100_v3_subscription_invoicing.sql` (nº 34) |
| Manifest SHA-256 existente | `docs/nightly-v3/BASELINE_MIGRATIONS.sha256`: cubre las 23 baseline → `shasum -a 256 -c` **23/23 OK** |
| Hashes de las 35 antes de V3.1 | `docs/nightly-v3-1/BASELINE_MIGRATIONS_PRE_V3_1.sha256` (calculado en esta fase, antes de cualquier cambio) |
| Cambios sin commit en `supabase/migrations` | Ninguno (`git diff --quiet HEAD` sobre cada archivo) |

## 3. Configuración revisada

- `CLAUDE.md`: reglas de seguridad (sin push, sin link/push remoto, RLS como autoridad, comisiones
  solo sobre CONFIRMED, Culqi LIVE prohibido).
- `package.json`: los gates son `db:reset`, `db:test`, `test`, `typecheck`, `lint`, `build` (incluye
  typecheck), `secrets:scan` y `e2e`.
- `vite.config.ts`: puerto 5199 con `strictPort`. Vitest incluye `src/**` y los módulos puros de
  `supabase/functions/**`.
- `supabase/config.toml`: API en 54421, DB en 54422, schema `platform` expuesto, seed `./seed.sql`.
- `playwright.config.ts`: 1 worker, sin reutilizar servidor, contra el Supabase local con seed.

## 4. Informes previos (contrastados con el código)

- `docs/nightly-v2/`, `docs/nightly-v2-1/` y `docs/nightly-v3/` existen.
- `FINAL_REPORT_V3_MULTICURRENCY.md` declara GO_QAS_CANDIDATE: pgTAP 380/380, unit 91/91, E2E 60/60.
  También describe `issue_subscription_invoice` (DV3-020) así: «incluye las líneas recurrentes
  vigentes en el periodo». El código lo confirma, y ese es justamente el defecto: **no mira la
  periodicidad** de la línea (§5).
- Esos números **no se reutilizan**. Los gates V3.1 se vuelven a ejecutar desde `db:reset`.

## 5. Estado del código relevante (antes del fix)

`platform.issue_subscription_invoice(p_subscription_id uuid, p_period_start date default null)`,
migración 34:

- El período es el mes calendario de `p_period_start` (por defecto, el mes en curso).
- Incluye **toda** línea con `billing_interval <> 'ONE_TIME'` vigente en el mes. Los ONE_TIME entran
  si no están en otra factura no VOID.
- Inserta la factura, luego las líneas, y si no hubo líneas lanza `SIN_LINEAS_FACTURABLES`. El
  rollback evita que quede una factura vacía.
- Idempotencia: devuelve la factura no VOID existente del mismo (suscripción, período).
- Número `INV-YYYYMM-<código>` con índice único `invoices_number_uk`.
- SECURITY DEFINER, `search_path = platform, pg_catalog`. Autoriza a EBIM_FINANCE o super admin;
  EXECUTE para `authenticated` y `service_role`.

Fixture `SUB-GRUPASA-EWM` (seed) verificado en la base: `ACTIVE`, `YEARLY`, `USD`; LICENSE USD
24,000.00 YEARLY y IMPLEMENTATION_FEE USD 12,000.00 ONE_TIME, ambas con `valid_from` =
`current_date - 6 months` (2026-03-13 en este reset); sin facturas.

UI: `SubscriptionDetailPage.tsx`, botón «Emitir factura del mes (MON)», sin período elegible.
E2E `v3-regional-journeys.spec.ts` usa ese texto.
