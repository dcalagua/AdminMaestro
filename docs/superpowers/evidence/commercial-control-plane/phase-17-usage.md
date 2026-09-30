# Fase 17 — Medición de uso y créditos IA de la suite

- Fecha: 2026-09-28 · Worktree `masteradmin/.worktrees/ebim-commercial-control-plane-v1` · rama `feature/ebim-commercial-control-plane-v1` · base de la fase `ba29ff3` (cierre fase 16).
- Plan §4 filas 17–19, §12 (MA-50…MA-54 + outbox por SaaS); spec §11, §12, §14, §20.
- **Solo LOCAL.** Sin `link`, `db push`, `functions deploy`, `secrets set`, QAS, PRD ni push (MasterAdmin ni SaaS). Nada contra `uvjmdphlnpyhtohobvzx` ni `xikbhkfeaosasdltartg`.
- Reanudación: el runner indicaba "reanudar fase 12", pero 12–16 ya estaban PASS en el ledger y el log `RESUME-17` estaba vacío; la fase 17 empezó desde cero (misma nota que en 15/16).
- Supabase: CLI 2.116.0 (sin cambios, `supabase-cli-masteradmin.txt`). Docs revisadas: *Column Level Security* (grant por columna; `select *` falla para el rol restringido → `internal` sin grant y lectura de COGS por RPC), advisors 0026/0027 (sin grants a `anon`; lectura mínima a `authenticated`). Hallazgos previos vigentes: EXECUTE por defecto a PUBLIC → `revoke … from public, anon` explícito; vistas `security_invoker`.

## Qué no se inventó (D-02, D-03, D-04, D-06, D-12)

Ningún precio de crédito, crédito incluido, peso, paquete, rollover, expiración ni precio de exceso se sembró. Las tablas `ai_credit_weights`, `ai_credit_policies` y `ai_credit_ledger` nacen vacías (pgTAP 40 lo asserta); los medidores nacen `is_billable=false`; el ingest está **apagado** por defecto (flag global + kill-switch por producto) hasta aprobar D-12. La compatibilidad "cuota por acción = peso 1" **no** se aplicó (D-03 no aprobado): cada SaaS mantiene su cuota legacy y emite `…ai.calls` con cantidad sin peso. Los valores en los tests son sintéticos y viven en transacciones que se revierten.

## MasterAdmin — commits

| Task | Commit | Asunto |
| --- | --- | --- |
| MA-50 | `1557609` | feat(usage): add meters and append-only idempotent usage events |
| MA-51 | `c7964a7` | feat(usage): add signed usage ingest endpoint |
| MA-54 | `02403d6` | feat(contracts): publish usage v1 fixtures (**FIX-USG-v1**) |
| MA-52 | `7af9941` | feat(usage): aggregate and finalize usage periods |
| MA-53 | `263b4a0` | feat(ai-credits): add append-only credit ledger and balances |
| — | `15658a5` | docs(usage): add usage ingest runbook and phase 17 rollback |
| gate | `c248935` | fix(usage): cover new foreign keys with indexes and state the jti table policy |
| gate | `0cc53e8` | perf(usage): evaluate auth.uid() once per statement in the new read policies |
| X-07 | (este commit) | `scripts/ccp/usage-x07-e2e.mts`, evidencia y ledger |

Orden: MA-54 se publicó antes que MA-52/53 para que los 7 SaaS trabajaran en paralelo; el contrato solo depende del ingest (MA-50/51).

## FIX-USG-v1

```
FIX_USG_V1_SHA256 = 9f77d3cd692a52287d1af20b766d3a6024d3f4485de664460de035245ba7d6e1
```

= `sha256(contracts/usage/v1/CHECKSUMS.sha256)`, 10 archivos: `README.md`, `request.schema.json`, `response.schema.json`, `meters.json`, `fixtures/setup.json`, `fixtures/ingest-batch.json`, `expected/ingest-results.json`, `expected/transport-errors.json`, `expected/classification-vectors.json`, `reference-sender.ts`. Generación determinista (`scripts/ccp/generate-usage-fixtures.mts`). El lote dorado se verificó contra la RPC REAL (`logs/MA-54-usage-ingest-e2e.txt`, 32/32). El E2E encontró un defecto propio antes de publicar: el `occurredAt` del fixture (2026-10-05) estaba en el futuro respecto de hoy → se movió a 2026-09-05. Los 7 SaaS fijaron el mismo hash.

## Migraciones (orden relativo del plan §4 filas 17–19)

| Archivo | Contenido |
| --- | --- |
| `20261005000100_ccp_usage_meters_events.sql` | `usage_meters` (no facturable/no negativo por defecto; `DAILY_SNAPSHOT` ⇒ MAX; nacen DRAFT); `usage_ingest_credentials` (pública del SaaS por referencia `…_PUBLIC_JWK/KEY`; ES256; dirección inversa a `credential_profiles`); `usage_events` append-only (55000 incluso para postgres), unique (producto, event_id) + `event_hash` JCS/SHA-256, `internal` sin grant de columna; `usage_ingest_rejections` append-only sin contenido; `m2m_jti_replay`; `ingest_usage_events` (DEFINER, solo service_role + `is_service_request()`, validación por evento, autorización producto×tenant×medidor, D-12); `usage_event_cogs` (solo finanzas); RPCs de administración (product admin; facturable solo finanzas) y kill-switch |
| `20261005000200_ccp_usage_aggregates.sql` | `usage_period_aggregates` (OPEN→CLOSING→FINALIZED, sin retrocesos, FINALIZED inmutable, nunca se borran), apertura por trigger del ingest, política de tardíos (`usage_assign_period`), `close_usage_periods` (acotado a `now()`), `finalize_usage_aggregate` (finanzas o job), `finalize_due_usage_aggregates` (`SKIP LOCKED`), asignación ALLOWANCE aplicada al cierre, exceso bajo BLOCK → alerta, DEMO/SANDBOX no facturable; `usage_alerts`; `v_usage_period_aggregates` (invoker); revoca INSERT directo de service_role en eventos/rechazos |
| `20261005000300_ccp_ai_credits.sql` | `ai_credit_weights` (vigencia, sin solapes, solo finanzas, no retroactivo antes del vigente), `ai_credit_policies` (nullable = no decidido; rollover/expiry bloqueados por CHECK hasta D-04), `ai_credit_ledger` append-only con signo por tipo y clave de idempotencia, `v_ai_credit_balances` (invoker), GRANT_PERIOD/compra/bono/ajuste/REVERSAL/reserva/liberación, CONSUME por trigger al FINALIZAR (peso vigente en `occurred_at`, guardado en la entrada), alertas `POLITICA_CREDITOS_NO_DEFINIDA`/`PESO_CREDITO_NO_DEFINIDO`/`CREDIT_OVERAGE`/`POOL_SCOPE_CONFLICT`; `aiCredits` del snapshot con los pesos vigentes (parche verificado de una sola expresión) |

## Edge Function `usage-ingest`

`supabase/functions/usage-ingest/{index,core}.ts` + `_shared/usage/{types,jwt-verify,ingest}.ts`. `verify_jwt = false` (el SaaS no tiene JWT de Supabase; presenta su ES256). Orden: método → flag global (503) → content-type → ≤ 256 KB → JWT (solo ES256; credencial por `iss`; firma; aud; exp/iat/nbf con skew 60 s; TTL ≤ 300 s; scope) → kill-switch del producto → jti de un solo uso (consumido **después** de la firma) → cuerpo (schema, batchId, 1..500, ambiente y producto = los de la credencial) → RPC. Errores de la base → `503 RETRYABLE` sin detalle.

## Cobertura del prompt

| Requisito | Dónde | Resultado |
| --- | --- | --- |
| Medidores | `usage_meters` + RPCs; pgTAP 38 | PASS |
| usage_events append-only e idempotentes | unique + hash; DUPLICATE/CONFLICT; pgTAP 38, E2E | PASS |
| Agregados / finalización | pgTAP 39 (UTC, estados, inmutabilidad, source_hash, SUM/MAX/COUNT_DISTINCT) | PASS |
| credit_ledger append-only | pgTAP 40 | PASS |
| Wallet/saldo derivado | `v_ai_credit_balances`; pgTAP 40 | PASS |
| Entradas incluidos/comprados/bono/reservados/usados/expirados | tipos del ledger; EXPIRE solo por política (D-04 → rechazado) | PASS |
| Aplicación de asignación | `usage_finalize_core` con `compute_entitlements` al cierre; pgTAP 39 | PASS |
| Política de exceso BLOCK/ALLOW | asignaciones: contrato v1 = BLOCK → alerta; créditos: `overage_mode` BLOCK/ALLOW/no definido → `CREDIT_OVERAGE`; nunca factura aquí | PASS |
| Ingest M2M firmado | `usage-ingest` (43 tests) + E2E | PASS |
| Autorización producto+tenant+medidor | credencial→producto, mapping ACTIVE del producto y ambiente, medidor ACTIVE del producto; pgTAP 38 | PASS |
| Política de eventos tardíos | tras FINALIZED → siguiente período abierto con `late=true`; pgTAP 39 | PASS |
| Metadata interna proveedor/modelo/tokens/costo | `internal` allowlist, sin grant de columna, `usage_event_cogs` solo finanzas | PASS |
| SaaS: outbox transaccional/reintentos, event_id en origen, cantidad/unidad validadas, atribución, tokens reales, sin snapshots diarios no aprobados | tabla por repo abajo + X-07 | PASS (con las salvedades de entorno de abajo) |

## SaaS (FIX-USG-v1 fijado en los 7)

| Producto | Commits (local, sin push) | Outbox / enganche | Tests del repo | SQL en contenedor real |
| --- | --- | --- | --- | --- |
| eCommerce | `9a67427` | `platform_usage.usage_outbox`, trigger AFTER INSERT en `ai_interactions` (misma transacción, también en fallo); `usage-outbox-worker` | pin 14, emisor 42, DB PGlite 25, pgTAP-en-PGlite 39/39, `npm test` 6576/6581 (5 = `listen EPERM` del sandbox, igual que fase 09), `test:db` 3928/3928 | **No**: bloqueo conocido de fase 09 (`20260827090600_storage_buckets.sql`: `must be owner of table objects`; 2 enfoques ya agotados) |
| EWM | `2b90b19` | `evt_outbox_event` `usage.v1` + V51 (`next_attempt_at`, `last_error_code`), `AiUsageHook` → `UsageOutboxRelay` | unit 1500 (0 fallos; 31 errores = mismos del sandbox en la base), ArchUnit verde; PGlite 32/32 | **Sí**, `clean verify` con Testcontainers (ver Reanudación): unit 1512/0/0, IT 1535 con 0 fallos; los 25 errores son preexistentes o intermitentes |
| Comerza | `46863bc`, `0ee7537` | `operator.usage_outbox` por trigger en `ai_usage_events` (misma transacción, probado con `xmin`) | 33 nuevos; `npm test` 824 pass/1 fallo solo-sandbox | **Sí** (por el coordinador): `npm run test:db` en `comerza_ccp_db` → exit 0, 83 migraciones, suite de uso y carrera de dos sesiones SKIP LOCKED. `test:edge` NO ejecutado (necesita el stack dev en 54321/54322, ocupado por otro proyecto; no se detienen stacks ajenos) |
| eSupplier | `86021db` | `ai_usage_outbox` (fase 13) extendido; 21 funciones vía `meteredAnthropicFetch` | SQL 227/227 en contenedor (SKIP LOCKED con dos sesiones vía dblink); `npm test` 1251; `test:security` 652; `security:gates` 19/19 | **Sí** (el propio worker). `platform_provisioning_rpc.sql` no corre en la base de pruebas por la deriva conocida de fase 13 (`public.companies`) |
| eChange | `5b879b9`, `0ea1166` | `privado.usage_outbox`: IA (`echange.ai.calls`) y Deepgram con segundos del proveedor (`echange.voice.seconds`); casos → DEAD `NOT_A_METER` | `npm test` 751 (+27); PGlite 797/32 = línea base 745/32 (mismos 32) | **Sí** (por el coordinador): HEAD 1106 ok / 10 not ok; **línea base `741a994` 1054 ok / 10 not ok con los mismos 10**, y en la **base DEV original `3d6f34e` 818 ok / 10 not ok, las mismas 10 aserciones** (grants en `linea_de_tiempo`, `portal_visibility`, `ticket_attachments`) → preexistentes al programa (ver Reanudación); uso 52/52 + 30/30; provisioning 31/31 |
| eExpense | `0022538`, `afb2850`, `0ddd0d1`, `085deb7`, `f2389dc` | `private.usage_outbox` (fase 15) + estado de entrega, claim/lease/mark | vitest 249 (+46), PGlite 295/295 | **Sí** (por el coordinador): cadena completa desde cero (133 migraciones) en `supabase_db_eexpense-ccp`: 9 archivos, **295/295** |
| GMAO | `587e94a` | `platform.usage_outbox` escrito en `ai_consume` tras cobrar la cuota (misma transacción) | deno 25 nuevos + suites previas verdes; `run_ccp17_tests` 24; ccp/ccp16 con fase 17 aplicada 40/48 | GMAO no puede `db reset` (esquema base no versionado): PGlite es su harness oficial |
| TMS | — | sin medidor aprobado (plan §12.2) | — | — |

INV-1 (provisioning protegido) sin diff en los 7 repos; INV-4 (precios) intacto en todos; secret scan limpio (solo nombres de rol/variables). Ningún repo crea cron; todos los emisores están apagados salvo `USAGE_OUTBOX_SENDER_ENABLED === 'true'`.

## X-07 de uso (`logs/MA17-X07-usage-e2e.txt`) — 66/66 PASS

Emisor REAL de cada SaaS TypeScript (su `runUsageOutboxSender` + `buildUsageEvent`, importados de su worktree) → handler REAL de `usage-ingest` → RPCs REALES de MasterAdmin. Por producto (GMAO, eExpense, eCommerce, eSupplier, eChange, Comerza): apagado por defecto sin POST; encendido → eventos SENT con tenant/medidor/capacidad/tokens reales en MasterAdmin; sin tokens del proveedor → MasterAdmin no recibe tokens; fila inaceptable → DEAD con código sin reintento; el ingest abre el agregado OPEN; reenvío idempotente (DUPLICATE, sin filas nuevas); kill-switch de MasterAdmin → eventos PENDING con `USAGE_INGEST_DISABLED` (nada se pierde); estado final apagado. El outbox se simula en memoria con la misma interfaz del store RPC de cada repo (la semántica SQL la prueban sus suites); la entrega usa `fetchImpl` porque el sandbox niega `listen` (como en 13–16).

## Verificación de MasterAdmin

| Verificación | Resultado | Evidencia |
| --- | --- | --- |
| pgTAP tras `db reset` | **1581/1581**, 41 archivos (38 = 57, 39 = 49, 40 = 68) | `logs/MA17-gate-db-test.txt` (1.er intento: 00_structure detectó FKs sin índice y una tabla RLS sin política → corregido, `logs/MA17-gate-db-test-attempt0-structure.txt`) |
| vitest / typecheck / lint / build | 1185/1185 · OK · OK · OK | `logs/MA17-gate-*.txt` |
| node:test ccp | 15/15 | `logs/MA17-gate-node-test.txt` |
| deno check | `usage-ingest`, `entitlement-sync`, orquestador OK | `logs/MA17-gate-deno-check.txt` |
| secrets scan | PASS | `logs/MA17-gate-secrets.txt` |
| `26_ccp_preservation` (INV-3/INV-4) | PASS sin cambiar constantes | gate |
| advisors locales | sin hallazgos de seguridad; 22 `unused_index` (INFO, tablas nuevas vacías); los 2 `auth_rls_initplan` propios corregidos | `logs/MA17-advisors-local.json` |
| INV-1 diff protegido vs `ba29ff3` | vacío | `logs/MA17-provisioning-diff.txt` |
| rollback `docs/runbooks/ccp-rollback/17.sql` | ensayo en transacción revertida: ingest y kill-switch off, EXECUTE revocado, `aiCredits` restaurado, lectura y entitlements intactos | `logs/MA-17-rollback-dryrun.txt` |
| Ingest E2E contra la base real | 32/32 | `logs/MA-54-usage-ingest-e2e.txt` |
| X-07 de uso (6 SaaS) | 66/66 | `logs/MA17-X07-usage-e2e.txt` |

## Decisiones y desviaciones

1. **Numeración de pgTAP**: 37 ya era de la fase 08 → 38 (ingest), 39 (agregados), 40 (créditos). El `40_ccp_billing_usage` de la fase 18 pasa a 41.
2. **Credencial de ingest en tabla propia** (`usage_ingest_credentials`) en vez de `credential_profiles`: esa tabla modela la dirección MasterAdmin→SaaS y su CHECK exige `secret_ref` de clave privada.
3. **`internal` sin grant de columna** + `usage_event_cogs()` para finanzas (un grant por columna no distingue finanzas de otros `authenticated`).
4. **Período en `CLOSING` sigue aceptando eventos** (se recalcula al finalizar); solo `FINALIZED` desvía tardíos al período siguiente.
5. **Exceso de asignaciones**: el contrato FIX-ENT-v1 fija `overageMode: "BLOCK"` (const) → en v1 no hay ALLOW para asignaciones; ALLOW existe para créditos (`ai_credit_policies.overage_mode`). Permitir ALLOW en el snapshot requiere un contrato v1.1 aditivo.
6. **Sin política o sin pool no hay CONSUME** (se alerta): el pool es D-03 y no se inventa.
7. **Pesos retroactivos**: permitidos solo si empiezan después del vigente; lo ya consumido guarda su peso y no cambia.
8. **Migraciones 17–19 editadas antes de publicar** (índices de FK, política explícita en `m2m_jti_replay`, `(select auth.uid())`) en commits nuevos; nunca se aplicaron fuera del stack local.
9. **Emisores de los SaaS reimplementan la lógica del emisor de referencia** en su runtime (el `reference-sender.ts` usa una *parameter property* que Node en modo *strip-only* no acepta y vive fuera del bundle de las funciones); cada repo prueba paridad con los vectores y con el archivo vendorizado. Posible limpieza cosmética en v1.1 (también el `require-await` que `deno lint` señala en el archivo vendorizado).
10. **Entorno de los workers**: el sandbox de los agentes paralelos negó el socket de Docker. El coordinador ejecutó las suites SQL en contenedores reales para eExpense, eChange (con línea base) y Comerza; eSupplier ya las corrió; eCommerce y GMAO tienen bloqueos de entorno preexistentes documentados (fases 09 y 05).

## Abierto (registrado, no ampliado)

- D-02, D-03, D-04, D-06, D-12 siguen abiertas; hasta D-12 el ingest queda apagado en todo entorno.
- Operador tras D-12/GATE C: par ES256 por producto × entorno, pública en MasterAdmin (`configure_usage_ingest_credential`), medidores de `meters.json` ACTIVE, secretos de los SaaS, programación de los emisores y de los jobs de cierre/finalización/créditos (`docs/runbooks/usage-ingest.md`).
- `echange.voice.seconds` y futuros medidores por segundos/documentos: registrar en MasterAdmin cuando se aprueben (hoy DRAFT/no registrados → `UNKNOWN_METER`, DEAD en el SaaS).
- GMAO: `internal` vacío (los tokens no se conocen al cobrar la cuota); `translate` no medido. eCommerce: tokens 0 indistinguibles de "no devuelto" → se omiten. eSupplier/eExpense: sin `externalCompanyId`. EWM: modelo del proveedor no capturado; `ai-copilot` edge sin uso.
- Eventos de tenants sin mapping de MasterAdmin quedan PENDING (`TENANT_NOT_MAPPED`) hasta adoptar esos tenants.
- Línea `USAGE_OVERAGE` y facturación de uso: fase 18.

## Reanudación (2026-09-28, segunda invocación)

La invocación anterior terminó sin marcador porque el `mvn clean verify` de EWM seguía corriendo. No había ningún proceso Maven vivo. El log previo muestra que el fork de surefire murió con SIGTERM (exit 143) al cerrarse la sesión, así que nunca hubo resultado final. No se rehízo trabajo ya verde.

**EWM.** Defecto de la **fase 10** corregido en `c87ef5d`:
- El GET de entitlements respondía 500 en PostgreSQL real porque el jti se consumía dentro de una transacción `readOnly`. Las IT de la fase 10 nunca corrieron con base de datos.
- `consumirJti` pasa a `REQUIRES_NEW`, con una IT nueva. Fue RED con 25006 y GREEN con 55/55 en las IT de plataforma y provisioning.

**EWM, compuerta completa con Docker** (`e75f4c3`):

| Corrida | Unit | IT |
| --- | --- | --- |
| HEAD | 1512/0/0 | 1535, 0 fallos, 25 errores |
| Base previa `86cb148` | 1462/0/0 | 1529, 1 fallo (el defecto corregido), 24 errores |

- Los 24 errores de `YardVisitIT` son idénticos en la base. Vienen de contaminación del contexto por el contenedor de clase de `NeoRetailSeedSmokeIT`, que es harness preexistente sin diff contra `7c086e8`, y la clase pasa aislada.
- `InterWarehouseTransferIT` tuvo 1 error intermitente. Pasó en la base y en 4 corridas aisladas, y no comparte código con la fase 17.
- Las IT del programa están verdes: `PlatformUsageOutboxIT` 5/5, `PlatformEntitlementsIT` 5/5, provisioning 12/12 + 7/7.
- Evidencia: `WMS-by-EBIM/.worktrees/…/phase-17-ewm-usage.md`, logs `EW17-05…09`.

**eChange.** Las 10 fallas pgTAP se compararon contra la **base DEV original `3d6f34e`**, no contra la fase 14:
- Se hizo `git archive` de `3d6f34e`, se creó una base desechable con 238 migraciones y se corrieron sus 21 tests: 818 ok / 10 not ok.
- Son las mismas 10 aserciones que en HEAD, por número y por texto. Los 3 archivos de test tienen 0 líneas de diff.
- Por lo tanto son **preexistentes** y no se reparan en el programa: son deuda de seguridad de eChange, EXECUTE de anon/authenticated sobre DEFINER del portal y de adjuntos.
- Evidencia en `916264b`, `logs/EC17-R1-original-base-3d6f34e-sql.txt`.

**eCommerce.** `storage_buckets` es un **defecto de portabilidad de la migración, preexistente**; no es infraestructura local.
- La sentencia fallida es la línea 83, `alter table storage.objects enable row level security`, que viene de `c5111cb` y ya está en la base `7da2ae4`.
- En las imágenes actuales `storage.objects` es de `supabase_storage_admin`, `postgres` no es superusuario y RLS ya está activo (verificado en solo lectura).
- Falla en cualquier base nueva creada desde cero. No afecta a las bases que ya la aplicaron.
- Consecuencia para la fase 19: QAS no se recrea con `db reset`; se verifica sobre la base existente aplicando solo las migraciones nuevas. La corrección queda para el dueño de eCommerce (`e82bd2e`).

**GMAO (se conserva para la fase 19).** GMAO no tiene esquema base versionado; PGlite con el esquema capturado es su único harness local. La verificación en vivo de QAS tiene que:
- validar contra el esquema real del hub y de GMAO, con el SQL de operador de solo lectura de la fase 16;
- recién después aplicar las migraciones 16/17.

**Sin cambios de QAS/PRD. Sin push.** Todos los contenedores y worktrees desechables de esta reanudación se eliminaron.
