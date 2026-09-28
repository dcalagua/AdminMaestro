# EBIM Commercial Control Plane v1 — Plan de implementación cross-repo

> Para agentes: ejecutar tarea por tarea, en orden. Cada tarea sigue el ciclo TDD **RED → GREEN → REFACTOR → COMMIT**. Ninguna tarea empieza sin que la anterior del mismo repo esté verde y commiteada.

**Estado:** `PLAN_REVIEW_REQUIRED` (GATE B). Este documento es solo un plan: no contiene código de producto, migraciones aplicadas ni cambios remotos.
**Spec aprobada (GATE A):** `docs/superpowers/specs/2026-09-27-ebim-commercial-control-plane-design.md` (commit `747741c`), aprobada por el humano con `HUMAN_SPEC_APPROVAL=YES` el 2026-09-27.
**Rama y worktree de MasterAdmin:** `feature/ebim-commercial-control-plane-v1` en `masteradmin/.worktrees/ebim-commercial-control-plane-v1`, base `346aa72`.
**Estado de repos:** `.claude-prompts-commercial-control-plane-v3/program-state/repo-state.tsv` (fase 00).

Las citas usan el formato `repo:ruta:línea`. `M/` significa `supabase/migrations/` y `F/` significa `supabase/functions/` del repo citado. Los números de línea se leyeron en el commit base de cada repo y se **re-verifican** al empezar cada tarea (si se movieron, se registra en el ledger).

---

## 0. Reglas de ejecución (leer antes de cualquier tarea)

### 0.1 Invariantes protegidos (se prueban, no se asumen)

| ID | Invariante | Prueba que lo protege |
| --- | --- | --- |
| INV-1 | CREATE/REPLAY/GET de provisioning no cambian en ningún repo (rutas, códigos HTTP, cuerpo, hash de idempotencia, `REPLAYED`/`IDEMPOTENCY_CONFLICT`) | MasterAdmin: `F/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts`, `ewm-v1.test.ts`, `e2e/v4-generic-orchestrator-golden.spec.ts`. SaaS: su suite de contrato de provisioning (tabla §1.2) debe seguir verde **sin editar** esos archivos. `git diff <base> -- <archivos de provisioning>` = vacío salvo las líneas de ruteo aditivas declaradas en cada tarea |
| INV-2 | Idempotencia: misma `Idempotency-Key` + mismo comando → mismo resultado; distinto comando → 409 | Suites de contrato existentes + los nuevos tests de `PUT entitlements` |
| INV-3 | Mapeos existentes (`tenant_product_mappings`, `saas_provisioning_requests`, tablas `*provisioning_requests` de cada SaaS) intactos | pgTAP `26_ccp_preservation.test.sql`: `md5(string_agg(... order by id))` antes = después de todas las migraciones del programa, con el seed local |
| INV-4 | Valores de precios de negocio intactos (`plan_prices`, `catalog_items.price_month`, precios locales de cada SaaS) | Mismo test de hash (INV-3) sobre `plan_prices` y `catalog_items(code, price_month, currency)`. Ninguna migración del programa hace `UPDATE` de columnas de precio. En los SaaS: test de hash sobre sus tablas de precio (`addons`, `plans`, `ai_agents.price_month`, `channels.price_month`, `billing_plans`) |
| INV-5 | PRD nunca se toca | No existe ningún comando contra PRD en este plan. `scripts/ccp/guard-env.sh` (Task MA-00) aborta si la URL/ref de destino no es local |
| INV-6 | Comisiones solo desde pagos `CONFIRMED` | pgTAP existente de comisiones sigue verde + casos nuevos en `27_ccp_discount.test.sql` |
| INV-7 | Nada sintético es facturable | Tenants de certificación `tenant_type=DEMO`, emails `*@ebim.test`; guard DEMO existente; test en `40_ccp_billing_usage.test.sql` |
| INV-8 | Ningún secreto en snapshot, fixtures, evidencia ni commits | Test de claves prohibidas del snapshot (spec §7.2.6) + `npm run secrets:scan` (MasterAdmin `scripts/secrets-scan.mjs`) antes de cada commit; equivalente por repo (§1.2) |

### 0.2 Entornos y guardas

- **Solo LOCAL en las fases 03–18.** Ningún `supabase link`, `db push`, `db reset --linked`, `migration repair`, `functions deploy` ni `secrets set` contra un proyecto remoto.
- MasterAdmin: `.env.local` apunta a QAS (`jivgwrczgdpsuvqcwqku`). Toda ejecución local exporta primero las variables de proceso del stack local y aplica la guarda de la spec EWM (plan `2026-09-21-ewm-masteradmin-adapter-implementation.md` §0.1): `curl -s http://127.0.0.1:5199/src/lib/env.ts | grep VITE_SUPABASE_URL` debe mostrar `127.0.0.1:54421`. Si muestra `jivgwrczgdpsuvqcwqku` → **HARD STOP**.
- **Proyectos remotos que en la práctica son productivos** (tratados como PRD en este programa):
  - eExpense `uvjmdphlnpyhtohobvzx` (DEV=QAS, sirve al cliente CMH; readiness eExpense §4-5).
  - GMAO/hub `xikbhkfeaosasdltartg` (clasificado AMBIGUOUS_OR_PRD; readiness GMAO §2).
  Para estos dos no hay "QAS" seguro: la fase 19 los trata con la decisión **P-05** (§12).
- Drift de historial: GMAO, eExpense, eChange y eSupplier **nunca** usan `supabase db push`. GMAO no puede hacer `db reset` (su esquema base no está versionado): sus pruebas SQL corren en el harness PGlite (`supabase/tests/run_tests.mjs`, `run_provisioning_tests.mjs`).
- Supabase: antes de la primera tarea con migraciones de cada repo se ejecuta y archiva en evidencia `supabase --version`, `supabase db --help`, `supabase test --help`, `supabase functions --help`, y se revisa el changelog vigente de Supabase (CLI y Postgres) buscando cambios en `ALTER TYPE … ADD VALUE`, `security_invoker`, grants por defecto de funciones y `verify_jwt`. El hallazgo se anota en el ledger.

### 0.3 Git

- Una rama y un worktree de programa por repo (§1.1). Se crean **la primera vez** que ese repo se modifica, desde el `selected_base` de `repo-state.tsv`. Antes de crearlo: `git -C <repo> fetch origin` y re-verificar que la regla de selección sigue dando el mismo commit; si cambió, se registra y se usa el nuevo resultado (si hay divergencia → STOP ese repo).
- `.worktrees/` debe estar ignorado: `git -C <repo> check-ignore -q .worktrees/x || echo '.worktrees/' >> <repo>/.git/info/exclude` (exclusión local, no se commitea).
- Nunca `reset --hard`, `stash` sin etiqueta, `rebase`, `push --force`, ni limpieza de la raíz sucia.
- **Push**: MasterAdmin autoriza push de ramas feature (`CLAUDE.md`). Los SaaS tienen reglas propias más estrictas y **prevalecen**:
  - eCommerce, Comerza, TMS, eExpense: solo commits locales; push solo con orden explícita del operador.
  - EWM: nada llega a DEV (push ni migraciones) sin autorización de Dennis **por lote** (`CLAUDE.md:2890`).
  - eSupplier: un job programado empuja `dev` a las 21:30; la rama del programa no es `dev`, así que no se ve afectada. No se hace push manual.
  - Cuando se necesite un push de SaaS se emite el comando mínimo para el operador y se registra en el ledger.
- Mensajes de commit: Conventional Commits. En repos cuyo `CLAUDE.md` pide español (eCommerce) el asunto va en español. Todo commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### 0.4 Disciplina TDD

Cada tarea declara:
1. **RED**: archivo(s) de test exactos y el comando; el resultado esperado es FALLO por la razón declarada (no por error de sintaxis). La salida se guarda en `…/evidence/commercial-control-plane/logs/<task-id>-red.txt`.
2. **GREEN**: archivos de implementación exactos; mismo comando en verde; log `<task-id>-green.txt`.
3. **REFACTOR** opcional sin cambiar tests.
4. **Gate de repo** (§1.2) completo en verde antes del commit.
5. **COMMIT** con el mensaje indicado. Un commit por tarea salvo que se indique "commit conjunto".

Si una misma aproximación técnica falla 2–3 veces, se detiene la tarea, se escribe el bloqueo en el ledger y se reconsidera (regla global).

### 0.5 Ledger y evidencia

- Ledger: `masteradmin/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/program-ledger.md`. Una entrada por fase: commits (hash corto por repo), tests ejecutados, desviaciones, bloqueos, comandos de operador emitidos.
- Evidencia de MasterAdmin: `docs/superpowers/evidence/commercial-control-plane/` (carpeta versionada en git).
- Evidencia de cada SaaS: `<worktree>/docs/superpowers/evidence/commercial-control-plane/` en su propio repo, y un resumen enlazado desde el ledger.

---

## 1. Propiedad de repos, worktrees y gates

### 1.1 Worktrees y ramas

Todos en `<repo>/.worktrees/ebim-commercial-control-plane-v1`, rama `feature/ebim-commercial-control-plane-v1`.

| Producto | Repo (bajo `EBIM/`) | Base | Fases que lo modifican | Dueño de archivos |
| --- | --- | --- | --- | --- |
| MasterAdmin | `masteradmin` | `346aa72` (ya creado) | 03, 07, 08, 17, 18, 21 + fixtures para todas | Único escritor de `contracts/entitlements/v1/**` y `contracts/usage/v1/**` |
| eExpense | `eExpenses` | `f282dc4` | 04, 15, 17 | — |
| GMAO | `GMAO` | `90e501f` | 05, 16, 17 | — |
| eSupplier | `eSupplier` | `a61dd22` | 06, 13, 17 | — |
| eChange | `eChange` | `3d6f34e` | 06, 14, 17 | — |
| eCommerce | `eCommerce` | `7da2ae4` | 09, 17 | — |
| EWM | `IACLAUDE/WMS-by-EBIM` | `7c086e8` | 10, 17 | — |
| Comerza | `comerza` | `2c49725` | 11, 17 | — |
| TMS | `TMS` | `692ff4f` | 12, 17 | — |

Los SaaS **no** editan los fixtures: copian (vendor) la versión publicada por MasterAdmin y la fijan por checksum (§3).

### 1.2 Gate de calidad por repo (se ejecuta antes de cada commit)

| Repo | Comandos del gate | Suite de provisioning protegida (INV-1) |
| --- | --- | --- |
| MasterAdmin | `npm run typecheck && npm run lint && npm test && npm run db:reset && npm run db:test && npm run secrets:scan`; `npm run build` al cierre de fase; `npm run e2e` (local, con guarda §0.2) al cierre de fase 08 y 18 | `F/_shared/provisioning/**/*.test.ts`, `e2e/v4-*.spec.ts` |
| eCommerce | `npm run typecheck && npm run lint && npm test && npm run test:db && npm run build`; `supabase test db` para pgTAP | `supabase/tests/platform-provisioning-contract.test.ts`, `platform-provisioning-db.test.ts`, `supabase/tests/database/platform_provisioning.test.sql` |
| EWM | `cd backend/wms-api && ./mvnw test` (unit); `./mvnw clean verify` si hay Docker (si no, se registra como bloqueo de entorno, no se omite el test en silencio); frontend `npm run typecheck && npm run test` si se toca | `PlatformProvisioningIT`, `PlatformProvisioningIdempotencyIT`, `PlatformSecurityIsolationIT`, `ProvisioningContractFixtures` |
| TMS | `cd backend/tms-api && ./mvnw -B clean test`; `./mvnw verify` con Docker | `PlatformProvisioningApiTest`, `PlatformProvisioningServiceTest`, `GenericProvisioningFixtures`, `PlatformM2mJwtDecodersTest` |
| Comerza | `npm run typecheck && npm test && npm run test:db && npm run test:edge` | `tests/provisioning/*.test.ts`, `tests/edge/platform-provisioning.test.ts`, `supabase/tests/platform_provisioning*.sql` |
| eChange | `cd web && npm test && npm run build`; `psql "$DB" -f supabase/tests/<x>_test.sql` sobre stack local | `web/src/edge/platformProvisioning*.test.ts`, `platformM2M.test.ts`, `supabase/tests/platform_provisioning_test.sql` |
| eSupplier | `npm test && npm run test:security && npm run type-check:gate && npm run security:gates && npm run lint`; SQL con `psql -v ON_ERROR_STOP=1` tras `supabase db reset` **local** | `src/security/__tests__/platformProvisioning*.test.ts`, `supabase/tests/platform_provisioning_rpc.sql` |
| eExpense | `cd web && npm test && npm run typecheck && npm run build`; `deno check`/`deno lint` por función tocada; pgTAP con `psql … -f` tras `supabase db reset --local` | `web/src/edge/platformProvisioning*.test.ts`, `platformM2M.test.ts`, `supabase/tests/platform_provisioning_test.sql` |
| GMAO | `cd supabase/tests && npm ci && node run_tests.mjs && npm run test:provisioning`; `deno test supabase/functions/platform-provisioning/`; `deno check`/`deno lint` por función tocada | `supabase/functions/platform-provisioning/provisioning_test.ts`, `run_provisioning_tests.mjs` |

Secret scan en los SaaS sin script propio: `git -C <wt> diff --cached | grep -nEi '(service_role|sk_live|sk_test|BEGIN (EC |RSA )?PRIVATE KEY|eyJ[a-zA-Z0-9_-]{20,}\.)'` debe estar vacío.

---

## 2. Orden de integración cross-repo y dependencias

```
Fase 03 MA-P0 ─┐
Fase 04 EX-P0 ─┤  (P0 en paralelo: repos distintos, sin dependencias entre sí)
Fase 05 GM-P0 ─┤
Fase 06 SU/EC-P0┘
        │
Fase 07 MA core (catálogo, capacidades, precios add-on, grants, lifecycle, compute_entitlements)
        │
Fase 08 MA sync contract + publicación de fixtures contracts/entitlements/v1 (tag lógico FIX-ENT-v1)
        │
Fase 09 eCommerce piloto ──► (gate: piloto PASS) ──► Fases 10 EWM, 11 Comerza, 12 TMS (paralelizables)
                                                   └► Fases 13 eSupplier, 14 eChange (requieren 06)
                                                   └► Fase 15 eExpense (requiere 04)
                                                   └► Fase 16 GMAO (requiere 05; la más riesgosa, última)
        │
Fase 17 uso + créditos IA (MA primero; publica contracts/usage/v1 = FIX-USG-v1; luego outbox por SaaS)
        │
Fase 18 facturación + certificación LOCAL/DEV 8/8
        │
GATE C ─► Fase 19 promoción QAS ─► Fase 20 certificación QAS ─► Fase 21 cierre
```

**Dependencias duras:**
- Ningún SaaS pasa de `LEGACY_ONLY` si tiene un P0 abierto (spec §1.4).
- Las fases 10–16 consumen **FIX-ENT-v1** tal como quedó al cerrar la 08. Si el piloto (09) obliga a cambiar el contrato, se publica `FIX-ENT-v1.1` (aditivo) desde MasterAdmin, se registra y **todos** los SaaS ya iniciados re-vendorizan antes de su commit final.
- Fase 17 SaaS depende de FIX-USG-v1 y de que el SaaS ya tenga su receptor (10–16).
- `USAGE_OVERAGE` se agrega en fase 07 (migración aislada) aunque se use en 18, para que la migración de enum preceda a toda función que la referencie.

---

## 3. Fixtures de contrato compartidos

### 3.1 Ubicación y contenido (MasterAdmin, fase 08)

```
contracts/entitlements/v1/
  README.md                         # reglas: JCS RFC 8785, SHA-256, tamaños, errores
  schema.json                       # JSON Schema de ebim.entitlements/v1 (spec §7.1)
  manifest.schema.json              # JSON Schema del manifiesto de capacidades
  jcs-vectors.json                  # pares {input, canonical, sha256}: unicode, escapes, orden de claves, enteros, decimales, 0, -0, 1e21, arrays vacíos
  fixtures/
    01-baseline-only.json           # appActive=true, sin sellables habilitadas
    02-plan-grants.json             # capacidades de plan
    03-plan-plus-addon.json         # unión plan + add-on (COMPANY scope)
    04-addon-removed.json           # versión +1 que revoca
    05-limit-update.json            # LIMIT cambia de valor
    06-app-inactive.json            # appActive=false
    07-unknown-capability.json      # código no registrado en el receptor → APPLIED_WITH_WARNINGS
    08-stale.json                   # versión menor que la aplicada → 409 STALE_SNAPSHOT
    09-conflict.json                # misma versión, checksum distinto → 409 VERSION_CONFLICT
    10-bad-checksum.json            # checksum inválido → 422 CHECKSUM_MISMATCH
    11-wrong-environment.json       # environment ≠ receptor → 422 ENVIRONMENT_MISMATCH
    12-forbidden-keys.json          # contiene "price" → debe ser rechazado por el generador (test negativo del emisor)
  expected/
    put-responses.json              # respuesta esperada por fixture y por estado previo
    get-applied.json                # forma exacta del GET aplicado
  CHECKSUMS.sha256                  # sha256 de cada archivo anterior
contracts/usage/v1/                 # (fase 17) schema de lote, eventos válidos/duplicados/conflictivos, respuestas por evento
```

- Los valores numéricos de los fixtures son **ilustrativos** y usan productos y códigos sintéticos `fixture.*` más un set por producto con los códigos reales del registro; nunca precios.
- Los `controlPlaneTenantId` de fixtures son UUID fijos del rango `00000000-0000-4ccc-8000-0000000000NN`.

### 3.2 Consumo por los SaaS

- Cada SaaS copia `contracts/entitlements/v1/` a su árbol de tests:
  - eCommerce `supabase/tests/fixtures/entitlements-v1/`
  - eExpense y eChange `web/src/edge/fixtures/entitlements-v1/`
  - eSupplier `src/security/__tests__/fixtures/entitlements-v1/`
  - Comerza `tests/fixtures/entitlements-v1/`
  - GMAO `supabase/functions/platform-provisioning/fixtures/entitlements-v1/`
  - EWM `backend/wms-api/src/test/resources/contracts/entitlements-v1/`
  - TMS `backend/tms-api/src/test/resources/contracts/entitlements-v1/`
- Un test por repo (`entitlements-fixtures-pin`) recalcula SHA-256 de cada archivo y compara con `CHECKSUMS.sha256` **y** con el hash de `CHECKSUMS.sha256` fijado en el propio test (constante `FIX_ENT_V1_SHA256`). Si alguien edita un fixture localmente, el test falla.
- La implementación JCS de cada runtime (TS en Deno/Node y Java) pasa **todos** los `jcs-vectors.json`. Java: implementación propia pequeña en `…/platform/entitlements/infrastructure/Jcs.java` (sin nueva dependencia de terceros, salvo aprobación en P-04).

---

## 4. Cadena de migraciones de MasterAdmin

Timestamps en el orden en que deben existir. Si al ejecutar la fecha real es posterior, se conserva el **orden relativo** y el prefijo se actualiza; el cambio se registra.

| # | Archivo (`M/`) | Fase | Contenido | Depende de |
| --- | --- | --- | --- | --- |
| 1 | `20260928000100_ccp_discount_sign.sql` | 03 | `platform.signed_line_amount(charge_kind, numeric)`; `recalc_invoice_totals` con signo; `v_subscription_mrr` resta DISCOUNT recurrente; `v_collected_revenue` y read models ejecutivos consistentes; commission loop excluye DISCOUNT | `…0500`, `…1100`, `…0900 (v3)`, `20260925100000` |
| 2 | `20260928000200_ccp_commercial_write_lockdown.sql` | 03 | Revoca I/U/D de `authenticated` en `tenant_addons`/`tenant_features`, elimina policies de escritura, RPC temporal auditado `set_tenant_addon_active` (gate `can_manage_commercial()`), `set_tenant_feature` sigue siendo la única vía de feature | `…0900_rls_policies` |
| 3 | `20260929000100_ccp_charge_kind_usage_overage.sql` | 07 | `ALTER TYPE platform.charge_kind ADD VALUE 'USAGE_OVERAGE'` (aislada, sin otras sentencias) | — |
| 4 | `20260929000200_ccp_product_capabilities.sql` | 07 | `product_capabilities`, `capability_aliases`, RPCs `import_capability_manifest`, `upsert_capability_alias` | 3 |
| 5 | `20260929000300_ccp_catalog_items_extend.sql` | 07 | `catalog_items` + `saas_product_id`, `lifecycle_status`, `billing_model`; `price_month` solo lectura para facturación nueva | 4 |
| 6 | `20260929000400_ccp_catalog_item_prices.sql` | 07 | Tabla + triggers (réplica `plan_prices`), `current_catalog_item_price`, `set_catalog_item_price` | 5 |
| 7 | `20260929000500_ccp_entitlement_grants.sql` | 07 | `entitlement_grants` (GiST sin solapes), `tenant_entitlement_overrides`, RPCs `create_entitlement_grant`, `close_entitlement_grant`, `create_entitlement_override` | 4, 5 |
| 8 | `20260929000600_ccp_tenant_addons_lifecycle.sql` | 07 | Columnas nuevas de `tenant_addons`, unique parcial, RPCs `request_/approve_/reject_/schedule_cancel_/reactivate_/suspend_/resume_/cancel_tenant_addon`; reemplaza el RPC temporal de la migración 2 | 2, 6, 9 |
| 9 | `20260929000550_ccp_subscription_items_source.sql` | 07 | `subscription_items` + `source_type`, `tenant_addon_id`, `price_ref`; existentes = `MANUAL` | 6 (se aplica antes que 8, ver nota) |
| 10 | `20260929000800_ccp_compute_entitlements.sql` | 07 | `compute_entitlements(tenant, product, t)` STABLE SECURITY INVOKER + helpers | 7, 8 |
| 11 | `20260929000900_ccp_tenant_features_read_model.sql` | 07 | `tenant_features.source` + `ENTITLEMENT`; `refresh_tenant_features(tenant)` (DEFINER, service/commercial) | 10 |
| 12 | `20260929001000_ccp_commercial_read_models.sql` | 07 | Vistas `security_invoker`: `v_tenant_entitlements`, `v_catalog_item_current_prices`, `v_tenant_addon_history` | 10 |
| 13 | `20260930000100_ccp_entitlement_snapshots.sql` | 08 | `entitlement_snapshots` append-only, `issue_entitlement_snapshot(tenant, product)` (service_role) | 10 |
| 14 | `20260930000200_ccp_entitlement_sync_state.sql` | 08 | `entitlement_sync_state`, `entitlement_sync_attempts`, RPCs de transición de estado (service_role) | 13 |
| 15 | `20260930000300_ccp_product_integrations_entitlements.sql` | 08 | Columnas de §3.2 spec en `product_integrations`, `entitlements_push_enabled` (kill-switch), `commercial_cutover_events`, RPC `set_commercial_cutover_state` | 14 |
| 16 | `20260930000400_ccp_sync_actions.sql` | 08 | Permisos de acciones `SYNC_ENTITLEMENTS`/`GET_ENTITLEMENTS` en `provisioning_execution_context` (aditivo) | 15 |
| 17 | `20261005000100_ccp_usage_meters_events.sql` | 17 | `usage_meters`, `usage_events` (append-only, grant por columna en `internal`), `m2m_jti_replay`, RPC `ingest_usage_events` (service_role) | 15 |
| 18 | `20261005000200_ccp_usage_aggregates.sql` | 17 | `usage_period_aggregates`, `close_usage_period`, `finalize_usage_aggregate` | 17 |
| 19 | `20261005000300_ccp_ai_credits.sql` | 17 | `ai_credit_weights`, `ai_credit_policies`, `ai_credit_ledger`, vista `v_ai_credit_balances` | 18 |
| 20 | `20261008000100_ccp_invoice_lines_usage.sql` | 18 | `invoice_lines` + `usage_aggregate_id` (unique parcial no-VOID), `meter_code`, `corrects_line_id`; guard `DESCUENTO_EXCEDE_LINEA` | 1, 18 |
| 21 | `20261008000200_ccp_issue_invoice_usage.sql` | 18 | `issue_subscription_invoice` extendido (USAGE_OVERAGE + ADDON), sin cambios para suscripciones sin uso | 20, 19 |

Nota (orden 8/9): la migración de `subscription_items` lleva el timestamp `…000550` para aplicarse **antes** del lifecycle de `tenant_addons` (`…000600`), que la referencia. Los números de fila de la tabla son solo identificadores; el orden de aplicación lo da el timestamp.

**Seed:** `supabase/seed.sql` agrega `comerza`, `eexpense`, `ecommerce` a `saas_products` (hoy solo hay 5: `seed.sql:104-114`), con los mismos patrones de id (`20000000-…-0006..0008`), e integraciones `MOCK` locales. Sin precios nuevos, sin claves reales.

**Rollback de MasterAdmin:** todas las migraciones son aditivas. El rollback es una migración nueva que desactiva (revoca EXECUTE, pone kill-switch, `cutover_state=LEGACY_ONLY`), nunca `DROP` de datos comerciales. Cada fase deja escrita la migración de rollback **como archivo en `docs/runbooks/ccp-rollback/`** (no en `M/`), probada en local con `db reset` + aplicación manual en una base desechable.

---

## 5. Fase 03 — MasterAdmin P0 (DISCOUNT y autootorgamiento)

Worktree: MasterAdmin. Evidencia: `phase-03-masteradmin-p0.md`.

### Task MA-00 — Guarda de entorno y baseline

- **Crear** `scripts/ccp/guard-env.sh`: aborta (exit 2) si `VITE_SUPABASE_URL`/`SUPABASE_DB_URL` no es `127.0.0.1`/`localhost`, o si aparece un ref conocido remoto (`jivgwrczgdpsuvqcwqku`, `uvjmdphlnpyhtohobvzx`, `xikbhkfeaosasdltartg`).
- **Test** `scripts/ccp/guard-env.test.mjs` (vitest incluido vía `vite.config.ts` si se amplía `include`; si no, `node --test`): RED sin script, GREEN con script.
- Baseline: correr el gate §1.2 completo en el worktree y archivar logs `MA-00-baseline-*.txt` (esto prueba que la base está verde antes de tocar nada).
- Commit: `chore(ccp): add local environment guard and baseline evidence`.

### Task MA-01 — Test de preservación (INV-3/INV-4)

- **RED**: `supabase/tests/26_ccp_preservation.test.sql` compara `md5` de `tenant_product_mappings`, `saas_provisioning_requests`, `plan_prices(id,amount,currency,valid_from,valid_to)` y `catalog_items(code,price_month,currency)` contra constantes calculadas con el seed de `346aa72`. RED esperado: la primera ejecución falla porque las constantes aún son `'TBD'`; se rellenan con el valor medido en la base **antes** de cualquier migración del programa (se registra el comando y el valor en evidencia).
- **GREEN**: constantes rellenadas. El test queda verde y debe **seguir** verde hasta el final del programa. Solo la fase 07 puede actualizar el hash de `saas_products`/seed (y lo documenta).
- Commit: `test(ccp): pin provisioning mappings and business price values`.

### Task MA-02 — DISCOUNT resta exactamente una vez

Hallazgo verificado: DISCOUNT se guarda positivo (`M/20260907000100_admin_write_rpcs.sql:1439-1440`, UI `min(0)`); `recalc_invoice_totals` suma sin signo (`M/20260902000500_billing_and_costs.sql:95`), así que el descuento **aumenta** el total; `v_subscription_mrr` lo **excluye** (`M/20260902001100_metrics_views.sql:43`); `v_collected_revenue` lo trata como ingreso cobrado; `generate_commission_events` lo cuenta como base (`M/20260913000900:222`, `amount > 0`); `issue_subscription_invoice` lo marca `is_recurring` (`M/20260913001300:222`).

Representación propuesta (**P-01**, requiere visto bueno en GATE B):
- Magnitud positiva en `subscription_items.unit_amount` (sin cambiar RPC ni UI existentes).
- En `invoice_lines` se aceptan ambas formas: la histórica positiva y la correctiva negativa de spec §13.2. El signo contable se deriva **solo** por `platform.signed_line_amount(charge_kind, amount) = case when charge_kind='DISCOUNT' then -abs(amount) else amount end`. Así ninguna forma resta dos veces.
- `recalc_invoice_totals`, `v_subscription_mrr` (resta DISCOUNT recurrente), `v_collected_revenue`, read models ejecutivos y `issue_subscription_invoice` usan esa función.
- `generate_commission_events` excluye DISCOUNT del loop de líneas (hoy lo suma). No se agrega reducción de base: eso sigue siendo D-11.
- Facturas ya `ISSUED/PAID` con DISCOUNT positivo **no** se recalculan (son inmutables). La migración solo cambia la función; el trigger actúa en el próximo cambio de líneas, que para facturas emitidas está bloqueado. Una consulta de caracterización lista cuántas existen (local = 0 esperado; QAS se mide en fase 19, solo lectura) y se registra.

Ciclo:
- **RED** `supabase/tests/27_ccp_discount.test.sql`:
  - factura DRAFT con LICENSE 100 + DISCOUNT 10 → `total = 90` (hoy da 110);
  - suscripción con LICENSE 100 MONTHLY + DISCOUNT 10 MONTHLY → MRR 90 (hoy 100);
  - línea DISCOUNT negativa (−10) → mismo total 90 (no 80, no 110);
  - pago CONFIRMED sobre la factura → base de comisión = 100 (DISCOUNT no suma ni resta; hoy 110 bajo `COLLECTED_ANY`);
  - `v_collected_revenue` no reporta DISCOUNT como ingreso positivo;
  - `issue_subscription_invoice` sobre la misma suscripción produce total 90;
  - la factura emitida antes de la migración (fixture insertado como estado histórico) conserva su `total`.
- **RED** vitest `src/features/executive/kpis.test.ts` (existente o nuevo): el KPI MRR descuenta DISCOUNT.
- **GREEN** `M/20260928000100_ccp_discount_sign.sql`; `src/features/executive/kpis.ts:37` (comentario + lógica si calcula en cliente); `docs/finance/COST_MARGIN_MODEL.md:18` actualizado ("DISCOUNT resta de MRR y de la factura una sola vez").
- DISCOUNT ≠ reembolso ≠ nota de crédito: el test comprueba que ningún pago ni `payment` cambia de estado.
- Commit: `fix(finance): subtract DISCOUNT exactly once across invoice, MRR and commissions`.

### Task MA-03 — Cerrar autootorgamiento comercial (P0-MA-1)

- **RED** `supabase/tests/28_ccp_commercial_self_grant.test.sql` con `set local role` + `request.jwt.claims` para: `anon`, `authenticated` sin rol, TENANT_ADMIN del tenant, org admin, partner admin/comercial (`my_attributed_tenant_ids`), `EBIM_FINANCE`, `EBIM_PRODUCT_ADMIN`, super admin:
  - `insert/update/delete` directo en `tenant_addons` y `tenant_features` → denegado para **todos** los roles `authenticated` (hoy permitido a TENANT_ADMIN: `M/20260902000900_rls_policies.sql:300-315,393-414`);
  - `select` sigue funcionando según `can_read_tenant`;
  - `set_tenant_feature` (`M/20260907000100:792-836`) solo para plataforma, con `audit_log`;
  - RPC `set_tenant_addon_active(tenant, addon_code, active, reason)`: solo `can_manage_commercial()`; rechaza `catalog_items.available=false`; escribe `audit_log`; anon y `authenticated` sin rol → `42501`;
  - privilegios de la función: `has_function_privilege('public', …, 'execute') = false`, `proconfig` contiene `search_path`.
- **GREEN** `M/20260928000200_ccp_commercial_write_lockdown.sql`; `src/services/mutations.ts` agrega `useSetTenantAddonActive` (patrón `useRpc`); `src/types/database.types.ts` regenerado con `npm run db:types`.
- Configuración del tenant sobre capacidades ya otorgadas: MasterAdmin no expone ninguna hoy; se documenta que esa configuración vive en el SaaS (spec §2).
- Commit: `fix(security): remove tenant self-grant of add-ons and features`.

### Task MA-04 — Verificación de fase

- Gate §1.2 completo, `supabase db advisors` local si la CLI lo soporta (`supabase db lint`/`advisors --local`; si no existe, se registra), `git diff 346aa72 -- supabase/functions/_shared/provisioning supabase/functions/provisioning-*` = vacío.
- Evidencia + ledger. Commit: `docs(ccp): phase 03 evidence`.
- **Rollback boundary:** revert de los commits MA-02/MA-03 o migración de rollback en `docs/runbooks/ccp-rollback/03.sql` (restaura policies anteriores). Nunca se restaura el autootorgamiento en QAS sin decisión humana.

`PHASE_03=PASS` requiere MA-00..MA-04 verdes.

---

## 6. Fase 04 — eExpense P0

Worktree: `eExpenses/.worktrees/ebim-commercial-control-plane-v1` desde `f282dc4`. Proyecto remoto = productivo: **nada remoto**.

| Task | RED (test) | GREEN (archivos) | Commit |
| --- | --- | --- | --- |
| EX-00 | Baseline del gate §1.2 | — | `chore(ccp): baseline evidence` |
| EX-01 Helper de auth | `web/src/edge/requireTenantActor.test.ts`: sin `Authorization` → 401; anon key → 401; JWT válido sin membresía → 403; JWT de otro tenant → 403; miembro → `{userId, tenantId, roles}` | `supabase/functions/_shared/requireTenantActor.ts` (portable, sin `Deno.*` en la lógica; inyecta cliente) | `fix(security): add shared tenant actor resolution for edge functions` |
| EX-02 IA y fiscal autenticadas (P0-EX-1) | `web/src/edge/aiEndpointsAuth.test.ts`: para cada una de `capture-receipt`, `cfo-insights`, `close-entry`, `copilot-chat`, `fraud-check`, `parse-statement`, `policy-check`, `suggest-classification`, `fiscal-validate`, `sunat-validate`: anon → 401 y proveedor **no** invocado (fake fetch cuenta 0); miembro de otro tenant → 403 | Extraer el núcleo de cada `supabase/functions/<fn>/index.ts` a `<fn>/core.ts` testeable; `index.ts` llama `requireTenantActor` antes de leer `platform_secrets` | `fix(security): require authenticated tenant membership for AI and fiscal endpoints` |
| EX-03 WhatsApp firmado (P0-EX-5) | `web/src/edge/whatsappInboundSignature.test.ts`: sin `X-Twilio-Signature` → 403; firma inválida → 403; válida → procesa. Sin llamada al LLM en los 403 | `supabase/functions/whatsapp-inbound/{index,core}.ts`, `_shared/twilioSignature.ts` (HMAC-SHA1 según Twilio, comparación constante) | `fix(security): verify Twilio signature on whatsapp-inbound` |
| EX-04 Webhook de billing (P0-EX-3) | `web/src/edge/billingWebhook.test.ts`: sin firma → 401, firma inválida → 401, `gateway_ref` desconocido → 404 sin cambios, firma válida → marca `paid` una sola vez (idempotente) | `supabase/functions/billing-webhook/{index,core}.ts`; secreto por env, nunca en DB ni evidencia. Si el proveedor no define firma, **falla cerrado** (503 `WEBHOOK_NOT_CONFIGURED`) | `fix(security): authenticate billing-webhook and fail closed` |
| EX-05 Columnas comerciales (P0-EX-2) | `supabase/tests/ccp_commercial_columns_test.sql`: tenant admin `update tenants set plan/max_users/billing_mode/status` → denegado; puede actualizar columnas no comerciales existentes (nombre, branding…); `tenant_addons` insert/update → denegado; superadmin sigue pudiendo | Migración `supabase/migrations/20260928100000_ccp_commercial_columns_lockdown.sql`: revoca UPDATE por columna, reemplaza `tenants_write` (`M/20260626240000:130-133`) y `tenant_addons_write` (`:90-93`) | `fix(security): stop tenant admins from editing commercial columns and add-ons` |
| EX-06 platform-subscribe (P0-EX-4) | `web/src/edge/platformSubscribe.test.ts`: usuario sin rol admin → 403; `mode:'live'` desde el body se ignora: la función solo crea una **solicitud** (`REQUESTED`/lead), nunca activa | `supabase/functions/platform-subscribe/{index,core}.ts` | `fix(security): turn platform-subscribe into a request-only path` |
| EX-07 enroll-client | `web/src/edge/enrollClientInitialAdmin.test.ts` (existente) sigue verde; se agrega caso de regresión si falta | Sin cambios de código | commit conjunto con EX-08 |
| EX-08 Evidencia | Hash de precios (INV-4) sobre `plans`, `addons`; `billing-run` sin cambios de comportamiento (test de caracterización `web/src/edge/billingRunCharacterization.test.ts`) documentado como destino de migración | `docs/superpowers/evidence/commercial-control-plane/phase-04.md` | `docs(ccp): phase 04 evidence` |

Rollback: revert por commit; la migración EX-05 tiene su reverso en `docs/runbooks/ccp-rollback/04.sql`. Aplicación remota: **no** en este programa hasta GATE C + P-05.

---

## 7. Fase 05 — GMAO P0

Worktree: `GMAO/.worktrees/ebim-commercial-control-plane-v1` desde `90e501f`. Tests SQL en PGlite; esquema faltante en git se captura en `supabase/tests/20_provisioning_base.sql` (solo para tests), nunca inventando columnas: se toma de exports del operador o del uso en código, y se marca como "captura de tests".

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| GM-00 | Baseline §1.2 | — | `chore(ccp): baseline evidence` |
| GM-01 `ai_consume` | `supabase/tests/ccp_ai_consume.test.mjs` (registrado en `run_tests.mjs`): `p_units` 0, negativo, NULL, > 10 000 → error `P0001 CANTIDAD_INVALIDA`; negativo no decrementa `used`; llamada directa de `authenticated` vía REST sin feature válida → error | Migración `20260928200000_ccp_ai_consume_validation.sql` (redefine `ai_consume` de `M/20260710200000:52-80`) | `fix(security): validate ai_consume quantity` |
| GM-02 `set_addon` / plan IA | `ccp_ai_plan_authority.test.mjs`: owner/admin con `ajustes.editar` no puede cambiar `plan`/`monthly_quota` (`M/20260709150000:228-245`); sí puede cambiar config técnica declarada (lista blanca de claves, p. ej. idioma/modelo preferido si existe) | Migración `20260928200100_ccp_set_addon_technical_only.sql`; `web/src/lib/api.ts:954-958` (`setAiPlan`) deja de enviar campos comerciales | `fix(security): separate technical AI settings from commercial plan` |
| GM-03 `reset_ai_usage` | `ccp_reset_ai_usage.test.mjs`: tenant → denegado; service_role → permitido y auditado | Migración `20260928200200_ccp_reset_ai_usage_service_only.sql` | `fix(security): restrict AI usage reset to the platform` |
| GM-04 `translate` (P0-GM-2) | `supabase/functions/translate/translate_test.ts`: sin JWT → 401, fetch a Anthropic 0 veces; con usuario → consume `ai_consume` | `translate/{index,core}.ts` usando `_shared/jwtAuth.ts` y `_shared/tenant.ts` | `fix(security): require auth and metering for translate` |
| GM-05 `provision_or_attach_tenant` (P0-GM-3) | `run_provisioning_tests.mjs:285` (existente) verde; se agrega aserción de `has_function_privilege('anon', …)=false` | Ya corregido en `M/20260925002308`; solo evidencia | commit conjunto con GM-07 |
| GM-06 Secretos del gateway | `ccp_secret_visibility.test.mjs`: `authenticated` no puede leer `payment_config.secret_key`, `erp_connections.auth_secret`, email config secrets; `get_payment_config` devuelve solo `has_secret` | Migración `20260928200300_ccp_secret_column_grants.sql` **solo si** el test falla en la captura; el estado vivo se verifica en fase 19 con `has_table_privilege` de solo lectura | `fix(security): keep gateway secrets out of client roles` |
| GM-07 Moneda de `charge` | `supabase/functions/charge/charge_test.ts` de **caracterización**: documenta que `currency = cfg.currency ?? item.currency` y `amount = item.price_month` (`charge/index.ts:44-45`) sin conversión. Test marca el caso "moneda distinta" como `KNOWN_DEFECT` | Sin cambio de semántica (requiere migración aprobada, P-06). `charge` agrega check de rol admin (hoy no hay) con test RED/GREEN | `test(billing): characterize charge currency; require admin role` |
| GM-08 Evidencia | Hub intacto: tests confirman que `platform-register`/`platform-context` siguen respondiendo (fake fetch) | `docs/superpowers/evidence/commercial-control-plane/phase-05.md`; actualizar `EBIM-ESTADO-GMAO.md` **en el repo GMAO** según su `CLAUDE.md` (no en GUIDELINES_ROOT) y `graphify update .` si está instalado | `docs(ccp): phase 05 evidence` |

---

## 8. Fase 06 — eSupplier y eChange P0

### 8.1 eSupplier (worktree desde `a61dd22`)

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| SU-00 | Baseline | — | `chore(ccp): baseline evidence` |
| SU-01 `platform-catalog` (P0-SU-1) | `src/security/__tests__/platformCatalogAuthz.test.ts`: `subscribe`/`set_addon` sin sesión → 401; usuario no admin de la org → 403; admin → crea **solicitud**, no llama a `set_addon` del hub (fake fetch 0 llamadas a `set_addon`) | `supabase/functions/platform-catalog/{index,core}.ts` con `requireActor` (patrón `platform-context/index.ts:33`) | `fix(security): authenticate platform-catalog and stop add-on self-activation` |
| SU-02 `platform-context` IDOR (P0-SU-2) | `platformContextIdor.test.ts`: `org_id` de otra org → 403 | `platform-context/index.ts:46-49` liga `org_id` a la membresía de la sesión | `fix(security): bind platform-context org to the session` |
| SU-03 Gate server-side IA | `aiEntitlementGate.test.ts`: para una muestra por módulo de las 21 funciones IA (`ai-chat`, `contract-ai`, `tender-copilot`, `invoice-validator`, `supplier-risk`, …) sin add-on → 403 `CAPABILITY_NOT_ENTITLED` y proveedor no invocado; con add-on (fuente actual: hub `company_addons` vía contexto) → 200; `INCLUDED_ADDONS` (`src/stores/platformStore.ts:19`) permitidos | `supabase/functions/_shared/requireCapability.ts`; import en cada una de las 21 funciones (lista en evidencia) | `fix(security): enforce paid AI add-ons on the server` |
| SU-04 Cliente fail-closed | `src/hooks/__tests__/usePlatformAddons.test.ts`: `source==='local'` ya no concede sellables (`usePlatformAddons.ts:39-43`) | `src/hooks/usePlatformAddons.ts` | `fix(ui): fail closed for paid add-ons` |
| SU-05 Límites | `max_companies`/`max_users` **no** se aplican nuevos (D-05); solo test de caracterización de `checkCompanyPlanLimit` | — | commit conjunto con SU-06 |
| SU-06 P0-01/04/05/06 PARTIAL | Inventario por test: lista `SECURITY DEFINER` con EXECUTE a anon (`supabase/tests/ccp_definer_grants.sql`); los que conceden entitlements o IA se corrigen aquí; el resto se registra como deuda | Migración `supabase/migrations/20260928300000_ccp_definer_grants.sql` (revisar `KNOWN_DUPLICATE_TIMESTAMPS.txt`) | `fix(security): revoke anon execute on commercial definer functions` |
| SU-07 | Evidencia | `phase-06-esupplier.md` | `docs(ccp): phase 06 eSupplier evidence` |

Nota: la guía `.claude/skills/esupplier-dev.md:446` ("Allow all for anon") **no** se sigue.

### 8.2 eChange (worktree desde `3d6f34e`)

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| EC-00 | Baseline | — | `chore(ccp): baseline evidence` |
| EC-01 DEFINER con PUBLIC (P0-EC-1) | `supabase/tests/ccp_definer_public_test.sql`: `has_function_privilege('public', consumo_de_horas_de(...), 'execute')`, `satisfaccion_resumen_de`, `executive_summary_de` = false; `api-lectura` (`F/api-lectura/index.ts:100,107,118`) sigue funcionando con service_role | Migración `20260928400000_ccp_revoke_public_definer.sql` | `fix(security): revoke PUBLIC execute on reporting definer functions` |
| EC-02 Agentes add-on (P0-EC-2) | `ccp_agent_entitlement_test.sql`: owner con `update ai_agents set enabled=true` en agente `billing='addon'` no contratado → denegado; puede apagar (`true→false`) y encender agentes `core`/incluidos; `price_month` sigue no escribible | Migración `20260928400100_ccp_agent_enable_guard.sql`: trigger `BEFORE UPDATE OF enabled` que exige `commercially_entitled` (columna nueva, escrita solo por service_role; valor inicial = estado actual de `enabled` para no cambiar comportamiento en tenants existentes) | `fix(security): owners can only disable paid AI agents` |
| EC-03 Canales add-on | Igual para `channels` `billing='addon'` | Misma migración o `…400200` | `fix(security): owners can only disable paid channels` |
| EC-04 | Hash de `service_rates`, `billing_plans`, `ai_agents.price_month`, `channels.price_month` sin cambios (INV-4); evidencia | `phase-06-echange.md` | `docs(ccp): phase 06 eChange evidence` |

---

## 9. Fase 07 — Núcleo comercial de MasterAdmin

Worktree MasterAdmin. Sin sync con SaaS. Tests pgTAP `29`–`34`.

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| MA-10 Enum | `29_ccp_capabilities.test.sql` parte 1: `'USAGE_OVERAGE' = any(enum_range(null::platform.charge_kind)::text[])` | Migración 3 (§4) | `feat(billing): add USAGE_OVERAGE charge kind` |
| MA-11 Registro de capacidades | `29_…`: forma de `code` (`^[a-z0-9]+(\.[a-z0-9_]+)+$`, prefijo = producto), unique, `kind` válidos, alias únicos; `import_capability_manifest(product, jsonb)` idempotente, rechaza códigos de otro producto, solo `can_manage_platform_entities()`; privilegios anon/authenticated | Migración 4; `src/features/commercial/capabilities/CapabilitiesPage.tsx` (solo lectura + importar manifiesto), hooks en `src/services/queries.ts`/`mutations.ts` | `feat(commercial): add product capability registry and aliases` |
| MA-12 Catálogo extendido | `30_ccp_catalog_item_prices.test.sql` parte 1: filas existentes intactas (hash INV-4), `lifecycle_status` derivado de `available`, `billing_model` derivado de `scope` | Migración 5 | `feat(catalog): extend catalog items with product, lifecycle and billing model` |
| MA-13 Precios de add-on | `30_…`: solapes rechazados (GiST), `MERCADO_REQUERIDO`, `PRECIO_HISTORICO_INMUTABLE`, precio vigente por fecha, `set_catalog_item_price` solo finanzas; espejo 1:1 de los casos de `08_v3_regional_pricing.test.sql` | Migración 6; `src/features/catalog/AddonPriceList.tsx` (patrón `RegionalPriceList`) | `feat(catalog): add effective-dated regional add-on prices` |
| MA-14 Grants y overrides | `31_ccp_entitlement_grants.test.sql`: forma de `grant` por `kind`, inmutable salvo `valid_to`, sin solapes, override exige `reason`/`approved_by`/`expires_at` | Migración 7 | `feat(commercial): add plan and add-on entitlement grants` |
| MA-15 `subscription_items.source_type` | `32_ccp_tenant_addon_lifecycle.test.sql` parte 1: ítems existentes = `MANUAL`; `issue_subscription_invoice` produce **las mismas líneas** que antes para todas las suscripciones del seed (test "antes = después" con tabla temporal capturada antes de la migración) | Migración `…000550` | `feat(billing): tag subscription items by source` |
| MA-16 Lifecycle de add-on | `32_…`: todas las transiciones del diagrama spec §6.2 válidas e inválidas; `approve` crea `subscription_item` ADDON con `price_ref` en la misma transacción; `TARIFA_ADDON_NO_DEFINIDA` sin precio en suscripción no-DEMO; DEMO permitido sin precio; `COMING_SOON`/`DRAFT` no activables; cada transición escribe `audit_log` y marca dirty (columna provisional hasta fase 08); roles: tenant admin y partner solo `request`; filas existentes → `ACTIVE` | Migración 8; `src/features/tenants/TenantAddonsPanel.tsx` en `TenantDetailPage`; hooks RPC | `feat(commercial): add audited tenant add-on lifecycle` |
| MA-17 `compute_entitlements` | `33_ccp_compute_entitlements.test.sql` con tablas de verdad: baseline solo con app activa; plan ∪ add-on; `combine_rule` MAX/SUM; scope COMPANY; override; downgrade (add-on `CANCEL_SCHEDULED` sigue activo hasta `effective_to`); cancelado no aparece; aislamiento: tenant A no ve grants de B; función STABLE e INVOKER | Migración 10 | `feat(commercial): compute effective entitlements` |
| MA-18 Read model de features | `33_…` parte 2: `refresh_tenant_features` materializa `source='ENTITLEMENT'`; overrides `MANUAL` existentes intactos; `authenticated` sigue sin escritura | Migración 11 | `feat(commercial): derive tenant features from entitlements` |
| MA-19 Vistas y 8 productos | `34_ccp_eight_products.test.sql`: `db reset` produce los 8 `saas_products`; `00_structure.test.sql:146` se actualiza de 5 a 8 códigos (cambio de test justificado en el commit); vistas `security_invoker=true`; ninguna fila de seed con secreto (`credential_profiles` solo `secret_ref` a nombres de env `LOCAL_*`) | Migración 12; `supabase/seed.sql` | `feat(commercial): add read models and seed all eight products locally` |
| MA-20 Cierre | Gate completo + `26_ccp_preservation` verde + `git diff 346aa72 -- <provisioning>` vacío; `npm run build`; evidencia `phase-07.md` | — | `docs(ccp): phase 07 evidence` |

UI: rutas nuevas en `src/app/App.tsx` (`commercial/capabilities`, `catalog/addons`) y `src/app/navigation.ts`, gateadas por los mismos helpers de permiso que `products`. Tests RTL por página: render + estado vacío + error.

---

## 10. Fase 08 — Contrato `SYNC_ENTITLEMENTS`

### 10.1 MasterAdmin

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| MA-30 JCS + checksum | `supabase/functions/_shared/entitlements/jcs.test.ts` contra `contracts/entitlements/v1/jcs-vectors.json` | `F/_shared/entitlements/jcs.ts`; `contracts/entitlements/v1/{README.md,jcs-vectors.json}` | `feat(entitlements): add RFC 8785 canonical JSON and checksum` |
| MA-31 Constructor de snapshot | `snapshot.test.ts`: determinismo (mismo estado → mismo JSON byte a byte), lista completa de sellables `ACTIVE`, claves prohibidas → excepción, ≤ 64 KB, `idempotencyKey = ma-ent-v1-sha256(tenant:product:version)` | `F/_shared/entitlements/{snapshot,types}.ts` | `feat(entitlements): build versioned entitlement snapshots` |
| MA-32 Persistencia y versión | `35_ccp_entitlement_snapshots.test.sql`: `issue_entitlement_snapshot` monótono bajo advisory lock (dos sesiones), sin versión nueva si el contenido no cambia, append-only (update/delete → error), `effectiveAt ≤ now()`, solo service_role | Migración 13 | `feat(entitlements): persist immutable versioned snapshots` |
| MA-33 Estado de sync | `36_ccp_entitlement_sync_state.test.sql`: cada transición de la tabla spec §9 (13 estados), `consecutive_failures`, lease de `PUSHING` expira, `DRIFT_AHEAD` no hace push, `NOT_ENROLLED` con `LEGACY_ONLY` | Migración 14; `F/_shared/entitlements/states.ts` + `states.test.ts` (función pura de transición, espejo de la SQL) | `feat(entitlements): track desired versus applied state` |
| MA-34 Integraciones y cutover | `36_…` parte 2: columnas de `product_integrations` nulas/`LEGACY_ONLY` por defecto; `set_commercial_cutover_state` solo avanza un paso o retrocede uno; escribe `commercial_cutover_events`; kill-switch | Migración 15 | `feat(entitlements): add per-product cutover state and kill switch` |
| MA-35 Cliente M2M | `F/_shared/entitlements/sync-client.test.ts`: PUT con headers `Idempotency-Key`, `X-Correlation-Id`, `X-MasterAdmin-Contract: entitlements.v1`; scopes `<product>:entitlements:write/read` (no reutiliza `scopesFor` de provisioning); reusa `url-guard.ts`, `retry.ts`, `m2m.ts` (`buildM2mClaims`) sin modificarlos; mapea cada respuesta de `expected/put-responses.json` al estado correcto | `F/_shared/entitlements/sync-client.ts` | `feat(entitlements): add M2M sync client` |
| MA-36 Acciones del orquestador | `F/_shared/provisioning/actions.test.ts` **extendido solo con casos nuevos**: `SYNC_ENTITLEMENTS`/`GET_ENTITLEMENTS` ruteadas y con permiso; los casos existentes intactos. `http-m2m.generic-golden.test.ts` y `ewm-v1.test.ts` sin editar y verdes | `actions.ts` (unión de tipo aditiva en `:12`, entradas nuevas en el mapa `:29-42`); `provisioning-orchestrator/index.ts` (ramas nuevas, las existentes sin cambios); migración 16 | `feat(provisioning): add SYNC_ENTITLEMENTS and GET_ENTITLEMENTS actions` |
| MA-37 Worker de jobs | `supabase/functions/entitlement-sync/core.test.ts`: `push` toma `PENDING_PUSH` con `SKIP LOCKED` (simulado), `verify` usa **solo** el GET para `IN_SYNC`, `registry-verify` produce `REGISTRY_DRIFT`; nunca escribe en la base del SaaS | `supabase/functions/entitlement-sync/{index,core}.ts` | `feat(entitlements): add push, verify and registry-verify jobs` |
| MA-38 Receptor de referencia y fixtures | `contracts/entitlements/v1/reference-receiver.test.ts`: un receptor en memoria (solo para tests) implementa spec §8.2 y pasa **todos** los fixtures; así los fixtures quedan validados antes de que un SaaS los use | `contracts/entitlements/v1/{schema.json,manifest.schema.json,fixtures/*,expected/*,CHECKSUMS.sha256}`, `contracts/entitlements/v1/reference-receiver.ts`; `vite.config.ts` incluye `contracts/**/*.test.ts` | `feat(contracts): publish entitlements v1 golden fixtures` → **FIX-ENT-v1** |
| MA-39 UI de sync | RTL: `src/features/commercial/sync/EntitlementSyncPage.tsx` muestra desired/applied/state por tenant×producto; botón "sincronizar" invoca la acción del orquestador | archivos UI + hooks | `feat(ui): show entitlement sync state` |
| MA-40 Cierre | Gate completo + e2e local + evidencia `phase-08.md` con el hash de `CHECKSUMS.sha256` publicado | — | `docs(ccp): phase 08 evidence` |

EWM_V1: el adaptador EWM gana la capacidad `SYNC_ENTITLEMENTS` como valor nuevo de `AdapterCapability` (`types.ts:28`); `ewm-v1.test.ts` agrega casos, no edita los existentes.

### 10.2 Contrato compartido del receptor SaaS (se implementa en 09–16)

Cada SaaS implementa exactamente esto, con los fixtures FIX-ENT-v1:
1. Tablas: `entitlement_snapshot_applied` (una fila por tenant: JSON, versión, checksum, `applied_at`, `status`, `unknown_capabilities`), `entitlement_apply_audit` (append-only), `entitlement_jti_replay` (PK `(issuer, jti)`, TTL), `entitlement_shadow_diffs` (fase de rollout), `entitlement_enforcement_mode` (LEGACY/SHADOW/DUAL_READ/PRIMARY, por producto y opcional por tenant). Sin grants a roles de tenant.
2. RPC/servicio de aplicación ejecutable solo por service_role (o el rol técnico del backend Java), que hace los pasos 1–7 de spec §8.2 en una transacción.
3. Rutas `PUT|GET /tenants/{id}/entitlements` y `GET /entitlements/manifest` en el receptor de provisioning existente, con scopes nuevos por env (`…_M2M_ENTITLEMENTS_WRITE_SCOPE`, `…_READ_SCOPE`). Las rutas existentes no cambian (INV-1).
4. Tests obligatorios (nombres por repo en cada fase): los 12 fixtures; scope incorrecto → 403; credencial de provisioning sin scope nuevo → 403; `jti` reutilizado → 401; `appActive=false`; offline (MasterAdmin inalcanzable: el gate local sigue decidiendo con el último snapshot); pin de fixtures; JCS vectors.
5. Manifiesto: `docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json` (versionado) + respuesta de `GET /entitlements/manifest`, igual byte a byte (test).

---

## 11. Fases 09–16 — Receptores y enforcement por producto

Estructura común de cada fase: **X-00** baseline · **X-01** pin de fixtures + JCS · **X-02** migración de tablas + RPC de aplicación · **X-03** rutas PUT/GET/manifest · **X-04** enforcement server-side desde el snapshot local (según `enforcement_mode`) · **X-05** shadow diff legacy vs snapshot · **X-06** offline last-good · **X-07** integración local contra MasterAdmin local (push real M2M con claves locales generadas en el momento, nunca commiteadas) · **X-08** evidencia. Estado de cutover al cerrar la fase: `SHADOW` en local; `DUAL_READ`/`PRIMARY` solo en la certificación local de la fase 18 y con D-14.

### 11.1 Fase 09 — eCommerce (piloto)

- Migración `supabase/migrations/20261001100000_masteradmin_entitlements.sql`: tablas §10.2 en schema `platform_provisioning`; RPC `public.platform_apply_entitlements(jsonb)` (service_role) que traduce códigos (1:1, ya dot-notation) y llama a `sync_platform_context` (`M/20260827160000:363`) con `source` nuevo `'masteradmin'` (valor aditivo al enum `entitlement_source` `:32`, migración aislada `20261001090000_entitlement_source_masteradmin.sql`); allowances → `ai_quotas` (`M/20260910100000:40`) solo si el snapshot las trae (D-03); `legacy_until_synced` (`M/20260914180000:78`) se resuelve al primer snapshot aplicado.
- Rutas en `supabase/functions/_shared/platformProvisioning/handler.ts` `resolveRoute` (`:70`); scopes en `m2m.ts` `loadM2MConfig` (`:79`); métodos en `repository.ts`.
- Tests: `supabase/tests/platform-entitlements-contract.test.ts` (vitest + PGlite harness), `supabase/tests/platform-entitlements-db.test.ts`, `supabase/tests/database/platform_entitlements.test.sql` (pgTAP), `supabase/tests/capability-enforcement.test.ts` extendido: capacidad `enabled:false` → `assert_capability` falla aunque `tenant_feature_flags` diga true; flags solo restan; hard gate de IA (`ai_consume`) intacto.
- H-ECO-1: test que prueba que el modo clave estática (`_shared/platform-context.ts:134-186`) queda **desactivado** cuando `enforcement_mode=PRIMARY` para el tenant; en `LEGACY/SHADOW` sigue igual.
- Criterio de éxito del piloto (prompt 09): fixture MasterAdmin → apply → gate server → GET misma versión/checksum → replay 200 → stale 409 → conflict 409. Si falla, **no** se inician 10–16.
- Commits (español): `feat(entitlements): receptor de snapshot MasterAdmin`, `feat(entitlements): enforcement desde snapshot local`, `test(entitlements): contrato v1 y escenario offline`, `docs(ccp): evidencia fase 09`.

### 11.2 Fase 10 — EWM (Java + Flyway; tablas IA en historial Supabase)

- Flyway `backend/wms-api/src/main/resources/db/migration/V49__platform_entitlements.sql`: tablas §10.2 (lectura separada de escritura, RLS + REVOKE en la misma migración). `SchemaIT` debe seguir verde.
- `company_ai_agents` vive en `supabase/migrations/20260805120000_ai_fleet.sql:78`: la materialización es **DML** desde Java sobre esa tabla (no DDL cruzado), con el mismo rol operador que hoy escribe (`20260805140000_fix_agent_entitlement_rls.sql`).
- Paquete nuevo `com.ebim.wms.platform.entitlements.{api,application,domain,infrastructure}`: `PlatformEntitlementsController` bajo `/internal/platform/v1`, `ApplyEntitlementSnapshotUseCase`, `EntitlementSnapshot`, `Jcs`, `EntitlementSnapshotRepository`. Matchers nuevos en `PlatformM2mSecurityConfig.java:123-126` antes de `denyAll`; scopes nuevos en `PlatformScope.java` (`ewm:entitlements:write|read`).
- `AgentEntitlementService` lee el snapshot según `enforcement_mode`; `wms_agent_active` (`:114`) queda como fuente legacy.
- `NarrationBudget` (en memoria) → contador durable `V50__narration_budget_counter.sql` + `NarrationBudgetRepository`; `NarrationBudgetTest` extendido (reinicio del proceso no reinicia el contador).
- Outbox de uso IA: se prepara en fase 17 sobre `evt_outbox_event` (V17) con `event_type='usage.v1'`; aquí solo el hook con billing desactivado.
- Tests: `PlatformEntitlementsContractTest` (fixtures), `PlatformEntitlementsIT`, `PlatformEntitlementsSecurityIT` (scope provisioning ≠ entitlements), `EntitlementShadowDiffTest`. `PlatformProvisioningIT` y fixtures EWM_V1 sin cambios.
- Push/migraciones remotas: requieren autorización de Dennis por lote (§0.3).

### 11.3 Fase 11 — Comerza

- Migración `supabase/migrations/20261003100000_platform_entitlements.sql`: tablas en schema `operator`; RPC `public.platform_apply_entitlements` (service_role, check de company dentro de la función, lección `20260815091000`) que escribe `config_layers.config->'features'` a nivel org para `comerza.storefront`/`comerza.erp_connector` y un flag nuevo `ai_whatsapp_agent`. Flags técnicos existentes solo pueden restar.
- Rutas en `supabase/functions/_shared/provisioning/handler.ts` `route()` (`:254`), store en `platform-provisioning/index.ts` `createStore`.
- Gate server-side del agente Gemini: `supabase/functions/whatsapp-webhook/index.ts:191` y `services/baileys/src/index.js:281` consultan `public.comerza_has_capability(org, code)` (lectura del snapshot local, sin llamada a MasterAdmin). Baileys: test en `services/baileys/test/capabilityGate.test.js`.
- Presupuesto de proveedor compartido: contador por tenant del período (no comercial, operativo) para que un tenant no agote la clave común.
- "Cero comisión" ≠ add-ons gratis: test de que `vitrina`/`erp_connector` sin snapshot `enabled:true` quedan apagados en `PRIMARY`.
- Tests: `tests/provisioning/entitlements.test.ts`, `tests/edge/platform-entitlements.test.ts`, `supabase/tests/platform_entitlements.sql`, `tests/guards/sql-contract.test.ts` actualizado solo con objetos nuevos.

### 11.4 Fase 12 — TMS

- ADR nuevo `docs/architecture/ADR-013-commercial-entitlements.md` (regla del repo).
- Flyway `V52__platform_entitlements.sql` en schema `tms`.
- `PlatformProvisioningPaths` + `TENANT_ENTITLEMENTS="/tenants/*/entitlements"`, `MANIFEST="/entitlements/manifest"`; controller hermano `iam/entitlements/api/PlatformEntitlementsController`; `PlatformProvisioningSecurityConfig` (`:113-118`) + `PlatformScopes` (`tms:entitlements:write|read`).
- `iam/entitlements/application/CommercialEntitlementService` (por tenant), **separado** de `shared/security/Permission` (RBAC). Registro de sellables vacío; `appActive=false` bloquea acceso operativo vía filtro dedicado. No se convierte ningún permiso RBAC en capacidad pagada.
- Sin medidores (no hay aprobados); fase 17 no aplica salvo D-06.
- Tests: `PlatformEntitlementsApiTest` (`@WebMvcTest`), `CommercialEntitlementServiceTest`, `PlatformEntitlementsContractFixturesTest`; suites de provisioning sin cambios.

### 11.5 Fase 13 — eSupplier

- Migración `supabase/migrations/20261006100000_platform_entitlements.sql` (schema `public` con RLS deny + grants solo service_role; revisar duplicados de timestamp).
- Rutas en `supabase/functions/platform-provisioning/handler.ts` `resolveRoute` (`:56`), `repository.ts`.
- `_shared/requireCapability.ts` (fase 06) cambia de fuente según `enforcement_mode`: LEGACY = hub, SHADOW = hub + diff, DUAL_READ/PRIMARY = snapshot.
- Jobs IA programados (`portfolio-risk-sweep`, `supplier-portfolio`) verifican capacidad y asignación antes de consumir.
- Aliases hub → canónico (`dorothy_copilot` → `esupplier.ai.dorothy_copilot`, etc.) en `docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`.
- Drift de migraciones manuales documentado en evidencia (no se oculta).
- Tests: `src/security/__tests__/platformEntitlements{Contract,Handler,Gate,Offline}.test.ts`, `supabase/tests/platform_entitlements_rpc.sql`.

### 11.6 Fase 14 — eChange

- Solo licenciamiento EBIM: `echange.ai.<agente>` para los 4 agentes add-on, `echange.channels.<canal>` para canales add-on, allowance `echange.cases.included` (valor solo si D-05/D-06). `service_rates` **fuera de alcance** (test de hash INV-4).
- Migración `supabase/migrations/20261007100000_platform_entitlements.sql` (schema `privado`), RPC que escribe `ai_agents.commercially_entitled` y el equivalente de canales (fase 06), `enabled = snapshot ∧ flag_local`.
- Rutas en `supabase/functions/platform-provisioning/handler.ts` (`resolveRoute` `:59`), `repository.ts`, `contract.ts`.
- Dual-read: `supabase/functions/_shared/commercialParity.ts` + reporte `docs/superpowers/evidence/commercial-control-plane/echange-parity.md` (tabla de diferencias `billing_plans`/`channel_billing_events` vs MasterAdmin). El pricing local no se retira.
- Tests: `web/src/edge/platformEntitlements{,Contrato,Paridad}.test.ts`, `supabase/tests/platform_entitlements_test.sql`.

### 11.7 Fase 15 — eExpense

- Migración `supabase/migrations/20261008100000_platform_entitlements.sql` (schema `private`) + RPC service_role.
- Rutas en `supabase/functions/platform-provisioning/handler.ts` (`resolveRoute` `:59`), scopes en `_shared/platformM2M.ts` `loadM2MConfig` (`:82`).
- `requireTenantActor` (fase 04) + `requireCapability` en las 9 funciones IA; `useModuleGate.ts` pasa a fail-closed para sellables (solo UX).
- Eje de facturación con estados explícitos `LEGACY_AUTHORITY → SHADOW → MASTERADMIN_AUTHORITY → RETIRED` en `private.billing_authority(tenant_id, state)`; `billing-run` (`F/billing-run/index.ts:68`) excluye tenants `MASTERADMIN_AUTHORITY`; en `SHADOW` calcula y guarda comparación, **nunca cobra**. Test de "nunca dos cobradores".
- Sin llamadas reales al gateway en tests (fake). `MASTERADMIN_AUTHORITY` no se alcanza hasta paridad DEV verde.
- Tests: `web/src/edge/platformEntitlements*.test.ts`, `web/src/edge/billingAuthority.test.ts`, `supabase/tests/platform_entitlements_test.sql`.

### 11.8 Fase 16 — GMAO + hub

- Captura previa: esquema del hub usado por los tests en `supabase/tests/20_provisioning_base.sql` a partir de **export del operador** (comando de solo lectura emitido y registrado); sin export, las tareas del hub quedan `BLOCKED` y el resto de la fase sigue.
- `supabase/functions/hub-commercial-export/` (solo lectura, service_role, sin secretos) para inventario de `catalog_items`/`company_addons`/`workspace_subscriptions`; MasterAdmin importa como alias `GMAO_HUB` + reporte de diferencias (sin precios vigentes, D-01).
- Receptor: rutas en `supabase/functions/platform-provisioning/handler.ts` (`ROUTE_*` junto a `:37-39`), scopes en `m2m_auth.ts` `loadM2MConfig` (`:138`), store en `adapters.ts`/`service.ts`; RPCs `platform.m2m_apply_entitlements` (service_role).
- Snapshot → `platform.tenant_addons` local + `ai_usage` + límites (solo si D-05).
- Estados explícitos `LEGACY_AUTHORITY → DUAL_READ → SHADOW → MASTERADMIN_AUTHORITY → READONLY → RETIRED` por producto consumidor del hub.
- Congelamiento de escrituras comerciales del hub (`set_addon`, `hub_subscribe`, `activate_catalog_item`) **por producto** y solo cuando ese producto llega a `MASTERADMIN_PRIMARY`; test por producto.
- Checklist de retiro: `docs/runbooks/gmao-hub-retirement-checklist.md`. Nada se retira en este programa.
- Tests: `supabase/functions/platform-provisioning/entitlements_test.ts`, `supabase/tests/ccp_entitlements.test.mjs`, `hub_parity_test.ts`.

---

## 12. Fase 17 — Uso y créditos IA

### 12.1 MasterAdmin

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| MA-50 | `37_ccp_usage_ingest.test.sql`: `ingest_usage_events` solo service_role; `ACCEPTED`/`DUPLICATE`/`CONFLICT`/`UNKNOWN_METER`/`TENANT_NOT_MAPPED_FOR_PRODUCT`; negativo rechazado salvo `allows_negative`; `internal` invisible para roles no finanzas (grant por columna); append-only | Migración 17 | `feat(usage): add meters and append-only idempotent usage events` |
| MA-51 | `supabase/functions/usage-ingest/core.test.ts`: JWT del SaaS (ES256, `aud=masteradmin.ebim`, `usage:ingest`), `jti` de un solo uso, ≤ 500 eventos, ≤ 256 KB, `environment`; **ingest deshabilitado** por flag hasta D-12 (test: flag off → 503 `USAGE_INGEST_DISABLED`) | `supabase/functions/usage-ingest/{index,core}.ts`, `F/_shared/usage/*` | `feat(usage): add signed usage ingest endpoint` |
| MA-52 | `38_ccp_usage_aggregates.test.sql`: asignación por `occurred_at` UTC; `OPEN→CLOSING→FINALIZED`; `FINALIZED` inmutable; `source_hash`; tardíos → siguiente período con `late=true`; DEMO `is_billable=false` | Migración 18 | `feat(usage): aggregate and finalize usage periods` |
| MA-53 | `39_ccp_ai_credits.test.sql`: ledger append-only, unique por clave, peso vigente en `occurred_at` guardado en la entrada, saldo por pool, `REVERSAL`, sin `ROLLOVER`/`EXPIRE` sin política (D-04), `POLITICA_CREDITOS_NO_DEFINIDA` | Migración 19 | `feat(ai-credits): add append-only credit ledger and balances` |
| MA-54 | Fixtures `contracts/usage/v1/**` + receptor de referencia de lote | archivos contrato | `feat(contracts): publish usage v1 fixtures` → **FIX-USG-v1** |

### 12.2 SaaS (outbox)

Una tarea por repo, misma forma: tabla outbox nueva (sin grants a tenant), escritura en la misma transacción o en el `finally` del pipeline IA, `event_id` generado en origen, tokens reales solo si el proveedor los devuelve (nunca inventados), worker con backoff que marca `sent` solo en `ACCEPTED`/`DUPLICATE`.

| Repo | Punto de enganche | Outbox |
| --- | --- | --- |
| eCommerce | `ebim.ai_record` (`M/20260921120000_ai_core.sql:462/521`), `_shared/aiCore.ts` | `platform_provisioning.usage_outbox`; worker en `functions/integration-worker` o función nueva `usage-outbox-worker` |
| EWM | `NarrationBudget.registrar`, servicios de agentes IA | `evt_outbox_event` con `event_type='usage.v1'` (sin tabla nueva) |
| Comerza | `whatsapp-webhook`, Baileys | `operator.usage_outbox` |
| eSupplier | `_shared/aiGateway.ts` + 19 funciones con fetch directo (migrar a gateway o hook común) | `public.usage_outbox` |
| eChange | `_shared/client.ts:43` `callClaude` (hoy descarta el uso), Deepgram `_shared/twilioMedia.ts:131-151` | `privado.usage_outbox` |
| eExpense | las 9 funciones IA | `private.usage_outbox` |
| GMAO | `ai_consume` callers (`agent-gateway:323`, …), `translate` | `platform.usage_outbox` |
| TMS | no aplica (sin medidores aprobados) | — |

Compatibilidad: cuotas por acción existentes pueden mapearse a peso 1 **solo** si se aprueba (D-03).

---

## 13. Fase 18 — Facturación y certificación LOCAL/DEV 8/8

| Task | RED | GREEN | Commit |
| --- | --- | --- | --- |
| MA-60 | `40_ccp_billing_usage.test.sql`: línea `USAGE_OVERAGE` referencia agregado `FINALIZED` (nunca evento crudo); unique por agregado no-VOID; idempotente por período; sin política o sin precio → no hay línea + alerta; suscripción sin uso → factura idéntica a la de antes (captura previa); ADDON ligado a `catalog_item` + `price_ref`; DISCOUNT correctivo con `corrects_line_id` y `DESCUENTO_EXCEDE_LINEA`; ningún `tax_amount` nuevo; DEMO no facturable | Migraciones 20, 21 | `feat(billing): invoice finalized usage overage and corrective discounts` |
| MA-61 | Limitación de montos variables en la pasarela documentada con test de caracterización (`src/features/billing/…`) | `docs/finance/USAGE_BILLING.md` | `docs(billing): document variable recurring amount limits` |
| MA-62 | Script `scripts/ccp/certify-local.sh`: levanta los stacks locales disponibles, ejecuta por producto los 15 checks del prompt 18 y escribe JSON por producto | script + `scripts/ccp/checks/*.mjs` | `test(ccp): add reproducible local 8/8 certification` |
| MA-63 | Ejecutar suites completas por repo (§1.2) | `docs/superpowers/evidence/commercial-control-plane/DEV_SYNCHRONIZATION_MATRIX.md` | `docs(ccp): 8/8 local synchronization matrix` |

Resultado: `DEV_ALL_8_SYNCHRONIZED=YES` solo si los 8 cumplen spec §19.1 en local; si no, `PHASE_18=BLOCKED` con la fila que falla.

---

## 14. Fases 19–21 — QAS y cierre (solo tras GATE C)

- Fase 19 solo con `PROMOTE_COMMERCIAL_CONTROL_PLANE_TO_QAS=YES` en el prompt del runner.
- Orden: (1) migraciones aditivas de seguridad/esquema de MasterAdmin, (2) funciones `entitlement-sync`/`usage-ingest` (ingest apagado hasta D-12), (3) receptor SaaS **uno por uno**, (4) enforcement, (5) legados en `DUAL_READ`/`SHADOW`, (6) UI.
- Cada paso remoto lo ejecuta el operador con el comando mínimo emitido por el agente (regla MasterAdmin `CLAUDE.md`: el agente no hace `link/push/reset` remoto). Nada de `db push` en repos con drift: SQL revisado con `psql -1 -f` + `migration repair` por el operador.
- eExpense y GMAO: ver **P-05**. Sin decisión, esos dos productos quedan `BLOCKED` en QAS y la certificación 8/8 QAS no puede cerrarse.
- Después de cada producto: verificación de solo lectura + smoke de contrato; si falla, se detiene ese producto y se preserva el último estado bueno.
- Fase 20: matriz `PRODUCT | ENTITLEMENT | RECONCILIATION | ENFORCEMENT | USAGE | AI_CREDITS | LEGACY_MODE | STATUS`, tenants DEMO certificados existentes.
- Fase 21: runbook PRD solamente, `PRD_MUTATIONS=NONE`.

---

## 15. Límites de rollback por fase

| Fase | Unidad de rollback | Cómo |
| --- | --- | --- |
| 03–06 (P0) | Commit por tarea | `git revert` en la rama del programa; reverso SQL en `docs/runbooks/ccp-rollback/NN.sql`. No se reintroduce un P0 en un entorno remoto sin decisión humana |
| 07 | Migraciones 3–12 | Aditivas; rollback = revocar EXECUTE de RPCs nuevos + `lifecycle_status` ignorado. El enum `USAGE_OVERAGE` no se elimina (no hay `DROP VALUE`) |
| 08 | Migraciones 13–16 + funciones | Kill-switch `entitlements_push_enabled=false`; acciones nuevas sin permiso; FIX-ENT-v1 inmutable (correcciones = v1.1 aditivo) |
| 09–16 | Por producto | `enforcement_mode` un paso atrás (spec §15.1); el SaaS vuelve a legacy; snapshot aplicado se conserva |
| 17 | Por producto y global | Flag de ingest off; outbox acumula; eventos idempotentes |
| 18 | Por tenant | `BILLING_LEGACY`; facturas DRAFT de MasterAdmin anuladas; nunca VOID sobre pagos `CONFIRMED` |

---

## 16. Evidencia por fase

Bajo `masteradmin/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/`:

| Archivo | Contenido mínimo |
| --- | --- |
| `program-ledger.md` | Entrada por fase |
| `phase-03-masteradmin-p0.md` | RED/GREEN por tarea, matriz de roles de self-grant, diff de provisioning vacío |
| `phase-04-eexpense-p0.md` … `phase-06-*.md` | Resumen + enlace a la evidencia del repo SaaS y hashes de commit |
| `phase-07-core.md` | Tablas de verdad de `compute_entitlements`, reset con 8 productos |
| `phase-08-sync-contract.md` | Hash de FIX-ENT-v1, estados de sync probados, golden intactos |
| `phase-09-ecommerce.md` … `phase-16-gmao.md` | Criterio de éxito del piloto/receptor, shadow diffs |
| `phase-17-usage.md` | Ingest, agregados, ledger |
| `DEV_SYNCHRONIZATION_MATRIX.md` | Fase 18 |
| `logs/<task-id>-{red,green}.txt` | Salidas de tests (sin secretos; se pasan por el secret scan) |
| `supabase-cli-<repo>.txt` | Versión y `--help` de la CLI por repo (§0.2) |

---

## 17. Decisiones que este plan necesita del humano (GATE B)

| ID | Decisión | Propuesta del plan | Bloquea |
| --- | --- | --- | --- |
| P-01 | Representación de DISCOUNT | Magnitud positiva en ítems; signo derivado por `charge_kind` con `signed_line_amount`; acepta líneas correctivas negativas sin doble resta; MRR resta DISCOUNT recurrente; comisiones excluyen DISCOUNT (hoy lo suman). Cambia `docs/finance/COST_MARGIN_MODEL.md:18` | MA-02 |
| P-02 | Comisiones con DISCOUNT positivo histórico | No se recalculan eventos ya generados; el cambio aplica a eventos nuevos | MA-02 |
| P-03 | Seed de los 3 productos faltantes y cambio del test `00_structure.test.sql:146` | Agregar comerza/eexpense/ecommerce al seed local | MA-19 |
| P-04 | JCS en Java | Implementación propia pequeña probada con vectores (sin dependencia nueva) | 10, 12 |
| P-05 | eExpense (`uvjmdphlnpyhtohobvzx`) y GMAO (`xikbhkfeaosasdltartg`) no tienen QAS separado del uso productivo | En fase 19 esos dos quedan `BLOCKED` salvo autorización humana específica por producto, adicional a GATE C | 19–20 para esos 2 |
| P-06 | Corrección de moneda de GMAO `charge` | Solo caracterización en fase 05; corrección con migración aprobada aparte | GM-07 |
| P-07 | eChange `commercially_entitled` inicial | Se inicializa con el `enabled` actual para no cambiar comportamiento de tenants existentes; la verdad llega con el primer snapshot | EC-02 |

Las decisiones de negocio D-01..D-15 de la spec siguen abiertas; el plan no las necesita para las fases 03–16, pero sin D-12 el ingest de uso queda apagado y sin D-03/D-05/D-06 los snapshots no llevan asignaciones, límites ni medidores facturables.

---

## 18. Autorrevisión

- **Cobertura del prompt:** archivos/interfaces por repo (§5–§13), dependencias de migraciones (§4), fixtures (§3), worktrees/ramas (§1.1), ciclos test-first (cada tarea), commits (cada tarea), rollback (§15), evidencia (§16), orden de integración (§2), verificación local/DEV (§1.2, §13), QAS solo tras gate (§14).
- **Preservación:** CREATE/REPLAY/GET e idempotencia (INV-1/2), mapeos (INV-3), precios (INV-4), PRD (INV-5).
- **Contradicciones:** la regla global de push se subordina a las reglas más estrictas de cada SaaS (§0.3). La spec §13.2 pide DISCOUNT negativo; P-01 lo acepta sin romper los datos positivos existentes.
- **Placeholders:** solo las constantes de hash de MA-01, que se miden en ejecución (declarado) y los timestamps, cuyo orden relativo es lo normativo.
