# HANDOFF MANIFEST — EBIM Control Plane V2

Paquete preparado para **auditoría independiente externa**. Todos los datos de
este documento están extraídos del repositorio o de los reportes existentes.
Ninguna cifra es estimada.

---

## 1. Identificación

| Campo | Valor |
|---|---|
| **Fecha y hora de generación** | 2026-09-07 10:23:42 -05:00 |
| **PROJECT_ROOT** | `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin` |
| **Branch actual** | `dev` |
| **HEAD SHA** | `31ace339bbc095bb5217a504a0c5fa3398fbd714` (`31ace33`) |
| **origin/dev SHA** | `561053e1ac19539497231d5259aec5dc0b4b9c0f` (`561053e`) |
| **Commits locales sobre origin/dev** | **10** (ahead 10, behind 0) |
| **¿Se hizo push?** | **NO.** `origin/dev` sigue exactamente donde estaba |

Los 10 commits locales, del más reciente al más antiguo:

```
31ace33  fase18-98(docs,auditoría): documentación de handoff e informe final
ba09cbb  fase17(e2e): 39 journeys PASS y corrección del arranque de la suite
ca1822d  fase15-16(seed,seguridad): 9 escenarios de negocio y 102 tests pgTAP
48c9a9f  fase11-14(renovaciones,comisiones,finanzas,ui): motor de cobranza y paneles
43e7c28  fase09-10(culqi): adapter desacoplado, webhook idempotente y modo MOCK explícito
d62a1f4  fase07-08(cobranza): método de cobro por suscripción y ciclo de OS/OC
a688aa4  fase05-06(onboarding,infra): alta transaccional de cliente y ciclo de tenant
92650c5  fase03-04(suite,canal): producto data-driven y acuerdos de canal con límites
6e8286d  fase02(crud): escritura administrativa por RPC auditada + UI de mutación
cf8ad75  fase01(audit): baseline V2 verificado contra la DB viva + corrección de gates
```

---

## 2. Migraciones

| Campo | Valor |
|---|---|
| **Total de migraciones** | **21** |
| Baseline `20260902*` (INMUTABLES) | 13 |
| V2 `20260907*` (nuevas) | 8 |
| **Última migración** | `20260907000800_commissions_and_finance.sql` |

Las 13 migraciones baseline se verificaron **idénticas byte a byte** por SHA-256
contra el commit `561053e`. Evidencia en `FINAL_REPORT_V2.md` §4.

Las 8 migraciones V2:

```
20260907000100_admin_write_rpcs.sql            25 RPCs de escritura administrativa
20260907000200_channel_agreements_v2.sql       límites del acuerdo de canal
20260907000300_onboarding_rpc.sql              alta transaccional de cliente
20260907000400_collection_profiles.sql         cobranza por suscripción
20260907000500_commercial_documents.sql        órdenes de servicio / de compra
20260907000600_payment_provider_mappings.sql   mapeos Culqi + webhook idempotente
20260907000700_billing_alerts_and_renewals.sql motor de renovaciones y suspensión
20260907000800_commissions_and_finance.sql     reversos y reconciliación
```

---

## 3. Estado de los gates

Los seis primeros se **reejecutaron en el momento de generar este paquete**
(2026-09-07 10:23). El E2E se cita del informe: se ejecutó en la auditoría de la
Fase 98 y desde entonces no se ha modificado ningún archivo de `src/`,
`supabase/` ni `e2e/` — solo se añadió `docs/handoff-chatgpt/`.

| Gate | Comando | Resultado | Origen del dato |
|---|---|---|---|
| **DB tests** | `npm run db:test` | ✅ **PASS** · `Files=5, Tests=102` | Reejecutado ahora |
| **Unit tests** | `npm run test` | ✅ **PASS** · `32 passed (32)` | Reejecutado ahora |
| **Typecheck** | `npm run typecheck` | ✅ **PASS** | Reejecutado ahora |
| **Lint** | `npm run lint` | ✅ **PASS** (0 warnings) | Reejecutado ahora |
| **Build** | `npm run build` | ✅ **PASS** · `862.26 kB` (gzip 240.09 kB) | Reejecutado ahora |
| **Secrets scan** | `npm run secrets:scan` | ✅ **PASS** | Reejecutado ahora |
| **E2E** | `npx playwright test` | ✅ **PASS** · **39/39, 0 skips** | `E2E_REPORT.md` y `FINAL_REPORT_V2.md` §4 |

Composición de los tests:

- **102 tests de base de datos** en 5 archivos pgTAP (`supabase/tests/`):
  `00_structure` (14), `01_rls_isolation` (20), `02_business_rules` (18),
  `03_v2_security` (26), `04_v2_business` (24).
- **32 tests unitarios** con Vitest en 3 archivos.
- **39 tests E2E** con Playwright en 2 archivos: `smoke.spec.ts` (21) y
  `v2-journeys.spec.ts` (18, que cubren los 13 recorridos de la Fase 17).

---

## 4. Documentos clave para el auditor

Rutas relativas a la raíz del ZIP (`masteradmin/`):

| Documento | Ruta | Qué contiene |
|---|---|---|
| **Informe final** | `docs/nightly-v2/FINAL_REPORT_V2.md` | Evidencia completa, real vs simulado, contraste ítem por ítem con la Definition of Done |
| **Auditoría del baseline** | `docs/nightly-v2/AUDIT_BASELINE.md` | Verificación del punto de partida y los defectos R-01/R-02/R-03 |
| **Matriz de gaps** | `docs/nightly-v2/GAP_MATRIX.md` | 40 gaps clasificados por área, riesgo y fase responsable |
| **Reporte E2E** | `docs/nightly-v2/E2E_REPORT.md` | Resultado por journey y, explícitamente, qué NO cubre |
| **Arquitectura Culqi** | `docs/payments/CULQI_ARCHITECTURE.md` | Adapter, webhooks, idempotencia y checklist de activación en producción |

Documentación complementaria incluida:

```
docs/architecture/    DATA_MODEL · DEPLOYMENT_MODEL · OVERVIEW · EBIM_CONVENTIONS
docs/commercial/      COMMERCIAL_MODEL · COMMISSION_MODEL
docs/finance/         COST_MARGIN_MODEL
docs/payments/        COLLECTION_MODEL · CULQI_ARCHITECTURE · SERVICE_ORDER_PURCHASE_ORDER
docs/operations/      LOCAL_DEVELOPMENT · PROVISIONING · RENEWALS_AND_SUSPENSION
docs/security/        RBAC_RLS_MATRIX
docs/demo/            DEMO_SCENARIOS · DEMO_SCENARIOS_V2
docs/nightly/         reportes de la ejecución nocturna anterior (baseline)
docs/nightly-v2/      reportes de la ejecución V2
docs/superpowers/     spec y plan de diseño V2
.claude-prompts-v2/   los 22 prompts de la ejecución + STATE_V2 · DECISIONS_V2 · QUALITY_GATE_V2
```

---

## 5. Blockers conocidos

### BE-02 · Culqi sin credenciales — **BLOCKER ACTIVO**

**El PRD de cobro con tarjeta NO está validado.**

No existen credenciales Culqi en este proyecto. El adapter
(`supabase/functions/_shared/payments/`) opera en **modo MOCK determinista**:
genera identificadores con prefijo `mock_`, no hace ni una llamada de red, y la
consola lo declara en pantalla («Culqi pendiente de configurar») en vez de
fingir que el cobro está operativo.

Lo que **sí** está implementado y verificado: el adapter desacoplado, las 5
tablas de mapeo, el webhook idempotente (5 entregas del mismo evento producen 1
`payment` y 1 `commission_event`, verificado en `04_v2_business.test.sql`), la
reconciliación y el registro de fallos de cobro.

Lo que **no** se ha podido comprobar: que las credenciales reales funcionen, que
el formato del webhook real coincida con el esperado, y el enrutado test/live.

Variables pendientes de configurar (ninguna está en el repositorio):
`CULQI_SECRET_KEY`, `CULQI_API_BASE`, `CULQI_ALLOW_LIVE`, y la llave pública
`pk_test_…` en la columna `public_key` de la cuenta de proveedor.

Checklist completo de activación: `docs/payments/CULQI_ARCHITECTURE.md` §10.

### BE-01 · `GUIDELINES_ROOT` no enumerable

La ruta de referencia READ-ONLY
(`~/Library/CloudStorage/GoogleDrive-…/My Drive/EBIM-Plataforma`) no fue
enumerable durante la ejecución: el gate de permisos rechazó `ls` y `find` sobre
ella. Se usó como sustituto el snapshot local
`docs/architecture/EBIM_CONVENTIONS.md`, tal y como autoriza el propio prompt.

**Ese directorio NO fue modificado y NO forma parte de este paquete.**

### B-05 (heredado del baseline) · Provisioning LIVE

Sin token de la Management API de Supabase. El provisioning sigue en **DRY_RUN**,
que es lo que el contrato exige. El adapter real está escrito como esqueleto que
falla ruidosamente si falta el secreto.

### Gaps no bloqueantes

Documentados en `FINAL_REPORT_V2.md` §11: cron no programado (decisión del
operador), ausencia de tabla FX para consolidar monedas (fuera de alcance V2),
bundle de 862 kB sin code-splitting, MRR sin histórico, webhook sin firma
(limitación del proveedor, no del diseño), y la divergencia pendiente del schema
`platform` con el proyecto de GMAO.

---

## 6. Nota de seguridad sobre el contenido del paquete

### Excluido deliberadamente

| Archivo | Motivo |
|---|---|
| `.env.local` | Contiene las claves del stack Supabase local (anon y service_role). **No versionado** y **excluido del ZIP** |
| `supabase/.temp/` | Contiene `docker.env` con secretos del runtime local |
| `.claude/` | Configuración local de la herramienta, ajena al proyecto |
| `.git/`, `node_modules/`, `dist/`, `test-results/`, `playwright-report/` | Artefactos y binarios |

### Incluido a propósito, con aviso

- **`.env.example`** — solo nombres de variable y placeholders. Verificado: sus
  únicos valores son `http://127.0.0.1:54421`, `LOCAL`, `DRY_RUN` y `false`.
  Ninguna credencial.
- **`e2e/fixtures.ts` contiene `DEMO_PASSWORD = 'Ebim.Demo2026!'`** — es la
  contraseña de los usuarios *de prueba* que `supabase/seed.sql` crea en la base
  de desarrollo local. **No existe ningún entorno remoto con esos usuarios.**
  Es una fixture de QA (`*@ebim.test`, contrato §11) que ya estaba en el
  baseline, y sin ella la suite E2E no puede ejecutarse. Se incluye para que el
  auditor pueda reproducir los tests.

### Resultado del escaneo

`npm run secrets:scan` → **PASS**. Además se ejecutó un escaneo independiente
sobre el conjunto exacto de archivos empaquetados, buscando `sk_test_`,
`sk_live_`, `pk_live_`, JWTs, `sb_secret_`, `sbp_`, `service_role` con valor,
claves PEM privadas, cadenas de conexión con contraseña y claves de AWS/Google/
Slack. **Cero coincidencias.**

---

## 7. Cómo reproducir la verificación

```bash
cd masteradmin
npm ci
npx supabase start          # requiere Docker
npm run db:reset            # 21 migraciones + seed con los 9 escenarios
npm run db:test             # 102 tests pgTAP
npm run typecheck && npm run lint && npm run test && npm run build
npm run secrets:scan
npm run e2e                 # 39 tests; levanta el dev server en el puerto 5199
```

> **Puerto 5199, no 5173.** El 5173 lo ocupa de forma permanente el dev server de
> otro proyecto en la máquina de desarrollo original. Está documentado en
> `README.md` y en `E2E_REPORT.md`.

> ⚠️ **Nunca ejecutar `tsc` sin `--noEmit`.** Emitiría un `.js` junto a cada
> `.tsx` y junto a los configs de la raíz; Vite y Playwright resuelven `.js`
> antes que `.ts`, y la aplicación se queda congelada en la última compilación
> sin dar ningún error. Es el defecto R-03 descrito en `AUDIT_BASELINE.md` §5.

---

## 8. Archivos de evidencia de este paquete

| Archivo | Contenido |
|---|---|
| `GIT_STATUS.txt` | `git status --short --branch` |
| `GIT_LOG.txt` | `git log --oneline --decorate --graph -30` |
| `GIT_BRANCHES.txt` | `git branch -vv` |
| `DIFF_ORIGIN_DEV.patch` | `git diff origin/dev...HEAD` — el cambio completo de V2 (28.112 líneas) |
| `FILE_TREE.txt` | Estructura del proyecto, sin artefactos |
| `HANDOFF_MANIFEST.md` | Este documento |
