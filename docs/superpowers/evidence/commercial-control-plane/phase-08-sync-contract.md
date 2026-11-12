# Fase 08 — Contrato versionado `SYNC_ENTITLEMENTS` (MasterAdmin + contrato compartido)

- Fecha: 2026-09-27/28 · Worktree `masteradmin/.worktrees/ebim-commercial-control-plane-v1` · rama `feature/ebim-commercial-control-plane-v1`.
- Base de la fase: `b7cbefb` (cierre de la fase 07). Plan §3 (fixtures), §4 filas 13–16, §10 (MA-30…MA-40); spec §7–§9, §14, §15, §18, §19.
- Entorno: solo stack LOCAL (`127.0.0.1:54421/54422`), guarda `scripts/ccp/guard-env.sh` antes de cada `db reset`. Sin `link`, `db push`, `functions deploy`, `secrets set`, QAS ni push. Ningún repo SaaS tocado en esta fase.
- Supabase CLI 2.116.0 (sin cambios). Docs revisadas: *Scheduling Edge Functions* y *pg_net* → la programación es pg_cron + pg_net con URL/clave en Vault; **no** se crea ningún cron en migraciones (URL y clave son del entorno): runbook `docs/runbooks/entitlement-sync.md` §3. Se mantienen los hallazgos de las fases 03/07 (EXECUTE por defecto a PUBLIC → `revoke … from public, anon` explícito en cada función; vistas `security_invoker`).

## FIX-ENT-v1 (publicado)

```
FIX_ENT_V1_SHA256 = 7aab413a145b0e9a165c5f02be4bfda17f886a4b46bc2a557eec3eeaed1f65d5
```

= `sha256(contracts/entitlements/v1/CHECKSUMS.sha256)`. 20 archivos fijados: `README.md`, `schema.json`, `manifest.schema.json`, `jcs-vectors.json` (11 vectores RFC 8785, 8 `sqlDomain`), `fixtures/01…13`, `expected/put-responses.json`, `expected/get-applied.json`, `reference-receiver.ts`. Generación determinista (dos ejecuciones → mismos bytes) con `scripts/ccp/generate-entitlement-fixtures.mts`. Cada SaaS (fases 09–16) copia el directorio a su ruta del plan §3.2 y fija esta constante en su test `entitlements-fixtures-pin`.

## Commits

| Task | Commit | Asunto |
| --- | --- | --- |
| MA-30 | `b91edfd` | feat(entitlements): add RFC 8785 canonical JSON and checksum |
| MA-31 | `42c1f31` | feat(entitlements): build versioned entitlement snapshots |
| MA-32 | `f5b6590` | feat(entitlements): persist immutable versioned snapshots |
| MA-33 | `6d1cde7` | feat(entitlements): track desired versus applied state |
| MA-34 | `29654f0` | feat(entitlements): add per-product cutover state and kill switch |
| MA-35 | `18321bb` | feat(entitlements): add M2M sync client |
| MA-36 | `0cb528e` | feat(provisioning): add SYNC_ENTITLEMENTS and GET_ENTITLEMENTS actions |
| MA-37 | `fb0cb9a` | feat(entitlements): add push, verify and registry-verify jobs |
| MA-38 | `b080b37` | feat(contracts): publish entitlements v1 golden fixtures (**FIX-ENT-v1**) |
| MA-39 | `0e4eba5` | feat(ui): show entitlement sync state |
| MA-40 | (este commit) | docs(ccp): phase 08 evidence |

## Migraciones

| Archivo | Contenido |
| --- | --- |
| `20260930000100_ccp_entitlement_snapshots.sql` | `jcs_canonical` (JCS en SQL, falla 22023 fuera de dominio), `entitlement_checksum`, `entitlement_snapshots` append-only (UPDATE/DELETE/TRUNCATE → 55000 incluso para postgres), `entitlement_snapshot_content`, `issue_entitlement_snapshot` (DEFINER, solo service_role, advisory lock + fila de estado deseado `FOR UPDATE`, versión nueva solo si cambia el contenido) |
| `20260930000200_ccp_entitlement_sync_state.sql` | `entitlement_sync_state` (13 estados), `entitlement_sync_attempts` y `entitlement_registry_checks` append-only, funciones puras de transición (espejo de `states.ts`), trigger snapshot→deseado, `claim_entitlement_pushes`/`_verifications` (lease + `FOR UPDATE SKIP LOCKED`), `record_entitlement_push_result`/`_verify_result`, `record_entitlement_registry_check` |
| `20260930000300_ccp_product_integrations_entitlements.sql` | columnas §3.2 en `product_integrations` (defaults inocuos), kill-switch, `commercial_cutover_events`, `configure_entitlements_integration`, `set_commercial_cutover_state` (un paso, cohorte IN_SYNC para avanzar, `*_RETIRED` bloqueados), `set_entitlements_push_enabled`, `entitlement_delivery_context` |
| `20260930000400_ccp_sync_actions.sql` | `can_sync_entitlements` / `can_read_entitlement_sync`, claims dirigidos del "sincronizar ahora", `entitlement_issue_candidates`, `entitlement_registry_targets`, vista `v_entitlement_sync_status` (`security_invoker`) |

## Código

- `supabase/functions/_shared/entitlements/`: `jcs.ts`, `types.ts`, `snapshot.ts` (espejo del emisor SQL + verificación previa al envío), `states.ts` (espejo de las transiciones SQL; tabla común `sync-state-cases.json`), `sync-client.ts` (PUT/GET/manifest; reusa `url-guard`, `retry`, `m2m` **sin modificarlos**; token nuevo por intento), `sync-store.ts` (RPCs con nombres de parámetro verificados contra las migraciones), `sync-flow.ts` (flujo compartido orquestador/job).
- `supabase/functions/entitlement-sync/{core,index}.ts`: jobs `issue`/`push`/`verify`/`registry-verify`/`all`; solo canal servidor (`x-provisioning-secret`, comparación en tiempo constante); `config.toml` `verify_jwt = true`.
- Orquestador: acciones `SYNC_ENTITLEMENTS` / `GET_ENTITLEMENTS` (50 líneas añadidas, 0 cambiadas en las ramas existentes).
- UI: Operación SaaS → *Sincronización de entitlements* (`src/features/commercial/sync/EntitlementSyncPage.tsx`).

## Cobertura de lo pedido por la fase

| Requisito | Dónde | Resultado |
| --- | --- | --- |
| Snapshot deseado determinista | `snapshot.test.ts` (mismo estado → mismos bytes; orden de entrada irrelevante); SQL = TS sobre el fixture 03 (pgTAP 35) y en el E2E (el push verifica el checksum SQL con JCS de TS) | PASS |
| Versión monótona por tenant×producto | pgTAP 35; concurrencia real con dos sesiones (`logs/MA-32-concurrency.txt`: B espera el lock y no duplica; un cambio concurrente no se pierde) | PASS |
| Checksum | JCS RFC 8785 en TS (11 vectores) y SQL (8 vectores + fixture) | PASS |
| effectiveAt | `≤ issuedAt`; futuro → `VIGENCIA_FUTURA` (lo emite el barrido al llegar la fecha) | PASS |
| Capacidades + límites / asignaciones | snapshot completo de sellables ACTIVE con `enabled` explícito; límites MAX/HARD; asignaciones SUM, período y `overageMode: BLOCK` | PASS |
| Sin precios ni secretos | test de claves/valores prohibidos (emisor TS, fixture 12, pgTAP 35 sobre el documento emitido); bitácora sin tokens | PASS |
| Correlación / idempotencia | `correlationId` por emisión; `Idempotency-Key = ma-ent-v1-sha256(tenant:producto:versión)`; replay → `200 replayed` (fixture 03, E2E paso 6) | PASS |
| Estado seguro ante reintentos | lease + `SKIP LOCKED`; lease vencido retomable y contado; `LEASE_PERDIDO`; backoff 60 s→1 h; `UNREACHABLE` | PASS (pgTAP 36) |
| Deseado/aplicado; drift / error / pendiente explícitos | 13 estados; solo el GET produce `IN_SYNC`; `DRIFT_AHEAD`/`DRIFT_CHECKSUM`/`REJECTED` sin push automático | PASS (pgTAP 36/37, `states.test.ts`) |
| Receptor: last-good durable, stale, same-checksum, conflict, GET | receptor de referencia × 13 fixtures + `expected/*` | PASS |
| MasterAdmin caído no para lo concedido | receptor de referencia con `fetch` bloqueado; E2E paso 7 (SaaS sigue con v2) | PASS |
| SYNC_ENTITLEMENTS en la capa de orquestación | acciones nuevas del orquestador + job `entitlement-sync` | PASS |
| Compatibilidad EWM_V1 | codecs, `integration_capabilities`, golden y `ewm-v1.test.ts` sin cambios; una integración `EWM_V1` usa el mismo canal `entitlements.v1` (pgTAP 37) | PASS |
| Fixtures reutilizables para todos los repos | FIX-ENT-v1 + pin | PASS |

## E2E local (`logs/MA-40-e2e-local.txt`) — 20/20 PASS

MasterAdmin local real (RPCs vía supabase-js con service_role) → job/orquestador → cliente M2M real (ES256 con clave generada en memoria) → SaaS de prueba `node:http` que verifica firma, `iss`/`aud`/`exp`, scope y `jti` de un solo uso y delega en el receptor de referencia. Recorrido: v1 emitida → PUT → `AWAITING_VERIFY` → GET → `IN_SYNC`; revocación (v2) aplicada; SYNC manual sin cambios no emite ni empuja; re-envío → `REPLAYED`; SaaS caído → `RETRYABLE` y el SaaS sigue con v2; recuperación → v3 `IN_SYNC`; registry-verify sin drift; kill-switch apagado → v4 emitida y no empujada; 12 peticiones con 12 `jti` distintos; PUT solo con scope de escritura y GET solo con lectura.

## Verificación de la fase

| Verificación | Resultado | Evidencia |
| --- | --- | --- |
| pgTAP completo tras `db reset` | 1407/1407, 38 archivos, PASS | `logs/MA-40-gate-db-test.txt` (1.er intento: el archivo 31 salió sin TAP por un corte de conexión del contenedor, 0 aserciones fallidas; `logs/MA-40-gate-db-test-attempt1.txt`) |
| vitest / typecheck / lint / build | 1041/1041 · OK · OK · OK (solo el aviso de tamaño de chunk preexistente) | `logs/MA-40-gate-*.txt`, `logs/MA-40-build.txt` |
| deno check | orquestador y `entitlement-sync` OK | `logs/MA-36-deno-check.txt`, `logs/MA-37-deno-check.txt` |
| secrets scan | PASS | `logs/MA-40-gate-secrets.txt` |
| `26_ccp_preservation` (INV-3/INV-4) | PASS sin cambiar constantes | gate |
| advisors locales | 9 hallazgos nuevos, todos `unused_index` sobre tablas nuevas vacías; ningún hallazgo de seguridad | `logs/MA-40-advisors-local.json` |
| INV-1 diff protegido vs `346aa72` | golden, `ewm-v1.test.ts`, codecs, `types.ts`, `m2m.ts`, `url-guard.ts`, `retry.ts`, `e2e/v4-generic-orchestrator-golden.spec.ts` y migraciones v4: **0 líneas**. Solo cambian, de forma aditiva, `actions.ts` (unión de tipo y mapa), `actions.test.ts` (casos nuevos) y el orquestador (rama nueva) | `logs/MA-40-provisioning-diff.txt` |
| rollback `docs/runbooks/ccp-rollback/08.sql` | ensayo en transacción revertida: push y ejes apagados, EXECUTE revocado, datos y lectura intactos, provisioning intacto | `logs/MA-40-rollback-dryrun.txt` |

Totales de la fase: pgTAP 1183 → 1407 (+224: 35 = 50, 36 = 127, 37 = 47); vitest 803 → 1041 (+238).

## Decisiones y desviaciones

1. **El snapshot lo emite la base, no TS.** Versión, contenido y checksum se asignan en una transacción (`issue_entitlement_snapshot`), con JCS implementado en SQL para el dominio que MasterAdmin emite (fuera de dominio falla en vez de divergir). `buildSnapshot` (TS) es el espejo: genera los fixtures y verifica lo emitido antes de enviarlo. Equivalencia probada con vectores, con el fixture 03 y en el E2E.
2. **EWM_V1: canal separado, codec intacto.** El plan pedía añadir `SYNC_ENTITLEMENTS` a `AdapterCapability` y al codec EWM, pero `ewm-v1.test.ts:577` fija sus capacidades y es un archivo protegido (INV-1). La sincronización viaja por el contrato propio `entitlements.v1` (contexto `entitlement_delivery_context`, scopes propios), independiente del codec de provisioning; `provisioning_execution_context` tampoco se modificó (la migración 16 añade funciones nuevas en vez de ampliarlo).
3. **Token nuevo por intento** en el cliente de entitlements (el adaptador de provisioning reusa el mismo): los receptores tratan el `jti` de estas rutas como de un solo uso.
4. **13 fixtures**: los 12 del plan + `13-tenant-not-provisioned` (404). Las respuestas esperadas se escriben a mano en el generador; el receptor de referencia debe reproducirlas.
5. **`overageMode: BLOCK`** como valor técnico cerrado mientras no exista precio de exceso (D-06); **`aiCredits` explícito y vacío** hasta la fase 17. No se inventa ningún valor comercial.
6. **`limits` / `allowances` listan solo lo concedido**; ausente ≠ ilimitado (README §2).
7. **Eje de cutover por integración** (la del destino del mapping) con `cohort_state` por tenant; `*_RETIRED` no alcanzables en el programa; avanzar a `DUAL_READ`/`PRIMARY` exige la cohorte `IN_SYNC` por GET.
8. **Kill-switch apagado por defecto y operable por finanzas** además del product admin (freno ante una revocación masiva, spec §18).
9. **Sync manual** (`claim_entitlement_push_for`): ignora el backoff y permite reintentar `REJECTED`, pero no pisa un push en vuelo ni fuerza `DRIFT_AHEAD`/`DRIFT_CHECKSUM` (spec §18: incidente + versión nueva).
10. **`REGISTRY_DRIFT`** se registra por producto (`entitlement_registry_checks`) y se refleja en los tenants `IN_SYNC*`; al resolverse vuelven a `AWAITING_VERIFY`.
11. **Autorización del orquestador**: `platform.provisioning.execute` (sync) / `.read` (verificar) del producto del tenant, reutilizando `has_product_permission`; un admin de tenant o un partner no dispara sync (comercial ≠ operativo).
12. **Sin cron en migraciones**: la programación es un paso de operador por entorno (runbook §3).
13. **TDD**: `sync-store.ts` se escribió antes que su test (añadido en la misma tarea; contrasta cada parámetro RPC con las migraciones). El resto de tareas tiene RED antes de GREEN en `logs/MA-3x-red*.txt`.
14. Test de rutas 27 → 28 (ruta nueva, justificado en `0e4eba5`); `database.types.ts` regenerado del stack local (solo adiciones).
15. `supabase test db` sufre cortes de conexión intermitentes tras un reset en esta máquina; los scripts reintentan solo ante `LegacyDbConnectError`.
16. Playwright E2E del navegador **no ejecutado** en esta fase (la UI se verificó con RTL/typecheck/build); el E2E de la fase es el de integración de servicio descrito arriba.

## Abierto (registrado, no ampliado)

- Receptores reales por producto: fases 09–16 (eCommerce piloto primero). Cada uno copia FIX-ENT-v1 y fija `FIX_ENT_V1_SHA256`.
- Programación de los jobs y carga de claves M2M por entorno: operador, tras GATE C para QAS (runbook `entitlement-sync.md`).
- Pesos de créditos IA en el snapshot: fase 17. Valores comerciales D-01/D-03/D-05/D-06: siguen sin decidir y no se sembraron.
- El barrido (`issue` con `sweep`) se apoya en `complete_scheduled_addon_cancellations`; la materialización de `tenant_features` por paso del tiempo sigue siendo `refresh_tenant_features` (fase 07) y se agenda con el mismo cron.
