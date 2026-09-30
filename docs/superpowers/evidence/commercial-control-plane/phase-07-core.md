# Fase 07 — Núcleo comercial de MasterAdmin (catálogo y entitlements)

- Fecha: 2026-09-27 · Worktree `masteradmin/.worktrees/ebim-commercial-control-plane-v1` · rama `feature/ebim-commercial-control-plane-v1`.
- Base de la fase: `ca0ec3e` (cierre de la fase 06). Plan §9 (MA-10…MA-20), spec §3–§7, §10, §14.
- Entorno: solo stack LOCAL (`127.0.0.1:54421/54422`). Guarda `scripts/ccp/guard-env.sh` antes de cada `db reset`. Ningún `link`, `db push`, `functions deploy` ni `secrets set`. Sin sync con SaaS, sin QAS, sin push.
- Supabase CLI 2.116.0 (sin cambios desde `supabase-cli-masteradmin.txt`). Hallazgos de docs aplicados: `ALTER TYPE … ADD VALUE` aislado en su propia migración (no se puede usar en la transacción que lo crea); EXECUTE por defecto a PUBLIC → `revoke all … from public, anon` en cada función nueva y `revoke … from authenticated` en funciones de trigger e internas (lo exigen además los tests existentes 16/22); vistas `security_invoker = true`.

## Commits

| Task | Commit | Asunto |
| --- | --- | --- |
| MA-10 | `d3e0314` | feat(billing): add USAGE_OVERAGE charge kind |
| MA-11 | `977cc4e` | feat(commercial): add product capability registry and aliases |
| MA-12 | `db7d403` | feat(catalog): extend catalog items with product, lifecycle and billing model |
| MA-13 | `7ef6431` | feat(catalog): add effective-dated regional add-on prices |
| MA-14 | `551e275` | feat(commercial): add plan and add-on entitlement grants |
| MA-15 | `10818d5` | feat(billing): tag subscription items by source |
| MA-16 | `6d656d5` | feat(commercial): add audited tenant add-on lifecycle |
| MA-17 | `cd8e2fb` | feat(commercial): compute effective entitlements |
| MA-18 | `a4a45fe` | feat(commercial): derive tenant features from entitlements |
| MA-19 | `3ca39e6` | feat(commercial): add read models and seed all eight products locally |
| UI | `2050aa3` | feat(ui): commercial catalog, add-on prices and tenant add-on lifecycle |
| MA-20 | (este commit) | docs(ccp): phase 07 evidence |

## Migraciones (orden de aplicación)

| Archivo | Contenido |
| --- | --- |
| `20260929000100_ccp_charge_kind_usage_overage.sql` | `charge_kind + USAGE_OVERAGE` (aislada) |
| `20260929000200_ccp_product_capabilities.sql` | `product_capabilities`, `capability_aliases`, `import_capability_manifest`, `upsert_capability_alias` |
| `20260929000300_ccp_catalog_items_extend.sql` | `catalog_items.lifecycle_status` / `billing_model`, `available` derivado, `set_catalog_item_lifecycle` |
| `20260929000400_ccp_catalog_item_prices.sql` | `catalog_item_prices` (réplica de `plan_prices` + sin DELETE), `current_catalog_item_price(_id)`, `set_catalog_item_price`, `price_month` congelado |
| `20260929000500_ccp_entitlement_grants.sql` | `entitlement_grants`, `tenant_entitlement_overrides`, `entitlement_desired_state`, RPCs de grants/overrides, marcadores dirty |
| `20260929000550_ccp_subscription_items_source.sql` | `subscription_items.source_type` / `tenant_addon_id` / `price_ref` |
| `20260929000600_ccp_tenant_addons_lifecycle.sql` | ciclo de vida de `tenant_addons` + RPCs; retira `set_tenant_addon_active` |
| `20260929000800_ccp_compute_entitlements.sql` | `compute_entitlements`, `is_tenant_app_active` |
| `20260929000900_ccp_tenant_features_read_model.sql` | `tenant_features.source = ENTITLEMENT`, `refresh_tenant_features`, materialización en cada cambio |
| `20260929001000_ccp_commercial_read_models.sql` | `v_tenant_entitlements`, `v_catalog_item_current_prices`, `v_tenant_addon_history`, `v_commercial_audit_log` |

Tests nuevos: `29_ccp_capabilities` (35), `30_ccp_catalog_item_prices` (46), `31_ccp_entitlement_grants` (63), `32_ccp_tenant_addon_lifecycle` (70), `33_ccp_compute_entitlements` (34), `34_ccp_eight_products` (19). Cada task tiene `logs/MA-1x-red.txt` (falla por objeto inexistente, no por sintaxis), `-green.txt` y el gate `-gate-*.txt`.

## Cobertura de los tests pedidos por la fase

| Test pedido | Dónde | Resultado |
| --- | --- | --- |
| Solape de precio efectivo | 30: `VIGENCIA_INVALIDA` hacia atrás, `TARIFA_SOLAPADA`, exclusión GiST `23P01` en escritura directa, vigencia inclusiva del cierre, programada desde su fecha, mercado distinto no resuelve | PASS |
| Unión plan + add-on | 33: LIMIT por MAX (25 vs 10), ALLOWANCE por SUM (100 + 50), HARD gana a SOFT, fuentes `ADDON+PLAN` | PASS |
| Downgrade / baja | 32/33: `CANCEL_SCHEDULED` concede hasta `effective_to` y el ítem se factura este mes y no el siguiente; tras la fecha el add-on no aporta; `CANCELLED`/`SUSPENDED` no aportan; contrato no vigente = sin grants de plan | PASS |
| Aislamiento de tenants | 31/32/33/34: el admin de omega no ve overrides, add-ons, entitlements (función INVOKER), features ni vistas de alpha; sin rol = vacío | PASS |
| Otorgamiento no autorizado | 28/31/32: anon, sin rol, TENANT_ADMIN, ORG_ADMIN, PARTNER_ADMIN y comercial → `42501` al aprobar/crear grants/overrides; finanzas no mapea grants; product admin no fija precios ni overrides ni suspende; solicitar nunca activa (ni desde el SaaS) | PASS |
| Reset limpio con 8 productos | 34 + `00_structure` (5 → 8): los 8 productos con ids `…0001-0008`; los 3 nuevos sin planes, precios, integraciones ni credenciales; sin capacidades, grants ni precios de add-on inventados; ninguna credencial con valor | PASS |
| Compatibilidad de migraciones | Ensayo sobre el estado de la fase 03 (abajo) | PASS |

## Tabla de verdad de `compute_entitlements` (33, capacidades QA)

Plan `esupplier-shared-standard`: `tenders` ON, `users.max` 25 HARD, `docs` 100/mes, `beta` (capacidad DRAFT) ON, `ai.copilot` ON desde +10 días. Add-on `licitaciones`: `users.max` 10 SOFT, `docs` 50/mes. Add-on `multi_country`: `scoped` (COMPANY).

| Caso | Resultado |
| --- | --- |
| p1 (solo plan) | `core` BASELINE · `docs` 100 PLAN · `tenders` PLAN · `users.max` 25 HARD PLAN (DRAFT excluida, grant futuro no vigente) |
| alpha (plan ∪ licitaciones) | `core` · `docs` **150** ADDON+PLAN · `tenders` · `users.max` **25 HARD** ADDON+PLAN |
| alpha a +11 días | + `ai.copilot` PLAN |
| workspace de la app suspendido | sin `core` (baseline solo con app activa) |
| add-on por compañía / + a nivel tenant | `scoped` con `companyIds=[31…01]` / sin lista (todas) |
| baja programada a +5 días | hoy `docs` 150; a +6 días `docs` 100 y `users.max` 25 solo PLAN |
| baja inmediata (finanzas) | sin fuente ADDON |
| p1 con licitaciones: aprobado / suspendido / reanudado | 150 / 100 / 150 |
| p1 con contrato CANCELLED | solo `core` + aportes del add-on (`docs` 50, `users.max` 10 SOFT) |
| overrides en alpha | GRANT `ai.copilot` añade `OVERRIDE`; DENY `tenders` la retira; GRANT `users.max` 100 → MAX = 100 `OVERRIDE+PLAN`; al vencer o revocar dejan de aplicar |

## UI (`2050aa3`)

- `commercial/capabilities` (EBIM): registro por producto (kind, baseline, estado, alcance, regla, medidor, alias) + importar manifiesto con conteos y lista `missing` como drift.
- `catalog/addons` (EBIM/PARTNER con vista financiera): ciclo de vida y modelo de cobro; `AddonPriceList` con mercado junto al importe y «Sin precio definido» (nunca 0/gratis); nueva tarifa (finanzas) y cambio de ciclo de vida (product admin) con motivo obligatorio.
- Tenant 360 → pestaña «Add-ons y entitlements»: historia del ciclo de vida con acciones por estado (solicitar / aprobar-rechazar / baja programada-reactivar / suspender-reanudar-baja inmediata) y entitlements efectivos con marca «pendiente de sincronizar».
- Los botones reflejan los gates del backend (solo UX). `routeMeta` elige la entrada más específica (rutas de dos segmentos). Test de rutas: 25 → 27 (cambio justificado).
- Implementado por un worker en su propio worktree (limitación del harness) y aplicado como parche verificado (sha1 `93567472…`); gate re-ejecutado en el worktree del programa. Verificación de UI por RTL/typecheck/build; sin ejecución en navegador.

## Compatibilidad de migraciones (MA-20)

Base local reconstruida en el estado de la fase 03 (migraciones ≤ `20260928000200` + `seed.sql` de `63f8b74`), con estado legacy adicional (un add-on revocado con la RPC temporal y una fila MANUAL en `tenant_features`), y luego las 10 migraciones de la fase 07 aplicadas encima una a una:

- Huellas antes = después (`logs/MA-20-compat-before.txt`): mapeos, `plan_prices`, `catalog_items` (incl. `available`/`scope`), `subscription_items` (todas las columnas previas), `invoices` (número, estado, total), `tenant_addons` (tenant, código, `active`, `activated_at`), `tenant_features`, líneas debidas de 3 periodos y MRR (37 830.00). **Idénticas.**
- Backfill (`logs/MA-20-compat-backfill.txt`): add-ons activos → `ACTIVE`/`LEGACY_BACKFILL`; el revocado → `CANCELLED` con `effective_to`; conectores no disponibles → `COMING_SOON`; 35 ítems → `MANUAL`; RPC temporal retirada; 0 filas `ENTITLEMENT` (no hay grants); la fila MANUAL intacta.
- pgTAP sobre la base migrada (`logs/MA-20-compat-pgtap.txt`): 26, 29, 30, 31 OK; 33 falla solo en la aserción de filas no-ENTITLEMENT porque el ensayo añadió a propósito la fila MANUAL (lo que prueba que el read model no la toca). En reset limpio 33 pasa 34/34.
- Las líneas de factura no cambian (MA-15): huella de `subscription_due_items` de las 78 líneas del seed en 3 periodos medida antes de la migración (`logs/MA-15-baseline-fingerprint.txt`) = después.

## Verificación de la fase

| Verificación | Resultado | Evidencia |
| --- | --- | --- |
| pgTAP completo tras `db reset` | 1183/1183, 35 archivos, PASS | `logs/MA-20-gate-db-test.txt` |
| vitest / typecheck / lint / build | 803/803 · OK · OK · OK (solo aviso de tamaño de chunk preexistente) | `logs/MA-20-gate-*.txt`, `logs/MA-20-build.txt` |
| secrets scan | PASS | `logs/MA-20-gate-secrets.txt` |
| `26_ccp_preservation` (INV-3/INV-4) | PASS sin cambiar constantes: la fase no altera precios ni mapeos | gate |
| advisors locales | 22 hallazgos nuevos, todos `unused_index` sobre tablas nuevas sin uso; ningún hallazgo de seguridad | `logs/MA-20-advisors-local.json` |
| diff protegido `git diff 346aa72 -- supabase/functions e2e/v4-*` | vacío | `logs/MA-20-provisioning-diff.txt` |
| rollback `docs/runbooks/ccp-rollback/07.sql` | ensayo en transacción revertida: 0 RPCs nuevas ejecutables por authenticated, 0 vistas legibles, `set_tenant_addon_active` vuelve (adaptada a `status`), datos conservados | `logs/MA-20-rollback-dryrun.txt` |

## Decisiones y desviaciones

1. **`grant_value`** en vez de `grant` (palabra reservada de SQL); origen con dos FK reales (`plan_id` / `catalog_item_id`) en vez de `source_id` polimórfico.
2. **`catalog_items.saas_product_id` ya existía** (baseline): se reutiliza; la migración …0300 solo añade `lifecycle_status` y `billing_model`.
3. **Estado deseado:** `entitlement_desired_state` (revisión monótona + dirty por tenant×producto) es la "columna provisional hasta la fase 08" del plan; la fase 08 le cuelga snapshots y estado de sync.
4. **PK de `tenant_addons`** pasa a `id` para conservar la historia (una reactivación tras una baja es una fila nueva); unique parcial sobre filas no terminales. `activated_at` se conserva (NOT NULL) y solo es significativo desde `ACTIVE`.
5. **Cancelación inmediata** permitida desde `ACTIVE`/`CANCEL_SCHEDULED`/`SUSPENDED` solo a finanzas (spec §10), además de `SUSPENDED → cancel` del diagrama.
6. **`PAST_DUE` sigue concediendo** en `compute_entitlements` y en la aprobación: revocar por impago es D-07 (el mecanismo manual es `suspend_tenant_addon`).
7. **Add-ons `PER_UNIT`** no se aprueban en tenants facturables (`MODELO_POR_USO_PENDIENTE`) hasta que la fase 18 facture desde agregados de uso. Tenants TRIAL sin contrato fallan con `SUSCRIPCION_REQUERIDA` (solo DEMO se activa sin tarifa).
8. **Baja programada por defecto** al primer instante del mes siguiente (la facturación es por mes calendario); el ítem se cierra el último día del mes.
9. **`set_tenant_addon_active` retirada** (plan §4 fila 8). El test 28 de la fase 03 se actualizó: misma matriz "nadie se autootorga" (46 aserciones) contra `approve_tenant_addon`/`request_tenant_addon`/`cancel_tenant_addon`. `useSetTenantAddonActive` se sustituyó por hooks del ciclo de vida.
10. **Seed:** los 3 productos nuevos son solo filas de catálogo (P-03). **No** se añadieron integraciones MOCK para ellos (el plan las mencionaba): cambiarían los fixtures del plano de provisioning que cuentan integraciones (`22_v4_provisioning_rbac`) y no aportan nada a esta fase; las integraciones de entitlements llegan en la fase 08. El seed marca explícitamente `COMING_SOON` los conectores no disponibles y `ACTIVE` los add-ons legacy, para que un reset limpio coincida con el backfill de un entorno migrado.
11. **`tenant_features`** se re-materializa en cada cambio comercial (vía `mark_entitlements_dirty`); los cambios por paso del tiempo (grant futuro, fin de baja programada, vencimiento de override) requieren `refresh_tenant_features` / `complete_scheduled_addon_cancellations` desde el job (fase 08 lo agenda).
12. **`set_tenant_feature`** (MANUAL, `can_manage_commercial`, auditado — fase 03) se mantiene; el override comercial con vencimiento es `create_entitlement_override` (finanzas).
13. Huella de la prueba "antes = después" de MA-15 con anclas en **meses de calendario** relativos (los días relativos cambian con la fecha).
14. El test de privilegios de la fase detectó en MA-11 funciones de trigger con EXECUTE por defecto y en MA-13 una columna `currency` sin FK al catálogo: corregidos antes del commit (los tests existentes 06/16/22 hacen de red).

## Abierto (registrado, no ampliado)

- Precios de add-on, valores de límites/asignaciones, créditos IA: siguen siendo decisiones de negocio (D-01, D-03, D-05, D-06). El seed no los inventa.
- Job de materialización por tiempo y de cierre de bajas programadas: fase 08.
- Integraciones locales de los productos sin integración (tms, gmao, echange, comerza, eexpense, ecommerce): fase 08.
- Alcance por compañía de un add-on `per-company` sin compañía: se acepta (filas legacy); la cantidad por compañía para facturación `PER_COMPANY` llega con la fase 18.
