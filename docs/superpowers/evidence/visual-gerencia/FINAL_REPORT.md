# Informe final — Admin Maestro V4 «visual para Gerencia» (corrida nocturna 2026-10-05)

Rama `feature/masteradmin-visual-gerencia` (worktree `.worktrees/visual-gerencia`), base `dev` = `ddfc0fb`.
**Resultado de la noche: COMPLETA** — las 16 fases quedaron DONE; ninguna BLOCKED. Nada se empujó, no se abrió PR y no se tocó
ningún entorno remoto (AdminMaestro en la nube, QAS, PRD): todo corrió contra el Supabase **local** `ebim-control-plane`.

- 71 commits sobre `dev` (70 de las fases 01–15 + el de este informe) · 554 archivos, +32 156 / −4 775 líneas (189 archivos de `src/`).
- 5 migraciones nuevas, todas aditivas · 0 Edge Functions nuevas o modificadas · 0 dependencias npm nuevas.
- Galería antes/después: [`GALERIA.html`](GALERIA.html) (ábrela en el navegador desde esta carpeta).
- Sistema visual vigente: [`docs/design/VISUAL_SYSTEM_V2.md`](../../../design/VISUAL_SYSTEM_V2.md) (v2.1, con §9 «estado real»).

---

## 1. Resumen para Gerencia (30 segundos)

1. **El Admin Maestro tiene ahora un Resumen Ejecutivo de verdad:** MRR y ARR con 18 meses de historia, el puente del mes
   (nuevo / expansión / contracción / churn), facturado vs cobrado, cartera vencida por antigüedad, mix por producto y mercado,
   top clientes y partners, y un panel «Requiere atención». Todo en una moneda de reporte, con la tasa de cambio que dice la base.
2. **Modo presentación** para proyectar ese resumen en reunión: 6 diapositivas, teclado, pantalla completa, «ocultar nombres»
   de clientes y exportación a PDF.
3. **Ciclo de comisiones cerrado:** devengado → liquidación → aprobación → pago con referencia (o anulación), auditado y sin
   posibilidad de pagar dos veces.
4. **Toda la consola se rediseñó** con una sola identidad (teal de marca, DM Sans, tarjetas KPI con tendencia, tablas que caben a
   1280 px sin esconder columnas), en español, con contraste AA en claro y oscuro.

## 2. Qué cambió, por fase

| Fase | Estado | Qué quedó | Commits |
|---|---|---|---|
| 01 Baseline y capturas | DONE | 45 capturas «antes», auditoría A01–A16 (`BASELINE.md`) | `ee7a5c6` |
| 02 Datos demo | DONE | Dataset local `gerencia-v4`: 48 clientes, 4 partners, 83 contratos, 910 facturas, 832 cobros, 946 comisiones, 18 meses; carga/descarga idempotentes (`scripts/demo/`) | `45f9702` |
| 03 Spec del sistema visual | DONE | `VISUAL_SYSTEM_V2.md`: tipografía, tokens claro/oscuro con AA, componentes, paleta de datos validada (skill dataviz), inventario de 45 rutas → 11 patrones | `aeabbdc` |
| 04 Tokens, tipografía, tema | DONE | Slate frío + teal `#056769`, superficies en capas, sombras e1–e3, escala `text-hero…micro` aplicada a toda la app | `28e12bb` `d52bfb9` `ddaa02f` |
| 05 Componentes base | DONE | Campos V2 (moneda, búsqueda, switch, validación en español), `KpiTile` + sparkline, skeletons, vacío/error, tablas, overlays, galería `/design` | `6a94484` `81d2b9e` `0da80b8` `a5e4612` `4044039` `2ab9598` `d881e5b` |
| 06 Shell y navegación | DONE | Sidebar de marca «Admin Maestro» (modo iconos), topbar neutro, paleta ⌘K, menú de cuenta, migas, foco al título | `eef0dd8` `676f01c` `7474d67` `87251d5` |
| 07 Login, bienvenida, portal | DONE | Anatomía U-04 compartida, medidor de fortaleza, portal `/pagar` con marca, comprobante animado y estados de enlace amables | `d06eed7` `06cc2f0` `c5306f6` `77679c7` |
| 08 Series ejecutivas (MRR) | DONE | **Módulo nuevo 1** — migración `20261015000100` (ver §4) | `7ef6ec2` `02e8c8b` |
| 09 Dashboard ejecutivo | DONE | Resumen Ejecutivo V4 (hero de 6 KPIs, evolución, puente con drill-down, cobranza, antigüedad, mix, tops, atención) + migración `20261016000100` | `2c017c2` `b10d66d` `e6df149` `923eee7` |
| 10 Pantallas de Finanzas | DONE | 10 rutas + ficha de contrato con franja KPI, gráficos pequeños, menús por fila + migración `20261017000100` | `3a27454` `34db83f` `5fbfbe6` `a94bd26` `8db3279` `5be33a2` `0e5db8a` |
| 11 Clientes y productos | DONE | 13 rutas; fichas 360 con cabecera de perfil y tendencias; Nueva venta con stepper; **A01 `/feature-flags` corregido** + migración `20261018000100` | `66a9269` `1c516bd` `b40286d` `5b77dc1` `2d4be93` `8341e9f` `0e4d300` `df7e95c` |
| 12 Operación y gobierno | DONE | 13 rutas: integraciones en tarjetas con semáforo y cutover, uso con sparklines, auditoría como línea de tiempo, usuarios, cuentas de pago | `1c01eb7` `41bbd77` `d96b3cf` `332924c` `170f90c` `abf48b3` `7b64531` `d09701b` `0c80bad` `9c78aeb` `698ab05` |
| 13 Liquidación de comisiones | DONE | **Módulo nuevo 2** — migración `20261019000100` (ver §4) y pantalla `/commissions#liquidaciones` | `5d3ff28` `d04c900` `e25f97a` `ff1318d` `803eae3` |
| 14 Modo presentación | DONE | `/?presentacion=1`: 6 diapositivas, teclado, pantalla completa, ocultar nombres, PDF A4 | `fd61247` `526a30c` `b3678b9` |
| 15 QA visual y accesibilidad | DONE | 45 rutas sin errores ni desbordes; 27 tablas compactadas; e2e de desbordes y teclado; contraste 116/116 AA | `0f95156` `082e7a4` `6a31210` `f33c706` `bcdbc0d` `6a9a337` `b8468a8` `be123cf` `35070f3` |
| 16 Cierre e informe | DONE | Este informe, galería, spec v2.1 | (commit de este informe) |

### Qué NO se hizo (y por qué)
- **Nada quedó BLOCKED.** Lo que sigue son límites de alcance o deudas conocidas, no fallas de gate.
- **Ningún despliegue ni push:** por regla de la corrida; los pasos están en el §6 para que los ejecute una persona.
- **Módulos 3–14 del roadmap** (cobranza automática, correo transaccional, CPQ, portal autenticado…): fuera del alcance de esta noche
  (D-V07). Ver [`ROADMAP_MODULOS.md`](../../../../../../.claude-prompts-v4-visual-gerencia/ROADMAP_MODULOS.md) del pack (en el checkout principal: `masteradmin/.claude-prompts-v4-visual-gerencia/`, fuera de esta rama).
- **Diálogos secundarios** (cobranza manual, integraciones, provisioning, despliegues, invitación, secreto de proveedor) y algunos paneles
  internos de la ficha 360 no se re-maquetaron: funcionan, pero conservan la tipografía anterior (§7).
- **Facturación electrónica, metas/forecast, snapshots de cierre:** requieren decisión de negocio (roadmap 8, 9, 10).

## 3. Gates finales (fase 16, sobre el HEAD previo a este commit)

| Gate | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npx vitest run` | **114 archivos / 1 675 tests**, todos verdes (baseline: 98 / 1 441) |
| `npm run build` | OK (3,1 s) |
| `npm run secrets:scan` | **PASS** — sin credenciales en repo ni bundle (solo fixtures que los tests exigen RECHAZAR) |
| `supabase db reset --local` + `supabase test db` (sin demo) | **56 archivos / 2 225 tests, PASS** (baseline: 51 / 2 072) |
| `bash scripts/demo/load-demo-data.sh` | OK — la base local queda con la demo cargada |
| e2e `smoke.spec.ts` + `a11y-teclado.spec.ts` | **26 / 26** (sin reintentos) |
| e2e suite completa (fase 15) | 121 ✓ · 19 omitidos · 4 ✘ → 3 corregidos y re-verificados; queda `v4-provisioning-orchestrator` «destino UNHEALTHY», que falla **solo** en la suite completa por estado que deja un spec anterior (aislado tras reset: 37/37) |
| Contraste (`node scripts/a11y/contrast-tokens.mjs`, fase 15) | 116 / 116 pares AA, mínimo 4,73:1 |
| Capturas «después» (fase 15) | 45 rutas, 0 errores inesperados, 0 desbordes de página o tabla; 16 responsive |
| Hex fuera de `tokens.css` | 4, todos en placeholder/validación de los campos «color de marca» (dato, no estilo) |

Notas: `e2e/executive/states.spec.ts` E11 necesita el fixture manual `supabase/fixtures/executive-demo.sql` (no cargado) y ese spec
reescribe evidencia versionada al correr (restaurar con `git checkout -- <archivo>`). pgTAP se corre **sin** la demo: con ella fallan
13/14/26/29/32, que suponen base sin datos extra.

## 4. Módulos nuevos

Todas las funciones son `SECURITY INVOKER` (el alcance lo da RLS), sin `GRANT` a `anon`, y devuelven `NULL` + aviso cuando falta una
tasa de cambio (nunca un 0 inventado). Diccionario de métricas S01–S11 en el código de hooks (`src/services/queries.ts`).

### 4.1 Series ejecutivas — migraciones `20261015000100`, `20261016000100` (+ `20261017000100`, `20261018000100`)

| Migración | RPCs (`platform.`) | Para qué |
|---|---|---|
| `20261015000100_executive_series` | `executive_mrr_at`, `executive_mrr_series`, `executive_mrr_movements`, `executive_mrr_movement_customers`, `executive_mrr_mix` (PRODUCT/MARKET), `executive_receivables_aging`, `executive_reporting_config` | MRR/ARR mensual en moneda de reporte, puente nuevo/expansión/contracción/churn (cuadra al céntimo), detalle por cliente, mix, cartera por antigüedad a una fecha |
| `20261016000100_executive_dashboard_series` | `executive_billing_series`, `executive_mrr_movements_series`, `executive_mrr_mix(…,'PARTNER',…)` | Facturado/cobrado/vencida por mes, NRR mensual, MRR por partner |
| `20261017000100_finance_screen_series` | `finance_monthly_series`, `collections_by_week` | Gráficos de Finanzas (cobrado/costo/comisión/margen por mes, cobros por semana) |
| `20261018000100_account_series` | `executive_account_series` | MRR, facturado y cobrado de UNA cuenta (fichas 360) |

pgTAP: `51_executive_series`, `52_executive_dashboard_series`, `53_finance_screen_series`, `54_account_series`.

**Cómo probarlo (local):**
```bash
supabase db reset --local && supabase test db        # 56/2225 verde, sin demo
bash scripts/demo/load-demo-data.sh                  # carga la demo gerencia-v4
npm run dev                                          # entrar como super admin EBIM → «Resumen ejecutivo»
```
En SQL: `select * from platform.executive_mrr_series(null, null, 'USD');` y
`select * from platform.executive_mrr_movements((date_trunc('month', current_date) - interval '1 month')::date, 'USD');`
(como usuario autenticado con vista financiera; con `service_role` no hay `auth.uid()`).

Definición de MRR histórico: contratos ACTIVE, PAST_DUE y los dados de baja hasta su fin; excluye DRAFT, PAUSED, DEMO y SANDBOX
(difiere a propósito de K01 `v_subscription_mrr`, que no se tocó). Cada mes se mide a su cierre; el mes en curso se marca *parcial*.

### 4.2 Liquidación y pago de comisiones — migración `20261019000100_commission_settlement_payout`

> La fase pedía `20261016000100` para este módulo, pero ese nombre ya lo usaba la fase 09; se tomó el siguiente libre.

- RPCs: `approve_commission_settlement(id, nota)`, `pay_commission_settlement(id, fecha, referencia, medio, nota)`
  (medios BANK_TRANSFER / PAYROLL / CHECK / CASH / OTHER), `cancel_commission_settlement(id, motivo)`; `settle_commissions` redefinida
  (ignora anuladas). Rol finanzas, auditadas, idempotentes (`already_*` en reintentos; otra referencia de pago se rechaza).
- Triggers: PAID y CANCELLED inmutables; una liquidación APPROVED queda congelada; un evento solo entra en una OPEN.
- Columnas nuevas en `commission_settlements` (nota de aprobación, quién pagó, medio, nota de pago, anulación) e índice de código
  **parcial** (`where status <> 'CANCELLED'`): el código de una anulada se puede reutilizar. Filas históricas PAID sin medio → `OTHER`.
- Reverso tras pago: se respeta el contra-evento V2, que entra en la próxima liquidación.
- `supabase/seed.sql` se actualizó (`on conflict … where status <> 'CANCELLED'`, `payment_method`). El seed solo se usa en local.
- pgTAP `55_commission_settlement_payout` (61 aserciones). e2e `e2e/v4-commission-settlements.spec.ts` (modifica la demo: recargarla después).

**Cómo probarlo:** `/commissions` → pestaña **Liquidaciones**: la demo deja 1 OPEN (Lucía, USD) y 1 APPROVED (Andrés Vera, USD).
Abrir la aprobada → «Registrar pago» (fecha, referencia, medio) → queda PAID e inmutable. «Generar liquidación» muestra vista previa.
Como comercial (Carla) la pestaña es de solo lectura.

## 5. Guion de 5 minutos para Gerencia (modo presentación)

Preparación (1 min antes): `bash scripts/demo/load-demo-data.sh`, entrar como super admin EBIM, abrir `/` y pulsar **«Presentar»**
(o abrir `/?presentacion=1`). Moneda USD, mes analizado = último mes cerrado. Si se proyecta a terceros, activar **«Ocultar nombres»**.
Cifras de referencia con la demo cargada el 2026-10-05 (cambian si se recarga otro mes, porque las fechas son relativas):

| Min | Diapositiva | Qué decir |
|---|---|---|
| 0:00 | **1 · KPIs** | «Esto es el negocio en una pantalla.» MRR **USD 55.7 K** (+2.5 % vs agosto), ARR **668 K**, 48 clientes activos, NRR **102.4 %**. Cartera vencida 33.0 K (+7.7 %): la única flecha roja, la retomamos en la 4. Aclarar que el cobrado de setiembre baja 40 % porque agosto tuvo facturas únicas grandes. |
| 1:00 | **2 · Evolución del MRR** | 18 meses: de ~18.7 K a 55.7 K, ×3. Cada punto es el cierre del mes; el mes en curso se marca parcial. Clic en un mes lo fija como mes analizado. |
| 1:45 | **3 · Puente del mes** | De dónde viene el cambio: nuevo + expansión − contracción − churn = variación neta. La base garantiza que cuadra al céntimo. Clic en una barra → qué clientes la explican. |
| 2:45 | **4 · Cobranza** | Facturado vs cobrado por mes con % de cobro bajo cada mes (cobro 12 m ≈ 94 %). A la derecha la cartera por antigüedad: el riesgo está en 61–90 y 90+. |
| 3:30 | **5 · Mix** | Qué producto y qué mercado sostienen el MRR (barras ordenadas, no tortas). |
| 4:15 | **6 · Top clientes y partners** | Concentración: cuánto pesan los 5 primeros. Con nombres ocultos salen como «Cliente A, B…». |
| 4:45 | Cierre | «Todo es clicable hasta la ficha del cliente» — salir con `Esc` y mostrar el panel «Requiere atención». |

Teclado: → / espacio avanzan, ← retrocede, 1–6 saltan, `Esc` sale. «Imprimir» genera un PDF A4 apaisado de 6 hojas
(ejemplo: [`capturas/fase14/presentacion/presentacion.pdf`](capturas/fase14/presentacion/presentacion.pdf)).

## 6. Cómo llevarlo a `dev` y a la nube (solo instrucciones — NO se ejecutó nada)

1. **Revisión humana:** abrir `GALERIA.html`, este informe y `git log dev..HEAD`. Correr localmente los gates del §3.
2. **Integrar a `dev`:** `git push -u origin feature/masteradmin-visual-gerencia` y abrir PR hacia `dev` (sin force push).
   El PR trae 5 migraciones nuevas, tests pgTAP 51–55, e2e nuevos y ~111 MB de capturas PNG en `docs/superpowers/evidence/visual-gerencia/capturas/`
   (considerar si se versionan todas o solo `antes/` y `despues/`).
3. **Base de datos de la nube** (AdminMaestro DEV → QAS; **PRD solo con autorización explícita**), en este orden y con el flujo de
   migraciones del repositorio:
   - `20261015000100_executive_series.sql`
   - `20261016000100_executive_dashboard_series.sql`
   - `20261017000100_finance_screen_series.sql`
   - `20261018000100_account_series.sql`
   - `20261019000100_commission_settlement_payout.sql` — **revisar antes**: cambia el índice único de código de liquidaciones a
     parcial, agrega triggers que congelan liquidaciones PAID/CANCELLED/APPROVED y completa `payment_method = 'OTHER'` en PAID históricas.
     Si en la nube hay procesos que escriben liquidaciones a mano, deben actualizar eventos antes de poner la cabecera en PAID.
   Ninguna toca datos de clientes ni debilita RLS/grants; todas las funciones son SECURITY INVOKER sin `anon`.
4. **Edge Functions:** ninguna nueva ni modificada → no hay que desplegar funciones ni cambiar secretos.
5. **Datos de demostración:** `scripts/demo/*` es **solo local**. Nunca correrlo contra la nube.
6. **Tras migrar:** `npm run db:types` contra el entorno destino solo si el flujo del repo lo pide (los tipos ya están regenerados en la rama);
   verificar el Resumen Ejecutivo con datos reales: el MRR histórico de meses viejos depende de que los ítems tengan `valid_from` correcto
   (en local los ítems del seed nacen en la fecha del reset y producen un salto en el mes en curso — es un artefacto local, documentado).
7. **Configuración de la nube a confirmar:** moneda de reporte y tasas FX publicadas para los últimos 18 meses; sin tasas, las series
   muestran «falta tasa» en lugar de cifras.

## 7. Deudas y siguientes pasos

**Deudas visuales/funcionales conocidas** (detalle en `VISUAL_SYSTEM_V2.md` §9.3):
- Listados sin paginación: Tenants (~100), Contratos (~104), Atribuciones, Liquidaciones (~53).
- Ficha 360 de organización con 12 pestañas (scroll, sin flechas); diálogos secundarios y paneles internos sin re-maquetar.
- Registro de capacidades con columnas desalineadas y nombres sin tildes; detalle de Conciliación con fechas ISO; `input type=month` nativo en la ficha de contrato.
- Sidebar largo (35 ítems) sin indicador de scroll a 900 px de alto.
- Para el comercial, el KPI «Devengado» de comisiones dice «Falta tasa PEN» (la serie S09 no ve sus tasas).
- Cobrado de setiembre en la demo cae 40 % por facturas únicas del seed base en agosto (artefacto de datos locales, no de la pantalla).
- e2e: `v4-provisioning-orchestrator` depende del orden de specs; `states` E11 depende de un fixture manual.

**Siguientes módulos** (de [`ROADMAP_MODULOS.md`](../../../../../../.claude-prompts-v4-visual-gerencia/ROADMAP_MODULOS.md)):
4 → 3 (correo transaccional y luego centro de cobranza/dunning: impacto directo en caja), después 5 (CPQ) y 7 (salud del cliente);
10 (cierres mensuales/snapshots) encaja bien sobre las series ejecutivas de esta noche. 8 y 12 requieren decisión con Finanzas.

## 8. Evidencia

- `BASELINE.md` — auditoría inicial A01–A16.
- `GALERIA.html` — 45 pares antes/después + presentación, comisiones, tablero y responsive.
- `capturas/antes/`, `capturas/despues/` (con `index.json` por set) y `capturas/faseNN/` por fase.
- `capturas/fase14/presentacion/{presentacion,tablero}.pdf`.
- Estado y decisiones de la noche: `.claude-prompts-v4-visual-gerencia/STATE.md` y `DECISIONS.md` (fuera del repo, en el checkout principal).

## 9. `git log --oneline dev..HEAD` (antes del commit de este informe)

```
35070f3 test(visual): record the after captures
be123cf test(visual): the invalid payment link may show its expected error
b8468a8 fix(ui): keep renewals and tenant states inside 1280 with real data
6a9a337 test(e2e): align journeys with the tenant 360 and stepper redesigns
bcdbc0d fix(ui): fit tables with longer real names and translate org activity codes
f33c706 fix(ui): fit the section-tab tables and widen invoice ids from 1400 px
6a31210 test(e2e): overflow, keyboard and responsive checks plus contrast script
082e7a4 fix(ui): keep price and interval together and use the es-PE short month
0f95156 fix(ui): fit every listing table at 1280 without hidden columns
b3678b9 docs(design): presentation mode pattern
526a30c test(e2e): presentation mode captures and print evidence
fd61247 feat(executive): add the presentation mode
803eae3 docs(commissions): settlement and payout cycle plus phase 13 screens
ff1318d test(e2e): settlement lifecycle journey and phase 13 captures
e25f97a fix(commissions): fit the settlement detail table and keep demo dates in the past
d04c900 feat(commissions): settlement lifecycle on the commissions screen
5d3ff28 feat(commissions): approve, pay and cancel commission settlements
698ab05 docs(visual): capture the phase 12 operations and governance screens
9c78aeb fix(ui): open a deep-linked tab once its permission-gated tab appears
0c80bad test(e2e): find integration cards by code and match the DRY_RUN wording
d09701b test(ops): cutover stepper marks the current step without relying on colour
7b64531 style(ops): tighter usage meter cells and payment account details
abf48b3 style(governance): settings sections, payment accounts as cards with a visible encrypted-key state
170f90c style(governance): users with initials avatars, role chips and status dots
332924c style(ops): deployments, SaaS onboarding and infrastructure queue as PT-LIST
d96b3cf style(ops): usage meters with monthly sparklines and consumption vs included bars
41bbd77 style(ops): integration cards with per-environment health lights and cutover stepper
1c01eb7 style(governance): audit log as a day-grouped timeline with action icons and inline detail
df7e95c docs(visual): capture the phase 11 client, catalog and contract screens
0e4d300 style(clients): keep the active 360 tab in view and tidy long cells
8341e9f style(clients): Nueva venta as a stepped wizard with a sticky contract summary
2d4be93 style(catalog): Suite SaaS product cards, product detail strip and catalog row menus
5b77dc1 style(clients): tenants, contracts, sales team and attributions lists
b40286d style(clients): Tenant 360 profile header, KPI strip and trend charts
1c516bd style(clients): organization 360 profile header and customer lists with avatars
66a9269 feat(executive): monthly series of one account for the 360 views
0e5db8a docs(visual): capture the phase 10 finance screens
5be33a2 fix(ui): keep row menus open on focus scroll and match counted nav links
8db3279 style(finance): subscription detail with contract KPIs and money actions in view
a94bd26 style(finance): regional, AI credits, billing shadow and partner fees with KPI strips
5fbfbe6 style(finance): commission plans, renewals and reconciliation with KPI strips and row menus
34db83f style(finance): billing, costs and commissions with KPI strip and period charts
3a27454 feat(finance): monthly margin components and weekly collections series
923eee7 docs(visual): capture the phase 09 executive summary
e6df149 feat(executive): executive summary redesign with hero KPIs, MRR story and attention panel
b10d66d style(ui): V2 chart panel anatomy, 12px axes and compact amounts
2c017c2 feat(executive): billing, monthly bridge and partner mix series for the dashboard
02e8c8b feat(executive): series hooks and KPI dictionary for MRR history
7ef6ec2 feat(executive): monthly MRR series, bridge, mix and aging as-of RPCs
77679c7 docs(visual): capture the phase 07 login, welcome and payment portal
c5306f6 feat(payments): branded public payment portal with receipt and link states
06cc2f0 feat(ui): welcome page on the login anatomy with a strength meter
d06eed7 feat(ui): brand auth layout and Admin Maestro login per U-04
87251d5 docs(visual): capture the phase 06 shell, command palette and account menu
7474d67 test(e2e): detect the session and sign out through the account menu
676f01c feat(ui): V2 shell with brand sidebar, neutral topbar and ⌘K command palette
eef0dd8 feat(ui): page header owns breadcrumbs from the shell trail and takes focus
d881e5b docs(visual): capture the phase 05 component gallery and form screens
2ab9598 test(ui): wrap native invalid events in act
4044039 fix(ui): show native form validation in Spanish inside the field and title the gallery route
a5e4612 feat(ui): add the /design component gallery and shape-matched loading across screens
0da80b8 style(ui): polish dialogs, drawer, tabs and toasts to the V2 overlay system
81d2b9e feat(ui): evolve StatCard into KpiTile with sparkline and add skeleton, empty and error states
6a94484 feat(ui): give form fields the V2 anatomy with icons, prefixes and new money, search and switch fields
ddaa02f docs(visual): record the phase 04 theme captures
d52bfb9 style(theme): apply the V2 type scale and base component anatomy app-wide
28e12bb style(theme): adopt the V2 tokens for surfaces, brand teal and data palette
aeabbdc docs(design): add the V2 visual system specification
45f9702 feat(demo): add an idempotent local demo dataset for the management presentation
ee7a5c6 test(visual): add the page capture inventory and record the visual baseline
```
