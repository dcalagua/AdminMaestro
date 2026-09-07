# E2E REPORT — EBIM Control Plane V2 (Fase 17)

**Fecha:** 2026-09-07
**Comando:** `npx playwright test --reporter=line` (equivale a `npm run e2e`)
**Entorno:** Chromium headless · app real en `http://127.0.0.1:5199` · Supabase local con `db:reset` previo
**Resultado:** **39 passed / 0 failed / 0 skipped** en 48,3 s

> **No hay skips.** Ninguna prueba de seguridad ni de cobranza está desactivada,
> condicionada ni marcada como `fixme`.

---

## Bloqueo encontrado y resuelto: la suite corría contra OTRA aplicación

Antes de poder certificar nada hubo que resolver un fallo que invalidaba la
ejecución entera, y que conviene dejar escrito porque es fácil de repetir.

**Síntoma.** La primera ejecución se quedó ~20 minutos sin emitir una sola línea
y hubo que abortarla.

**Causa.** El puerto 5173 —el que este proyecto tenía configurado— está ocupado
de forma permanente por el dev server de **otro proyecto de esta máquina**
(«Nova CRM», `~/Documents/test/crm`, levantado desde el viernes). Playwright
estaba configurado con `reuseExistingServer: true`, así que dio por bueno ese
servidor y ejecutó **la suite completa contra una aplicación distinta**.

Y había una segunda capa: `vite.config.ts` no se estaba leyendo. Existía un
`vite.config.js` **compilado y commiteado por error** (secuela de R-03, ver
`AUDIT_BASELINE.md` §5), y Vite resuelve `.js` antes que `.ts`. Cambiar el
puerto en el `.ts` no tenía ningún efecto. Lo mismo pasaba con
`playwright.config.js` y `tailwind.config.js`.

**Corrección** — el mismo criterio que el blocker B-01 del baseline: se mueve
NUESTRO puerto, no se mata el servidor de otro proyecto.

1. `vite.config.ts` → puerto **5199** con `strictPort: true`, para que el
   arranque falle en vez de saltar a otro puerto en silencio.
2. `playwright.config.ts` → `baseURL`/`url` a 5199 y **`reuseExistingServer: false`**:
   ante la duda, es preferible fallar a certificar la aplicación equivocada.
3. Eliminados `vite.config.js`, `playwright.config.js` y `tailwind.config.js`
   del disco y del índice de Git, y añadidos a `.gitignore` con el porqué escrito
   al lado. `eslint.config.js` y `postcss.config.js` se conservan: son fuentes
   reales, no artefactos.

---

## Resultados por journey

### Suite de humo heredada — `e2e/smoke.spec.ts` · 21 PASS

Se mantiene íntegra. Único ajuste: la Fase 14 renombró la entrada de menú
«SaaS Products» → «Suite SaaS», y el test se actualizó en consecuencia.

| # | Test | Estado |
|---|---|---|
| 1-3 | Anatomía de login §4.5, credenciales inválidas, ruta protegida | PASS |
| 4-11 | Dashboard, catálogo, tenants, detalle con tabs, provisioning, deployments, costos, auditoría (super admin) | PASS |
| 12-14 | Aislamiento de partner admin | PASS |
| 15-17 | Tablero del comercial y ausencia de secciones ajenas | PASS |
| 18-19 | Finanzas | PASS |
| 20-21 | Apariencia: modo y densidad | PASS |

### Journeys V2 — `e2e/v2-journeys.spec.ts` · 18 PASS

Cubren los 13 recorridos que pide la Fase 17.

| Journey | Qué demuestra | Estado |
|---|---|---|
| **J1** | EBIM crea un partner desde la UI y le asigna un acuerdo eSupplier Shared al 25 % | PASS |
| **J2** | El wizard crea tenant + suscripción + licencia + fee de implementación en **una sola operación**, y el resumen separa la implementación del recurrente | PASS |
| **J3** | Un partner Shared administra **varios** tenants sin infraestructura dedicada | PASS |
| **J4** | Ese mismo partner **no ve** la organización de otro partner (RLS, no el menú) | PASS |
| **J4b** | El partner no ve «Costos y margen» ni «Reconciliación» | PASS |
| **J5** | Los tres modelos de despliegue conviven en la pantalla de Deployments | PASS |
| **J6** | Se encola provisioning en **DRY_RUN** desde la consola | PASS |
| **J7** | **GRUPASA paga eSupplier con tarjeta y EWM con Orden de Servicio**: un cliente, dos métodos | PASS |
| **J8** | Una OS **aprobada** no aparece como cobro confirmado | PASS |
| **J8b** | El ciclo request → received → approved con sus hitos en la línea de tiempo | PASS |
| **J9** | La UI declara «Culqi pendiente de configurar» en vez de fingir que cobra | PASS |
| **J9b** | El ledger de webhooks muestra la entrega repetida como **IGNORED** | PASS |
| **J10** | El comercial ve sus comisiones y **no** ve infraestructura, cobranza ni el alta de clientes | PASS |
| **J11** | Tablero de renovaciones con ventanas 7/15/30/45/60 y la factura en gracia | PASS |
| **J11b** | Recalcular alertas es **idempotente** (segunda pulsación: «Nada nuevo») y no suspende nada | PASS |
| **J12** | El partner admin no ve el botón de crear producto | PASS |
| **J12b** | Forzar `/onboarding` no da acceso | PASS |
| **J13** | **Vista 360** de organización: capacidades, cobranza por SaaS, cobros, comisiones, provisioning | PASS |

---

## Correcciones aplicadas a los propios tests

Todos los fallos intermedios fueron de los tests, no de la aplicación. Se dejan
anotados porque dos de ellos eran defectos reales de diseño de la prueba:

| Problema | Corrección |
|---|---|
| `getByLabel('País')`, `'Slug'` y `'Acción'` resolvían a 2 elementos | Se acotan al `role="dialog"`; esas etiquetas también existen en la tabla de fondo |
| `selectOption({ label: /regex/ })` | `selectOption` no acepta expresiones regulares: se usa la etiqueta exacta |
| `getByText('25,0%')` no encontraba nada | `Intl` en es-PE mete un espacio duro antes del `%`: se compara con `/25[.,]0\s*%/` |
| **Carrera de navegación** | `goToSection` hacía `click` y volvía de inmediato, así que la aserción siguiente se evaluaba contra la pantalla ANTERIOR. Un conteo de filas llegó a medir la tabla del dashboard creyendo que medía la de tenants. Ahora el helper **espera el cambio de URL** |
| **Idempotencia mal afirmada** | El test daba por hecho un estado limpio que los journeys anteriores ya habían cambiado. Ahora pulsa **dos veces** y afirma sobre la segunda, que es lo que de verdad prueba la idempotencia |

---

## Qué NO cubre esta suite

Dicho explícitamente para que nadie lo lea de más:

- **Culqi LIVE.** No hay credenciales. El adapter opera en MOCK y los tests
  verifican que la UI lo declara, no que un cobro real funcione. Ver
  `docs/payments/CULQI_ARCHITECTURE.md` §10.
- **El webhook por HTTP.** La Edge Function no se despliega en local durante los
  tests. La idempotencia se verifica en la capa donde vive —
  `platform.register_provider_payment()` — en `04_v2_business.test.sql`, donde el
  mismo evento entregado cinco veces produce un solo `payment`.
- **Provisioning LIVE.** Todo corre en DRY_RUN por diseño.
- **Multi-navegador.** Solo Chromium; es la configuración del proyecto.
