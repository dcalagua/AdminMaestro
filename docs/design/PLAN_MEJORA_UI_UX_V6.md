# Plan de mejora de UI/UX · Admin Maestro V6 («densidad gerencial»)

Fecha: 2026-11-12. Base: `dev` = `7bd4299` (V5 completa + ciclo de vida de tenants).
Evidencia: 274 capturas de la web publicada (QAS, usuario super admin, solo lectura) en
`scratchpad/v6-audit/` (todas las entradas del menú y sus pestañas, las 8 fichas de detalle con cada pestaña,
12 diálogos, el drawer de la matriz, el menú «Más acciones», estados vacíos; anchos 1440, 1280 y 390), su
`report.json` con métricas por pantalla (filas, alto de fila, columnas vacías, truncados, solapes, jerga,
párrafos duplicados, errores de consola) y la lectura del código de `src/components/ui/*`, `HubPage` y las
pantallas.

## 0. Diagnóstico en una frase

La V5 dejó la consola **bien organizada y correcta**, pero se ve «de formulario», no «de gerencia».
Hay tres causas que se repiten en casi todas las pantallas:

1. **Tarjetas KPI de 120–148 px para una sola cifra.** Se usan 4 por pantalla en 29 archivos
   (`KpiStrip` + `KpiTile`), muchas veces para contar cosas triviales («Integraciones 10 · Listas 10 · Habilitadas 10»).
   Empujan la tabla, que es lo importante, por debajo del pliegue. En móvil se apilan a una columna y ocupan más de
   una pantalla antes del primer dato (Tenants: 9.426 px de alto a 390).
2. **La cabecera de las pantallas con pestañas está partida.** `HubPage` pinta el título y la descripción de la
   entrada; debajo de las pestañas, cada panel incrustado vuelve a pintar **su propia descripción** (2–3 líneas) y
   **su acción primaria**. Así «Nuevo cliente» queda a 150 px del título y hay un párrafo casi repetido en
   las 25 pestañas de los 7 hubs.
3. **Las tablas muestran identificadores en vez de negocio.** Cuentas tiene 5 columnas (País, Identificación fiscal,
   Tenants, Estado) en 1.142 px; Tenants dedica 3 líneas por fila a «Comercial · Alta · Admin»; Planes llega a
   98 px por fila listando cada precio; los códigos (`slug`, `INV-…`, `andina-esupplier-dedicated`) se truncan
   mientras sobra espacio en otras columnas.

A eso se suman textos encimados (el stepper de migración en Apps › Integraciones y en la ficha de integración),
jerga técnica que el glosario V5 no vigila (`Legacy`, `Ingest`, `GET`, `checksum`, `ledger`, `pool`, `target`,
`Scopes`, `Lockup`, `One-time`, `Deployments`, `Webhooks`, `MasterAdmin`, `Control Plane`, `(D-06)`, `(K05)`,
`v_collected_revenue` en un tooltip) y pestañas de tres niveles (Apps › Uso › Medidores; Cobranza › Conciliación ›
Hallazgos; Configuración › Créditos IA › Saldos).

No hay errores de consola ni respuestas HTTP ≥ 400 en ninguna pantalla. Solo hay un aviso de Recharts
(`width(0) and height(0) of chart`) en Resumen y Bandeja, al montar gráficos ocultos o a 390 px.
Ninguna pantalla desborda en horizontal: la única excepción es Catálogo a 390 px, con 392 px de ancho de página.

## 1. Principios V6

1. **Densidad gerencial.**
   - Filas de 44–48 px, con una línea principal y como mucho una secundaria.
   - Ninguna celda de 3 líneas: si hace falta más, va a un tooltip o a la ficha.
   - Una tabla de listado a 1440 muestra de 6 a 9 columnas útiles; nunca 5 columnas en 1.142 px.
2. **Cabecera de lista estándar.**
   - Migas, y en una sola fila: título + contador, y a la derecha la acción primaria (como mucho 1 primaria y
     2 secundarias).
   - La descripción aparece **una sola vez** y en una línea; la explicación larga pasa a un icono «¿Qué es esto?».
   - Las pestañas van debajo, alineadas a la izquierda.
3. **Resumen arriba, compacto.** Cada listado abre con una franja de 3 a 6 cifras de negocio en **una banda de
   ~72 px** (`StatStrip`) que, al hacer clic, filtra la tabla.
   - Las tarjetas grandes (`KpiTile` con sparkline) quedan para Resumen ejecutivo, Facturación, Costos y
     Comisiones, donde la tendencia aporta.
   - Una cifra que no aporta («Integraciones 10», «Productos en catálogo 8») se quita, no se compacta.
4. **Columnas de negocio antes que identificadores.**
   - Dinero (MRR, saldo vencido), estado de negocio (salud de cobranza, alta en las apps) y personas (responsable,
     canal) van antes que país, RUC o código.
   - Los códigos (`slug`, ids, códigos de destino) van en la segunda línea en `font-mono` pequeño o en un tooltip,
     nunca como protagonistas ni truncados a la mitad.
5. **Cero texto encimado, cero truncado evitable.**
   - Steppers y etiquetas de ancho fijo se diseñan para su peor caso (5 pasos en una tarjeta de 260 px).
   - Los títulos de tarjeta usan `line-clamp-2` con `title`.
   - Lo vigila una prueba automática de solapes y truncados (Fase 5).
6. **Un solo nivel de pestañas.** Pestañas de sección (subrayado, a la izquierda) para la pantalla; el segundo nivel
   es un control segmentado (`StatusTabs`) o un selector; nunca tres niveles de pestañas subrayadas.
7. **Una acción primaria por zona.**
   - Las acciones por fila van en el menú `⋯` o en un botón **secundario** pequeño.
   - La Bandeja hoy pinta 35 botones primarios «Gestionar el cobro».
   - Los diálogos tienen su acción primaria a la derecha y desactivada hasta que es válida: hoy «Emitir factura»
     tiene «Cerrar» como botón primario.
8. **Móvil de consulta.** A 390 px el primer dato útil debe verse en la primera pantalla:
   - KPIs en 2 columnas;
   - filtros plegados en un botón;
   - descripción oculta tras el icono;
   - tablas como tarjetas (`mobileCards`, hoy solo en 4 de 71 tablas).

## 2. Cambios transversales (componentes compartidos)

| # | Qué | Dónde | Pantallas que mejora |
|---|---|---|---|
| T1 | **Cabecera única en los hubs.** `EmbeddedPageContext` pasa a dar un *slot* de acciones: el `PageContainer` incrustado lleva sus `actions` a la cabecera del hub con un portal, junto al título. Su `description` deja de pintarse como párrafo y pasa a un `InfoHint` («¿Qué es esto?») junto a la pestaña activa. `item.description` de `navigation.ts` se acorta a una línea. | `src/components/ui/pageTrail.ts`, `primitives.tsx` (`PageContainer`), `src/features/hubs/HubPage.tsx`, `src/app/navigation.ts` | Las 25 pestañas de Cuentas, Equipo comercial, Apps, Catálogo, Cobranza, Comisiones y Configuración: se quitan entre 50 y 70 px y el párrafo repetido, y «Nuevo cliente», «Nueva integración», «Nuevo plan»… quedan junto al título |
| T2 | **`StatStrip`** (nuevo): una banda dentro de una sola `ebim-card`, con celdas divididas por un hairline (`text-micro` como etiqueta, `text-h2` como cifra, `text-caption` como contexto, tono opcional). Se ve en 2 columnas en móvil y de 4 a 6 en escritorio, y cada celda puede filtrar (`onSelect`) o navegar (`to`). Muestra montos multimoneda en una línea (`USD 22.7 K · PEN 3.2 K · BOB 5.9 K`). `KpiStrip` (hoy en `billing/financeUi.tsx`, usado en 28 archivos) pasa a `src/components/ui/` y queda como alias de `StatStrip` con `variant="tiles"`, para las pantallas con tendencia. | `src/components/ui/StatStrip.tsx` (nuevo), `src/features/billing/financeUi.tsx` (re-export) | Tenants, Apps (todas las pestañas), Catálogo › Productos, Usuarios, Ciclo de vida, Conciliación, Renovaciones, Tarifas de partners, Créditos IA, Monedas, ficha de app, Contrato 360, Producto 360: la tabla sube de 250 a 300 px |
| T3 | **`TabStrip` alineado a la izquierda** (`align="start"` por defecto; `center` queda como opción). Hoy `mx-auto w-max` centra las pestañas y deja huecos a ambos lados. Hay que **registrar el desvío** respecto de la regla de suite «tabs centrados» (`gmao-025`) en DECISIONS y validarlo con el dueño, porque afecta también a las fichas. | `src/components/ui/SectionTabs.tsx` | Los 7 hubs, las 8 fichas 360 y las pestañas internas |
| T4 | **`DataTable` gerencial.** (a) `mobileCards` activado por defecto. (b) Columna `{ width, truncate, sticky }`: la primera columna fija con scroll horizontal (ya está en VISUAL_SYSTEM §5.7, pero sin implementar). (c) Celdas tipadas reutilizables: `CellTitle` (nombre + secundaria), `MoneyCell` (monto en la moneda nativa, compacto y con `title` completo), `AppChips` (iconos de producto con el punto de estado y «+N»), `StatusCell` (badge + antigüedad). (d) Columnas ordenables (`sortable`, `aria-sort`), hoy solo en Por cobrar. | `src/components/ui/primitives.tsx`, `MobileCards.tsx`, `tableCards.ts`, nuevo `src/components/ui/cells.tsx` | Todas las tablas de listado (71 usos) |
| T5 | **`EmptyState` con dos variantes.** `variant="no-results"`: lupa y botón «Limpiar búsqueda». `variant="empty"`: la ilustración actual y una acción que crea algo. Además, si el conjunto está vacío (no el filtro), se ocultan el buscador y las pestañas de estado: hoy se ven «Todos 0 · Activos 0 · Borrador 0». | `primitives.tsx` (`EmptyState`, `SearchBar`) | Uso, Módulos habilitados, Tarifas de partners, Créditos IA, Liquidaciones y todas las búsquedas sin resultado |
| T6 | **`CompactStepper`** (nuevo): una barra segmentada (n segmentos, 6 px), la etiqueta **solo de la etapa actual** con su número («2 de 5») y la lista completa en un tooltip y en `sr-only`. Sustituye las 5 etiquetas en columnas de `minmax(0,1fr)` que hoy se pisan («Comparación» encima de «Lectura dual»). El asistente de Nueva venta conserva su stepper grande. | `src/components/ui/Stepper.tsx` (nuevo), `src/features/platform/CutoverStepper.tsx` | Apps › Integraciones, Ficha de integración, Configuración › Avanzado |
| T7 | **Glosario V6.** Se añaden a `FORBIDDEN_UI_TERMS`: `Legacy`, `Ingest`, `GET`, `checksum`, `ledger`, `pool`, `target`, `Scopes`, `Lockup`, `One-time`, `Deployments`, `Webhooks`, `MasterAdmin`, `Control Plane`, `jobs`, `Biller`, `Auth` y las referencias a decisiones o KPI («(D-06)», «(K05)»). La guardia pasa a revisar también las props `info` y `footer` de los KPI: hoy un tooltip de Costos dice `v_collected_revenue`. Los nombres de etapa de migración pasan a lenguaje de negocio: Legacy → «La app manda»; Comparación → «En comparación»; Lectura dual → «Doble control»; Primario → «Manda el Admin Maestro»; Retirado → «Migración completa». Lo técnico queda solo en Configuración › Avanzado. | `src/lib/glossary.ts`, `glossary.test.ts`, `src/features/platform/cutover.ts`, `docs/design/GLOSARIO_V5.md` → `GLOSARIO_V6.md` | Apps (Uso, Módulos habilitados, Entornos), Catálogo, Producto 360, Integración, Créditos IA, Costos, Ciclo de vida, Renovaciones, Conciliación, Auditoría |
| T8 | **`SummaryBar` como cabecera de TODAS las fichas** (hoy solo en Cuenta y Tenant). Contrato, Producto, App, Integración y Usuario usan `KpiTile` con texto en tamaño KPI («Tarjeta (Culqi)», «No aplica», «eSupplier Partner · Tenant»). En Cuenta 360 se eliminan los 4 KPI que repiten la barra (MRR, Saldo, Salud). | `src/components/ui/SummaryBar.tsx` y las fichas de la Fase 4 | Las 8 fichas de detalle |
| T9 | **Formato homogéneo.** Una sola regla para montos en listados: compacto con el monto completo en el `title`. Hoy Contratos mezcla «BOB 5,900.00 · USD 28.8 K». Además: fechas siempre `formatDate` (Conciliación muestra `2026-09-01`); plurales reales en lugar de «1 factura(s) abierta(s)»; y no repetir «de USD 1,800.00» cuando el saldo es igual al total. | `src/lib/format.ts` (nuevo `formatCountNoun`), `Money.tsx` | Contratos, Cobranza › Por cobrar, Conciliación, Contrato 360 |
| T10 | **Menú lateral con doble activo.** En `/apps/:codigo` se marcan a la vez «Centro de la suite» (es la dueña de la ficha) y «Apps» (`NavLink` sin `end`, que coincide por prefijo). Solución: `end` cuando la ruta pertenece a otra entrada. | `src/app/AppShell.tsx` | Ficha de app |
| T11 | **Gráficos sin aviso de tamaño 0.** Se montan cuando el contenedor tiene medida (`initialDimension`/`minWidth` en `ResponsiveContainer` o un observador). | `src/features/billing/financeCharts.tsx`, `lazyFinanceCharts.tsx`, `src/features/executive/components/*` | Resumen, Bandeja, Facturación y Costos (consola limpia) |
| T12 | **Insignias de producto.** Los encabezados de columna por app de las matrices salen en mayúsculas micro («ECHANGE», «EEXPENSE»), y la marca se lee mal. Se cambian por un `AppChip` con el icono y el nombre en su caja real («eChange»). | `cells.tsx` (`AppChip`) | Centro de la suite, Ciclo de vida, Cuenta 360 |

## 3. Hallazgos por pantalla

Prioridad: **P1** se ve en la demo o rompe la lectura (texto encimado, hueco evidente, jerga en una pantalla de
negocio); **P2** mejora clara de densidad o jerarquía; **P3** pulido.
Las fuentes de datos son nombres de `src/types/database.types.ts`: todas existen hoy.

### 3.1 Inicio

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| Resumen › Ejecutivo | Los 6 KPI grandes dicen «— Sin datos» (falta la tasa BOB/PEN→USD) aunque la sparkline sí tiene datos. «Cobrado del mes USD 0». «¿De dónde viene el cambio del MRR?» es una tarjeta vacía de 350 px. El eje de «¿Cómo crece el ingreso recurrente?» llega a 32 K con la serie en unos 3 K. | Si no se puede consolidar, el KPI muestra la **suma por moneda nativa** en una línea (`executive_mrr_at` → `native_mrr` y `native_currency`) con la marca «sin consolidar»; nunca «Sin datos» si hay datos. La tarjeta del puente sin tasa se reduce a un aviso de 1 línea dentro de la tarjeta de MRR. El dominio del eje se ajusta a los datos visibles. | P1 |
| Resumen (filtros) | Moneda, Mes y Horizonte ocupan una fila propia, más los avisos y el botón «Presentar» en otra (unos 110 px). A 390 px, los filtros llenan la primera pantalla. | Una sola barra: filtros a la izquierda, «Presentar» a la derecha; los avisos de tasa van como chip dentro de la barra. En móvil, todo dentro de un botón «Filtros». | P2 |
| Resumen › Top clientes, Top partners, Requiere atención | Las tres columnas tienen alturas desparejas (Top partners: 1 fila con 300 px vacíos). | Grid `auto-rows-min`; Top partners con un estado vacío corto, o fusionado con Top clientes en pestañas segmentadas. | P3 |
| Bandeja | Filas de 80 px con un **botón primario por fila** (35 primarios). Las categorías ocupan 2 renglones de chips. Un párrafo explicativo y «Ver marcados como hechos» en una fila propia. | Filas de 52 px: prioridad (punto) · título · cuenta · antigüedad · monto · acción **secundaria pequeña** «Gestionar» + `⋯` (Hecho). Las categorías pasan a un `select` o a una columna lateral de filtros a ≥1280 px. El aviso va a un `InfoHint`. `StatStrip`: Urgentes · Vencidas (monto) · Altas fallidas · Documentos por aprobar (`inboxModel`, `v_invoice_balances`, `v_saas_provisioning`, `subscription_commercial_documents`). | P1 |

### 3.2 Clientes

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| **Cuentas › Clientes** | Tiene **5 columnas en 1.142 px** (Organización, País, Identificación fiscal, Tenants, Estado), filas de 45 px muy separadas, ningún resumen y el párrafo repetido bajo las pestañas centradas. «Nuevo cliente» está 150 px por debajo del título. A 390 px la página mide 5.107 px. | **Cabecera:** T1 y T3; «Nuevo cliente» va junto al título. **`StatStrip`:** Clientes activos · MRR vigente por moneda · Saldo vencido por moneda (n.º de facturas) · Cuentas con deuda vencida · Cuentas con alguna app sin alta; cada cifra filtra la tabla. **Columnas:** (1) **Cuenta**: avatar, nombre, y en segunda línea razón social · país · RUC; (2) **Apps**: `AppChips` por `product_code` con el punto de alta y «+N» (`v_tenant_overview`); (3) **MRR** por moneda (`v_tenant_overview.mrr` / `currency` por `customer_organization_id`; o `v_subscription_mrr.billed_organization_id`); (4) **Saldo vencido** y días de la más antigua (`v_invoice_balances`: `is_receivable`, `days_overdue > 0`, `balance`, `currency`, `customer_organization_id`); (5) **Salud de cobranza**: badge con `accountHealth()` sobre `v_renewal_pipeline` (`is_past_due`, `in_grace`, `suspension_pending`); (6) **Canal**: directo o vía partner (`v_tenant_overview.managing_name`); (7) **Responsable**: `commercialOwner()` sobre `sales_attributions` + `sales_agents` (`useAttributions`, `useSalesAgents`); (8) Estado, solo si no está activa; (9) `⋯`. **Pestañas de estado:** Todas · Con deuda · Por suspender · Sin apps activas · Inactivas. Se ordena por MRR o por saldo vencido. Se añade «Exportar CSV». Las tarjetas móviles muestran nombre, MRR, vencido y apps. | **P1** |
| Cuentas › Todas las organizaciones | Mismo esqueleto; las capacidades se ven como badges en una columna propia. | Misma tabla que Clientes. Las capacidades pasan a la segunda línea, junto al nombre; las columnas Tenants y Administra se fusionan en «Tenants (propios · administra)». | P2 |
| Partners | Son 2 filas en una página vacía, sin dinero, y la columna «Administra» queda lejos. | `StatStrip`: Partners activos · MRR administrado (`v_partner_finance`) · Margen del canal (`v_partner_margin`) · Tarifa del período (`v_partner_fee_statements`). Columnas: Partner · Clientes · Tenants administrados · MRR administrado · Margen % · Tarifa plataforma (`v_partner_agreements`) · Responsable · Estado. | P2 |
| Equipo comercial › Comerciales | La descripción está **duplicada casi literal** (hub + panel). Los correos se truncan con espacio libre. El código (`beto-andina`) aparece bajo el nombre. Faltan cifras de comisión. | T1. El código pasa al tooltip. Columnas: Comercial (nombre + organización) · Tipo · Cartera (clientes, productos) · **MRR atribuido** (`v_tenant_overview` × `sales_attributions`) · **Comisión por liquidar** y **pagada** (`v_commission_detail`) · Estado. El correo va como enlace `mailto` en la segunda línea, sin truncar. | P2 |
| Equipo comercial › Atribuciones | Filas de 55 px. | `CellTitle` y filas de 44 px; «Canal» y «Plan de comisión» juntos en una celda de 2 líneas. | P3 |
| Diálogo «Nuevo cliente» | El botón dice «Nuevo cliente» y el diálogo se titula **«Nueva organización»** («Crear organización»). Hay un campo de color en hex crudo (`#056769`) y aparece «white-label». | El título y el botón siguen al origen («Nuevo cliente / Crear cliente»). El color pasa a una paleta de muestras con el hex en el tooltip. «white-label» → «con marca propia». | P2 |

### 3.3 Suite

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| **Apps › Integraciones** | (a) **El stepper de migración tiene las etiquetas encimadas** («Comparación» sobre «Lectura dual», «Comparación» pegada a «Primario»), dos veces por tarjeta y 10 tarjetas. (b) Los títulos se truncan (`eSupplier · alta manual con au…` a 1280 o con 3 columnas). (c) Cada tarjeta repite «Salud por entorno», «Paso 1 de 5», «Legacy», «Propietarios técnicos: Ninguno», «Responsable: Sin asignar» y el código mono. (d) 4 KPI grandes que dicen 10 · 10 · 10 · 10 de 16. (e) Pie con 2 líneas de advertencia. (f) «MasterAdmin» en el texto. | **Lista compacta agrupada por app** en lugar de tarjetas de 300 px: una fila por integración con App (`AppChip`) · Integración (nombre en `line-clamp-2` y el código en tooltip) · **Estado** (un badge que combina `status` + `enabled`: «Operativa», «Borrador», «Deshabilitada») · **Salud** (un punto por entorno con etiqueta corta, «Calidad ●», y «hace 1 h»; `deployment_targets.health_status`, `health_checked_at`) · **Módulos** y **Cobro** con `CompactStepper` (T6) y el nombre de negocio de la etapa (T7) · Responsable (sin repetirlo si falta) · `⋯`. `StatStrip`: Operativas 10/10 · Entornos con salud 10/16 · Con incidencia 0 · Sin comprobar > 24 h. El pie pasa a `InfoHint`. A 390 px, una tarjeta de 3 líneas por integración. (`product_integrations`, `deployment_targets`, `product_owners`). | **P1** |
| Apps › Altas en las apps | Filas de 57 px; el nombre del tenant se trunca («Empresa Enterprise Om…») mientras «Solicitado · intentos» ocupa 3 líneas. Botón «Detalle» **y** `⋯` en cada fila. La pestaña «En curso» no tiene contador. 4 KPI grandes. | Columnas: Tenant (nombre completo en 2 líneas; el código al tooltip) · App · Entorno · Estado · Solicitado (fecha relativa; la persona en el tooltip) · Intentos («1/3» solo si es > 1) · `⋯` (Detalle dentro). Contador en «En curso». `StatStrip` (`v_saas_provisioning`). | P2 |
| Apps › Módulos habilitados | Jerga: «GET», «checksum», «SaaS por delante», «MasterAdmin». En el estado vacío se ven igual el buscador y 5 pestañas a 0. | T5 y T7. Texto: «Lo que el Admin Maestro envió a cada app frente a lo que la app confirma». Si no hay filas: un estado vacío con un enlace a la ficha de app (Sincronización). | P2 |
| Apps › Uso | **Tres niveles de pestañas** (Apps › Uso › Medidores…) más una tarjeta con su propio título. Jerga: «Ingest», «(D-06)», `contracts/usage/v1/meters.json`. Todo vacío. | El segundo nivel pasa a un control segmentado. «Ingest» → «Conexión de uso». Sin referencias a decisiones ni rutas de archivo. Si no hay medidores: un estado vacío único con «Qué falta para ver uso» (canal de uso por app). | P2 |
| Apps › Entornos y despliegues | La página mide **5.437 px** (9.913 a 390): una tabla de tenants por cada destino, expandida. «Nuevo **target**». La matriz de salud tiene filas de 81 px con 3 líneas por celda. | Tabla de destinos (Destino · App · Entorno · Modo · Tenants · Salud · Última comprobación) con los tenants **en un drawer o una fila expandible** que empieza plegada. «Nuevo destino». Celdas de salud de 1 línea (punto, estado y «hace 1 h»; el detalle en el tooltip). (`deployment_targets`, `tenant_deployments`). | P2 |
| Apps › Solicitudes de infraestructura | Filas de 57 px; aparece «En buen estado / Crítico» como texto truncado (sr-only). | `CellTitle` y filas de 44 px; `StatStrip` de estados. | P3 |
| Centro de la suite | 8 tarjetas de salud idénticas (unos 600 px) repiten «Alta Activo · Módulos No activo · Uso No activo · Suspensión No disponible» y tienen **8 botones «Verificar ahora»**. La matriz, que es lo valioso, empieza por debajo del pliegue. | **Franja de salud compacta**: una fila de 8 `AppChip` con el punto de salud y «hace 1 h» (unos 72 px), con una sola «Verificar ahora» (todas) en la cabecera y el detalle por app en un popover. Los canales iguales para todas se dicen una vez en una línea («Canales activos: Alta en 8 de 8 · Módulos 0 · Uso 0 · Suspensión 0»). La matriz sube al primer pliegue. Encabezados con `AppChip` (T12). (`deployment_targets`, `product_integrations`, `v_tenant_lifecycle`). | P1 |
| Centro de la suite › drawer de la celda | «Estado en **MasterAdmin**». El drawer es ancho, con el 60 % vacío. Hay dos bloques de título («Cliente EWM Norte · EWM» repetido). | «Estado en el Admin Maestro». El título se dice una vez. Drawer `md` (480 px) con la línea de tiempo del tenant (`provisioning_events`, `tenant_suspensions`) para aprovechar el alto. | P3 |
| Ciclo de vida de los tenants | Cada celda repite «Sin canal». Pestaña «Política y **jobs**». Filas de 59 px; los clientes con 2 tenants en una app ocupan 4 líneas. | «Sin canal» va una sola vez como nota de la columna. «Política y tareas programadas». Una celda con varios tenants muestra el peor estado y «×2». | P2 |
| Tenants | Filas de **64 px**. «Tipo y modelo» se rompe en 3 líneas. La columna «Comercial · Alta · Admin» tiene 3 líneas de texto por fila. El código de infraestructura se trunca. 4 KPI grandes. A 390 px, 9.426 px de alto. | Columnas: Tenant (nombre y app) · Cuenta (y «vía partner») · Modelo (badge de 1 línea: «Compartido · Producción») · MRR · **Estado** (3 iconos compactos comercial, alta y admin con tooltip, o el peor estado como badge) · Infraestructura (el código en el tooltip y la región en la línea secundaria) · `⋯`. `StatStrip`: Tenants · Productivos · Demo · MRR por moneda · Sin alta en la app. (`v_tenant_overview`, `tenantDimensions`). | P1 |
| Ficha de app (`/apps/:codigo`) | 4 KPI de conteo sin dinero. «Canales con la app» repite un párrafo por canal. El menú lateral marca 2 entradas activas (T10). | `SummaryBar`: Salud · Tenants (activos / total) · **MRR de la app** (`v_tenant_overview` por `saas_product_id`) · **Vencido de sus clientes** (`v_tenant_lifecycle.overdue_balance`) · Por confirmar. Canales en una sola fila de badges con el detalle en el tooltip. | P2 |
| Ficha de integración | El mismo stepper encimado. Pestañas «Scopes», «Credenciales» y «Propietarios (0)». Etiquetas de definición en mayúsculas micro dentro de una tabla de 2 columnas muy separadas. | T6/T7. «Scopes» → «Permisos». `SummaryBar`: Estado · Política de altas · Destinos habilitados · Credenciales listas · Última comprobación. Lo técnico (issuer, audience, TTL) va en la pestaña «Conexión», que solo ve el super admin. | P1 (stepper) / P2 |
| Diálogo «Nueva integración» | Jerga en la cabecera (endpoint, issuer, audience, TTL, scopes, JWT, SSRF) para cualquier rol que lo abra. | Un primer bloque de negocio (Producto, Nombre, Responsable, Política de altas) y un bloque plegable «Conexión técnica (Avanzado)». | P3 |

### 3.4 Comercial

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| Nueva venta / Nuevo tenant | «Paso 1 de 6 · Cuenta» repite el stepper que está justo debajo. La tarjeta del formulario es de 760 px para 3 campos. | Se quita la línea redundante. Los campos van en 2 columnas a ≥1280 px; el resumen del contrato queda fijo (`sticky`). **No se cambian** los textos de acción ni `?modo=app` (e2e y demo). | P3 |
| Contratos y suscripciones | No hay `StatStrip` (es inconsistente con Tenants). El resumen va en texto suelto y con formatos mezclados («BOB 5,900.00 · PEN 8,900.00 · USD 28.8 K»), más un párrafo de advertencia. La segunda línea de «Facturado a» se trunca. Los códigos del contrato se ven en mono verde de enlace. | `StatStrip`: Activos · MRR por moneda · Con pago atrasado · Renuevan en 30 días · Borradores. Columnas: Contrato (código y plan) · Cliente · App · Tenant · Recurrente/mes · Próxima factura o renovación (`next_renewal_date`, `v_renewal_pipeline.renewal_on`) · Método de cobro (`v_subscription_collection.collection_method`) · Estado. El aviso del MRR oficial va a un `InfoHint`. | P1 |
| Contrato 360 | 4 KPI con **texto en tamaño KPI** («Tarjeta (Culqi)», «No aplica»). El subtítulo repite nombres («eSupplier by EBIM · Empresa Directa Alpha · Empresa Directa Alpha · eSupplier»). «1 factura(s) abierta(s) · 1 vencida(s)». | `SummaryBar` (T8): Estado · Recurrente/mes · Saldo por cobrar · Próxima factura · Método de cobro · Documento vigente. El subtítulo se deduplica. Plurales reales (T9). | P2 |
| Catálogo › Productos | 4 KPI (8 · 8 · 8 · 36). Las tarjetas de producto muestran los códigos de integración en mono (`esupplier-manual, esupplier-provisioning-v1`) y el MRR con 3 líneas de monedas completas. | `StatStrip` de 3 celdas (Productos activos · MRR por moneda · Tenants). Tarjeta: el MRR compacto en una línea; «Integración: Operativa» como badge, con los códigos en el tooltip. | P2 |
| Catálogo › Planes y licencias | Filas de **98–190 px**: cada precio por mercado aparece listado completo. La columna «Sociedades» vale 1 en todas las filas. Los códigos se truncan. | Fila de 48 px: Plan · App · Modelo · **Desde** (precio mínimo y moneda) · **Mercados** (chips «BO EC PE») · Cargos únicos (n.º) · Estado. La tabla completa de precios va en una fila expandible o en la ficha del producto. «Sociedades» solo si es > 1. (`v_plan_price_catalog`). | P1 |
| Catálogo › Add-ons, Capacidades, Registro | Correctos; el párrafo de descripción está duplicado (T1). | T1/T4. | P3 |
| Producto 360 | Pestaña «**Deployments**», fila «**Lockup**», columna «**One-time** cobrado», «Target» en la pestaña de destinos. «Identidad del producto» es una lista de 9 pares con 500 px entre etiqueta y valor. «Distribución de tenants» deja 200 px vacíos. | T7: «Destinos», «Nombre con marca», «Cobros únicos», «Destino». La identidad pasa a una grilla de 3 columnas de pares compactos. La distribución va como barra apilada de una línea dentro de la `SummaryBar`. | P2 |
| Diálogo «Emitir factura» | El botón **primario** es «Cerrar». El buscador y el `select` son redundantes. | Primario «Emitir factura», desactivado hasta elegir; secundario «Cancelar». Un único combobox con búsqueda. | P2 |

### 3.5 Finanzas

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| Cobranza › Por cobrar | El resumen va en texto pequeño («Saldo por cobrar / Vencido») en lugar de cifras. El número de factura se trunca (`INV-202609-V3-EC-USD-…`). «de USD 1,800.00» repite el saldo. La acción por fila no se ve: la columna «Acciones» está vacía hasta el hover. | `StatStrip` por **tramo de antigüedad** (1–30 · 31–60 · 61–90 · > 90, con monto y n.º; `receivables_aging`) que filtra. Factura en 2 líneas (número completo con `break-all` en mono pequeño y el período). «de X» solo si el saldo es menor que el total. Botón secundario visible «Gestionar» en la fila (la acción principal de esta bandeja). | P1 |
| Cobranza › Facturación y cobros | 4 KPI con «USD 0» y «Sin datos» por falta de tasa. «¿Cómo entra la caja?» es una tarjeta vacía de 200 px. Hay un tercer nivel de pestañas (Facturas / Cobros confirmados). | Montos nativos si no hay tasa (igual que Resumen). La tarjeta vacía se pliega a una línea. Facturas y Cobros pasan a un control segmentado. | P2 |
| Cobranza › Renovaciones | Las acciones secundarias («Recalcular alertas», «Ejecutar cobros pendientes», «Más acciones») quedan sueltas bajo la descripción. Hay un banner de 2 líneas con «Control Plane». El título y la descripción de la tarjeta repiten la pestaña. | Las acciones van al slot de la cabecera (T1), en un menú «Acciones de cobranza». El banner pasa a `InfoHint` y «Control Plane» → «Admin Maestro». `StatStrip`. | P2 |
| Cobranza › Conciliación | Fechas ISO en el detalle («Emitida el 2026-09-01»). «**Webhooks** rechazados». 3 niveles de pestañas. Banner «Sólo diagnóstico». | `formatDate` (T9). «Avisos del proveedor rechazados». Las sub-pestañas pasan a un segmentado. El banner va al `InfoHint`. | P2 |
| Comisiones | La descripción ocupa 3 líneas. «+ Generar liquidación» es el único botón primario con icono de la consola. El gráfico vacío ocupa 180 px. | T1. Iconos en botones primarios: todos o ninguno (se decide **ninguno**, salvo exportar o descargar). Un estado vacío del gráfico de 1 línea. | P3 |
| Costos y margen | Tooltip con `v_collected_revenue` y «(K05)». «Margen gerencial **+100 %** vs setiembre» cuando los dos meses son 0 (variación engañosa). Un banner largo bajo el gráfico. | T7 sobre `info` (texto de negocio). La variación se oculta si la base es 0 (`KpiDelta` → «sin base»). El banner pasa a `InfoHint`. | P2 |
| Tarifas de partners | «Período», «Calcular» y «Calcular todos» quedan sueltos bajo la descripción, y el primario es «Calcular todos». Con 0 estados de cuenta se ven igual 4 KPI «Sin datos». | Los controles van al slot de acciones (el período como selector compacto). Si el período está vacío: **un** estado vacío con «Configurar tarifa en la ficha del partner» (enlace) en lugar de 4 KPI vacíos. | P2 |

### 3.6 Gobierno

| Pantalla | Problema | Cambio propuesto (datos) | P |
|---|---|---|---|
| Usuarios y accesos | 4 KPI grandes para 3 usuarios. La columna «Apps» dice «Sin apps» en todas las filas. | `StatStrip` de 4 celdas en una banda. La columna «Apps» se oculta si nadie tiene apps (o dice «—» con un `InfoHint` «el canal de usuarios por app aún no existe»). | P3 |
| Ficha de usuario | Abre en un formulario editable; no hay resumen. Tiene 7 pestañas. | `SummaryBar`: Rol de consola · Organizaciones · Apps · Último ingreso · Estado. «Perfil» se edita con un botón «Editar». Se agrupan las pestañas «Rol de consola» y «Organizaciones» → «Accesos». | P2 |
| Auditoría | Títulos con el código crudo (`SAAS_PROVISIONING_REQUESTED`). La entidad aparece como fragmento de UUID («Tenant c8bb9b80…»). Cada fila repite el código (`TENANT_STATUS_CHANGED`). La descripción dice «enforcement está en los GRANT». | Completar `auditActions.ts` (todas las acciones con etiqueta). La entidad se muestra por nombre cuando está en caché (tenants, organizaciones) y, si no, como tipo + «ver»; el código pasa al detalle. Descripción: «La bitácora no se puede editar ni borrar». (`audit_logs`, `v_commercial_audit_log`). | P1 |
| Configuración › General | 2 niveles de pestañas («General» › Apariencia, Mi perfil…). | El segundo nivel pasa a una navegación lateral dentro del panel (lista vertical a ≥1024 px). | P3 |
| Configuración › Créditos IA | «ledger», «pool», «(D-03)». Tres niveles de pestañas. 4 KPI «Sin datos». | T5/T7. El segundo nivel pasa a un segmentado. Con todo vacío: un estado vacío único. | P2 |
| Configuración › Monedas | Pestaña llamada «Monedas y FX» en el `h2`; textos en tooltip truncados. | «Monedas y tipo de cambio» en todos los textos. | P3 |
| Configuración › Avanzado | «Eje BILLING», «Biller local», «MasterAdmin», «legacy». Es la zona del super admin. | Se permite lo técnico (regla 10), pero con mayúsculas de negocio («Eje de cobro») y el `CompactStepper`. | P3 |

### 3.7 Móvil (390 px), en todas las pantallas

| Problema | Cambio | P |
|---|---|---|
| Las pilas de KPI a 1 columna llenan la primera pantalla (Tenants, Apps, Integraciones, Usuarios, Catálogo). | `StatStrip` a 2 columnas (T2). | P1 |
| La descripción de 3–4 líneas, la acción a ancho completo y los filtros en 2 renglones dejan el primer dato por debajo de los 580 px. | T1: descripción en `InfoHint` y acción en la cabecera; `StatusTabs` como `select` por debajo de `sm`. | P1 |
| Solo 4 de 71 tablas pasan a tarjetas: el resto hace scroll horizontal. | T4(a). | P2 |
| Bandeja: 7.137 px de alto; Entornos: 9.913 px. | Filas compactas y tablas plegadas (3.1, 3.3). | P2 |

## 4. Fases de ejecución

Cada fase es una sesión de agente de 6 a 15 commits, con los 4 gates antes de cada commit y capturas antes/después.
**F1 va primero y sola** (crea los componentes compartidos). Después, **F2, F3 y F4 pueden ir en paralelo**, porque
tocan carpetas distintas; F5 cierra. Regla anti-conflicto: las fases 2–4 **no editan** `src/components/ui/*`,
`src/lib/glossary.ts`, `src/app/navigation.ts` ni `src/services/queries.ts`. Las consultas nuevas van en un archivo
`src/features/<área>/<área>Queries.ts` propio. Si una fase necesita un cambio en un componente compartido, lo anota
para F5.

### F1 · Base V6 + Cuentas + Integraciones (impacto más visible) — unos 14 commits

- T1: cabecera única de los hubs, con el slot de acciones y el `InfoHint`; descripciones de `navigation.ts` en una
  línea.
- T2: `StatStrip`; `KpiStrip` movido a `ui` y convertido en alias (todas las franjas existentes se compactan de
  una vez).
- T3: `TabStrip` alineado a la izquierda (más la entrada en `docs/nightly/DECISIONS.md`).
- T4: `DataTable` con `mobileCards` por defecto, columnas `width/truncate/sticky/sortable` y `cells.tsx`
  (`CellTitle`, `MoneyCell`, `AppChips`, `StatusCell`).
- T5: `EmptyState` con sus variantes y el buscador oculto cuando el conjunto está vacío.
- T6: `CompactStepper`.
- T7: glosario V6: lista negra, props `info/footer` y etapas de migración.
- T10: menú lateral sin doble activo.
- **Cuentas › Clientes y Todas las organizaciones** completas (3.2), con el modelo puro
  `accountListModel.ts` y sus tests.
- **Apps › Integraciones** como lista compacta (3.3).
- **Archivos:**
  - `src/components/ui/{primitives.tsx, SectionTabs.tsx, pageTrail.ts, MobileCards.tsx, tableCards.ts}`;
  - nuevos `src/components/ui/{StatStrip.tsx, Stepper.tsx, cells.tsx, InfoHint.tsx}`;
  - `src/features/hubs/HubPage.tsx`, `src/app/{navigation.ts, AppShell.tsx}`, `src/features/billing/financeUi.tsx`;
  - `src/lib/glossary.ts` (+ test), `docs/design/GLOSARIO_V6.md`;
  - `src/features/organizations/{OrganizationsPage.tsx, CustomersPage.tsx}`, nuevos
    `organizations/{accountListModel.ts, accountListQueries.ts}`;
  - `src/features/platform/{IntegrationsPage.tsx, CutoverStepper.tsx, cutover.ts}`.

### F2 · Suite y Clientes (resto) — unos 12 commits

- Centro de la suite: franja compacta, matriz arriba y encabezados con `AppChip`.
- Ciclo de vida.
- Tenants.
- Apps › Altas, Módulos habilitados, Uso (segmentado), Entornos (plegado), Infraestructura.
- Ficha de app y ficha de integración (`SummaryBar`, stepper).
- Partners, Equipo comercial, Atribuciones.
- Diálogo «Nuevo cliente / partner».
- **Archivos:**
  - `src/features/suite/*`, `src/features/tenants/TenantsPage.tsx`;
  - `src/features/deployments/{SaasProvisioningPage, DeploymentsPage, ProvisioningPage}.tsx`;
  - `src/features/commercial/sync/*`, `src/features/usage/*`;
  - `src/features/platform/{IntegrationDetailPage.tsx, IntegrationDialogs.tsx, EnvironmentHealth.tsx}`;
  - `src/features/organizations/{PartnersPage.tsx, OrganizationFormDialog.tsx}`;
  - `src/features/commercial/{SalesAgentsPage, AttributionsPage}.tsx`.

### F3 · Finanzas y Comercial (listados) — unos 13 commits

- Bandeja.
- Cobranza (las 4 pestañas).
- Comisiones y Planes de comisión.
- Costos y margen.
- Tarifas de partners.
- Contratos (listado).
- Catálogo: Productos, Planes, Add-ons, Capacidades, Registro.
- Diálogo «Emitir factura».
- Nueva venta: solo la línea redundante.
- **Archivos:**
  - `src/features/inbox/*`;
  - `src/features/billing/{CollectionsInboxPage, BillingPage, RenewalsPage, ReconciliationPage, CostsPage, SubscriptionsPage, IssueInvoiceDialog, financeCharts, lazyFinanceCharts, listing}.tsx`;
  - `src/features/commercial/{CommissionsPage, CommissionPlansPage, SettlementsSection}.tsx`;
  - `src/features/partnerFees/*`;
  - `src/features/catalog/{ProductsPage, PlansPage, AddonsPage, FeatureFlagsPage}.tsx`,
    `src/features/commercial/capabilities/*`;
  - `src/features/onboarding/OnboardingWizardParts.tsx`.

### F4 · Fichas 360, Resumen ejecutivo y Gobierno — unos 12 commits

- Cuenta 360: quitar los KPI duplicados y añadir `AppChip`.
- Tenant 360: `SummaryBar` y dimensiones compactas.
- Contrato 360: `SummaryBar` y plurales.
- Producto 360: términos, identidad en grilla y distribución.
- Usuario: `SummaryBar` y «Editar».
- Resumen ejecutivo:
  - montos nativos sin tasa;
  - barra de filtros única;
  - tarjeta del puente plegada;
  - dominio del eje;
  - fin del aviso de Recharts (T11).
- Auditoría: etiquetas y nombres de entidad.
- Configuración: General, Créditos IA, Monedas, Avanzado.
- **Archivos:**
  - `src/features/organizations/{Account360, AccountPanels, Organization360, OrganizationDetailPage}.tsx`;
  - `src/features/tenants/{TenantDetailPage, TenantHeader}.tsx`;
  - `src/features/billing/SubscriptionDetailPage.tsx`, `src/features/catalog/ProductDetailPage.tsx`;
  - `src/features/users/*`;
  - `src/features/dashboard/*`, `src/features/executive/components/*`;
  - `src/features/settings/{AuditPage, AuditTimeline, auditActions, auditFormat, SettingsPage}.ts(x)`;
  - `src/features/credits/*`, `src/features/regional/*`, `src/features/billing/shadow/*`.

### F5 · Móvil, guardas visuales y cierre — unos 8 commits

- **Pase móvil:**
  - `StatusTabs` como `select` por debajo de `sm`;
  - filtros del Resumen en un botón;
  - revisión de las tarjetas móviles de las 71 tablas.
- **Guarda automática** `e2e/visual/solapes.spec.ts`: recorre las rutas del menú a 1280 y 390 y falla si dos
  textos visibles se intersectan o si un título visible queda truncado sin `title`. Generaliza
  `desbordes.spec.ts`.
- Lo pendiente que F2–F4 anotaron para `src/components/ui/*`.
- Capturas en claro y oscuro.
- Actualizar `VISUAL_SYSTEM_V2.md` (§5.6 KPI/`StatStrip`, §5.7 tabla, §5.8 pestañas a la izquierda, §5.13 cabecera).
- **Archivos:** `src/components/ui/*`, `e2e/visual/*`, `docs/design/VISUAL_SYSTEM_V2.md`, `docs/nightly/DECISIONS.md`.

**Orden por impacto visual:** F1 (las dos pantallas que señaló el dueño, más todas las franjas y cabeceras), luego
F2 ∥ F3 ∥ F4, y al final F5.
Si solo cabe una fase en paralelo, la prioridad es F3 (Bandeja y Cobranza se ven en la demo de gerencia), después
F2 y luego F4.

## 5. Lo que necesitaría backend (aparte)

Ninguna fase depende de esto: todo lo de las secciones 2–4 usa tablas, vistas y RPC que ya existen.
Esto haría las pantallas más rápidas y completas:

1. **Vista de resumen por cuenta** (`v_account_summary`): MRR por moneda, saldo vencido por moneda y días de la
   factura más antigua, apps activas y sin alta, salud de cobranza, responsable vigente y último cobro, por
   `organization_id` y con RLS.
   F1 lo calcula en el cliente con 4 consultas (`v_tenant_overview`, `v_invoice_balances`, `v_renewal_pipeline`,
   `sales_attributions`). Funciona con decenas o cientos de cuentas; con miles hará falta paginar y ordenar en el
   servidor.
2. **Tasas de cambio BOB y PEN → USD en QAS** (es un dato, no una migración: se registra desde Configuración ›
   Monedas con `set_exchange_rate`). Sin ellas, Resumen, Facturación y Costos muestran «Sin datos» o «USD 0».
   La V6 mostrará montos nativos, pero el consolidado necesita la tasa.
3. **Auditoría con nombre de entidad** (`entity_label` en `audit_logs` o una vista `v_audit_log_display`): hoy solo
   hay un UUID y la UI solo puede resolver los nombres que tiene en caché.
4. **Canal de usuarios por app (SSO):** sin él, la columna «Apps» de Usuarios y la pestaña «Apps y accesos» quedan
   vacías. Es la brecha conocida de la V5 · F6.
5. **Canales de módulos, uso y suspensión por app:** el Centro de la suite y la ficha de app dirán «no activo» en las
   8 apps hasta que existan. La V6 lo resume en una línea en lugar de repetirlo 32 veces.
6. **Alta registrada en las apps:** muchos tenants figuran como «Sin alta» (registro histórico incompleto). Es
   operativo o de datos, no de UI.
7. **Ordenar y paginar en el servidor** Tenants, Contratos y Cuentas cuando superen unos 500 registros (hoy el
   orden y la paginación son en cliente).

## 6. Métricas de éxito V6

| Métrica | Hoy | Meta |
|---|---|---|
| Columnas de negocio en Cuentas a 1440 | 5 (2 de identificación) | 8–9 (MRR, vencido, salud, apps, responsable) |
| Distancia título → acción primaria en los hubs | ≈ 150 px y otra fila | la misma fila |
| Párrafos de descripción repetidos en los hubs | 25 pestañas | 0 |
| Alto de la franja de KPIs | 120–148 px (más de 600 px en móvil) | ≈ 72 px (≈ 150 px en móvil, 2 columnas) |
| Textos encimados detectados | stepper en 10 tarjetas + ficha | 0 (guarda e2e) |
| Alto de fila máx. en listados | 98 px (Planes), 64 px (Tenants) | ≤ 52 px |
| Niveles de pestañas | hasta 3 | 1 + segmentado |
| Tablas con tarjetas en móvil | 4 / 71 | todas las de listado |
| Términos técnicos nuevos en la UI de negocio | ≈ 15 términos | 0 fuera de «Avanzado» |
| Errores o avisos de consola | 1 aviso (Recharts) | 0 |
