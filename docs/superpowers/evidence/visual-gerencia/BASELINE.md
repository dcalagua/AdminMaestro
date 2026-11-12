# Línea base visual — MasterAdmin V4 «visual para Gerencia»

Fecha: 2026-10-05 · Fase 01 (baseline y capturas «antes») · corrida nocturna autónoma.

## 1. Punto de partida

| Dato | Valor |
|---|---|
| Rama | `feature/masteradmin-visual-gerencia` (worktree `.worktrees/visual-gerencia`) |
| Base | `dev` = `ddfc0fb` (Merge PR #5 `feature/masteradmin-culqi-credenciales`) |
| HEAD al empezar | `ddfc0fb` (árbol limpio) |
| Supabase | local `ebim-control-plane` (API 54421, DB 54422), `db reset --local` con el `seed.sql` base |

## 2. Gates

| Gate | Resultado |
|---|---|
| `supabase test db` | **PASS** — 51 archivos, **2072** pruebas pgTAP |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npx vitest run` | PASS — **98** archivos, **1441** pruebas |
| `npm run build` | PASS (vite build 3.8 s) |
| `npm run secrets:scan` | PASS (sin credenciales; sólo excepciones documentadas en tests) |

Nota de entorno: `node_modules` del worktree es un symlink al checkout principal; vitest/vite escriben
`node_modules/.vite-temp`, así que vitest, build y Playwright se ejecutan fuera del sandbox.

## 3. Inventario de capturas

Spec: `e2e/visual/capturas.spec.ts` (`VISUAL_LABEL=antes npx playwright test e2e/visual/capturas.spec.ts`).
Salida: `capturas/antes/` + `capturas/antes/index.json` (ruta, archivo, título `h1`, URL final, error,
error esperado, respuestas HTTP ≥ 400 del API local, desborde horizontal).

- 1440×900, modo claro, página completa, super admin (`dcalagua@ebim.pe`) con el seed base.
- Resumen ejecutivo además en oscuro y a 1280×800 (claro y oscuro).
- Red: sólo 127.0.0.1 y Google Fonts (DM Sans real); ningún otro host contactado (`blockedHosts: []`).
- **45 capturas**, 0 con desborde horizontal, 0 errores HTTP del API salvo lo indicado.

| # | Archivo | Ruta | Estado |
|---|---|---|---|
| 01 | `01-login-claro.png` | `/login` (sin sesión) | ok |
| 02 | `02-resumen-ejecutivo-{claro,oscuro,1280-claro,1280-oscuro}.png` | `/` | ok |
| 03 | `03-customers-claro.png` | `/customers` | ok |
| 04 | `04-partners-claro.png` | `/partners` | ok |
| 05 | `05-organizations-claro.png` | `/organizations` | ok |
| 06 | `06-sales-agents-claro.png` | `/sales-agents` | ok |
| 07 | `07-attributions-claro.png` | `/attributions` | ok |
| 08 | `08-products-claro.png` | `/products` | ok |
| 09 | `09-plans-claro.png` | `/plans` | ok |
| 10 | `10-feature-flags-claro.png` | `/feature-flags` | **ERROR** — PostgREST: *Could not embed because more than one relationship was found for 'tenants' and 'saas_products'* |
| 11 | `11-commercial-capabilities-claro.png` | `/commercial/capabilities` | ok |
| 12 | `12-catalog-addons-claro.png` | `/catalog/addons` | ok |
| 13 | `13-onboarding-claro.png` | `/onboarding` | ok |
| 14 | `14-tenants-claro.png` | `/tenants` | ok |
| 15 | `15-subscriptions-claro.png` | `/subscriptions` | ok |
| 16 | `16-billing-claro.png` | `/billing` | ok |
| 17 | `17-costs-claro.png` | `/costs` | ok |
| 18 | `18-commissions-claro.png` | `/commissions` | ok |
| 19 | `19-commission-plans-claro.png` | `/commission-plans` | ok |
| 20 | `20-renewals-claro.png` | `/renewals` | ok |
| 21 | `21-reconciliation-claro.png` | `/reconciliation` | ok |
| 22 | `22-regional-claro.png` | `/regional` | ok |
| 23 | `23-ai-credits-claro.png` | `/ai-credits` | ok |
| 24 | `24-billing-shadow-claro.png` | `/billing-shadow` | ok |
| 25 | `25-partner-fees-claro.png` | `/partner-fees` | ok |
| 26 | `26-integrations-claro.png` | `/integrations` | ok |
| 27 | `27-commercial-entitlement-sync-claro.png` | `/commercial/entitlement-sync` | ok |
| 28 | `28-usage-claro.png` | `/usage` | ok |
| 29 | `29-deployments-claro.png` | `/deployments` | ok |
| 30 | `30-saas-provisioning-claro.png` | `/saas-provisioning` | ok |
| 31 | `31-provisioning-claro.png` | `/provisioning` | ok |
| 32 | `32-users-claro.png` | `/users` | ok |
| 33 | `33-audit-claro.png` | `/audit` | ok |
| 34 | `34-settings-claro.png` | `/settings` | ok |
| 35 | `35-organizacion-ficha-360-claro.png` | `/organizations/:id` (primera del listado) | ok |
| 36 | `36-tenant-ficha-claro.png` | `/tenants/:id` | ok |
| 37 | `37-suscripcion-ficha-claro.png` | `/subscriptions/:id` | ok |
| 38 | `38-usuario-ficha-claro.png` | `/users/:id` | ok |
| 39 | `39-producto-ficha-claro.png` | `/products/:id` | ok |
| 40 | `40-integracion-ficha-claro.png` | `/integrations/:id` | ok |
| 41 | `41-pagar-enlace-invalido-claro.png` | `/pagar` sin token | error **esperado** (enlace inválido) |
| 42 | `42-bienvenida-sin-enlace-claro.png` | `/bienvenida` sin enlace | error **esperado** (enlace ausente) |

Artefacto de captura conocido: en páginas más altas que el viewport el sidebar (sticky, `h-screen`)
termina a los 900 px y debajo se ve el fondo; en pantalla real el sidebar está fijo. No es un defecto de la app.

## 4. Auditoría visual (guía para las fases 04–12)

Mirando las PNG. Prioridad: **P0** bloquea la presentación a Gerencia · **P1** se nota a primera vista · **P2** pulido.

| # | Prio | Pantalla | Problema | Fase sugerida |
|---|---|---|---|---|
| A01 | P0 | `/feature-flags` (10) | La pantalla no carga: error PostgREST por relación ambigua `tenants`↔`saas_products`, y el mensaje técnico sale **en inglés** al usuario (rompe U-13). Hace falta desambiguar el embed (`saas_products!<fk>`) y traducir errores de PostgREST en `ErrorState`. | 11 (o antes, es un bug) |
| A02 | P0 | Resumen ejecutivo (02) | Los KPIs hero apilan 3 monedas (BOB/PEN/USD) en tamaño display: el ojo no sabe cuál es «el número». Falta una cifra protagonista en moneda de reporte con el desglose nativo en segundo plano, y no hay sparkline ni variación vs mes anterior (D-V05). | 08–09 |
| A03 | P0 | Resumen ejecutivo (02) | «¿Cuánto cobramos cada mes?» muestra 10 meses vacíos y 2 barras: con el seed base el gráfico no representa el negocio. Falta la historia de 12–18 meses (fase 02) y el gráfico protagonista de **evolución de MRR**, puente de MRR, facturado vs cobrado y antigüedad de cartera. | 02, 08, 09 |
| A04 | P1 | Resumen ejecutivo (02) | «Margen gerencial −USD 5,828.00» en rojo grande sin contexto (mes en curso parcial, sin cobros): a Gerencia se le lee como pérdida. El estado «parcial/sin datos» debe pesar más que la cifra. | 09 |
| A05 | P1 | Resumen ejecutivo (02, oscuro) | En oscuro el sidebar conserva el verde brillante del modo claro: contraste de bloque excesivo contra el fondo casi negro; el sidebar debería usar el gradiente teal profundo (D-V03) en ambos modos. | 04, 06 |
| A06 | P1 | Global (shell) | Jerarquía tipográfica plana: el `h1` de página es 22 px y los títulos de tarjeta 13–14 px; KPIs de ~22 px (< 28 px requerido para proyector). No se usa la escala D-V02 (display 40, h1 28, h2 20). | 04 |
| A07 | P1 | Facturación (16), Comisiones (18), Costos (17), Renovaciones (20) | Tablas muy altas y densas: números de factura y códigos de suscripción en mono que se parten en 2 líneas (`INV-202610-V3-BO-…`), celdas de comisiones de 3–4 líneas (tenant, origen, regla), texto 11–12 px en columnas secundarias. Falta truncado con tooltip, anchos mínimos y números tabulares consistentes. | 05, 10 |
| A08 | P1 | Ficha 360 de organización (35) | Tarjetas KPI con mucho aire vacío y valor «Sin actividad en este alcance» del mismo peso que un número; una tarjeta huérfana en la tercera fila; 11 pestañas en dos renglones (SectionTabs desbordado). Necesita estado vacío explícito y pestañas agrupadas o con scroll. | 05, 11 |
| A09 | P1 | Tenant 360 (36) | Mezcla de escalas: «eSupplier Partner · Tenant» y «andina-esupplier-dedicated» a ~26 px en tarjetas (un slug técnico en tamaño hero), mientras el MRR va al mismo tamaño; color ámbar para «Sin activar» como texto display. 10 pestañas en dos renglones. | 05, 11 |
| A10 | P1 | Inputs (13 Nueva venta, 34 Configuración, 16/17 buscadores) | Inputs a ancho completo de 1100 px para un `select` de 1 valor (Nueva venta), alto 36 px, radio y borde distintos entre `select` nativo, buscador y campo de texto; sin icono/prefijo ni anillo de foco de marca (D-V04). El stepper de Nueva venta mezcla una pastilla sólida con texto plano. | 05, 07 |
| A11 | P1 | Renovaciones (20) | Tres botones de acción en la cabecera, uno rojo sólido («Ejecutar suspensiones…») al mismo nivel que los demás: la acción destructiva domina la pantalla. Las 5 tarjetas de ventana (7/15/30/45/60 d) muestran todas «18» — selector que parece KPI. | 05, 10 |
| A12 | P2 | Clientes (03), Suite SaaS (08) y listados | Acciones de fila siempre visibles («Editar · Archivar · Ver detalle») compiten con los datos; «Archivar» en rojo en cada fila. D-V04 pide acciones al hover y una columna de acción discreta. | 05, 11 |
| A13 | P2 | Suite SaaS (08) | Badges «Sin integración registrada» grises con texto oscuro sobre gris medio (contraste límite) y la columna «Unidad de cobro» en mayúsculas técnicas (`TENANT`, `WAREHOUSE`) sin traducir. | 11 |
| A14 | P2 | Portal de pago (41), Bienvenida (42) | Estados de error correctos pero pobres: tarjeta blanca con dos líneas y 70 % de la pantalla vacía, sin ilustración, sin acción (contactar / volver). La marca casi no aparece. | 07 |
| A15 | P2 | Login (01) | Buena anatomía U-04, pero el wordmark «Control Plane» usa el verde claro sólo en la «C» y el CTA tiene sombra pesada; los selectores ES/Oscuro flotan sin alinear con la tarjeta. Retoque menor. | 07 |
| A16 | P2 | Topbar (todas) | Densidad y modo se exponen dos veces (select «Equilibrada» + botón de luna en el topbar y de nuevo en Configuración); el badge «Entorno local» ámbar compite con el título. El topbar puede aligerarse. | 06 |

Observaciones positivas que se mantienen: buscador único + pestañas de estado en todos los listados (U-06),
`SectionTabs` con `#hash` en fichas (U-07), todo en español salvo A01/A13, ningún desborde horizontal a 1440 px,
footer de tabla con conteo y paginación, «Requiere atención» con acciones claras.
