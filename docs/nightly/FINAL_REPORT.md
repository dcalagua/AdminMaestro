# FINAL REPORT — EBIM Control Plane

**Branch:** `feature/ebim-control-plane-bootstrap-20260902`
**Commits:** 5
**Última migración:** `20260902001300_fk_indexes.sql`
**Fecha:** 2026-09-02

---

## MORNING EXECUTIVE SUMMARY

Quedó una base **funcional, reproducible y con seguridad real**, no una maqueta.

1. `npm run db:reset` reconstruye la base desde cero, aplica 13 migraciones y
   carga un seed determinista que se autoverifica y falla si queda incompleto.
2. **39 tablas, todas con RLS + FORCE. `anon` no tiene ni USAGE sobre el schema.**
3. **52 tests de base de datos y 21 E2E en navegador real, todos en verde**,
   incluidos los negativos: cross-partner, cross-tenant y "vender un tenant no
   da acceso operativo".
4. Los 9 escenarios de negocio pedidos están cargados y visibles: Shared directo,
   Shared vía partner con varios tenants, Partner Dedicated, Tenant Dedicated,
   en eSupplier **y** en EWM, con un partner multi-SaaS con márgenes distintos
   por producto (25% / 18%) y una comercial independiente con ventas en dos
   productos sin membresía operacional.
5. Consola de 20 rutas conectada a datos reales, con el login que exige el
   contrato §4.5 y tres dashboards (EBIM / Partner / Comercial) que leen las
   mismas vistas — lo que los diferencia es RLS, no el frontend.
6. MRR USD 24.750, cobrado USD 98.600, costos USD 16.584 y margen por producto,
   partner y tenant calculados sobre **cobros**, no sobre facturado.
7. Provisioning en DRY_RUN con máquina de estados, idempotencia y adapter
   preparado para la Management API. **Ninguna llamada remota real ejecutada.**
8. Cero secretos versionados, verificado por un escáner que se probó en positivo.
9. Diez fallos reales aparecieron durante los gates y se corrigieron; están
   listados en `QUALITY_GATE.md` §8. Ninguno quedó abierto.
10. Gap principal: **no hay escrituras desde la UI** (crear tenant, aprobar
    liquidación, disparar provisioning). El dominio y los permisos existen y
    están probados en la base; falta el formulario. Es la primera tarea del día.

---

## Tabla de estado

| Gate | Estado | Evidencia |
|---|---|---|
| `FILESYSTEM_GUARDRAILS` | **PASS** | Todo el trabajo dentro de `PROJECT_ROOT`. Cero escrituras en `GUIDELINES_ROOT` (sólo lectura). No se detuvo el stack Supabase de otro proyecto: se reasignaron los puertos propios. |
| `REPO_INITIALIZED` | **PASS** | Git inicializado, branch `feature/ebim-control-plane-bootstrap-20260902`, 5 commits descriptivos, sin push remoto. |
| `REACT_APP` | **PASS** | Vite 7 + React 19 + TS estricto. 20 rutas, arranca y navega. |
| `SUPABASE_LOCAL` | **PASS** | Stack completo en puertos 54421-54424. |
| `DB_RESET` | **PASS** | `supabase db reset` exit 0 desde cero, repetido 5 veces. |
| `MIGRATIONS` | **PASS** | 13 migraciones versionadas, `migration list` sin drift. |
| `SEED` | **PASS** | Determinista, con bloque de verificación propio. 5 productos, 10 orgs, 13 tenants, 40 facturas, 25 pagos, 19 comisiones. |
| `AUTH` | **PASS** | Supabase Auth real, 12 usuarios, login verificado en E2E para 5 roles distintos. |
| `RBAC` | **PASS** | 9 roles en 3 ámbitos (plataforma / organización / tenant), matriz documentada. |
| `RLS` | **PASS** | 39/39 tablas con RLS + FORCE, 69 políticas, 0 tablas con RLS sin política. |
| `MULTI_SAAS` | **PASS** | 5 SaaS por catálogo, sin columnas por producto (test 13 lo verifica). |
| `PARTNERS` | **PASS** | Capacidades acumulables, acuerdos por producto, partner multi-SaaS con condiciones distintas. |
| `TENANTS` | **PASS** | 13 tenants en 2 productos y 3 modelos de despliegue. |
| `SALES_AGENTS` | **PASS** | 3 comerciales (independiente, de partner, interno). Comercial independiente con ventas en 2 productos. |
| `COMMISSIONS` | **PASS** | Devengo desde cobros, idempotente, con snapshot del cálculo. 19 eventos generados por trigger. |
| `SUBSCRIPTIONS` | **PASS** | 13 suscripciones incluyendo licencias base de partner sin tenant. |
| `COSTS_MARGIN` | **PASS** | 27 costos, imputación con `weight` explícito, margen por producto/partner/tenant. |
| `DEPLOYMENT_MODEL` | **PASS** | Los 3 modos con triggers de coherencia probados. |
| `PROVISIONING_DRY_RUN` | **PASS** | Máquina de estados + idempotencia + timeline. 4 solicitudes en 4 estados. Sin llamadas remotas. |
| `ADMIN_UI` | **PARTIAL** | 20 rutas de lectura completas y conectadas. **Faltan las escrituras** (crear/editar tenant, aprobar liquidación, encolar provisioning). |
| `PARTNER_UI` | **PASS** | Dashboard de partner, menú adaptado y aislamiento verificado en E2E. |
| `TESTS_DB` | **PASS** | 52/52 pgTAP en 3 archivos. |
| `TESTS_FRONTEND` | **PASS** | 29/29 Vitest en 3 archivos. |
| `TYPECHECK` | **PASS** | `tsc --noEmit` exit 0, TS estricto. |
| `LINT` | **PASS** | `eslint .` — 0 errores, 0 advertencias. |
| `BUILD` | **PASS** | 586,85 kB (165,31 kB gzip). |
| `E2E` | **PASS** | 21/21 Playwright contra navegador real y Supabase local. |
| `SECURITY_NEGATIVE_TESTS` | **PASS** | 12 escenarios negativos en DB + 5 en E2E. `anon` recibe 42501, no lista vacía. |
| `SECRETS_SCAN` | **PASS** | Repo + bundle limpios. Escáner probado en positivo. |
| `DOCUMENTATION` | **PASS** | README + 11 documentos de arquitectura, seguridad, comercial, finanzas, demo y operación. |

**Resumen: 29 PASS · 1 PARTIAL · 0 FAIL · 0 BLOCKED_ENVIRONMENT**

---

## Conteos reales

| Métrica | Valor |
|---|---|
| Commits | 5 |
| Archivos versionados | 129 |
| Migraciones | 13 |
| Líneas de SQL (migraciones + tests + seed) | 5.305 |
| Líneas de TypeScript (sin tipos generados) | 5.773 |
| Tablas en `platform` | 39 |
| Vistas | 7 |
| Políticas RLS | 69 |
| Funciones | 42 (34 `SECURITY DEFINER`, todas con `search_path` fijo) |
| Índices | 152 |
| **Tests de base de datos** | **52 PASS / 0 FAIL** |
| **Tests unitarios** | **29 PASS / 0 FAIL** |
| **Tests E2E** | **21 PASS / 0 FAIL** |
| **Total** | **102 PASS / 0 FAIL** |

---

## Funcionalidades disponibles

**Datos y seguridad**
- Modelo completo: identidad, cuentas, catálogo, tenancy, comercial, finanzas,
  infraestructura, auditoría.
- RLS con aislamiento cross-org y cross-tenant probado en positivo y en negativo.
- Guards de negocio en la base: `ADMIN_EMAIL_REQUERIDO`, super admin único,
  dominio operador, DEMO sin recurrente, coherencia de despliegue, atribución
  ≤ 100%, imputación de costo ≤ 100%, anti-secretos en JSONB.
- Auditoría append-only real (por GRANT, no por convención).

**Consola**
- Login con la anatomía obligatoria del contrato §4.5.
- 20 rutas de lectura con estados de carga, vacío y error.
- Dashboards por perfil (EBIM / Partner / Comercial).
- Detalle de tenant y de organización en tabs centrados con deep-link `#hash`.
- Buscador único por listado (regla de suite), tabs de estado.
- Modo claro/oscuro y densidad; **sin** selector de color (contrato §4.4).

**Negocio**
- Los 3 modelos de despliegue con su estructura de cargos.
- Partner multi-SaaS con condiciones distintas por producto.
- Comisiones desde cobros, con trazabilidad del cálculo y liquidaciones.
- Margen por producto, partner y tenant sobre ingreso cobrado.
- Provisioning DRY_RUN con timeline e idempotencia.

## Funcionalidades parciales

| Área | Qué falta |
|---|---|
| **Escrituras desde la UI** | Las políticas de INSERT/UPDATE existen y están probadas, pero no hay formularios: crear/editar tenant, alta de organización, asignar acuerdos, aprobar/pagar liquidaciones, encolar provisioning. **Es el gap principal.** |
| **Reintento de provisioning** | El diálogo de confirmación existe; falta invocar la Edge Function. |
| **Edge Function desplegada** | `provisioning-worker` está escrita pero no desplegada al runtime local. |
| **Config en capas en la UI** | `effective_config()` funciona en la base; no hay pantalla que la edite. |
| **Custom fields** | El shape canónico está documentado; falta el builder. |
| **Activación del admin de tenant** | `admin_activated_at` se modela y se muestra; falta el circuito de invitación. |

## Blockers

**Ninguno abierto.** El único blocker de entorno que apareció (puerto 54322
ocupado por otro proyecto) se resolvió reasignando los puertos **propios**, sin
tocar el stack ajeno. Ver `BLOCKERS.md`.

## Hallazgos de seguridad

Ninguno abierto. Los tres encontrados durante el desarrollo se corrigieron:

1. **Política `plan_prices_select` siempre verdadera.** Una expresión
   `boolean is not null` hacía que cualquier usuario autenticado leyera todos
   los precios de lista. Reescrita.
2. **24 FKs sin índice.** No es una fuga, pero un DELETE en el padre hacía
   seq-scan del hijo. Corregido, y el test 12 lo impide en el futuro.
3. **La regla anti-clave-de-servicio bloqueaba una Edge Function legítima.**
   Se acotó a `src/**` en vez de desactivarla: el servidor sí debe leer esa
   variable.

## Próximos 10 pasos priorizados

1. **Formulario de alta de tenant** invocando `platform.create_tenant()`, con el
   correo de administrador obligatorio y el error `ADMIN_EMAIL_REQUERIDO`
   mostrado como validación de campo. Es el flujo más pedido y el que cierra el
   `ADMIN_UI` en PASS.
2. **Desplegar `provisioning-worker`** al runtime local y conectar el botón de
   reintento; añadir un test E2E del ciclo completo en DRY_RUN.
3. **CRUD de organizaciones y acuerdos de producto** (habilitar un partner para
   un SaaS con su margen), con confirmación en operaciones destructivas.
4. **Circuito de invitación del administrador de tenant**: enviar la invitación
   y marcar `admin_activated_at`. El contrato §3.2 lo recomienda para detectar
   altas a medias en la pantalla, no en un reporte de fin de mes.
5. **Aprobar y pagar liquidaciones** desde la UI, exigiendo referencia de pago
   (el CHECK ya lo obliga en la base).
6. **Snapshot mensual de MRR** en una tabla propia. Hoy el MRR se calcula desde
   las suscripciones vigentes y no se puede reconstruir el de hace 6 meses.
7. **Tabla de tipos de cambio con fecha y fuente** para poder consolidar
   multi-moneda sin inventar un FX implícito.
8. **CI** que ejecute los 102 tests + `secrets:scan` en cada PR. Todos los gates
   ya corren por línea de comandos; falta el workflow.
9. **Code-splitting por ruta**: el bundle son 587 kB en un solo chunk. Con
   `React.lazy` por módulo baja mucho el primer render.
10. **Integración con el hub EBIM existente**: decidir si este proyecto ES el hub
    (promoviendo el schema `platform` que hoy vive en GMAO) o si consume su
    Platform Context API. Es una decisión de arquitectura de suite que requiere
    al operador y a GMAO como lead (contrato §1 y §10).

## Nota sobre el alcance

El prompt maestro pedía crear el proyecto dentro de
`.../My Drive/EBIM-Plataforma`. La instrucción explícita del operador en esta
sesión fijó `PROJECT_ROOT` en `EBIM/masteradmin` y declaró `EBIM-Plataforma`
como **READ-ONLY**. Se siguió la instrucción del operador, que es la más
restrictiva sobre el material de referencia. `GUIDELINES_ROOT` se leyó en
profundidad (contrato de plataforma v1.15, diseño del hub, design brief, estados
de las 4 apps, runbook del operador) y **no se modificó ni un archivo**. Las
convenciones adoptadas están trazadas a su sección de origen en
`docs/architecture/EBIM_CONVENTIONS.md`.

---

# FINAL CERTIFICATION

**Veredicto: `GO_WITH_GAPS`**

No hay fallas de seguridad ni inconsistencias del modelo. El único gap es de
alcance funcional (faltan las escrituras desde la UI), no de calidad: el dominio
y los permisos que esas escrituras necesitarán ya existen y están probados en la
base. No se marca `GO` porque una consola administrativa en la que todavía no se
puede dar de alta un tenant no está terminada como producto.

## 1. Verificación funcional (consultas a la base real, no a la documentación)

| # | Certificación | Resultado |
|---|---|---|
| 1 | eSupplier existe como SaaS configurable | **SÍ** |
| 2 | EWM by EBIM existe con el mismo core | **SÍ** |
| 3 | Se pueden agregar otros SaaS por catálogo | **SÍ** — 5 productos, sin columnas por producto (test 13) |
| 4 | Un partner puede estar habilitado para varios SaaS | **SÍ** — Consultora Andina en eSupplier (25%) y EWM (18%) |
| 5 | Shared admite partner/empresa con múltiples tenants | **SÍ** — 3 tenants SHARED con `managing_organization_id` |
| 6 | Partner Dedicated: licencia base + N tenants + infra | **SÍ** — los 3 `charge_kind` presentes y ligados a planes `PARTNER_DEDICATED` |
| 7 | Tenant Dedicated: Enterprise + infra + setup | **SÍ** |
| 8 | Implementation/onboarding fee en el modelo | **SÍ** — 6 ítems `IMPLEMENTATION_FEE` |
| 9 | Comercial independiente puede recibir comisión | **SÍ** — 6 eventos devengados |
| 10 | El comercial **no** accede al tenant operacional | **CONFIRMADO** — cero intersecciones entre `tenant_memberships` y `sales_attributions` del mismo agente y tenant |
| 11 | Costos y margen por producto / partner / tenant | **SÍ** — 5 / 2 / 13 filas calculadas |
| 12 | Provisioning DRY_RUN existente y auditable | **SÍ** — 4 solicitudes, 7 eventos de timeline |
| 13 | RLS evita cross-org y cross-tenant | **SÍ** — 39/39 tablas con RLS + FORCE; 12 tests negativos en verde |

La certificación #10 es la que sostiene la regla comercial del prompt §2.3, y se
verificó con una consulta que buscaría activamente la violación:

```sql
select 1 from platform.tenant_memberships tm
  join platform.sales_agents sa      on sa.user_id = tm.user_id
  join platform.sales_attributions a on a.sales_agent_id = sa.id
                                    and a.tenant_id = tm.tenant_id;
-- 0 filas
```

## 2. Tabla de gates

| Gate | Estado |
|---|---|
| FILESYSTEM_GUARDRAILS · REPO_INITIALIZED · REACT_APP · SUPABASE_LOCAL | PASS |
| DB_RESET · MIGRATIONS · SEED · AUTH · RBAC · RLS | PASS |
| MULTI_SAAS · PARTNERS · TENANTS · SALES_AGENTS · COMMISSIONS | PASS |
| SUBSCRIPTIONS · COSTS_MARGIN · DEPLOYMENT_MODEL · PROVISIONING_DRY_RUN | PASS |
| **ADMIN_UI** | **PARTIAL** |
| PARTNER_UI · TESTS_DB · TESTS_FRONTEND · TYPECHECK · LINT · BUILD · E2E | PASS |
| SECURITY_NEGATIVE_TESTS · SECRETS_SCAN · DOCUMENTATION | PASS |

**29 PASS · 1 PARTIAL · 0 FAIL · 0 BLOCKED_ENVIRONMENT**

## 3. Conteos verificados

```
102 tests PASS / 0 FAIL   (52 pgTAP + 29 Vitest + 21 Playwright)
 39 tablas · 39 con RLS+FORCE · 69 políticas · 0 GRANTs a anon
  7 vistas · 7 con security_invoker · 42 funciones · 34 definer con search_path
 13 migraciones · 152 índices · 0 FKs sin índice
  5 commits · 129 archivos · git status limpio
```

## 4. Blockers críticos o altos

**Ninguno.** Los 4 blockers de entorno que aparecieron están resueltos y
documentados en `BLOCKERS.md`; el quinto (sin autorización para provisioning
LIVE) es el comportamiento esperado por el propio prompt.

## 5. Deuda técnica priorizada

| Prioridad | Deuda | Por qué importa |
|---|---|---|
| **Alta** | Sin escrituras desde la UI | La consola se puede leer pero no operar. Bloquea el uso real. |
| **Alta** | Decidir la relación con el hub `platform` que ya vive en el proyecto de GMAO | Si ambos evolucionan por separado, divergen. Requiere al operador y a GMAO como lead de suite. |
| Media | Sin snapshot mensual de MRR | No se puede reconstruir el MRR histórico. |
| Media | Sin conversión FX | Los dashboards multi-moneda no consolidan. |
| Media | Sin CI | Los 102 tests corren a mano; nada impide un merge que los rompa. |
| Media | `provisioning-worker` sin desplegar | El reintento desde la UI no cierra el ciclo. |
| Baja | Bundle en un solo chunk (587 kB) | Primer render más lento de lo necesario. |
| Baja | Costo `PLATFORM` sin prorratear a productos | Aparece en el total pero no en el margen por producto. |
| Baja | Sin reconocimiento diferido de ingresos | Correcto para caja, no para devengo contable. |

## 6. Recomendación de la primera tarea del día

**Implementar el alta de tenant desde la UI**, invocando
`platform.create_tenant()` vía RPC.

Por qué esa y no otra:
- es el flujo que más se va a usar y el que hoy obliga a entrar por SQL;
- la función ya existe, valida y audita: sólo falta el formulario;
- ejercita de punta a punta la regla del contrato §3.2 — el error
  `ADMIN_EMAIL_REQUERIDO` debe mostrarse como validación del campo de correo,
  demostrando que la regla vive en la base y la UI simplemente la refleja;
- convierte `ADMIN_UI` de PARTIAL a PASS, que es el único gate que falta.

Ruta sugerida: botón "Nuevo tenant" en `/tenants` → modal con React Hook Form +
Zod → `supabase.rpc('create_tenant', …)` → invalidar `['tenant-overview']` →
test E2E que verifique tanto el alta correcta como el rechazo sin correo de
administrador.
