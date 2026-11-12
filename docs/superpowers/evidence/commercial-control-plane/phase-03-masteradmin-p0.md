# Fase 03 — MasterAdmin P0 (DISCOUNT y autootorgamiento comercial)

- Fecha: 2026-09-27 · Worktree `masteradmin/.worktrees/ebim-commercial-control-plane-v1` · rama `feature/ebim-commercial-control-plane-v1` · base `346aa72`.
- Precondición: GATE A (`HUMAN_SPEC_APPROVAL=YES`) y GATE B (`HUMAN_PLAN_APPROVAL=YES`, incluye P-01/P-02).
- Entorno: solo stack LOCAL (`127.0.0.1:54421/54422`, proyecto `ebim-control-plane`). Ningún `link`, `db push`, `functions deploy` ni `secrets set`. Guarda `scripts/ccp/guard-env.sh` ejecutada antes de cada `db reset`.
- Supabase CLI 2.116.0 (`supabase-cli-masteradmin.txt`). Docs vigentes consultadas (lints 0028/0029): Postgres concede `EXECUTE` a `PUBLIC` en funciones nuevas y Supabase da los mismos default privileges a `anon` y `authenticated` → cada función nueva o redefinida lleva `revoke all … from public, anon` + `grant execute … to authenticated, service_role` explícitos.

## Commits

| Task | Commit | Asunto |
| --- | --- | --- |
| MA-00 | `00e2f4e` | chore(ccp): add local environment guard and baseline evidence |
| MA-01 | `80456ca` | test(ccp): pin provisioning mappings and business price values |
| MA-02 | `a396c81` | fix(finance): subtract DISCOUNT exactly once across invoice, MRR and commissions |
| MA-03 | `63f8b74` | fix(security): remove tenant self-grant of add-ons and features |
| MA-04 | (este commit) | docs(ccp): phase 03 evidence |

## MA-00 — guarda y baseline

- RED `logs/MA-00-red.txt` (7/8 fallan: no existe el script). GREEN `logs/MA-00-green.txt` (8/8) con `node --test scripts/ccp/*.test.mjs`.
- Baseline en `346aa72` (antes de tocar nada): typecheck OK, lint OK, vitest 776/776, `db reset` OK, pgTAP 846/846 (26 archivos), secrets PASS (`logs/MA-00-baseline-*.txt`).

## MA-01 — preservación INV-3/INV-4

- `supabase/tests/26_ccp_preservation.test.sql`. RED con constantes `'TBD'` (`logs/MA-01-red.txt`), valores medidos sobre `db reset` de `346aa72` antes de cualquier migración del programa, GREEN (`logs/MA-01-green.txt`).
- Huellas: `tenant_product_mappings` y `saas_provisioning_requests` = `d41d8cd98f00b204e9800998ecf8427e` (el seed local no trae filas: huella de tabla vacía, detecta cualquier inserción); `plan_prices` = `1114f95fa1ec85743ac0358c0ef80e10`; `catalog_items(code, saas_product_id, price_month, currency)` = `7b6c1e1dc8d8fa812237f93389811ab1`.
- Desviación: los `id` de `plan_prices`/`catalog_items` son `gen_random_uuid()` y `valid_from` es relativo a `current_date` en el seed, así que se hashean clave natural (plan, mercado, cargo, periodo) y desfase en días en vez de `id`/fecha absoluta. Sigue verde tras MA-02 y MA-03.

## MA-02 — DISCOUNT resta exactamente una vez (P-01/P-02)

- Migración `20260928000100_ccp_discount_sign.sql`:
  - `platform.signed_line_amount(charge_kind, numeric)` IMMUTABLE: `DISCOUNT → −|importe|`.
  - `recalc_invoice_totals`, `v_subscription_mrr` (DISCOUNT recurrente resta), `v_collected_revenue`, `v_collected_payments` (misma fórmula para conciliar), `issue_subscription_invoice` y `get_subscription_billing_status` (total debido firmado) usan la función.
  - `generate_commission_events` excluye DISCOUNT del loop de líneas (sin reducción de base: D-11 sigue abierto).
  - Cuerpos de función copiados de la última definición; el diff contra el original son solo las líneas `CCP P-01`.
  - Nuevo `v_discount_sign_legacy_invoices` (security_invoker, sin anon): facturas cuyo total persistido ≠ total firmado.
- RED `logs/MA-02-red.txt` (la función no existe) + caracterización del comportamiento actual `logs/MA-02-red-characterization.txt`: MRR 100 (esperado 90), total estimado 110, factura emitida 110, DRAFT con DISCOUNT positivo 110, pago de 90 deja `PARTIALLY_PAID`, un evento de comisión sobre la línea DISCOUNT, DISCOUNT cobrado como +8.18.
- GREEN `logs/MA-02-green.txt`: 20/20 en `27_ccp_discount.test.sql` (DISCOUNT −10 correctivo → 90, ni 80 ni 110; base COLLECTED_ANY = 100; ningún evento sobre DISCOUNT; Σ cobrado = 90 = pago; ningún pago nuevo o revertido; factura histórica conserva 110 y aparece con total firmado 90).
- vitest: `executive-contracts.test.ts` exige que K01 ya no excluya DISCOUNT y que `COST_MARGIN_MODEL.md` / `EXECUTIVE_KPI_DICTIONARY.md` digan «DISCOUNT resta de MRR y de la factura una sola vez». RED `logs/MA-02-red-vitest.txt`, GREEN `logs/MA-02-green-vitest.txt`.
- Caracterización local tras la migración (`logs/MA-02-characterization-local.txt`): 0 líneas DISCOUNT, 0 facturas afectadas, 0 filas en la vista histórica, 0 ítems DISCOUNT. QAS se mide en fase 19 (solo lectura).
- Desviación frente al plan: el plan decía que el cambio de líneas de facturas emitidas "está bloqueado". No hay trigger que lo bloquee; lo que lo impide es que `authenticated` solo tiene SELECT en `invoice_lines` y las únicas escrituras son RPCs DEFINER que crean facturas **nuevas**. Por eso se añadió `v_discount_sign_legacy_invoices` (misma política que `v_currency_integrity_issues`: a la vista, sin corregir en silencio). Ninguna sentencia de la migración hace `UPDATE` de `invoices` ni de `commission_events` (P-02).

## MA-03 — sin autootorgamiento comercial (P0-MA-1)

- Migración `20260928000200_ccp_commercial_write_lockdown.sql`: elimina las 6 políticas de escritura de `tenant_addons`/`tenant_features`, revoca INSERT/UPDATE/DELETE/TRUNCATE a `authenticated`, `anon`, `public` (SELECT y políticas `*_select` intactas; `service_role` conserva sus privilegios); `set_tenant_feature` pasa de `can_manage_tenant()` a `can_manage_commercial()`; nueva `set_tenant_addon_active(tenant, addon_code, active, reason)` DEFINER, `search_path = platform, pg_catalog`, sin EXECUTE para PUBLIC/anon, motivo obligatorio, rechaza items `available=false` al otorgar, audita `TENANT_ADDON_SET` con estado previo/nuevo/motivo. Temporal hasta el lifecycle de la fase 07.
- UI: `useSetTenantAddonActive` en `src/services/mutations.ts` (patrón `useRpc`); ningún componente escribía estas tablas directamente. Tipos regenerados (`npm run db:types` equivalente).
- RED `logs/MA-03-red.txt` · GREEN `logs/MA-03-green.txt` (46/46 en `28_ccp_commercial_self_grant.test.sql`).

Matriz de roles (tenant alpha `50…0001`, o cliente-p1 `50…0002` para ORG_ADMIN/PARTNER_ADMIN):

| Rol | Escritura directa antes | Escritura directa después | `set_tenant_feature` después | `set_tenant_addon_active` después | Lectura |
| --- | --- | --- | --- | --- | --- |
| anon | denegada | 42501 ×6 | 42501 | 42501 | — |
| authenticated sin rol | INSERT 42501; UPDATE/DELETE 0 filas (RLS) | 42501 ×6 | 42501 | 42501 | 0 filas |
| TENANT_ADMIN (propio tenant) | **permitida ×6** | 42501 ×6 | 42501 | 42501 | su tenant |
| ORG_ADMIN del cliente | **permitida ×6** | 42501 ×6 | 42501 | 42501 | su tenant |
| PARTNER_ADMIN que gestiona | **permitida ×6** | 42501 ×6 | 42501 | 42501 | según can_read_tenant |
| Comercial con atribución | INSERT 42501; UPDATE/DELETE 0 filas | 42501 ×6 | 42501 | 42501 | según can_read_tenant |
| EBIM_FINANCE | INSERT 42501 | 42501 ×6 | OK + audit | OK + audit | todo |
| EBIM_PRODUCT_ADMIN | **permitida ×6** | 42501 ×6 | OK + audit | OK + audit | todo |
| EBIM_SUPER_ADMIN | **permitida ×6** | 42501 ×6 | OK + audit | OK + audit | todo |

- Cambio de comportamiento a notar: EBIM_FINANCE antes **no** podía usar `set_tenant_feature` (no pasaba `can_manage_tenant`) y ahora sí (es `can_manage_commercial`). Ninguna pantalla usa hoy `useSetTenantFeature`.
- Configuración de una capacidad ya otorgada por el tenant: MasterAdmin no expone ninguna (spec §2); vive en cada SaaS. `tenant_settings` no se tocó.

## MA-04 — verificación de fase

| Verificación | Resultado | Evidencia |
| --- | --- | --- |
| pgTAP completo (tras `db reset` con las 2 migraciones) | 916/916, 29 archivos, PASS | `logs/MA-03-gate-db-test.txt` |
| vitest (incluye goldens de provisioning en `supabase/functions/**`) | 778/778 | `logs/MA-03-gate-test.txt` |
| guard-env (`node --test`) | 8/8 | `logs/MA-00-green.txt` |
| typecheck / lint | OK / OK | `logs/MA-03-gate-typecheck.txt`, `logs/MA-03-gate-lint.txt` |
| build | OK (solo aviso de tamaño de chunk preexistente) | `logs/MA-04-build.txt` |
| secrets scan | PASS | `logs/MA-04-secrets.txt` |
| advisors locales (`supabase db advisors --local --type all --level info`) | 7 `auth_rls_initplan`, 2 `multiple_permissive_policies`, 1 `function_search_path_mutable` (`next_renewal_date`), 105 `unused_index`: todos preexistentes; ninguno sobre objetos creados o redefinidos en esta fase | `logs/MA-04-advisors-local.json` |
| diff de provisioning protegido `git diff 346aa72 -- supabase/functions/_shared/provisioning supabase/functions/provisioning-* e2e/v4-*` | vacío; `supabase/functions` completo sin cambios | `logs/MA-04-provisioning-diff.txt` |
| rollback `docs/runbooks/ccp-rollback/03.sql` (A: DISCOUNT, B: self-grant) | aplica limpio dentro de una transacción revertida sobre la base local | `logs/MA-03-rollback-dryrun.txt` |

- e2e no forma parte del gate de la fase 03 (plan §1.2: fases 08 y 18).
- Rollback boundary: `git revert` de `a396c81`/`63f8b74` o `03.sql`. La parte B re-abre P0-MA-1 y no se aplica en QAS sin decisión humana.

`PHASE_03=PASS`
