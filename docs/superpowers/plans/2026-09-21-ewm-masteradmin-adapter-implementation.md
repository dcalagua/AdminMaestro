# EWM MasterAdmin Adapter Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Agregar compatibilidad EWM V1 en MasterAdmin sin modificar semánticamente el adapter GENERIC ni exigir cambios a otros SaaS.

**Architecture:** El `HttpM2mAdapter` existente recibe un *codec de contrato* inyectado (`GENERIC` o `EWM_V1`) que decide sólo la forma: cuerpo, marcadores de ruta y lectura de la respuesta. Transporte, SSRF, firma M2M y reintentos siguen siendo únicos y compartidos. La selección ocurre una vez en `resolveAdapter`, a partir de una columna enum auditada (`product_integrations.adapter_key`, default `GENERIC`). Los datos propios de cada alta viven congelados en `saas_provisioning_requests.product_configuration`, y dos acciones opcionales del orquestador (`GET_STATUS` y `REPLAY_CERTIFICATION`) se habilitan por capacidad.

**Tech Stack:**
- Frontend: React 19 + Vite 7 + TypeScript, TanStack Query, React Hook Form + zod.
- Base de datos: Supabase/PostgreSQL (schema `platform`, RLS + FORCE), pgTAP vía `supabase test db` (`npm run db:test`).
- Edge Functions: Supabase Edge Functions (Deno, `jsr:@supabase/supabase-js@2`).
- Pruebas: Vitest 3 (incluye los módulos puros de `supabase/functions/**`), @testing-library/react y Playwright 1.56.
- Protocolo: HTTP M2M con JWT ES256.

**Spec:** `docs/superpowers/specs/2026-09-21-ewm-masteradmin-adapter-design.md` (commit `afc40cf`).

**Base:** `dev` @ `afc40cf`. El commit `a25e4a7` (CORS) ya está en la rama y **no** se reimplementa. Entre `afc40cf` y el commit de este plan sólo cambia `docs/superpowers/plans/`, así que toda comparación de código contra `afc40cf` es válida.

**Contrato EWM verificado:** `WMS-by-EBIM` @ `origin/qas` = `7e45d70`, `docs/platform-provisioning/API_CONTRACT.md` (leído en modo sólo lectura con `git show origin/qas:docs/platform-provisioning/API_CONTRACT.md`). Ese repositorio **no** se modifica.

**Fuera de alcance:** eSupplier. Se certificará después contra el contrato GENERIC; si su contrato no coincide, será un blocker de eSupplier y **no** se modifica GENERIC.

---

## 0. Reglas de ejecución (leer antes de cualquier Task)

### 0.1 Entorno local vs QAS — riesgo real detectado en la auditoría

`.env.local` apunta hoy a **QAS** (`https://jivgwrczgdpsuvqcwqku.supabase.co`). `e2e/v4-provisioning-orchestrator.spec.ts` usa `loadEnv('development', …)` y `playwright.config.ts` arranca `npm run dev`: sin precaución, **las pruebas locales golpearían QAS**. Vite da prioridad a las variables de proceso sobre `.env.local`, así que toda ejecución local (Tasks 1–13) se hace así:

```bash
# 1) Stack local arriba (ya existe en esta máquina; no tocar QAS)
supabase status >/dev/null || supabase start
# 2) Variables de proceso que ganan a .env.local
export VITE_SUPABASE_URL=http://127.0.0.1:54421
export VITE_SUPABASE_ANON_KEY="$(supabase status -o env | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
export VITE_APP_ENV=LOCAL
# 3) Ningún dev server previo en 5199 (strictPort; Playwright no reutiliza)
lsof -tiTCP:5199 -sTCP:LISTEN | xargs -r kill
```

**Guardia obligatoria** antes de cualquier `npm run e2e` local, con un dev server levantado en la misma shell:

```bash
curl -s http://127.0.0.1:5199/src/lib/env.ts | grep -o '"VITE_SUPABASE_URL": "[^"]*"'
# DEBE imprimir: "VITE_SUPABASE_URL": "http://127.0.0.1:54421"
```

Si imprime `jivgwrczgdpsuvqcwqku`, **HARD STOP**: la ejecución apunta a QAS.

Las Tasks 14–22 usan QAS a propósito, en una shell **sin** esas variables (`unset VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_APP_ENV`), y aplican la guardia inversa: debe imprimir `jivgwrczgdpsuvqcwqku`.

### 0.2 Cambios remotos

- Ningún cambio remoto antes de que la Task 13 (gate local) termine en verde.
- `CLAUDE.md` prohíbe al agente `reset`, `link` y `push` contra Supabase remoto. La migración a QAS (Task 15) la ejecuta **el operador humano**, con el prefijo `!` en la sesión. El agente prepara y verifica, pero no ejecuta `db push`.
- El despliegue de la función y la carga del secreto exigen la autorización **explícita** del usuario en la sesión de ejecución, pedida justo antes de la Task 14. Si el harness deniega el comando, el operador lo ejecuta con `!` y el agente verifica el resultado. **Nunca** se reintenta por otra vía.
- PRD no se toca en ninguna Task.

### 0.3 Comandos de verificación (nombres reales del repo)

| Qué | Comando |
| --- | --- |
| Unitarias + módulos puros de Edge Functions | `npx vitest run` / `npx vitest run <ruta>` |
| Sólo provisioning | `npx vitest run supabase/functions/_shared/provisioning` |
| pgTAP | `npm run db:test` (`supabase test db`, stack local) |
| Reaplicar migraciones locales | `supabase db reset --local` (**nunca** `--linked`) |
| Tipos generados | `npm run db:types` |
| Typecheck / lint / build | `npm run typecheck` / `npm run lint` / `npm run build` |
| Escaneo de secretos | `npm run secrets:scan` |
| E2E local | `npm run e2e -- <archivo>` (con §0.1) |
| Advisors | `supabase db advisors --local --type security --output-format json` / `supabase db advisors --linked --type security --output-format json` (sólo tras la guardia de proyecto enlazado de §0.5) |
| Golden SHA | Tras la Task 1: `git rev-parse HEAD > "$TMPDIR/ewm-golden-sha"`. Toda verificación de «dorada sin cambios» compara contra ese commit |

### 0.5 Supabase CLI verificada

Versión instalada: **2.116.0** (`supabase --version`). La CLI no funciona dentro del sandbox del agente (sale con código 1 sin salida); los comandos de la CLI se ejecutan fuera del sandbox o los ejecuta el operador.

| Comando | Flags usados | Fuente |
| --- | --- | --- |
| `supabase status` | `-o env` | `supabase status -h` |
| `supabase test db` | (sin flags: stack local) | `supabase test db -h` (`--local`, `--linked`, `--db-url`, `--project-ref`) |
| `supabase migration list` | `--linked` | `supabase migration list -h` (`--local`, `--linked`, `--db-url`, `--project-ref`, `-p`) |
| `supabase db advisors` | `--local` / `--linked`, `--type security`, `--output-format json` | `supabase db advisors -h` (`--type all\|security\|performance`, `--level`, `--fail-on`, `--project-ref`) |
| `supabase functions list` | `--project-ref` | `supabase functions list -h` |
| `supabase secrets list` | `--project-ref` | `supabase secrets list -h` |
| `supabase db reset` | `--local` | Referencia oficial de la CLI (`--local`, `--linked`, `--db-url`, `--no-seed`, `--version`, `--last`). El harness deniega `-h` de este comando |
| `supabase db push` | `--linked`, `--dry-run` | Referencia oficial (`--linked`, `--local`, `--db-url`, `--dry-run`, `--include-all`, `--include-roles`, `--include-seed`, `-p`). **No tiene `--project-ref`** |
| `supabase functions deploy` | `<nombre> --project-ref` | Referencia oficial (`--project-ref`, `--no-verify-jwt`, `--use-api`, `--import-map`, `--prune`, `-j`). **Prohibidos aquí:** `--no-verify-jwt` y `--prune` |
| `supabase secrets set` | `--env-file`, `--project-ref` | Referencia oficial (`<NAME=VALUE> …`, `--env-file`, `--project-ref`). **Prohibido** pasar `NAME=VALUE` en `argv` |
| `supabase functions logs` | — | **No existe** en 2.116.0 (`supabase functions --help`) |

**Guardia de proyecto enlazado** (obligatoria antes de todo comando con `--linked`, porque `db push` no admite `--project-ref`):

```bash
[ "$(cat supabase/.temp/project-ref)" = "jivgwrczgdpsuvqcwqku" ] || { echo "HARD STOP H12"; exit 1; }
```

Hoy `supabase/.temp/project-ref` contiene `jivgwrczgdpsuvqcwqku`. El agente **no** ejecuta `supabase link` (`CLAUDE.md`).

### 0.4 Enmiendas a la spec detectadas al planificar

Se aplican en este plan, y la Task 25 las incorpora a la spec:

| # | Enmienda | Motivo |
| --- | --- | --- |
| A1 | `GET_STATUS` también se admite con la solicitud en `READY_TO_PROVISION`, además de `ACTIVE` y `FAILED` | Es la única forma, sin crear nada y sin modificar EWM, de demostrar que EWM **acepta el JWT ES256** de MasterAdmin (Task 19): con `ewm:tenant:read` sobre un `controlPlaneTenantId` todavía no aprovisionado, EWM responde `404 RESOURCE_NOT_FOUND` si el token es válido y `401` si no. Sigue siendo de sólo lectura; `PROVISIONING` sigue excluido |
| A2 | La moneda se congela junto con la configuración: `set_saas_provisioning_configuration` escribe **del lado del servidor** `resolvedCurrency = companies.currency` de la sociedad del tenant, y el codec la usa para `organization.currency` y `company.currency` | El requisito de reintento idéntico ante cambios posteriores (riesgo R1). El cliente no puede fijar ese valor |
| A3 | La UI mínima vive sólo en `SaasProvisioningPage` (formulario y «Consultar estado»); la pestaña del tenant no cambia | Menos superficie; la spec permitía ambos lugares y no exige los dos |

---

## File Map

| Acción | Archivo | Responsabilidad única |
| --- | --- | --- |
| TEST (CREATE) | `supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` | Caracteriza el contrato GENERIC actual; **no se edita** después de la Task 1 |
| TEST (CREATE) | `e2e/v4-generic-orchestrator-golden.spec.ts` | Caracteriza, contra el stack local real, que una acción desconocida hoy ejecuta `PROVISION` |
| CREATE | `supabase/migrations/20260921000100_v4_contract_adapters.sql` | Única migración, aditiva (se completa en las Tasks 2, 5, 6, 10 y 11 antes de salir de local) |
| TEST (CREATE) | `supabase/tests/23_v4_contract_adapters.test.sql` | pgTAP de preservación, RBAC, RLS y validaciones de la migración |
| MODIFY | `supabase/functions/_shared/provisioning/types.ts` | Tipos aditivos: `AdapterKey`, `AdapterCapability`, `ContractCodec`, `ProvisioningSource` |
| CREATE | `supabase/functions/_shared/provisioning/adapters/generic.ts` | `GENERIC_CODEC`: las líneas actuales de `http-m2m.ts`, movidas sin reescribir |
| MODIFY | `supabase/functions/_shared/provisioning/adapters/http-m2m.ts` | Recibe el codec; transporte, SSRF, firma y reintentos intactos; expone `validateInput` y `createBodyFingerprint` |
| CREATE | `supabase/functions/_shared/provisioning/adapters/ewm-v1.ts` | `EWM_V1_CODEC`: cuerpo, marcadores, validación y normalización EWM, y nada más |
| TEST (CREATE) | `supabase/functions/_shared/provisioning/adapters/ewm-v1.test.ts` | Petición, validación, normalización y marcadores EWM |
| CREATE | `supabase/functions/_shared/provisioning/actions.ts` | `routeAction` y `permissionRpcFor`: enrutado puro y testeable de acciones |
| TEST (CREATE) | `supabase/functions/_shared/provisioning/actions.test.ts` | Enrutado, incluida la preservación de «desconocida → PROVISION» |
| CREATE | `supabase/functions/_shared/provisioning/fingerprint.ts` | `createBodyText` y `sha256Hex` |
| CREATE | `supabase/functions/_shared/provisioning/status.ts` | `summarizeStatus`: resultado de `GET_STATUS` frente al mapping |
| CREATE | `supabase/functions/_shared/provisioning/replay.ts` | `evaluateReplayCertification`: veredicto puro de la certificación |
| TEST (CREATE) | `…/fingerprint.test.ts`, `…/status.test.ts`, `…/replay.test.ts` | Lógica pura de las acciones nuevas |
| MODIFY | `supabase/functions/_shared/provisioning/registry.ts` | `resolveAdapter(type, env, deps, adapterKey = 'GENERIC')` y `CONTRACT_CODECS` |
| MODIFY | `supabase/functions/_shared/provisioning/registry.test.ts` | Casos de `adapterKey` |
| MODIFY | `supabase/functions/_shared/provisioning/m2m.test.ts` | Sólo casos nuevos: formato PKCS#8 de una línea aceptado y SEC1 rechazado (Task 13.A). `m2m.ts` no cambia |
| MODIFY | `supabase/functions/_shared/provisioning/adapters/manual.ts`, `mock.ts` | Declaran `capabilities = ['PROVISION']` |
| MODIFY | `supabase/functions/_shared/provisioning/index.ts` | Exportaciones nuevas |
| MODIFY | `supabase/functions/provisioning-orchestrator/index.ts` | Usa `routeAction`/`permissionRpcFor`; pasa `adapterKey`; `validateInput` antes de `begin`; ramas `GET_STATUS` y `REPLAY_CERTIFICATION` |
| CREATE | `src/features/deployments/contractAdapters.ts` | Descriptor de UI por `adapter_key` (etiqueta, esquema zod, precargas). **Único** archivo de UI que conoce `EWM_V1` |
| TEST (CREATE) | `src/features/deployments/contractAdapters.test.ts` | Esquema EWM y ausencia de campos para GENERIC |
| CREATE | `src/features/deployments/ProductConfigurationForm.tsx` | Formulario «Datos de alta en el producto» generado por el descriptor |
| TEST (CREATE) | `src/features/deployments/ProductConfigurationForm.test.tsx` | Visibilidad, validación y precargas |
| CREATE | `src/features/deployments/ProvisioningStatusAction.tsx` | Botón y diálogo «Consultar estado», visible sólo con `GET_STATUS` |
| TEST (CREATE) | `src/features/deployments/ProvisioningStatusAction.test.tsx` | Visible con EWM y oculto con GENERIC |
| MODIFY | `src/features/deployments/SaasProvisioningPage.tsx` | Monta los dos componentes en `RequestDetail` |
| MODIFY | `src/features/platform/IntegrationDialogs.tsx` | Selector «Contrato» (enum) y envío de `p_adapter_key` |
| MODIFY | `src/services/mutations.ts` | `useSetProvisioningConfiguration`, `useGetProvisioningStatus`; campos nuevos en `OrchestratorResult` |
| MODIFY | `src/services/queries.ts` | `useProfileFullNameByEmail`, `useEffectiveTenantConfig` (precargas) |
| MODIFY | `src/types/database.types.ts` | Regenerado con `npm run db:types` |
| TEST (CREATE) | `e2e/v4-ewm-qas-certification.spec.ts` | Certificación QAS real, opt-in (`EWM_QAS_CERTIFICATION=1`) |
| MODIFY | `docs/platform-provisioning/ADAPTERS.md`, `ARCHITECTURE.md`, `M2M.md` | GENERIC/EWM_V1, capacidades, secret y certificación |
| MODIFY | `docs/superpowers/specs/2026-09-21-ewm-masteradmin-adapter-design.md` | Enmiendas A1–A3 |
| CREATE | `docs/platform-provisioning/EWM_QAS_CERTIFICATION.md` | Acta de certificación con evidencia |

No se toca: `response.ts`, `url-guard.ts`, `m2m.ts`, `retry.ts`, `errors.ts`, `cors.ts`, `check_provisioning_preconditions`, `begin_`/`complete_`/`fail_saas_provisioning` ni `create_saas_provisioning_request`.

---

## Global Hard Stops

Cualquiera de estas condiciones detiene la ejecución **completa**. Se reporta la evidencia y no se continúa ni se «arregla» por otra vía.

| # | Condición | Dónde se detecta |
| --- | --- | --- |
| H1 | La prueba dorada GENERIC (`http-m2m.generic-golden.test.ts` o `v4-generic-orchestrator-golden.spec.ts`) falla, o alguien propone editarla | Tasks 3–13 y 24 |
| H2 | La migración contiene `drop column`, `alter … rename`, `update`/`delete` sobre filas existentes, `NOT NULL` sin default compatible, o toca la expresión `payload` | Task 2, revisión y pgTAP |
| H3 | Otro SaaS necesitaría un cambio (cualquier fila distinta de `ewm-provisioning-v1` cambiaría de configuración) | Tasks 2, 17 y 23 |
| H4 | La respuesta real de EWM difiere de `API_CONTRACT.md` (`WMS-by-EBIM@origin/qas`) | Tasks 19–22 |
| H5 | La huella de la clave privada no coincide con `~/.ebim-keys/ewm/qas/masteradmin-public.pem` | Task 14 |
| H6 | El preflight CORS en QAS no devuelve `204` con `access-control-allow-origin: http://127.0.0.1:5199` | Task 16 |
| H7 | EWM rechaza la firma (`401`) en `GET_STATUS` | Task 19 |
| H8 | El Create no devuelve `201` con `status: ACTIVE` y el mapping esperado | Task 20 |
| H9 | El replay crea un duplicado (`201`) o cambia `companyId` | Task 21 |
| H10 | `GET` devuelve un mapping distinto del almacenado | Task 22 |
| H11 | Aparece material de clave privada o un JWT completo en la BD, los logs, el repo, el bundle o la salida de un comando | Tasks 14 y 23 |
| H12 | Cualquier comando apunta a PRD o a un project ref distinto de `jivgwrczgdpsuvqcwqku` | Todas las remotas |
| H13 | La guardia de entorno (§0.1) muestra QAS durante una Task local | Tasks 1–13 |
| H14 | `GET_STATUS` previo al alta devuelve `404` **sin** `provider_code = RESOURCE_NOT_FOUND` (cuerpo no RFC 7807 → `PROVIDER_NOT_FOUND`): la ruta no existe o `WMS_PLATFORM_M2M_ENABLED` está apagado en EWM QAS. Resolverlo es configuración de EWM, fuera de este plan | Task 19 |
| H15 | La clave convertida a PKCS#8 no importa localmente con WebCrypto, o su clave pública derivada no coincide con la que tiene EWM | Task 14 |

Correspondencia con los hard stops pedidos:

| Pedido | Hard stop |
| --- | --- |
| GENERIC cambia | H1 |
| Migración destructiva | H2 |
| Otro SaaS requiere cambios | H3 |
| Key mismatch | H5, H15 |
| CORS falla | H6 |
| M2M falla | H7, H14 |
| E2E falla | H4, H8, H9, H10 |
| Private key leak | H11 |
| PRD tocado | H12 |

Ante cualquier hard stop en una Task remota (14–23) se aplica **§ Rollback QAS**.

---

## Rollback QAS

Se ejecuta sólo si salta un hard stop remoto o el usuario lo pide. Siempre con la guardia de §0.5 y nunca contra PRD. Cada paso se registra en el acta (`EWM_QAS_CERTIFICATION.md`, sección «Rollback»).

| Nivel | Cuándo | Acción exacta | Verificación |
| --- | --- | --- | --- |
| RB1 · Configuración (inmediato) | Cualquier hard stop entre las Tasks 18 y 22 | Por la consola local contra QAS: `configure_deployment_provisioning` sobre `ewm-shared-qas` con `p_provisioning_status 'DRAFT'` y `p_provisioning_enabled false` (resto de parámetros con sus valores actuales); `upsert_product_integration` sobre `ewm-provisioning-v1` con `p_enabled false`, `p_status 'DRAFT'` y `p_adapter_key 'GENERIC'`; `upsert_credential_profile` sobre `ewm-qas-m2m` con `p_enabled false` | `v_saas_provisioning` y la lista de integraciones muestran EWM en DRAFT/deshabilitado; `audit_logs` registra los tres cambios; las demás integraciones no cambian (H3) |
| RB2 · Función | La función desplegada rompe GENERIC o CORS (H1/H6) | El operador redespliega la función desde el commit base, con la **misma** CLI: `git worktree add "$TMPDIR/rb" afc40cf` y luego `! supabase functions deploy provisioning-orchestrator --project-ref jivgwrczgdpsuvqcwqku --workdir "$TMPDIR/rb"`. Después, `git worktree remove "$TMPDIR/rb"` | El preflight de la Task 16.3 devuelve `204`; `supabase functions list --project-ref jivgwrczgdpsuvqcwqku` muestra una versión nueva. La función base ignora `source`, `adapter` y `product_configuration` |
| RB3 · Secret | H11 (fuga) o H15 | `! supabase secrets unset EWM_QAS_M2M_PRIVATE_KEY --project-ref jivgwrczgdpsuvqcwqku`, y RB1. En una fuga la clave queda **comprometida**: su rotación exige cargar una clave pública nueva en EWM, que es configuración de EWM y queda fuera de este plan. Se reporta como blocker | `supabase secrets list --project-ref jivgwrczgdpsuvqcwqku` ya no muestra el nombre |
| RB4 · Esquema | Sólo si el usuario lo exige | No se revierte por defecto: columnas con default y funciones nuevas no alteran lo existente. Si se exige, se escribe una migración inversa **nueva** que elimina sólo los objetos de `20260921000100`, tras RB1, y recorre el ciclo completo Tasks 13 → 15. **Nunca** `db reset --linked` ni `migration repair` | pgTAP local de la migración inversa y `migration list --linked` |
| RB5 · Datos en EWM | Tras un Create | No hay `DELETE` en EWM (API_CONTRACT §8). El tenant de prueba queda en EWM QAS y se documenta en el acta | — |

---

## Review Focus — riesgos y su prueba propietaria

| Riesgo | Prueba concreta | Task |
| --- | --- | --- |
| R1 · Reintento después de cambiar zona horaria, moneda o configuración | `ewm-v1.test.ts › "el cuerpo no cambia si cambia la cascada de config del tenant"`; pgTAP `23 › "resolvedCurrency queda congelada aunque cambie companies.currency"`; pgTAP `23 › "product_configuration es inmutable tras el primer intento"`; `replay.test.ts › "huella distinta → REPLAY_BODY_DRIFT sin llamar"` | 6, 7, 11 |
| R2 · `admin.fullName` ausente | `ewm-v1.test.ts › "sin admin.fullName → ADMIN_FULL_NAME_REQUIRED, sin firma ni fetch"`; `ProductConfigurationForm.test.tsx › "fullName obligatorio sólo para EWM_V1"`; `ProductConfigurationForm.test.tsx › "precarga desde profiles cuando existe"` | 6, 12 |
| R3 · `product_configuration` malicioso o enorme | pgTAP `23 › "rechaza > 4096 bytes"`, `"rechaza arrays"`, `"rechaza profundidad > 2"`, `"rechaza no-objeto"`; `ewm-v1.test.ts › "rechaza claves desconocidas"`, `"rechaza valores con esquema URL o ${ / {{"`, `"rechaza tipos incorrectos"` | 2, 4 |
| R4 · Integración GENERIC existente después de la migración | pgTAP `23 › "toda fila previa queda en GENERIC"`, `"upsert sin p_adapter_key preserva EWM_V1 y GENERIC"`, `"payload del contexto idéntico a la expresión previa"`; prueba dorada verde en la Task 24 | 1, 2, 5, 24 |
| R5 · EWM responde `201` válido pero incompleto | `ewm-v1.test.ts › "201 sin companyId / sin organizationId / sin provisioningId / sin replayed → PROVIDER_RESPONSE_INVALID"`, `"controlPlaneTenantId distinto → inválido"`, `"companyId distinto del enviado → inválido"`, `"status ≠ ACTIVE → inválido"`, `"companyId no UUID → inválido"`; `ewm-v1.test.ts › "201 inválido deja FAILED y el reintento con la misma clave acepta 200 replayed:true"` (la solicitud no pasa a `ACTIVE` con datos parciales, y el alta que EWM sí hizo se recupera sin duplicar) | 8 |

---

## Correspondencia con las Tasks solicitadas

Las Tasks se numeran **en orden de ejecución**. La correspondencia con el pedido:

| Pedido | Plan |
| --- | --- |
| 1 Golden | 1 |
| 2 Migración | 2 |
| 3 Registry | 3 |
| 4 Request codec + product_configuration | 4 |
| 5 Source | 5 |
| 6 Admin fullName | 6 |
| 7 Timezone/currency | 7 |
| 8 Response | 8 |
| 9 Path | 9 |
| 10 GET_STATUS | 10 |
| 11 Replay | 11 |
| 12 UI | 12 |
| — Gate local previo a lo remoto | 13 |
| 15 Secret | 14 |
| 16 Migración QAS | 15 |
| 14 CORS + 16 deploy | 16 |
| 13 Config EWM QAS | 17 (necesita la columna de la Task 15) |
| 17 Pre-activation | 18 |
| 18 Test connection | 19 |
| 19 Create | 20 |
| 20 Replay | 21 |
| 21 Get | 22 |
| 22 Security + advisors | 23 |
| 23 Full gate | 24 |
| 24 Docs | 25 |
| 25 Commits/report | 26 |

---

## Task 1 — Golden test GENERIC antes del refactor

> **Excepción TDD deliberada:** es una prueba de caracterización. Tiene que pasar **contra el código actual**, y a partir de aquí queda congelada.

**Files:**
- CREATE `supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts`
- CREATE `e2e/v4-generic-orchestrator-golden.spec.ts`

- [ ] **1.1 Escribir la prueba dorada del adaptador.** Reutiliza la forma de `http-m2m.test.ts`, pero con reloj, `jti` y clave **deterministas**, para poder comparar por igualdad exacta:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HttpM2mAdapter } from './http-m2m';
import type { ProvisioningContext } from '../types';

/*
 * CONTRATO GENERIC CONGELADO (Task 1 del plan EWM).
 * Esta prueba se escribió contra el código ANTERIOR al refactor de codecs.
 * Si falla, el refactor cambió el contrato genérico: HARD STOP H1.
 * NO se actualiza para acomodar un cambio.
 */

const FIXED_NOW = new Date('2026-09-21T12:00:00.000Z');

async function fixedEcKeyPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
  return `-----BEGIN PRIVATE KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
}
const KEY = await fixedEcKeyPem();

function genericContext(): ProvisioningContext {
  return {
    request: {
      id: '9a000000-0000-4000-a000-000000000001',
      status: 'READY_TO_PROVISION',
      idempotency_key: 'ma-prov-v1-golden',
      correlation_id: '11111111-2222-4333-8444-555555555555',
      attempt_count: 0, max_attempts: 3, request_version: 1,
      environment: 'QAS', policy: 'MANUAL', requested_by: 'u1', subscription_id: null,
    },
    product: { id: 'p1', code: 'producto', short_name: 'Producto' },
    deployment: { id: 'd1', code: 'producto-shared-qas', deployment_mode: 'SHARED', environment: 'QAS',
      base_url: 'https://producto-qas.example.com', timeout_ms: 2000, retry_count: 2,
      status: 'READY', enabled: true, health_status: 'HEALTHY' },
    integration: { id: 'i1', code: 'producto-provisioning-v1', type: 'HTTP_M2M', contract_version: 'v1',
      status: 'READY', enabled: true, issuer: 'masteradmin.ebim', audience: 'producto.ebim',
      subject: 'masteradmin-provisioning', algorithm: 'ES256', token_ttl_seconds: 300,
      create_scope: 'provisioning:tenant:create', read_scope: 'provisioning:tenant:read',
      additional_scopes: ['extra:scope'],
      create_path_template: '/internal/platform/v1/tenants/{tenantCode}/create',
      status_path_template: '/internal/platform/v1/tenants/{externalTenantId}',
      health_path_template: null, allowed_hosts: [] },
    credential: { id: 'c1', code: 'producto-qas-m2m', type: 'M2M_ASYMMETRIC_JWT', enabled: true,
      algorithm: 'ES256', token_ttl_seconds: 300, secret_ref: 'PRODUCTO_QAS_M2M_PRIVATE_KEY', public_key_ref: null },
    payload: {
      tenantCode: 'alpha-ewm', tenantName: 'Alpha · Producto', adminEmail: 'admin@alpha.ebim.test',
      tenantType: 'PRODUCTION', environment: 'QAS', deploymentMode: 'SHARED',
      organization: { code: 'empresa-directa-alpha', legalName: 'Alpha S.A.C.', displayName: 'Alpha', countryCode: 'PE', taxId: '20500000004' },
      company: { code: 'ALPHA-01', name: 'Alpha', countryCode: 'PE', currency: 'PEN', taxId: '20500000004' },
      plan: { code: 'plan-std', name: 'Standard' },
      masterAdmin: { tenantId: '50000000-0000-4000-a000-000000000008', productCode: 'producto',
        requestId: '9a000000-0000-4000-a000-000000000001', correlationId: '11111111-2222-4333-8444-555555555555', contractVersion: 'v1' },
    },
    actor: { id: 'u1', role: 'TECH_LEAD' },
  };
}

function adapterWith(fetchImpl: typeof fetch) {
  return new HttpM2mAdapter({
    fetchImpl,
    secretResolver: (ref) => (ref === 'PRODUCTO_QAS_M2M_PRIVATE_KEY' ? KEY : undefined),
    sleep: () => Promise.resolve(),
    now: () => FIXED_NOW,
  });
}

const decode = (seg: string) => JSON.parse(Buffer.from(seg, 'base64url').toString());
```

Casos obligatorios (cada uno con `expect(...).toEqual(...)` o `toBe(...)` sobre **valores literales**, no sobre llamadas al código):

1. **URL y método:** `https://producto-qas.example.com/internal/platform/v1/tenants/alpha-ewm/create`, `POST`.
2. **Cabeceras exactas** (sin `authorization`): `{ 'content-type': 'application/json', accept: 'application/json', 'x-correlation-id': '1111…5555', 'idempotency-key': 'ma-prov-v1-golden', 'x-masteradmin-contract': 'v1' }`, más `authorization` que empieza por `Bearer `. Se compara también el **orden de claves** con `Object.keys(headers)`.
3. **Cuerpo exacto:** `init.body` es `toBe(JSON.stringify(genericContext().payload))` y además es igual a un **literal** de texto pegado en la prueba (el JSON serializado).
4. **Claims** (segundo segmento decodificado): `{ iss: 'masteradmin.ebim', aud: 'producto.ebim', sub: 'masteradmin-provisioning', iat: 1789992000, exp: 1789992300, scope: 'provisioning:tenant:create extra:scope', actor_id: 'u1', actor_role: 'TECH_LEAD', correlation_id: '1111…5555' }`, más `jti` con forma de UUID. Cabecera JOSE `{ alg: 'ES256', typ: 'JWT' }`.
5. **Scope de lectura:** `getStatus` usa `GET` sobre `/internal/platform/v1/tenants/9a000000-0000-4000-a000-000000000001` (hoy `{externalTenantId}` = `request.id`), sin cuerpo, con scope `provisioning:tenant:read extra:scope`.
6. **Respuesta:** un `201` con `{ status:'ACTIVE', externalTenantId:'ext-1', externalOrganizationId:'org-1', externalCompanyId:'co-1', resources:{ initialWarehouseId:'WH-01', nested:{x:1} }, rawReference:'op-1', extra:'ignored' }` produce `outcome.ok === true`, `outcome.attempts === 1` y `outcome.result` `toEqual({ status:'ACTIVE', externalTenantId:'ext-1', externalOrganizationId:'org-1', externalCompanyId:'co-1', resources:{ initialWarehouseId:'WH-01' }, rawReference:'op-1' })`. Se comparan `ok`, `attempts` y `result` **por separado**, porque el envoltorio es interno y el contrato es `result`.
7. **Respuesta sin `externalTenantId`:** `200 {ok:true}` → `outcome.ok === false` y `failure.code === 'PROVIDER_RESPONSE_INVALID'`.
8. **Reintentos:** `503, 503, 201` con `retry_count: 2` → 3 llamadas, `attempts === 3`, **misma** `idempotency-key` y mismo texto de cuerpo en las 3. `409` → 1 llamada, sin reintento, `failure.retryable === false`. Una red que falla (`fetch` lanza `TypeError`) 3 veces → `PROVIDER_UNREACHABLE`.
9. **Marcadores actuales:** con `create_path_template: '/x/{tenantCode}/{externalTenantId}'` → `/x/alpha-ewm/9a000000-…0001`; con `'/x/{unknownKey}'` → `failure.code === 'PATH_TEMPLATE_INVALID'`.

- [ ] **1.2 Ejecutar contra el código actual.** `npx vitest run supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` → **PASS**. Si algún literal no coincide, se corrige **el literal de la prueba** para reflejar lo que el código hace **hoy**. Es la única vez que se permite.

- [ ] **1.3 Escribir la prueba dorada del orquestador** (`e2e/v4-generic-orchestrator-golden.spec.ts`). Reutiliza `jwtOf`/`callOrchestrator` y las constantes de `v4-provisioning-orchestrator.spec.ts`, copiadas, no importadas, porque son locales a ese archivo:
   - `"acción desconocida se comporta como PROVISION"`: sobre una solicitud `ACTIVE` del flujo MOCK (`TENANT_ALPHA_EWM`, creada y provisionada en `beforeAll` con el Tech Lead), `callOrchestrator(jwt, {action:'NO_EXISTE', request_id})` devuelve **el mismo status HTTP y el mismo `body.error`** que `callOrchestrator(jwt, {action:'PROVISION', request_id})`.
   - `"sin acción se comporta como PROVISION"`: ídem con `{request_id}`.

- [ ] **1.4 Ejecutar en local con §0.1:** `npm run e2e -- e2e/v4-generic-orchestrator-golden.spec.ts` → **PASS** (2 tests).

- [ ] **1.5 Commit:**
```bash
git add supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts e2e/v4-generic-orchestrator-golden.spec.ts
git commit -m "test(provisioning): lock generic adapter contract"
git rev-parse HEAD > "$TMPDIR/ewm-golden-sha"   # referencia de H1 para el resto del plan
```

---

## Task 2 — Migración aditiva: `adapter_key` y `product_configuration`

**Files:** CREATE `supabase/migrations/20260921000100_v4_contract_adapters.sql`, CREATE `supabase/tests/23_v4_contract_adapters.test.sql`.

- [ ] **2.1 pgTAP que falla primero.** Encabezado copiado de `22_v4_provisioning_rbac.test.sql` (`begin; select plan(N);`, `pg_temp.act_as`, `pg_temp.act_as_postgres`, helpers `super_admin()`, `tech_lead()`, `ewm_owner()`, `p_ewm()`). Casos de esta Task:
   1. `has_type('platform','integration_adapter')` y `enum_has_labels('platform','integration_adapter', array['GENERIC','EWM_V1'])`.
   2. `has_column('platform','product_integrations','adapter_key')`, `col_not_null`, `col_default_is(…, 'GENERIC'::platform.integration_adapter)`.
   3. **R4:** `is((select count(*) from platform.product_integrations where adapter_key <> 'GENERIC'), 0::bigint, 'toda fila previa queda en GENERIC')`.
   4. `throws_ok` al hacer `insert` o `update` con `adapter_key='EWM_V1'` sobre una integración `MANUAL` (`23514`, CHECK `product_integrations_adapter_ck`).
   5. `throws_ok` con `'OTRO'::platform.integration_adapter` (`22P02`): un valor arbitrario es imposible.
   6. **Upsert preserva (R4):** como `tech_lead`, se fija `EWM_V1` en `ewm-provisioning-v1` con `p_adapter_key => 'EWM_V1'`; luego se llama a `upsert_product_integration` **sin** `p_adapter_key` → sigue en `EWM_V1`. Lo mismo para una integración GENERIC → sigue en `GENERIC`.
   7. `p_adapter_key => 'GENERIC'` explícito funciona.
   8. **Auditoría:** tras cambiar el adaptador, existe en `platform.audit_logs` una fila `action='INTEGRATION_UPDATED'` cuyo `metadata::text` contiene `"adapter_key": "EWM_V1"` (after) y `"adapter_key": "GENERIC"` (before).
   9. `has_column('platform','saas_provisioning_requests','product_configuration')`, `col_not_null`, default `'{}'`; todas las filas previas tienen `'{}'`.
   10. **R3:** `throws_ok` al actualizar como `postgres` con: `'[]'::jsonb` (no objeto), un objeto con un array anidado, profundidad 3 (`{"a":{"b":{"c":1}}}`) y un objeto de más de 4096 bytes. Todos `23514`, CHECK `saas_prov_product_configuration_ck`.
   11. **RLS:** como `tech_lead`, `update platform.saas_provisioning_requests set product_configuration = …` falla con `42501`: no hay escritura directa desde el navegador.

   `npm run db:test` → **FAIL** (el tipo no existe).

- [ ] **2.2 Escribir la migración (parte 1).** Contenido exacto de esta Task:

```sql
-- V4 · Adaptadores de contrato (spec 2026-09-21). SÓLO ADITIVA.
create type platform.integration_adapter as enum ('GENERIC', 'EWM_V1');

alter table platform.product_integrations
  add column adapter_key platform.integration_adapter not null default 'GENERIC';
alter table platform.product_integrations
  add constraint product_integrations_adapter_ck
  check (adapter_key = 'GENERIC' or integration_type = 'HTTP_M2M');

alter table platform.saas_provisioning_requests
  add column product_configuration jsonb not null default '{}'::jsonb;
alter table platform.saas_provisioning_requests
  add constraint saas_prov_product_configuration_ck check (
    jsonb_typeof(product_configuration) = 'object'
    and octet_length(product_configuration::text) <= 4096
    and not jsonb_path_exists(product_configuration, 'strict $.**?(@.type() == "array")')
    and not jsonb_path_exists(product_configuration, '$.*.*.*')
  );
```

Después, `upsert_product_integration`:
   - `drop function platform.upsert_product_integration(uuid, text, text, platform.integration_type, text, uuid, text, text, text, text, platform.m2m_algorithm, integer, text, text, text[], text, text, text, text[], platform.provisioning_policy, boolean, platform.integration_status, jsonb, uuid);`
   - `create function platform.upsert_product_integration(` con los **mismos** parámetros en el **mismo** orden (copiados de `20260915000400_v4_provisioning_rpcs.sql` líneas 21–46) más `p_adapter_key platform.integration_adapter default null` al final.
   - El cuerpo es una copia literal de las líneas 47–145, con tres añadidos: `adapter_key` en la lista de columnas del `insert`, `coalesce(p_adapter_key, 'GENERIC')` en `values`, y `adapter_key = coalesce(p_adapter_key, t.adapter_key)` en el `do update set`. El `before`/`after` de auditoría (`to_jsonb(i) - 'metadata'`) ya incluye la columna nueva.
   - `comment on function` copiado.
   - Grants con la firma nueva, siguiendo `20260915000600_v4_provisioning_rls.sql` líneas 91 y 110–111: `revoke all … from public, anon; grant execute … to authenticated, service_role;`.

- [ ] **2.3** `supabase db reset --local` → `npm run db:test` → **PASS** (todos los archivos, incluidos `21` y `22` sin cambios).
- [ ] **2.4** Revisión H2: `grep -nE "drop column|rename|^\s*update |^\s*delete " supabase/migrations/20260921000100_v4_contract_adapters.sql` → sólo el `drop function` de la firma antigua (recreada en el mismo archivo).
- [ ] **2.5** Prueba dorada: `npx vitest run supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` → PASS.
- [ ] **2.6 Commit:** `feat(provisioning): add backward-compatible adapter metadata`

---

## Task 3 — Contrato de codec, registro y enrutado de acciones

**Files:** MODIFY `types.ts`, `registry.ts`, `registry.test.ts`, `adapters/http-m2m.ts`, `adapters/manual.ts`, `adapters/mock.ts`, `index.ts`, `provisioning-orchestrator/index.ts`; CREATE `adapters/generic.ts`, `actions.ts`, `actions.test.ts`.

- [ ] **3.1 Pruebas que fallan** (`registry.test.ts` y `actions.test.ts`):
   - `resolveAdapter('HTTP_M2M','QAS',deps)` sin cuarto argumento → `adapter.codec.key === 'GENERIC'` y `adapter.capabilities` `toEqual(['PROVISION'])`.
   - `resolveAdapter('HTTP_M2M','QAS',deps,'GENERIC')` → mismo resultado.
   - `resolveAdapter('HTTP_M2M','QAS',deps,'EWM_V1')` → `codec.key === 'EWM_V1'`. Hasta la Task 4, `EWM_V1_CODEC` existe como stub que lanza `ADAPTER_NOT_IMPLEMENTED` en todos sus métodos.
   - `resolveAdapter('MANUAL','QAS',deps,'EWM_V1')` → lanza `ProvisioningError` `ADAPTER_NOT_IMPLEMENTED`.
   - `resolveAdapter('HTTP_M2M','QAS',deps,'OTRO' as AdapterKey)` → `ADAPTER_NOT_IMPLEMENTED` (clave fuera de `CONTRACT_CODECS`).
   - `ManualAdapter` y `MockAdapter`: `capabilities` `toEqual(['PROVISION'])`.
   - `Object.keys(CONTRACT_CODECS).sort()` `toEqual([...ADAPTER_KEYS].sort())`.
   - `routeAction(undefined)` → `'PROVISION'`; `routeAction('PROVISION')` → `'PROVISION'`; `routeAction('CHECK_HEALTH')` → `'CHECK_HEALTH'`; `routeAction('GET_STATUS')` → `'GET_STATUS'`; `routeAction('REPLAY_CERTIFICATION')` → `'REPLAY_CERTIFICATION'`; **`routeAction('NO_EXISTE')` → `'PROVISION'`** y `routeAction(42)` → `'PROVISION'` (preservación, §8 fila 11 de la spec).
   - `permissionRpcFor('PROVISION')` → `{ rpc:'can_execute_saas_provisioning', arg:'p_request_id', bodyField:'request_id' }`; `CHECK_HEALTH` → `{ rpc:'can_check_deployment_health', arg:'p_deployment_target_id', bodyField:'deployment_target_id' }`; `GET_STATUS` → `can_read_saas_provisioning`/`p_request_id`; `REPLAY_CERTIFICATION` → `can_certify_saas_provisioning`/`p_request_id`.

- [ ] **3.2 Tipos (aditivos) en `types.ts`:**

```ts
export type AdapterKey = 'GENERIC' | 'EWM_V1';
export const ADAPTER_KEYS: readonly AdapterKey[] = ['GENERIC', 'EWM_V1'];
export type AdapterCapability = 'PROVISION' | 'GET_STATUS' | 'REPLAY_CERTIFICATION';

export interface ProvisioningSource {
  tenant: { id: string; slug: string; name: string; admin_email: string; deployment_mode: string };
  organization: { id: string; slug: string; legal_name: string; display_name: string;
                  country_code: string; tax_id: string | null };
  company: { id: string; name: string; erp_code: string | null; country_code: string;
             currency: string; tax_id: string | null } | null;
  mapping: { external_tenant_id: string | null; external_organization_id: string | null;
             external_company_id: string | null } | null;
  product_configuration: Record<string, unknown>;
}

/** Forma del contrato. Sin E/S: no firma, no llama, no lee secretos. */
export interface ContractCodec {
  readonly key: AdapterKey;
  readonly capabilities: readonly AdapterCapability[];
  validateInput(context: ProvisioningContext): string[];
  buildCreateBody(context: ProvisioningContext): unknown;
  pathParams(context: ProvisioningContext): Record<string, string>;
  /** `context` permite contrastar la respuesta con lo enviado; GENERIC lo ignora. */
  parseResponse(body: unknown, operation: 'create' | 'read', context: ProvisioningContext): AdapterResult;
}
```

Cambios aditivos en tipos existentes:
- `ProvisioningContext`: `source?: ProvisioningSource; adapter?: { key: AdapterKey; capabilities: AdapterCapability[] };`
- `AdapterResult`: `replayed?: boolean;`
- rama `ok: true` de `AdapterOutcome`: `httpStatus?: number;`
- `ProvisioningAdapter`: `readonly capabilities: readonly AdapterCapability[]; validateInput?(c: ProvisioningContext): string[]; createBodyFingerprint?(c: ProvisioningContext): Promise<string>;`

- [ ] **3.3 `adapters/generic.ts`:** se **mueven** las expresiones actuales de `http-m2m.ts` sin reescribirlas:

```ts
export const GENERIC_CODEC: ContractCodec = {
  key: 'GENERIC',
  capabilities: ['PROVISION'],
  validateInput: () => [],
  buildCreateBody: (context) => context.payload,
  pathParams: (context) => {
    const params: Record<string, string> = {
      externalTenantId: context.request.id,
      tenantCode: context.payload.tenantCode,
    };
    const cp = context.source?.tenant.id ?? context.payload.masterAdmin?.tenantId;
    if (typeof cp === 'string' && cp !== '') params.controlPlaneTenantId = cp;
    return params;
  },
  parseResponse: (body) => parseProvisioningResponse(body),
};
```

- [ ] **3.4 `HttpM2mAdapter`:** `constructor(private readonly deps: HttpAdapterDeps, readonly codec: ContractCodec = GENERIC_CODEC)`; `get capabilities() { return this.codec.capabilities; }`; `validateInput(c) { return this.codec.validateInput(c); }`.
   - En `call()`: el objeto de marcadores pasa a ser `this.codec.pathParams(context)`; `JSON.stringify(context.payload)` pasa a ser `createBodyText(this.codec, context)` (Task 11 crea `fingerprint.ts`; hasta entonces, `JSON.stringify(this.codec.buildCreateBody(context))`); `parseProvisioningResponse(last.body)` pasa a ser `this.codec.parseResponse(last.body, operation, context)`.
   - En el éxito se añade `httpStatus: last.status`. **Nada más cambia.**

- [ ] **3.5 `registry.ts`:** `export const CONTRACT_CODECS: Readonly<Record<AdapterKey, ContractCodec>> = { GENERIC: GENERIC_CODEC, EWM_V1: EWM_V1_CODEC };` y `resolveAdapter(type, environment, deps, adapterKey: AdapterKey = 'GENERIC')`:
   - `adapterKey !== 'GENERIC' && type !== 'HTTP_M2M'` → `ADAPTER_NOT_IMPLEMENTED`;
   - `!(adapterKey in CONTRACT_CODECS)` → `ADAPTER_NOT_IMPLEMENTED`;
   - `HTTP_M2M` → `new HttpM2mAdapter({...}, CONTRACT_CODECS[adapterKey])`.

- [ ] **3.6 `actions.ts`:** `OrchestratorAction`, `routeAction(raw: unknown): OrchestratorAction` y `permissionRpcFor(action)` con la tabla de 3.1.

- [ ] **3.7 Orquestador:**
   - `const action = routeAction(body.action);`
   - permiso con `permissionRpcFor(action)`, en lugar del ternario actual (mismo comportamiento para `PROVISION` y `CHECK_HEALTH`);
   - en `provision()`: `resolveAdapter(adapterType, environment, { secretResolver }, ctx.adapter?.key ?? 'GENERIC')`.

   Las ramas `GET_STATUS` y `REPLAY_CERTIFICATION` responden `501 {error:'ACCION_NO_DISPONIBLE'}` hasta las Tasks 10 y 11.

- [ ] **3.8 Verificación:**
   - `npx vitest run supabase/functions/_shared/provisioning` → PASS, **incluida la dorada sin cambios** (H1);
   - `git diff --stat "$(cat "$TMPDIR/ewm-golden-sha")" -- supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` → vacío (se compara contra el commit de la Task 1, no contra `afc40cf`, donde el archivo aún no existía);
   - con §0.1: `npm run e2e -- e2e/v4-generic-orchestrator-golden.spec.ts e2e/v4-provisioning-orchestrator.spec.ts` → PASS.

- [ ] **3.9 Commit:** `refactor(provisioning): select contract codec through the adapter registry`

---

## Task 4 — Codec EWM V1: petición y validación de `product_configuration`

**Files:** CREATE/MODIFY `adapters/ewm-v1.ts`, CREATE `adapters/ewm-v1.test.ts`.

Contrato exacto del cuerpo, copiado de `WMS-by-EBIM@origin/qas:docs/platform-provisioning/API_CONTRACT.md` §2:

```ts
export interface EwmCreateBody {
  controlPlaneTenantId: string;                 // UUID
  organization: {
    id: string;                                 // UUID canónico del hub
    slug: string;                               // ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$
    name: string;                               // ≤ 200
    legalName: string | null;                   // ≤ 200
    taxId: string | null;                       // ≤ 32
    countryCode: string;                        // ISO 3166-1 alfa-2
    currency: string;                           // ISO 4217
    timezone: string;                           // IANA
  };
  company: {
    id: string;                                 // UUID; es el tenant_id de EWM
    name: string;                               // ≤ 200
    legalName: string | null;
    taxId: string | null;
    erpCode: string | null;
    countryCode: string;
    currency: string;
  };
  initialWarehouse: {
    code: string;                               // ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$
    erpCode: string | null;
    name: string;                               // ≤ 200
    address: string | null;                     // ≤ 500
    timezone: string;                           // IANA
    is3pl: boolean;
  };
  admin: { email: string; fullName: string };   // fullName ≤ 200
  deploymentMode: 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED';
}
```

Forma de `product_configuration` para `EWM_V1` (lista cerrada). `resolvedCurrency` la escribe el servidor (A2):

```ts
export interface EwmProductConfiguration {
  organizationTimezone: string;
  initialWarehouse: { code: string; name: string; timezone: string;
                      erpCode?: string | null; address?: string | null; is3pl?: boolean };
  admin: { fullName: string };
  resolvedCurrency: string;
}
```

- [ ] **4.1 Pruebas que fallan** (`ewm-v1.test.ts`). Fixture `ewmContext()` = contexto con `source` completo (tenant `50000000-…0008`, organización `30000000-…0004` slug `empresa-directa-alpha`, sociedad `31000000-…0001` PEN) y `product_configuration` válida.
   - **Cuerpo exacto:** `EWM_V1_CODEC.buildCreateBody(ewmContext())` `toEqual` el literal completo de `EwmCreateBody`. Comprueba en particular:
     - `organization.name = source.organization.display_name` y `organization.legalName = legal_name`;
     - `organization.currency = company.currency = product_configuration.resolvedCurrency`;
     - `organization.timezone = organizationTimezone`;
     - `company.legalName = null`;
     - `initialWarehouse.is3pl = false` cuando se omite, y `erpCode`/`address` `null` cuando se omiten;
     - `admin.email = source.tenant.admin_email.toLowerCase()`;
     - `initialWarehouse.code` se envía en MAYÚSCULAS (`'cd01'` → `'CD01'`) y `company.erpCode` también, porque EWM los normaliza así (API_CONTRACT §2). Enviar la forma canónica hace que el cuerpo de un reintento o replay sea byte a byte el que EWM ya guardó;
     - `deploymentMode = source.tenant.deployment_mode`.
   - **Orden de claves estable:** `JSON.stringify(body)` es `toBe` un literal de texto (determinismo para la huella).
   - **Validación (bloqueos estables, sin firma ni fetch):** `validateInput(ctx)` devuelve exactamente:

| Entrada | Bloqueo |
| --- | --- |
| `source` ausente | `['SOURCE_MISSING']` |
| `source.company = null` | `['COMPANY_REQUIRED']` |
| slug de 41 caracteres | `['ORGANIZATION_SLUG_INCOMPATIBLE']` |
| `product_configuration = {}` | `['PRODUCT_CONFIGURATION_MISSING']` |
| clave extra `{…, script:'x'}` o `initialWarehouse.foo` | `['PRODUCT_CONFIGURATION_UNKNOWN_KEY']` (R3) |
| `initialWarehouse.code = 'WH 001'` / `'-WH'` / 33 caracteres | `['INITIAL_WAREHOUSE_CODE_INVALID']` |
| `initialWarehouse.name = ''` / 201 caracteres | `['INITIAL_WAREHOUSE_NAME_INVALID']` |
| `organizationTimezone = 'Mars/Base'` o `initialWarehouse.timezone = ''` | `['TIMEZONE_INVALID']` (validación con `new Intl.DateTimeFormat('en-US', { timeZone })` dentro de `try`) |
| `admin` ausente o `fullName = '  '` | `['ADMIN_FULL_NAME_REQUIRED']` (R2) |
| `resolvedCurrency` ausente o no `^[A-Z]{3}$` | `['CURRENCY_SNAPSHOT_MISSING']` |
| cualquier string con `^[a-z][a-z0-9+.-]*://`, `${` o `{{` | `['PRODUCT_CONFIGURATION_VALUE_NOT_ALLOWED']` (R3) |
| `is3pl: 'true'` (string) | `['PRODUCT_CONFIGURATION_TYPE_INVALID']` (R3) |

   - Con varios problemas, la lista viene **ordenada y sin duplicados**.
   - **Integración con el adaptador:** `new HttpM2mAdapter(deps, EWM_V1_CODEC).validateInput(ctxSinFullName)` → `['ADMIN_FULL_NAME_REQUIRED']`, y el `fetchImpl` espía no se llamó (R2).

- [ ] **4.2 Implementar** `validateEwmProductConfiguration(pc): string[]`, `buildEwmCreateBody(ctx): EwmCreateBody` y la parte correspondiente de `EWM_V1_CODEC` (`key:'EWM_V1'`, `validateInput`, `buildCreateBody`). `pathParams` y `parseResponse` llegan en las Tasks 8–9; hasta entonces lanzan `ADAPTER_NOT_IMPLEMENTED`.

- [ ] **4.3** `npx vitest run supabase/functions/_shared/provisioning` → PASS, dorada incluida.
- [ ] **4.4 Commit:** `feat(provisioning): add EWM v1 request codec`

---

## Task 5 — Contexto de ejecución con `source` y `adapter`

**Files:** MODIFY `supabase/migrations/20260921000100_v4_contract_adapters.sql`, `supabase/tests/23_v4_contract_adapters.test.sql`, `supabase/functions/provisioning-orchestrator/index.ts`.

- [ ] **5.1 pgTAP que falla:**
   1. **Payload idéntico (R4):** como `service_role` (`set local role service_role`), para **cada** solicitud del seed en `platform.saas_provisioning_requests`: `is(platform.provisioning_execution_context(r.id)->'payload', <jsonb recalculado>)`. La expresión recalculada es la copia **literal** de `20260915000500_v4_orchestrator_rpcs.sql` líneas 183–204, dentro de la propia prueba, con los mismos `select … into` sobre `tenants`, `organizations`, `companies`, `plans` y `saas_products`.
   2. `ok(ctx ? 'source')`; `source->'tenant'->>'id' = tenant_id`; `source->'organization'->>'id' = tenants.customer_organization_id`; `source->'company'->>'id' = tenants.company_id` (o `jsonb 'null'` si no hay sociedad); `source->'product_configuration' = product_configuration`; `source->'mapping'` refleja `tenant_product_mappings` de esa solicitud o `null`.
   3. `ctx->'adapter'->>'key'` = `adapter_key` de la integración **efectiva**, `coalesce(deployment.product_integration_id, request.product_integration_id)`, igual que hoy; y `ctx->'adapter'->'capabilities' = to_jsonb(platform.integration_capabilities(...))`.
   4. `platform.integration_capabilities('GENERIC', '/x/{externalTenantId}', 'r')` = `'{PROVISION}'`; `('EWM_V1', null, 'r')` = `'{PROVISION,REPLAY_CERTIFICATION}'`; `('EWM_V1', '/x', null)` = `'{PROVISION,REPLAY_CERTIFICATION}'`; `('EWM_V1', '/x', 'r')` = `'{PROVISION,GET_STATUS,REPLAY_CERTIFICATION}'`.
   5. `authenticated` sigue **sin** `EXECUTE` sobre `provisioning_execution_context`: `throws_ok` como `tech_lead` con `42501`.

- [ ] **5.2 Migración (parte 2):**
   - `create function platform.integration_capabilities(p_adapter_key platform.integration_adapter, p_status_path_template text, p_read_scope text) returns text[] language sql immutable set search_path = pg_catalog` con la regla de 5.1.4;
   - `create or replace function platform.provisioning_execution_context(p_request_id uuid)`: copia **literal** de las líneas 66–207 de `20260915000500_v4_orchestrator_rpcs.sql`, con `select * into v_map from platform.tenant_product_mappings where saas_provisioning_request_id = p_request_id;` añadido junto a los demás `select … into`, y dos claves nuevas al final del `jsonb_build_object` exterior, **después** de `'payload'`:

```sql
    ,
    'source', jsonb_build_object(
      'tenant', jsonb_build_object('id', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
                                   'admin_email', v_tenant.admin_email,
                                   'deployment_mode', v_tenant.deployment_mode::text),
      'organization', jsonb_build_object('id', v_org.id, 'slug', v_org.slug,
                                   'legal_name', v_org.legal_name, 'display_name', v_org.display_name,
                                   'country_code', v_org.country_code, 'tax_id', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
                                   'id', v_comp.id, 'name', v_comp.name, 'erp_code', v_comp.erp_code,
                                   'country_code', v_comp.country_code, 'currency', v_comp.currency,
                                   'tax_id', v_comp.tax_id) end,
      'mapping', case when v_map.id is null then null else jsonb_build_object(
                                   'external_tenant_id', v_map.external_tenant_id,
                                   'external_organization_id', v_map.external_organization_id,
                                   'external_company_id', v_map.external_company_id) end,
      'product_configuration', v_req.product_configuration),
    'adapter', jsonb_build_object(
      'key', coalesce(v_int.adapter_key, 'GENERIC')::text,
      'capabilities', to_jsonb(platform.integration_capabilities(
                        coalesce(v_int.adapter_key, 'GENERIC'),
                        v_int.status_path_template, v_int.read_scope)))
```

   Los grants de `provisioning_execution_context` no cambian (la firma es la misma). `integration_capabilities` se concede a `authenticated, service_role` y se revoca a `public, anon`.

- [ ] **5.3 Orquestador:** el `ctx` ya se esparce en `ProvisioningContext` (`{ ...ctx, actor }`), así que `source` y `adapter` llegan solos. **No** se leen del cuerpo HTTP: `RequestBody` sigue aceptando sólo `action`, `request_id` y `deployment_target_id`. Prueba en `actions.test.ts`: `"el cuerpo de la petición no puede aportar source/adapter"`. Se documenta que `routeAction` y el handler ignoran esas claves: el orquestador construye `context` exclusivamente desde `provisioning_execution_context`.

- [ ] **5.4 Orquestador, validación previa a `begin`:** después de obtener `ctx` y resolver el adaptador, **antes** de `begin_saas_provisioning`:

```ts
const blockers = adapter.validateInput?.(context) ?? [];
if (blockers.length > 0) {
  return json({ error: 'PRECONDICIONES_NO_CUMPLIDAS', blockers,
    message: 'La solicitud no cumple las condiciones para ejecutarse' }, 409);
}
```

   Para GENERIC, `validateInput` devuelve `[]` y el flujo es idéntico. `resolveAdapter` se mueve antes de `begin`; si lanza, se conserva el comportamiento actual (el `catch` produce la misma falla normalizada), y la dorada E2E lo verifica.

- [ ] **5.5** `supabase db reset --local` → `npm run db:test` PASS → `npx vitest run supabase/functions/_shared/provisioning` PASS → con §0.1, E2E dorada + `v4-provisioning-orchestrator.spec.ts` PASS.
- [ ] **5.6 Commit:** `feat(provisioning): expose source identities to contract codecs`

---

## Task 6 — `admin.fullName` y configuración congelada por solicitud

**Files:** MODIFY migración y pgTAP; MODIFY `src/services/queries.ts`, `src/services/mutations.ts`.

- [ ] **6.1 pgTAP que falla:**
   1. `set_saas_provisioning_configuration(p_request_id, p_configuration)` existe; `authenticated` tiene `EXECUTE`; `anon` no.
   2. Como `ewm_owner` (tiene `platform.provisioning.execute` sobre EWM), sobre una solicitud EWM en `READY_TO_PROVISION` con `attempt_count = 0` → OK. La fila queda con la configuración enviada **más** `resolvedCurrency` (A2).
   3. Como `esup_owner` sobre la misma solicitud → `42501`.
   4. **Inmutable (R1):** tras `update … set attempt_count = 1` (como `postgres`), una segunda llamada → `P0001` `CONFIGURACION_CONGELADA`. Con la solicitud en `ACTIVE`, `CANCELLED` o `PROVISIONING` → mismo error.
   5. Un `resolvedCurrency` enviado por el cliente se **sobrescribe** con `companies.currency` del tenant, y el cliente no lo puede fijar.
   6. Se registra el evento `PRODUCT_CONFIGURATION_SET` en `saas_provisioning_events`, con `detail` = `{"keys": [...]}`; el `detail::text` no contiene el `fullName` enviado.
   7. Un tenant sin sociedad → la configuración se guarda sin `resolvedCurrency`. La Task 4 ya bloquea ese caso con `COMPANY_REQUIRED` al ejecutar.

- [ ] **6.2 Migración (parte 3):** `create function platform.set_saas_provisioning_configuration(p_request_id uuid, p_configuration jsonb) returns jsonb language plpgsql security definer set search_path = platform, pg_catalog`:
   - lee la solicitud (`P0002` `SOLICITUD_NO_ENCONTRADA` si no existe);
   - autoriza con `platform.has_product_permission('platform.provisioning.execute', v_req.saas_product_id)` (`42501`);
   - exige `v_req.attempt_count = 0 and v_req.status in ('PENDING','READY_TO_PROVISION','WAITING_INFRA')`; si no, `raise exception 'CONFIGURACION_CONGELADA…' using errcode = 'P0001'`;
   - calcula `v_conf := (coalesce(p_configuration,'{}') - 'resolvedCurrency') || coalesce(jsonb_build_object('resolvedCurrency', (select c.currency from platform.tenants t join platform.companies c on c.id = t.company_id where t.id = v_req.tenant_id)), '{}')`;
   - escribe `product_configuration = v_conf`. El CHECK de la Task 2 hace cumplir forma y tamaño;
   - `perform platform.record_provisioning_event(p_request_id, 'PRODUCT_CONFIGURATION_SET', 'Configuración de producto fijada', jsonb_build_object('keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_conf) k)), auth.uid(), platform.my_provisioning_actor_role());`
   - devuelve `v_conf`.

   Grants: `revoke all … from public, anon; grant execute … to authenticated, service_role;`

- [ ] **6.3 Frontend (hooks).** En `mutations.ts`: `export function useSetProvisioningConfiguration() { return useRpc('set_saas_provisioning_configuration', ['saas-provisioning']); }`. En `queries.ts`: `useProfileFullNameByEmail(email)` → `supabase.from('profiles').select('full_name').eq('email', email.toLowerCase()).maybeSingle()`; `enabled: Boolean(email)`; devuelve `full_name ?? null`. Si RLS no devuelve fila, no hay precarga y no es un error.
- [ ] **6.4** `supabase db reset --local` → `npm run db:test` PASS → `npm run typecheck` PASS.
- [ ] **6.5 Commit:** `feat(provisioning): freeze product configuration per provisioning request`

---

## Task 7 — Zona horaria y moneda congeladas: pruebas de deriva

**Files:** MODIFY migración (grant), pgTAP, `ewm-v1.test.ts`, `src/services/queries.ts`.

- [ ] **7.1 Pruebas de deriva que fallan o faltan:**
   - pgTAP **R1-moneda:** se fija la configuración de una solicitud EWM (sociedad en PEN); `update platform.companies set currency = 'USD'` (como `postgres`); `provisioning_execution_context(req)->'source'->'product_configuration'->>'resolvedCurrency' = 'PEN'`.
   - pgTAP **R1-zona:** se fija la configuración con `organizationTimezone = 'America/Lima'`; se inserta `tenant_settings(tenant_id, config = '{"locale":{"timezone":"America/Bogota"}}')`; el contexto sigue devolviendo `'America/Lima'` en `product_configuration`.
   - vitest **R1-cuerpo:** `buildEwmCreateBody(ctx)` con `source.company.currency = 'USD'` y `resolvedCurrency = 'PEN'` → `organization.currency === 'PEN'` y `company.currency === 'PEN'`; el texto serializado es **idéntico** al de la ejecución anterior (`toBe` sobre el literal de la Task 4).
   - vitest: `buildEwmCreateBody` **no lee** ninguna zona horaria de `source`: `source` no tiene `locale` y el cuerpo usa sólo `product_configuration`.
- [ ] **7.2 Precarga de zona horaria:**
   - la migración (parte 4) añade `grant execute on function platform.effective_tenant_config(uuid) to authenticated;`. La función es `language sql stable` y no es `security definer`, así que corre con los permisos y la RLS del invocador;
   - pgTAP: `authenticated` tiene `EXECUTE`; como `tech_lead`, `effective_tenant_config('50000000-…0008')->'locale'->>'timezone'` no es nulo;
   - `queries.ts`: `useEffectiveTenantConfig(tenantId)` → `supabase.rpc('effective_tenant_config', { p_tenant: tenantId })`.
- [ ] **7.3** `supabase db reset --local` → `npm run db:test` PASS → vitest provisioning PASS.
- [ ] **7.4 Commit:** `test(provisioning): prove EWM body is stable across config drift`

---

## Task 8 — Normalización de la respuesta EWM

**Files:** MODIFY `adapters/ewm-v1.ts`, `adapters/ewm-v1.test.ts`.

Respuesta exacta de EWM (`API_CONTRACT.md` §2): `{ provisioningId, status, replayed, controlPlaneTenantId, organizationId, companyId, initialWarehouseId, adminAppUserId, adminProvisioningStatus, deploymentMode, createdAt }`.

- [ ] **8.1 Pruebas que fallan** sobre `EWM_V1_CODEC.parseResponse(body, operation, context)`, con la firma de tres parámetros definida en la Task 3. `context` aporta lo enviado (`source.tenant.id` y `source.company.id`). Casos:
   - `201` completo → `{ status:'ACTIVE', externalTenantId: companyId, externalOrganizationId: organizationId, externalCompanyId: companyId, resources:{ initialWarehouseId, adminAppUserId, adminProvisioningStatus:'PREPROVISIONED', deploymentMode:'SHARED' }, rawReference: provisioningId, replayed:false }`.
   - `200` con `replayed:true` → igual, con `replayed:true`.
   - **R5**, cada uno lanza `ProvisioningError('PROVIDER_RESPONSE_INVALID')`: sin `companyId`; sin `organizationId`; sin `provisioningId`; sin `replayed` o `replayed` no booleano; `status:'PENDING'`; `companyId:'no-uuid'`; `controlPlaneTenantId` distinto de `source.tenant.id`; `companyId` distinto de `source.company.id`; cuerpo `null` (JSON inválido).
   - Campos extra (`createdAt`, `foo`) se toleran y no aparecen en `resources`.
   - `resources` pasa por `sanitizeResources` (exportada de `response.ts`, sin cambios): un `adminAppUserId` de 600 caracteres se descarta.
   - Con operación `read`, `replayed` se exige igual (el GET devuelve `replayed:false`).
   - **R5 recuperación:** con `HttpM2mAdapter(deps, EWM_V1_CODEC)`, una primera `provision()` que recibe `201` sin `companyId` → `ok:false`, `PROVIDER_RESPONSE_INVALID`; una segunda `provision()` con el mismo contexto envía la **misma** `idempotency-key` y el mismo texto, recibe `200 replayed:true` completo → `ok:true`, `result.replayed === true`.
   - `parseProvisioningResponse` **no** se modifica: `git diff afc40cf -- supabase/functions/_shared/provisioning/response.ts` vacío.
- [ ] **8.2 Implementar** `EWM_V1_CODEC.parseResponse`. `GENERIC_CODEC.parseResponse` no cambia (Task 3).
- [ ] **8.3** vitest provisioning PASS (dorada incluida).
- [ ] **8.4 Commit:** `feat(provisioning): normalize EWM v1 responses in its codec`

---

## Task 9 — Marcador `{controlPlaneTenantId}`

**Files:** MODIFY `adapters/ewm-v1.ts`, `ewm-v1.test.ts`, `adapters/http-m2m.test.ts` (sólo casos nuevos).

- [ ] **9.1 Pruebas que fallan:**
   - `EWM_V1_CODEC.pathParams(ctx)` `toEqual({ controlPlaneTenantId: source.tenant.id })`.
   - Con `HttpM2mAdapter(deps, EWM_V1_CODEC)` y `status_path_template = '/internal/platform/v1/tenants/{controlPlaneTenantId}'`, `getStatus` llama a `GET https://ewm-rsxs.onrender.com/internal/platform/v1/tenants/50000000-0000-4000-a000-000000000008`.
   - GENERIC: con plantilla `/t/{controlPlaneTenantId}/{tenantCode}/{externalTenantId}` y `payload.masterAdmin.tenantId` → los tres sustituidos; con `masterAdmin: {}` y sin `source`, `{controlPlaneTenantId}` → `PATH_TEMPLATE_INVALID` (marcador sin valor, igual que hoy).
   - Codificación: `source.tenant.id = 'a/b?c'` → segmento `a%2Fb%3Fc`, sin inyección de ruta (reutiliza el guard).
   - Marcador desconocido `{foo}` → `PATH_TEMPLATE_INVALID`.
   - La dorada sigue verde: los marcadores GENERIC existentes no cambian.
- [ ] **9.2 Implementar** `EWM_V1_CODEC.pathParams`. `url-guard.ts` no cambia.
- [ ] **9.3** vitest provisioning PASS.
- [ ] **9.4 Commit:** `feat(provisioning): resolve controlPlaneTenantId in path templates`

---

## Task 10 — Capacidad opcional `GET_STATUS`

**Files:** MODIFY migración y pgTAP; CREATE `status.ts`, `status.test.ts`; MODIFY orquestador, `adapters/ewm-v1.ts` (capabilities).

- [ ] **10.1 pgTAP que falla:**
   - `can_read_saas_provisioning(uuid)`: `true` para super admin, tech lead y `ewm_owner` sobre una solicitud EWM; `false` para `esup_owner` sobre EWM; `false` para un usuario de tenant; `false` para un id inexistente.
   - `anon` sin `EXECUTE`.
   - `v_saas_provisioning` tiene, **al final**, las columnas `adapter_key`, `capabilities` y `product_configuration`; `capabilities` de una solicitud GENERIC = `'{PROVISION}'`.
   - Las columnas previas de la vista conservan nombre y orden: se comparan con `array_agg(attname order by attnum)` y la lista literal de `20260915000300_v4_saas_provisioning.sql` líneas 409–459.
- [ ] **10.2 Migración (parte 5):**
   - `create function platform.can_read_saas_provisioning(p_request_id uuid) returns boolean` con el patrón de `can_execute_saas_provisioning` (`20260915000500` líneas 29–50), cambiando el permiso por `'platform.provisioning.read'`;
   - `create or replace view platform.v_saas_provisioning with (security_invoker = true) as select <columnas actuales, literal> , ie.adapter_key, platform.integration_capabilities(ie.adapter_key, ie.status_path_template, ie.read_scope) as capabilities, r.product_configuration from … left join platform.product_integrations ie on ie.id = coalesce(d.product_integration_id, r.product_integration_id);`
   - el `grant select … to authenticated` se reemite.
- [ ] **10.3 Pruebas puras que fallan** (`status.test.ts`), sobre `summarizeStatus(outcome, mapping)`:
   - éxito → `{ found:true, remote:{…}, mapping_consistent:true }` si los tres ids coinciden, y `false` si difiere cualquiera;
   - falla con `httpStatus 404` → `{ found:false, remote:null, mapping_consistent: mapping === null, provider_code: failure.code }`. `provider_code` sale del `normalizeProviderFailure` existente: `RESOURCE_NOT_FOUND` si el proveedor respondió RFC 7807 con ese `code`, `PROVIDER_NOT_FOUND` si no trajo código (§ H14). `status.ts` no conoce ningún código de EWM: sólo lo propaga;
   - `401` o `403` → se propaga como falla con su código (`UNAUTHENTICATED` / `ACCESS_DENIED`);
   - la salida no contiene nunca claves `token`, `authorization` ni `body`.
- [ ] **10.4 Pruebas de capacidad** (`ewm-v1.test.ts` y `registry.test.ts`):
   - `EWM_V1_CODEC.capabilities` `toEqual(['PROVISION','GET_STATUS','REPLAY_CERTIFICATION'])`; `GENERIC_CODEC.capabilities` `toEqual(['PROVISION'])`;
   - `HttpM2mAdapter(deps, EWM_V1_CODEC).getStatus(ctx)` firma con `scope === 'ewm:tenant:read'`, **nunca** `ewm:tenant:create`: se decodifica el JWT que recibe el `fetch` espía;
   - el `GET` no lleva cuerpo.
- [ ] **10.5 Orquestador, rama `GET_STATUS`:**
   1. permiso `can_read_saas_provisioning`;
   2. `service_role` → `provisioning_execution_context`;
   3. si `!ctx.adapter?.capabilities.includes('GET_STATUS') || !adapter.capabilities.includes('GET_STATUS')` → `409 {error:'CAPACIDAD_NO_SOPORTADA'}`;
   4. estados admitidos `ACTIVE`, `FAILED` y `READY_TO_PROVISION` (A1); si no, `409 {error:'ESTADO_NO_CONSULTABLE'}`;
   5. `adapter.getStatus(context)`;
   6. `summarizeStatus(outcome, ctx.source?.mapping ?? null)`;
   7. `record_provisioning_event(request_id, 'STATUS_CHECKED', …, {provider_http_status, found, remote_status, mapping_consistent})`;
   8. respuesta `{ request_id, found, remote, mapping_consistent, provider_http_status, provider_code }` (`provider_code` es `null` en éxito).

   **No** llama a `begin_`, `complete_` ni `fail_saas_provisioning`.
- [ ] **10.6 E2E local** (añadido a `e2e/v4-provisioning-orchestrator.spec.ts`, bloque nuevo `GET_STATUS`, con §0.1):
   - sobre la solicitud MOCK/GENERIC `ACTIVE` → `409 CAPACIDAD_NO_SOPORTADA`;
   - con el JWT de `esupplier.owner` sobre EWM → `403`;
   - el estado y `attempt_count` de la solicitud no cambian (lectura antes y después).
- [ ] **10.7** `supabase db reset --local` → `npm run db:test` → vitest → E2E dorada + orquestador PASS.
- [ ] **10.8 Commit:** `feat(provisioning): add optional provider status lookup`

---

## Task 11 — Certificación interna de replay

**Files:** MODIFY migración y pgTAP; CREATE `fingerprint.ts`, `fingerprint.test.ts`, `replay.ts`, `replay.test.ts`; MODIFY `http-m2m.ts`, orquestador.

- [ ] **11.1 pgTAP que falla:** `can_certify_saas_provisioning(uuid)`:
   - `true` para tech lead y `ewm_owner` sobre una solicitud EWM en `QAS`;
   - **`false` si `provisioning_environment = 'PRD'`**, aunque sea super admin;
   - `false` para `esup_owner` sobre EWM;
   - `anon` sin `EXECUTE`.
- [ ] **11.2 Migración (parte 6):** `can_certify_saas_provisioning` = `has_product_permission('platform.provisioning.retry', product) and provisioning_environment <> 'PRD'`, más grants.
- [ ] **11.3 Pruebas puras que fallan:**
   - `fingerprint.test.ts`: `sha256Hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `createBodyText(codec, ctx)` = `JSON.stringify(codec.buildCreateBody(ctx))` y es estable entre llamadas.
   - `replay.test.ts`, sobre `evaluateReplayCertification({ expectedFingerprint, actualFingerprint, outcome, mapping })`:

| Caso | Resultado |
| --- | --- |
| `expectedFingerprint = null` | `{ call:false, error:'REPLAY_FINGERPRINT_MISSING' }` |
| huellas distintas | `{ call:false, error:'REPLAY_BODY_DRIFT' }` (R1) |
| huellas iguales (antes de llamar) | `{ call:true }` |
| outcome `200`, `replayed:true`, ids = mapping | `{ certified:true, duplicate:false }` |
| outcome `201` (`replayed:false`) | `{ certified:false, duplicate:true, reason:'PROVIDER_CREATED_AGAIN' }` |
| `200` con `replayed:false` | `{ certified:false, reason:'REPLAY_NOT_ACKNOWLEDGED' }` |
| `externalTenantId` ≠ mapping | `{ certified:false, reason:'IDENTIFIERS_MISMATCH' }` |
| outcome fallido (p. ej. `409 IDEMPOTENCY_CONFLICT`) | `{ certified:false, reason: failure.code }` |

   - `HttpM2mAdapter.createBodyFingerprint(ctx)` = `sha256Hex(createBodyText(this.codec, ctx))`.
   - **Misma clave y mismo cuerpo:** dos `provision()` con el mismo contexto envían la misma `idempotency-key` y el mismo texto (se comparan los `init` del `fetch` espía).
- [ ] **11.4 Orquestador:**
   - en `provision()`, tras un éxito y **sólo si** `adapter.capabilities.includes('REPLAY_CERTIFICATION')`: `record_provisioning_event(..., 'PROVIDER_REQUEST_FINGERPRINT', ..., { body_sha256 })`; y si `outcome.result.replayed === true`, también `PROVIDER_REPLAYED`. La respuesta de `PROVISION` no cambia de forma.
   - rama `REPLAY_CERTIFICATION`:
     1. permiso `can_certify_saas_provisioning`;
     2. contexto;
     3. capacidad;
     4. estado `ACTIVE`, o `409 ESTADO_NO_CERTIFICABLE`;
     5. `expectedFingerprint` = `detail->>'body_sha256'` del último evento `PROVIDER_REQUEST_FINGERPRINT` de la solicitud, leído con el cliente `service_role`;
     6. `actualFingerprint` = `adapter.createBodyFingerprint(context)`;
     7. `evaluateReplayCertification` antes de llamar; si `call:false`, `409` con el código y **sin fetch**;
     8. `adapter.provision(context)`;
     9. veredicto;
     10. evento `REPLAY_CERTIFICATION_PASSED` o `_FAILED`, con `{provider_http_status, replayed, identifiers_match}`;
     11. respuesta `{ request_id, certified, provider_http_status, replayed, identifiers_match, duplicate }`.

   **Nunca** llama a `begin_`, `complete_` ni `fail_saas_provisioning`.
- [ ] **11.5 E2E local:** sobre la solicitud MOCK `ACTIVE` → `409 CAPACIDAD_NO_SOPORTADA`; el estado no cambia.
- [ ] **11.6** `supabase db reset --local` → pgTAP → vitest → E2E PASS.
- [ ] **11.7 Commit:** `feat(provisioning): add internal EWM replay certification`

---

## Task 12 — UI mínima por capacidad

**Files:** CREATE `src/features/deployments/contractAdapters.ts` (+ test), `ProductConfigurationForm.tsx` (+ test), `ProvisioningStatusAction.tsx` (+ test); MODIFY `SaasProvisioningPage.tsx`, `IntegrationDialogs.tsx`, `mutations.ts`, `database.types.ts`.

- [ ] **12.1** `npm run db:types` (local) para tener `adapter_key`, `capabilities`, `product_configuration` y las RPC nuevas tipadas.
- [ ] **12.2 Pruebas que fallan** (patrón de `PeriodInvoiceAction.test.tsx`: `vi.mock('@/services/queries')`, `vi.mock('@/services/mutations')` y `vi.mock('@/components/ui/toast-context')`):
   - `contractAdapters.test.ts`: `CONTRACT_ADAPTERS.GENERIC.configurationSchema === null`; `CONTRACT_ADAPTERS.EWM_V1.configurationSchema` rechaza código de almacén inválido, `fullName` vacío, zona `Mars/Base` y claves extra (`.strict()`); acepta el ejemplo de la Task 4 **sin** `resolvedCurrency`; `Object.keys(CONTRACT_ADAPTERS)` = `['GENERIC','EWM_V1']`.
   - `ProductConfigurationForm.test.tsx`:
     - con `adapter_key='GENERIC'` → no renderiza nada (`container` vacío);
     - con `EWM_V1`, `attempt_count 0` → muestra «Código de almacén», «Nombre del almacén», «Zona horaria del almacén», «Zona horaria de la organización» y «Nombre completo del administrador»;
     - **precarga** `fullName` desde `useProfileFullNameByEmail` cuando devuelve valor, y las zonas desde `useEffectiveTenantConfig`;
     - **R2:** sin `fullName`, el envío no llama a `mutateAsync` y muestra «Obligatorio»;
     - con `attempt_count > 0` → sólo lectura, sin botón «Guardar».
   - `ProvisioningStatusAction.test.tsx`:
     - `capabilities` sin `GET_STATUS` → no hay botón «Consultar estado»;
     - con `GET_STATUS` y permiso `platform.provisioning.read` → hay botón; al pulsar llama a `mutateAsync(requestId)` y muestra «Preaprovisionado» cuando `resources.adminProvisioningStatus === 'PREPROVISIONED'`, y «No coincide con el mapping» si `mapping_consistent === false`;
     - sin permiso → sin botón.
   - `IntegrationDialogs`: cubierto por el test del descriptor; el `<select>` se alimenta de `Object.keys(CONTRACT_ADAPTERS)` y el esquema zod del formulario usa `z.enum(['GENERIC','EWM_V1'])`, así que un valor arbitrario no pasa la validación del formulario. La base lo rechaza igualmente (Task 2).
- [ ] **12.3 Implementar:**
   - `contractAdapters.ts`: `CONTRACT_ADAPTERS: Record<'GENERIC'|'EWM_V1', { label: string; configurationSchema: ZodObject | null; prefill(input): Partial<…> }>`. Etiquetas: «Estándar EBIM v1» y «EWM v1». Es el **único** archivo de `src/` que contiene `EWM_V1`.
   - `mutations.ts`:
     - `export function useGetProvisioningStatus()`, que invoca `invokeOrchestrator({ action:'GET_STATUS', request_id })`; la unión de `action` en `invokeOrchestrator` pasa a `'PROVISION' | 'CHECK_HEALTH' | 'GET_STATUS'`;
     - `OrchestratorResult` gana `found?`, `remote?`, `mapping_consistent?`.
   - `IntegrationDialogs.tsx`: campo `adapter_key` (select) visible sólo con `integration_type === 'HTTP_M2M'`; se envía `p_adapter_key: values.adapter_key`.
   - `SaasProvisioningPage.tsx` → en `RequestDetail`: `<ProductConfigurationForm request={request} />` y `<ProvisioningStatusAction request={request} />`.
- [ ] **12.4** `npx vitest run src` PASS → `npm run typecheck` → `npm run lint` → `npm run build` PASS.
- [ ] **12.5 Guardia de dispersión:** `grep -rn "EWM_V1" src --include='*.ts' --include='*.tsx' | grep -v test | grep -v database.types.ts` → sólo `contractAdapters.ts` (y el tipo generado). `grep -rn "EWM_V1\|'ewm'" supabase/functions --include='*.ts' | grep -v test` → sólo `adapters/ewm-v1.ts`, `registry.ts` y `types.ts`.
- [ ] **12.6 Commit:** `feat(console): support provisioning contract capabilities`

---

## Task 13 — Formato de clave, spec de certificación y gate local previo a cualquier cambio remoto

### 13.A Formato exacto que acepta el firmante (TDD, sin tocar `m2m.ts`)

`signM2mToken` importa con `crypto.subtle.importKey('pkcs8', …)` después de que `pemToArrayBuffer` quita las líneas `-----BEGIN [A-Z ]+-----` / `-----END [A-Z ]+-----` y **todo** espacio en blanco. La clave EWM existente es SEC1 (`BEGIN EC PRIVATE KEY`), que no es PKCS#8. En la Task 14 se carga como PEM PKCS#8 en **una sola línea** (`tr -d '\n'`), para no depender de cómo interprete `--env-file` un valor multilínea.

- [ ] **13.A.1 Pruebas** en `supabase/functions/_shared/provisioning/m2m.test.ts` (sólo casos nuevos, con claves P-256 generadas en memoria):
   - `"acepta PKCS#8 PEM en una sola línea"`: el PEM de `exportKey('pkcs8')` con los saltos eliminados firma un ES256 verificable con la clave pública;
   - `"acepta PKCS#8 PEM multilínea"`: mismo resultado;
   - `"rechaza SEC1 con PRIVATE_KEY_INVALID"`: el mismo material DER envuelto como `-----BEGIN EC PRIVATE KEY-----` (bytes SEC1 construidos en la prueba) → `ProvisioningError` con `code === 'PRIVATE_KEY_INVALID'`, y el `message` no contiene ningún fragmento base64 de la clave.
- [ ] **13.A.2** `npx vitest run supabase/functions/_shared/provisioning/m2m.test.ts` → PASS sin cambiar `m2m.ts`. Si alguno falla, el formato de la Task 14 está mal: se corrige el **plan de carga**, no el firmante.
- [ ] **13.A.3 Commit:** `test(provisioning): pin the PKCS#8 key format accepted by the signer`

### 13.B Spec de certificación QAS (opt-in)

**Files:** CREATE `e2e/v4-ewm-qas-certification.spec.ts`.

- [ ] **13.B.1** Estructura:
   - `test.skip(process.env.EWM_QAS_CERTIFICATION !== '1', 'certificación QAS opt-in')` a nivel de archivo: en la suite por defecto no se ejecuta;
   - `REQUEST_ID` obligatorio desde `process.env.REQUEST_ID`; si falta, el test falla con un mensaje claro;
   - login por la UI con `EWM_QAS_OPERATOR_EMAIL` / `EWM_QAS_OPERATOR_PASSWORD`, leídas de `process.env` en tiempo de ejecución, nunca escritas en el repo ni en logs. Si faltan, el test falla antes de abrir el navegador;
   - guardia: tras el login, `page.evaluate(async () => (await import('/src/lib/env.ts')).env.supabaseUrl)` debe contener `jivgwrczgdpsuvqcwqku`; si no, `throw` antes de invocar nada;
   - `test('status', …)`: `supabase.functions.invoke('provisioning-orchestrator', { body: { action:'GET_STATUS', request_id } })` desde el navegador; espera `found:true`, `provider_http_status:200`, `mapping_consistent:true`;
   - `test('replay', …)`: `action:'REPLAY_CERTIFICATION'`; espera `certified:true`, `provider_http_status:200`, `replayed:true`, `identifiers_match:true`, `duplicate:false`;
   - ninguna aserción imprime el JWT ni el cuerpo completo: se registran sólo los campos anteriores.
- [ ] **13.B.2 En seco:** `npm run e2e -- e2e/v4-ewm-qas-certification.spec.ts` sin la variable → los tests aparecen como *skipped*, 0 fallos. `npm run typecheck` y `npm run lint` PASS.
- [ ] **13.B.3 Commit:** `test(e2e): add opt-in EWM QAS certification`

### 13.C Gate local

Con §0.1, sin excepciones:

- [ ] `supabase db reset --local` → `npm run db:test` → **PASS** (todos los archivos, incluidos `21`, `22` y `23`).
- [ ] `npx vitest run` → PASS; **dorada** `http-m2m.generic-golden.test.ts` PASS y `git diff "$(cat "$TMPDIR/ewm-golden-sha")" -- supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` vacío (H1).
- [ ] `npm run e2e -- e2e/v4-generic-orchestrator-golden.spec.ts e2e/v4-provisioning-orchestrator.spec.ts e2e/v4-provisioning-console.spec.ts e2e/smoke.spec.ts` → PASS.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run secrets:scan` → PASS.
- [ ] Advisors locales, antes y después:
   1. **Antes:** `git worktree add "$TMPDIR/base" afc40cf`, luego `(cd "$TMPDIR/base" && supabase db reset --local --workdir "$TMPDIR/base")` contra el mismo stack local, y `supabase db advisors --local --type security --output-format json > "$TMPDIR/advisors-local-before.json"`.
   2. **Después:** `supabase db reset --local` en el repo y `supabase db advisors --local --type security --output-format json > "$TMPDIR/advisors-local-after.json"`.
   3. Diff por `name` + `detail` con `jq`. Sólo se resuelven las entradas **nuevas** atribuibles a `20260921000100`.
   4. `git worktree remove "$TMPDIR/base"`.
- [ ] H3: `git diff afc40cf --stat -- supabase/seed.sql` vacío; ninguna integración del seed cambia de valor tras `db reset` (lo prueba pgTAP R4).
- [ ] Sin commit (sólo verificación). Cualquier fallo → volver a la Task propietaria.

---

## Task 14 — Secret EWM en PKCS#8 (remoto)

- [ ] **14.0** Pedir al usuario la autorización explícita para cargar el secret y desplegar la función (§0.2). Guardia de proyecto de §0.5.

- [ ] **14.1 Huella de la clave pública (H5), sin mostrar la clave:**

```bash
K="$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem"
P="$HOME/.ebim-keys/ewm/qas/masteradmin-public.pem"
openssl pkey -in "$K" -noout -text 2>/dev/null | grep -E "ASN1 OID|NIST CURVE"   # prime256v1 / P-256
D=$(openssl pkey -in "$K" -pubout -outform DER | openssl dgst -sha256 | awk '{print $2}')
E=$(openssl pkey -pubin -in "$P" -outform DER | openssl dgst -sha256 | awk '{print $2}')
[ "$D" = "$E" ] && echo "FINGERPRINT MATCH ${D:0:16}…" || echo "HARD STOP H5"
```

   `masteradmin-public.pem` es la pública que EWM tiene cargada (`WMS_PLATFORM_M2M_PUBLIC_KEY`). Ambos archivos existen hoy en esas rutas; `private.pem` es SEC1.

- [ ] **14.2 Verificación local del formato exacto (H15)**, con el **mismo** texto que se cargará y el **mismo** procesamiento que `pemToArrayBuffer`, sin imprimir la clave:

```bash
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { createHash, webcrypto } from "node:crypto";
  const pem = readFileSync(0, "utf8");
  if (/\n/.test(pem.trim())) { console.log("HARD STOP H15: no es una sola línea"); process.exit(1); }
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/g, "").replace(/-----END [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Buffer.from(body, "base64");
  const key = await webcrypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", key); delete jwk.d; jwk.key_ops = ["verify"];
  const pub = await webcrypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pub));
  console.log("PKCS8_IMPORT_OK", createHash("sha256").update(spki).digest("hex").slice(0, 16));
' < <(openssl pkcs8 -topk8 -nocrypt -in "$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem" | tr -d '\n')
```

   Debe imprimir `PKCS8_IMPORT_OK <prefijo>` con el **mismo** prefijo de 16 caracteres que `FINGERPRINT MATCH` de 14.1. Cualquier otra salida es H15. La clave sólo viaja por la tubería: no hay archivo, `argv` ni stdout.

- [ ] **14.3 Carga del secret** (SEC1 → PKCS#8 en una línea), sin archivo intermedio, sin stdout y sin la clave en `argv`:

```bash
[ "$(cat supabase/.temp/project-ref)" = "jivgwrczgdpsuvqcwqku" ] || { echo "HARD STOP H12"; exit 1; }
supabase secrets set --project-ref jivgwrczgdpsuvqcwqku \
  --env-file <(printf 'EWM_QAS_M2M_PRIVATE_KEY="%s"\n' \
    "$(openssl pkcs8 -topk8 -nocrypt -in "$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem" | tr -d '\n')")
```

   El valor es `-----BEGIN PRIVATE KEY-----<base64>-----END PRIVATE KEY-----`, sin saltos: no depende de cómo interprete `--env-file` un valor multilínea, y es exactamente el formato probado en 13.A.1 y 14.2. La clave pasa por un descriptor de proceso (`/dev/fd/N`) que no se escribe a disco. Si el harness deniega el comando, lo ejecuta el operador con `!`.

- [ ] **14.4 Confirmar sólo el nombre:** `supabase secrets list --project-ref jivgwrczgdpsuvqcwqku --output-format json | grep -o '"name": *"EWM_QAS_M2M_PRIVATE_KEY"'`. Se filtra sólo el nombre; el digest no se copia al acta.
- [ ] **14.5** La importación **en el runtime** se certifica en la Task 19: `PRIVATE_KEY_INVALID` o `SECRET_NOT_AVAILABLE` allí son H15 y activan RB3.
- [ ] **14.6** No hay commit.

## Task 15 — Migración en QAS (remoto, operador humano)

- [ ] **15.1** Guardia de proyecto de §0.5. El agente verifica: `supabase migration list --linked` → la única pendiente es `20260921000100` (H3/H12: el proyecto enlazado es `jivgwrczgdpsuvqcwqku`, «AdminMaestro»).
- [ ] **15.2** Línea base: `supabase db advisors --linked --type security --output-format json > $TMPDIR/advisors-qas-before.json`.
- [ ] **15.3** El **operador** ejecuta: `! supabase db push --linked --dry-run` (revisa que sólo aplica `20260921000100`) y luego `! supabase db push --linked`.
- [ ] **15.4** El agente verifica: `supabase migration list --linked` sin pendientes. Por la consola local contra QAS (sesión super admin, patrón `import('/src/lib/supabase.ts')`): `select code, adapter_key from product_integrations` → todas `GENERIC` (R4 remoto).

## Task 16 — Despliegue del orquestador y verificación CORS (remoto)

- [ ] **16.1** `npx vitest run supabase/functions/_shared/provisioning/cors.test.ts` → PASS.
- [ ] **16.2** Guardia de §0.5 y luego `supabase functions deploy provisioning-orchestrator --project-ref jivgwrczgdpsuvqcwqku`. **Sólo** esta función, nombrada explícitamente. Sin `--no-verify-jwt` (el `verify_jwt = true` de `supabase/config.toml` `[functions.provisioning-orchestrator]` se respeta) y sin `--prune`. El bundle incluye `_shared/provisioning`, que es donde vive el CORS de `a25e4a7`: este despliegue **es** el rollout del CORS.
- [ ] **16.3** Verificación (H6):

```bash
curl -s -i -X OPTIONS \
  -H 'Origin: http://127.0.0.1:5199' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,apikey,content-type,x-client-info,x-application-name' \
  https://jivgwrczgdpsuvqcwqku.supabase.co/functions/v1/provisioning-orchestrator \
  | grep -iE '^HTTP|access-control-allow-(origin|methods|headers)'
# Esperado: HTTP/2 204 · allow-origin: http://127.0.0.1:5199 · methods POST, GET, OPTIONS
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' \
  https://jivgwrczgdpsuvqcwqku.supabase.co/functions/v1/provisioning-orchestrator
# Esperado: 401
```

- [ ] **16.4** Versión desplegada: `supabase functions list --project-ref jivgwrczgdpsuvqcwqku | grep provisioning-orchestrator`, anotando versión y fecha para el acta. Si la salida es JSON (como `secrets list` en esta CLI), se filtra con `jq '.. | objects | select(.slug? == "provisioning-orchestrator") | {version, updated_at}'`.
- [ ] **16.5** Si falla → H6. Sin E2E.

## Task 17 — Configuración EWM en QAS (remoto, DRAFT)

Por la consola local contra QAS (guardia inversa §0.1) y sus RPC oficiales, reutilizando los registros existentes **sin duplicarlos**. Los ids de abajo son los del seed; antes de escribir se leen en QAS **por `code`** (`ewm-provisioning-v1`, `ewm-qas-m2m`, `ewm-shared-qas`) y se usa el id que devuelva QAS. Si alguno de los tres no existe en QAS → HARD STOP (no se crea un registro nuevo). El seed trae `ewm-qas-m2m` en `RS256` y `ewm-provisioning-v1` con scopes y rutas genéricos: los dos se corrigen aquí.

- [ ] `upsert_product_integration` sobre `70000000-0000-4000-a000-000000000002` (`ewm-provisioning-v1`):
   - `p_adapter_key 'EWM_V1'`, `ES256`, TTL `300`;
   - issuer `masteradmin.ebim`, audience `ewm.ebim`;
   - scopes `ewm:tenant:create` / `ewm:tenant:read`;
   - rutas `/internal/platform/v1/tenants`, `/internal/platform/v1/tenants/{controlPlaneTenantId}` y `/actuator/health`;
   - `allowed_hosts ['ewm-rsxs.onrender.com']`;
   - `p_enabled false`, `p_status 'DRAFT'`.
- [ ] `upsert_credential_profile` sobre `71000000-0000-4000-a000-000000000001` (`ewm-qas-m2m`): `secret_ref 'EWM_QAS_M2M_PRIVATE_KEY'`, `ES256`, `p_enabled false`.
- [ ] `configure_deployment_provisioning` sobre `40000000-0000-4000-a000-000000000008` (`ewm-shared-qas`): `p_base_url 'https://ewm-rsxs.onrender.com'`, `p_provisioning_environment 'QAS'`, `p_timeout_ms 30000`, `p_retry_count 2`, `p_provisioning_status 'DRAFT'`, `p_provisioning_enabled false`, con `p_product_integration_id` y `p_credential_profile_id` de los registros anteriores.
- [ ] H3: se releen las otras dos integraciones (`ewm-mock-local` y `esupplier-manual`) y los otros destinos, y se comparan con su estado antes de esta Task: idénticos.

## Task 18 — Pre-activación y habilitación ordenada

- [ ] Checklist. Todos deben ser PASS; se registran en el acta:
   - migración aplicada;
   - `adapter.key = 'EWM_V1'` y capacidades `{PROVISION,GET_STATUS,REPLAY_CERTIFICATION}`, leídas de `v_saas_provisioning` tras crear la solicitud en la Task 19;
   - secret presente (Task 14);
   - CORS PASS (Task 16);
   - SSRF: `base_url` aceptada por `is_valid_provisioning_base_url(…,'QAS')` y host en `allowed_hosts`;
   - issuer, audience, scopes y rutas iguales a la Task 17.
   - La importación de la clave privada se certifica en la Task 19; un `PRIVATE_KEY_INVALID` ahí es H7.
- [ ] Habilitar **en orden**, con las mismas RPC:
   1. credencial `p_enabled true`;
   2. integración `p_status 'READY'`, `p_enabled true` (el CHECK `product_integrations_http_ready_ck` debe aceptar);
   3. deployment `p_provisioning_status 'READY'` + `p_provisioning_enabled true` (el trigger `enforce_deployment_provisioning_coherence` debe aceptar).
- [ ] «Verificar conexión» desde la UI → `HEALTHY` en `/actuator/health`. Sólo certifica infraestructura; **no** certifica el M2M.

## Task 19 — Verificación M2M real sin crear tenant

Con la enmienda A1:

- [ ] Crear en QAS, **por la UI local**, la organización **EBIM EWM QAS Smoke**:
   - organización: slug `ebim-ewm-qas-smoke`, país `PE` (Organizaciones → alta; `upsert_organization`);
   - sociedad por defecto en `PEN` (`upsert_company`);
   - alta EWM SHARED con Onboarding (`onboard_customer_subscription`): tenant `ebim-ewm-qas-smoke`, admin `ewm.masteradmin.smoke+$(date +%s)@ebim.test`, valor generado **una sola vez**, anotado en el acta y reutilizado en todas las Tasks siguientes (EWM responde `409 ADMIN_EMAIL_ALREADY_PROVISIONED` a un correo repetido).
   - El `tenants.id` resultante **es** el `controlPlaneTenantId`, generado una sola vez: `export EWM_QAS_CONTROL_PLANE_TENANT_ID=…` con el valor de la pantalla, y se anota en el acta.
- [ ] Provisioning SaaS → «Nueva solicitud» (`ProvisioningDialogs` → `create_saas_provisioning_request`) → `READY_TO_PROVISION`. `export EWM_QAS_REQUEST_ID=…` con el id de la solicitud; se anota en el acta.
- [ ] «Datos de alta en el producto»:
   - almacén `WH-001` / `Almacén Principal` / `America/Lima`;
   - zona de organización `America/Lima`;
   - nombre del admin, capturado;
   - `resolvedCurrency = PEN`, puesto por el servidor.
- [ ] «Consultar estado» (GET_STATUS) → esperado `found:false`, `provider_http_status 404` y **`provider_code: RESOURCE_NOT_FOUND`**. Un `404` con `provider_code: PROVIDER_NOT_FOUND` es H14: la API M2M de EWM no está activa (`WMS_PLATFORM_M2M_ENABLED`) o la ruta no existe, y un 404 así **no** certifica la firma. **Significa que EWM validó la firma ES256, el `iss`, el `aud` y el scope `ewm:tenant:read`.** `401` → H7. `403` → scope: H7. `PRIVATE_KEY_INVALID` o `SECRET_NOT_AVAILABLE` → volver a la Task 14.

## Task 20 — Create EWM (E2E real)

- [ ] «Ejecutar» desde la UI local (Browser → CORS → Edge Function QAS → HTTP_M2M → EWM QAS).
- [ ] Esperado:
   - respuesta de la función: `status: ACTIVE`;
   - evento `PROVIDER_REQUEST_FINGERPRINT` registrado;
   - `provider_http_status` del evento de éxito = `201`;
   - mapping con `external_tenant_id = company.id` enviado, `external_organization_id` = id de la organización y `resources.initialWarehouseId` presente;
   - `adminProvisioningStatus = PREPROVISIONED`.
- [ ] Auditoría: timeline `REQUESTED → … → ACTIVE` con actor y `correlation_id`.
- [ ] Fuga (H11): `select count(*) from saas_provisioning_events where detail::text ~* '(BEGIN .*PRIVATE KEY|eyJhbGciOi)'` = 0, leído por la consola.
- [ ] Cualquier otro resultado → H8 / H4.

## Task 21 — Replay (E2E real)

- [ ] `EWM_QAS_CERTIFICATION=1 REQUEST_ID="$EWM_QAS_REQUEST_ID" npx playwright test e2e/v4-ewm-qas-certification.spec.ts -g replay`, con `EWM_QAS_OPERATOR_EMAIL`/`EWM_QAS_OPERATOR_PASSWORD` exportadas por el operador en su shell:
   - login UI como super admin;
   - guardia: `env.supabaseUrl` contiene `jivgwrczgdpsuvqcwqku`, o el test se aborta;
   - `supabase.functions.invoke('provisioning-orchestrator', { body: { action:'REPLAY_CERTIFICATION', request_id } })` **desde el navegador** (atraviesa CORS).
- [ ] Esperado: `certified:true`, `provider_http_status:200`, `replayed:true`, `identifiers_match:true`, `duplicate:false`, y el mismo `companyId` (H9).

## Task 22 — Get (E2E real)

- [ ] `EWM_QAS_CERTIFICATION=1 REQUEST_ID="$EWM_QAS_REQUEST_ID" npx playwright test e2e/v4-ewm-qas-certification.spec.ts -g status`, y además «Consultar estado» en la UI → `found:true`, `provider_http_status:200`, `mapping_consistent:true` (H10), ruta `/internal/platform/v1/tenants/${EWM_QAS_CONTROL_PLANE_TENANT_ID}`.

## Task 23 — Seguridad y advisors (frescos)

- [ ] Clave privada fuera de la BD: consulta por la consola sobre `audit_logs`, `saas_provisioning_events`, `credential_profiles`, `product_integrations.metadata` y `tenant_product_mappings.metadata` con `~* 'BEGIN .*PRIVATE KEY'` → 0 filas.
- [ ] Fuera del navegador: `npm run build` + `grep -rE 'BEGIN .*PRIVATE KEY|sb_secret_|service_role' dist/` → vacío.
- [ ] Fuera de los logs: la CLI 2.116.0 **no** tiene `supabase functions logs` (verificado con `supabase functions --help`: sólo `list`, `delete`, `download`, `deploy`, `new`, `serve`). Se usa el panel *Edge Functions → provisioning-orchestrator → Logs* del proyecto `jivgwrczgdpsuvqcwqku`, filtrado por `PRIVATE KEY` y por `eyJhbGciOi` → vacío. El operador pega en el acta el recuento (0) de cada filtro.
- [ ] JWT no persistido: la misma consulta con `eyJhbGciOi` → 0.
- [ ] `npm run secrets:scan` PASS.
- [ ] SSRF activo: `configure_deployment_provisioning` con `base_url 'http://169.254.169.254'` sobre un destino **DEV de prueba local** → rechazado (se prueba en local; en QAS no se escribe).
- [ ] RBAC y RLS: los pgTAP 22/23 ya lo prueban en local; en QAS, `esupplier.owner` → `GET_STATUS` sobre la solicitud EWM → `403`.
- [ ] Advisors: `supabase db advisors --linked --type security --output-format json > $TMPDIR/advisors-qas-after.json`, diff contra `before`. Se resuelven **sólo** los hallazgos nuevos que nombren objetos de `20260921000100`. Un hallazgo nuevo requiere una migración correctiva aditiva y el ciclo completo de Tasks 13 → 15.

## Task 24 — Gate completo final

- [ ] Todo lo de la Task 13, **fresco**.
- [ ] Dorada GENERIC PASS **sin cambios** desde la Task 1: `git log --format=%h -- supabase/functions/_shared/provisioning/adapters/http-m2m.generic-golden.test.ts` tiene **un solo** commit (H1). Si la dorada falla: HARD STOP. **No** se actualiza la prueba; se investiga la regresión.

## Task 25 — Documentación

- [ ] `docs/platform-provisioning/ADAPTERS.md`:
   - §6, filas `GENERIC` y `EWM_V1`;
   - sección de capacidades;
   - frase explícita: «EWM V1 **no** es el estándar de la suite. El estándar sigue siendo el contrato genérico v1. **Other SaaS: no changes required.**».
- [ ] `ARCHITECTURE.md` §7: EWM conectado por codec y `product_configuration`.
- [ ] `M2M.md`: carga del secret SEC1 → PKCS#8 (comando de la Task 14) y verificación por `GET_STATUS`.
- [ ] Spec: sección «Enmiendas» con A1–A3.
- [ ] `docs/platform-provisioning/EWM_QAS_CERTIFICATION.md`, acta con:
   - HEAD;
   - versión de la función;
   - `controlPlaneTenantId`, `externalTenantId`;
   - HTTP de create, replay y get;
   - resultados de H1–H13;
   - diff de advisors.
- [ ] Commit: `docs(provisioning): document EWM compatibility adapter`

## Task 26 — Commits y reporte final

Secuencia esperada de commits locales (sin push):

1. `test(provisioning): lock generic adapter contract`
2. `feat(provisioning): add backward-compatible adapter metadata`
3. `refactor(provisioning): select contract codec through the adapter registry`
4. `feat(provisioning): add EWM v1 request codec`
5. `feat(provisioning): expose source identities to contract codecs`
6. `feat(provisioning): freeze product configuration per provisioning request`
7. `test(provisioning): prove EWM body is stable across config drift`
8. `feat(provisioning): normalize EWM v1 responses in its codec`
9. `feat(provisioning): resolve controlPlaneTenantId in path templates`
10. `feat(provisioning): add optional provider status lookup`
11. `feat(provisioning): add internal EWM replay certification`
12. `feat(console): support provisioning contract capabilities`
13. `test(provisioning): pin the PKCS#8 key format accepted by the signer` (Task 13.A)
14. `test(e2e): add opt-in EWM QAS certification` (Task 13.B)
15. `docs(provisioning): document EWM compatibility adapter` (Task 25)

Reporte final: HEAD inicial y final, commits, resultado de cada Hard Stop, evidencia de create/replay/get y cambios remotos (QAS: migración, función, secret y tres registros EWM; EWM: un tenant de prueba creado por contrato, sin cambios de código ni configuración; PRD: ninguno).

---

## Self-review del plan

| Control | Resultado |
| --- | --- |
| Cobertura de la spec §1–§26 | §7–8 → Tasks 1 y 3; §9–10 → 4, 6 y 7; §11 → 8; §12 → 10; §13 → 9; §14 → 2, 5, 6 y 7; §15 → 11; §16 → 3, 5 y 10; §17 → 2, 5, 6, 7, 10 y 11; §18 → 12; §19 → 23; §20 → 6, 10 y 11; §21 → todas las de prueba; §22 → orden de commits; §23 → 14–22; §24 → § Rollback QAS (RB1–RB5); §25 → 13, 24 y 20–22; §26 → File Map |
| Marcadores sin resolver | Ninguno. Todos los nombres, rutas, ids de seed, líneas de migración y comandos salen de la auditoría |
| Consistencia de tipos | `AdapterKey`, `AdapterCapability`, `ContractCodec` (con `parseResponse(body, operation, context)` desde la Task 3), `ProvisioningSource`, `routeAction`, `permissionRpcFor`, `createBodyText`, `sha256Hex`, `summarizeStatus`, `evaluateReplayCertification`, `set_saas_provisioning_configuration`, `can_read_saas_provisioning`, `can_certify_saas_provisioning`, `integration_capabilities`: mismos nombres en todas las Tasks |
| Review Focus | R1–R5, cada uno con pruebas nombradas en su Task propietaria |
| Compatibilidad al inicio y al final | Task 1 (dorada) y Task 24 (dorada intacta, un solo commit) |
| Nada remoto antes de los gates | Task 13 (13.A, 13.B, 13.C) precede a 14–23 |
| CLI de Supabase | 2.116.0; flags de §0.5 verificados con `-h` o, donde el harness deniega `-h`, con la referencia oficial de la CLI. `functions logs` no existe y no se usa; `db push` no admite `--project-ref` y queda tras la guardia de proyecto enlazado |
| Contrato EWM | Cuerpo, respuesta, códigos, scopes e idempotencia contrastados con `API_CONTRACT.md` @ `7e45d70`; normalización a mayúsculas/minúsculas de EWM reflejada en el codec (Task 4); `WMS_PLATFORM_M2M_ENABLED` cubierto por H14 |
| Rollback QAS | § Rollback QAS: configuración, función, secret, esquema y datos, con comandos y verificación |
| GENERIC demostrado | Dorada unitaria + dorada E2E en la Task 1, `$TMPDIR/ewm-golden-sha` en cada Task, gate 13.C y Task 24; pgTAP R4 prueba `payload`, filas previas y `upsert` |
| Cambios en EWM u otros SaaS | Ninguno. EWM sólo recibe llamadas por su contrato publicado; eSupplier queda fuera |
| Secretos | La clave nunca en stdout, `argv`, disco, BD, bundle ni logs (Tasks 14 y 23) |
| Otras aplicaciones | Cero cambios; H3 verificado en las Tasks 2, 13 y 17 |
