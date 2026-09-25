# EBIM MasterAdmin | Auditoría de experiencia y propuesta ejecutiva

**Fecha de referencia:** 24 de septiembre de 2026.  
**Estado:** análisis de fuentes y propuesta de diseño, pendiente de aprobación. No es una implementación ni una certificación de la versión desplegada.

## 1. Dictamen

MasterAdmin dispone de una base de control comercial y de provisioning considerable. El siguiente salto no consiste en añadir decoración: consiste en convertir los datos existentes en decisiones confiables, una operación administrativa clara y una experiencia coherente para dirección, finanzas, comerciales y operaciones.

La recomendación es evolucionar el sistema actual, conservando React, Tailwind, los tokens EBIM, las RPC de negocio, la seguridad y las ocho integraciones. Un cambio solo cosmético conservaría problemas de totales y significado; una reescritura completa agregaría riesgo sin ser necesaria.

## 2. Alcance y evidencia

Se inspeccionó estáticamente el ZIP recibido: 484 archivos, 108 archivos TS/TSX dentro de src, 32 componentes *Page.tsx, 25 entradas de navegación y 45 migraciones SQL. Las 32 páginas incluyen wrappers, login y no-encontrado; no equivalen a 32 módulos comerciales independientes.

Se revisaron estructura, dependencias, rutas, componentes, tokens, hooks, consultas, mutaciones, modelos, SQL y documentos de arquitectura/operación. No se inició sesión en QAS, no se ejecutaron llamadas de negocio, no se instalaron dependencias, no se levantó la aplicación y no se repitieron tests. Las observaciones de layout son de código; su apariencia renderizada queda pendiente de validación en navegador. No se modificó el código del producto.

El resultado 8/8 de provisioning procede del historial y las actas de certificación aportadas. No equivale a volver a certificar ocho runtimes durante esta auditoría.

**Archivo auditado:** `AdminMaestro-dev (2).zip`  
**SHA-256:** `54023a54367d64f772a3a6836368b699d00681efb752af5c8b23ea7b38ad1132`

## 3. Recap funcional: lo construido y lo que no debe confundirse

- Plataforma: productos, planes, organizaciones, sociedades, partners, clientes, tenants, capacidades, atribuciones y roles.
- Comercial y finanzas: suscripciones e ítems, cadencias, cobros, documentos OS/OC, renovaciones, alertas, comisiones, costos y margen gerencial.
- Multimoneda: separación nativa y consolidación con FX explícito y cobertura incompleta identificada.
- Operación SaaS: integraciones, perfiles de credencial, destinos, solicitudes, mappings, auditoría, adaptador EWM_V1 y GENERIC.
- Certificación reportada: EWM, eSupplier, TMS, Comerza, eChange, eExpense, eCommerce y GMAO. PREPROVISIONED no significa usuario con acceso; PENDING comercial no invalida mapping ACTIVE.

No considerar terminados por esta certificación: SSO, activación del administrador, suspensión remota homogénea, cobro comercial productivo, analítica histórica completa o todos los CRUD administrativos.

## 4. Hallazgos priorizados

P0 significa corrección/validación necesaria para confiar en datos o acciones antes de la nueva demo; P1 es mejora principal de experiencia; P2 es optimización posterior. Una hipótesis no es una vulnerabilidad confirmada.

### E01 | P1 | Inicio saturado y sin analítica temporal

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** Dashboard EBIM presenta doce StatCard y a continuación RegionalFinancePanel agrega seis indicadores y margen: diecinueve tarjetas. No encontré visualizaciones temporales ni una librería de gráficos en package.json.

**Impacto:** La gerencia debe interpretar muchas cifras sin una pregunta principal, variación ni siguiente acción. No se propone eliminar información: se propone jerarquizarla.

**Recomendación:** Seis indicadores principales, detalle financiero en una pestaña y una matriz operativa de productos separada. Todo indicador debe abrir el detalle que lo explica.

**Fuentes:** `src/features/dashboard/DashboardPage.tsx:40-111`; `src/features/dashboard/RegionalFinancePanel.tsx:23-48`; `src/features/dashboard/RegionalFinancePanel.tsx:137-152`.

### E02 | P0 | Totales y búsquedas limitados a un subconjunto

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** useInvoices y useCostEntries limitan la descarga a 200; useCommissionEvents a 300. BillingPage, CostsPage y CommissionsPage suman los arrays descargados. El componente DataTable no pagina ni consulta el total.

**Impacto:** Un resumen aparentemente global puede representar solo los registros recientes. La búsqueda tampoco encuentra necesariamente lo que quedó fuera del lote. La vista 360 hereda parte de este problema.

**Recomendación:** Separar consultas agregadas autorizadas en servidor de detalle paginado; aplicar alcance y filtros equivalentes; rotular período y universo. Probar con más de 200 y 300 registros y pagos parciales.

**Fuentes:** `src/services/queries.ts:514-526`; `src/services/queries.ts:596-607`; `src/services/queries.ts:672-685`; `src/features/billing/BillingPage.tsx:34-49`; `src/features/billing/CostsPage.tsx:23-34`; `src/features/commercial/CommissionsPage.tsx:37-47`.

### E03 | P0 | Período financiero no expuesto por el hook

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** finance_consolidated acepta p_period_start y p_period_end. FinanceConsolidatedParams y la invocación del frontend no los incluyen. Fecha de las tasas corresponde al tipo de cambio, no al período de operaciones.

**Impacto:** No se puede presentar comparación mensual fiable usando solo la fecha de FX. En la interfaz actual existe una base financiera aprovechable, no una ausencia completa de backend analítico.

**Recomendación:** Distinguir período transaccional, fecha de valuación FX y métricas snapshot. Conectar parámetros existentes sin cambiar la firma usada por otros consumidores.

**Fuentes:** `src/services/queries.ts:275-303`; `src/features/dashboard/RegionalFinancePanel.tsx:75-101`; `supabase/migrations/20260913000800_v3_consolidated_finance.sql:581-616`.

### E04 | P0 | Fallas técnicas de distinta capa

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** dashboard_summary calcula provisioning_failures desde platform.provisioning_requests. La nueva administración SaaS tiene saas_provisioning_requests y mappings propios.

**Impacto:** Un contador de infraestructura no representa todas las fallas de alta SaaS. Un producto ACTIVE del catálogo tampoco equivale a un producto certificado y saludable.

**Recomendación:** Separar infraestructura, integración SaaS, comercial y acceso del administrador. No inferir certificación de ACTIVE ni HEALTHY de enabled.

**Fuentes:** `supabase/migrations/20260913000800_v3_consolidated_finance.sql:344-365`; `supabase/migrations/20260913000800_v3_consolidated_finance.sql:381-393`; `src/features/dashboard/DashboardPage.tsx:62-79`.

### E05 | P1 | No hay serie mensual de MRR

**Clasificación:** LIMITACION DOCUMENTADA.

**Evidencia:** El documento de costos y margen reconoce que MRR procede de ítems vigentes y que no hay snapshot mensual para reconstruir seis meses. v_finance_facts fecha esa métrica con current_date.

**Impacto:** No se deben inventar curvas históricas de MRR, churn o NRR a partir del valor actual. Los cobros sí tienen fecha de hecho.

**Recomendación:** Mostrar MRR actual por producto; tendencias sobre pagos confirmados. Diseñar snapshots o reconstrucción de eventos en una fase analítica separada, mostrando desde cuándo existe cobertura.

**Fuentes:** `docs/finance/COST_MARGIN_MODEL.md:117-127`; `supabase/migrations/20260913000800_v3_consolidated_finance.sql:399-455`.

### E06 | P1 | Tablas sin infraestructura reutilizable de operación

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** DataTable recibe títulos y children. No incorpora ordenación, paginación, contador total, selección de columnas ni exportación. Mantiene overflow horizontal, que sí es una base útil.

**Impacto:** Las pantallas repiten detalles de filas y cada una crece de forma diferente. A escala, datos y acciones quedan difíciles de explorar.

**Recomendación:** Evolución compatible del componente con columnas tipadas, orden, páginas y detalle. Mantener buscador general y tabs de estado; respetar las convenciones de filtros del proyecto.

**Fuentes:** `src/components/ui/primitives.tsx:207-233`; `docs/architecture/EBIM_CONVENTIONS.md:61-77`.

### E07 | P1 | Variante de botón inexistente

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** Hay siete referencias a ebim-btn-secondary en componentes de integraciones, tenants y provisioning. No existe su definición en index.css ni tokens.css.

**Impacto:** Acciones importantes no reciben una variante visual centralizada consistente.

**Recomendación:** Resolver la variante en el sistema de botones y cubrir todos sus usos; no arreglar cada pantalla con estilos independientes.

**Fuentes:** `src/app/index.css:62-83`; `src/features/deployments/SaasProvisioningPage.tsx:285-298`; `src/features/tenants/TenantDetailPage.tsx:317-327`.

### E08 | P1 | Contraste insuficiente en variantes activas

**Clasificación:** CALCULO SOBRE TOKENS.

**Evidencia:** El botón primario usa fondo #5AA97F y texto blanco: contraste calculado 2.832:1. En oscuro, danger #B42318 sobre #2E1513 da 2.591:1 e info #0B6B8F sobre #10262F da 2.622:1.

**Impacto:** Parte del texto funcional no alcanza la referencia AA de texto normal (4.5:1). Es una medición de colores declarados, no una auditoría completa renderizada.

**Recomendación:** Conservar colores de marca y crear variantes funcionales accesibles. Verificar light/dark, hover, disabled, foco, badges y gráficos; no depender solo del color.

**Fuentes:** `src/app/tokens.css:13-44`; `src/app/tokens.css:57-76`; `src/app/index.css:63-78`.

### E09 | P1 | Modales y pestañas: semántica sin ciclo completo de teclado

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** Los diálogos enfocan un control y gestionan Escape; no implementan confinamiento Tab/Shift+Tab, retorno de foco ni fondo inert. ConfirmDialog tampoco recibe busy y enfoca la confirmación. SectionTabs declara roles, pero no implementa flechas y foco itinerante.

**Impacto:** La documentación de los propios componentes afirma un bloqueo de foco que no se ve implementado. Requiere verificación manual y automatizada en navegador.

**Recomendación:** Componente accesible común, foco restaurado, acción peligrosa protegida, estado pendiente, teclado completo. Evitar dobles envíos y pérdida de formulario.

**Fuentes:** `src/components/ui/ConfirmDialog.tsx:1-69`; `src/components/ui/FormDialog.tsx:39-60`; `src/components/ui/SectionTabs.tsx:46-90`.

### E10 | P1 | Apariencia local no compartida

**Clasificación:** CONFIRMADO EN FUENTE / HIPOTESIS DE SINCRONIA.

**Evidencia:** useAppearance persiste en localStorage; su comentario anuncia profiles.settings.appearance, pero el hook no lo usa. AppShell y SettingsPage instancian el hook por separado.

**Impacto:** La persistencia entre dispositivos no está implementada aquí. Debe probarse si selectores y modo muestran estados inconsistentes entre instancias.

**Recomendación:** Una fuente de estado compartida y alcance por usuario; hidratación sin flash; sincronización entre dispositivos solo si existe contrato y permiso real para el perfil.

**Fuentes:** `src/hooks/useAppearance.ts:1-66`; `src/app/AppShell.tsx:15-23`; `src/features/settings/SettingsPage.tsx:14-22`.

### E11 | P0 | Aislamiento de caché al cambiar sesión

**Clasificación:** HIPOTESIS A VALIDAR, NO EXPLOTACION DEMOSTRADA.

**Evidencia:** QueryClient vive a nivel de módulo. signOut no cancela ni vacía la caché y numerosas claves de consulta no incluyen identidad o contexto. No se encontró clear/removeQueries en src.

**Impacto:** Debe probarse que cambiar de superadmin a un usuario de otro alcance en el mismo navegador no muestre datos previos mientras refresca. RLS de base de datos no equivale por sí sola a invalidación de memoria cliente.

**Recomendación:** Caso de regresión con dos sesiones y roles; cancelar consultas pendientes y segmentar/limpiar caché conforme al ciclo real de autenticación. No cambiar roles ni RLS para resolverlo.

**Fuentes:** `src/app/App.tsx:46-65`; `src/features/auth/AuthContext.tsx:11-22`; `src/features/auth/AuthContext.tsx:57-69`; `src/services/queries.ts:514-526`.

### E12 | P1 | Navegación técnica y extensa

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** navigation.ts declara 25 entradas en seis grupos. AppShell imprime location.pathname en el encabezado. Se mezclan vocabularios como Tenancy, deployments, feature flags y descripciones SQL con lenguaje comercial.

**Impacto:** Un ejecutivo necesita pensar en clientes, ingresos, riesgo y continuidad, no en tablas y rutas. La estructura actual se puede reorganizar sin cambiar URLs.

**Recomendación:** Inicio ejecutivo; Clientes y canales; Productos y contratos; Finanzas; Operación SaaS; Gobierno. Grupos plegables, breadcrumbs humanos y herramientas técnicas en segundo nivel.

**Fuentes:** `src/app/navigation.ts:32-69`; `src/app/AppShell.tsx:103-118`.

### E13 | P1 | Capacidades administrativas no conectadas

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** Diez hooks de mutación exportados no tienen referencias fuera de mutations.ts: catálogo de features, sociedades, update tenant, feature tenant, liquidaciones, fin de ítem, proveedor de pago, expiración de documentos, reversión de pago y roles de provisioning.

**Impacto:** Tener una RPC/hook no prueba que exista una operación administrativa completa en UI. Tampoco habilita a exponer operaciones financieras o roles sin análisis de permisos.

**Recomendación:** Priorizar sociedades/features y cierre de flujos ya soportados; separar operaciones de dinero, suspensión y seguridad para revisión funcional y pruebas dedicadas.

**Fuentes:** `src/services/mutations.ts:77-103`; `src/services/mutations.ts:190-223`; `src/services/mutations.ts:285-298`; `src/services/mutations.ts:403-418`.

### E14 | P1 | Recuperar clave y solicitar acceso no completan un flujo

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** LoginPage apunta a #recuperar y #solicitar. No se encontró el flujo correspondiente enlazado a esas acciones en el código de src.

**Impacto:** La pantalla promete acciones que no terminan una tarea del usuario.

**Recomendación:** Resolver destino real existente o declarar indisponibilidad; no crear un flujo nuevo de Auth sin permisos, controles anti-abuso y diseño explícito.

**Fuentes:** `src/features/auth/LoginPage.tsx:240-249`; `src/features/auth/LoginPage.tsx:268-278`.

### E15 | P0 | Separar promesas comerciales y ejecución remota

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** TenantDetail muestra Tenant suspendido/reactivado y aclara en texto secundario que encoló DRY_RUN. Onboarding fuerza DRY_RUN y explica que el alta SaaS es independiente, con enlace genérico a /saas-provisioning.

**Impacto:** No presentar una suspensión del registro comercial como cierre de acceso en ocho SaaS. El nuevo diseño debe conservar esta frontera y hacerla más legible.

**Recomendación:** Resumen de cuatro estados, timeline y acciones disponibles por capacidad. Llevar el contexto del cliente/tenant al paso SaaS, sin auto-PROVISION ni activación de Auth.

**Fuentes:** `src/features/tenants/TenantDetailPage.tsx:54-77`; `src/features/onboarding/OnboardingPage.tsx:319-334`; `src/features/onboarding/OnboardingPage.tsx:700-744`.

### E16 | P1 | Vista 360 valiosa pero compuesta por lecturas generales

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** Organization360 combina nueve consultas y filtra en cliente las facturas, tenants, comisiones, documentos y renovaciones. loading cubre solo parte de ellas; no hay ErrorState dentro de ese componente.

**Impacto:** Puede crecer el costo de lectura y mostrarse vacío o cero cuando una fuente secundaria falló. No debe confundirse error con falta de movimiento.

**Recomendación:** Consultas por organización desde servidor, estado por sección, total sin límite de detalle, contexto comercial y técnico unificado.

**Fuentes:** `src/features/organizations/Organization360.tsx:34-102`.

### E17 | P1 | Auditoría y documentos poco orientados al operador

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** AuditPage muestra JSON.stringify(metadata) en una celda y la consulta limita a 200. ReceiveDocumentDialog pide una referencia external_file_ref; no es una carga de archivo.

**Impacto:** La investigación de cambios y la operación documental necesitan mejor presentación. No vender ese campo como gestión documental completa.

**Recomendación:** Visor antes/después legible, actor, entidad, correlación y paginación. En documentos, primero clarificar referencia; upload/preview requiere un alcance de Storage separado.

**Fuentes:** `src/features/settings/AuditPage.tsx:22-58`; `src/services/queries.ts:729-743`; `src/features/billing/CollectionDialogs.tsx:445-456`.

### E18 | P1 | Salud de integraciones mezcla destinos

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** IntegrationsPage calcula la peor salud entre todos los targets relacionados, sin filtrar ahí por ambiente/habilitación. No basta para comunicar salud fresca de un QAS concreto.

**Impacto:** Un destino sin configuración o antiguo puede contaminar el resumen. HEALTHY describe una comprobación, no un SLA medido.

**Recomendación:** Elegir entorno, mostrar fecha de observación, pendiente/desconocido/desactualizado y detalle por deployment. No prometer uptime histórico sin telemetría.

**Fuentes:** `src/features/platform/IntegrationsPage.tsx:92-131`; `src/features/platform/IntegrationsPage.tsx:173-181`.

### E19 | P2 | Carga y organización de frontend

**Clasificación:** CONFIRMADO EN FUENTE.

**Evidencia:** App.tsx importa estáticamente las páginas. Hay páginas extensas (Onboarding 793 líneas, IntegrationDetail 634, SubscriptionDetail 531).

**Impacto:** La ampliación debe reducir riesgo de cambios simultáneos y evitar cargar toda la consola para una pantalla. No se midió el bundle ejecutado.

**Recomendación:** División por secciones y carga diferida donde la medición lo justifique, sin reescribir la arquitectura ni cambiar dependencias mayores.

**Fuentes:** `src/app/App.tsx:1-44`.

### E20 | P0/P1 | La auditoría visual nocturna necesita pruebas específicas

**Clasificación:** COBERTURA POR DEFINIR.

**Evidencia:** El proyecto trae tests funcionales y Playwright con Desktop Chrome. No encontré una matriz de screenshots por viewport/tema ni suite de accesibilidad en ese config.

**Impacto:** Los tests de negocio previos no demuestran que el nuevo layout sea usable en móvil, teclado o modo oscuro. El reporte previo mantiene pendiente 24_secret_key_rule.test.sql.

**Recomendación:** Capturas antes/después en 1440,1280,768 y390px; light/dark; roles; carga/error/vacío/muchos registros; regresión de cifras y contratos. Medir, no marcar PASS por el historial.

**Fuentes:** `playwright.config.ts:1-29`; `src/app/App.tsx:46-55`.

## 5. Modelo de experiencia propuesto

### Inicio ejecutivo

Una vista predeterminada para la dirección, sin crear un rol nuevo que salte permisos: seis KPI máximos en primer nivel, tendencias disponibles, cartera/riesgo y acciones pendientes. Alternar perspectivas Ejecutivo, Finanzas y Operación SaaS reutilizando autorización existente; partner y comercial conservan su alcance restringido.

Secciones sugeridas: resumen, cobros por mes, MRR actual por producto, cartera vencida, renovaciones y matriz de integraciones. No colocar todos los gráficos en la primera pantalla. Cualquier cifra abre una tabla o ficha filtrada y reconciliable.

### Navegación

Organizar sin cambiar contratos de URL: Inicio; Clientes y canales; Productos y contratos; Finanzas; Operación SaaS; Gobierno. Reducir duplicación perceptiva entre clientes/partners/organizaciones usando subniveles. Mantener la identidad EBIM y los permisos del backend.

### Cliente 360 y tenant 360

La ficha debe responder quién es el cliente, qué contrató, cuánto paga, qué debe, cuándo renueva, qué productos funcionan y quién tiene acceso. Mostrar por separado cuatro dimensiones: comercial, provisión técnica, salud observada y activación del administrador.

Para la demo certificada: comercial PENDING/SANDBOX, solicitud ACTIVE, mapping ACTIVE, administrador PREPROVISIONED y MRR cero deben poder convivir sin un semáforo global engañoso.

### Sistema visual

Mantener DM Sans, verde EBIM #5AA97F, teal #056769 e isotipo #0A5A52. Usar variantes accesibles para texto/botones, neutrales para superficies, semánticos por estado y una sola familia de iconos. Conservar modo claro/oscuro y las tres densidades contractuales. No introducir un selector libre de paletas ni un tercer tratamiento arbitrario del topbar.

Jerarquía: título y breadcrumb humanos, acción primaria única, acciones secundarias agrupadas, KPI contextual, contenido y detalle. Listados con buscador general y tabs; los filtros por período/moneda pertenecen a analítica. No transformar cada CRUD en un panel de muchos selects.

Tablas con cifras alineadas, código de moneda visible, páginas y total. Formularios con agrupación, validación por campo, resumen y guardado persistente; modales accesibles y sin dobles envíos. Gráficos con leyendas legibles, alternativa tabular y sin 3D.

## 6. Contrato de indicadores para gerencia

Cada métrica necesita nombre, fórmula, fuente, granularidad, fecha/período, moneda, estados incluidos/excluidos, tratamiento demo/test, permisos, nulos y enlace a detalle. No aprobar una tarjeta si no se puede reconciliar con la tabla fuente.

| Indicador | Evidencia disponible | Representación propuesta | Condiciones |
|---|---|---|---|
| MRR actual | v_subscription_mrr y finance_consolidated | Valor actual y barras por producto | No es cobro; separar moneda; respetar ítems/estados vigentes y exclusiones documentadas. |
| ARR estimado | MRR normalizado existente | Dato secundario en finanzas | Proyección anual, no ingreso realizado. |
| Cobrado del período | v_collected_revenue / payments confirmados | Serie mensual y barras por producto/canal | Excluir DRAFT/VOID; conciliar pagos parciales/reversos y conversión. |
| Facturado y saldo | Facturas y aplicaciones de pago | Comparación y cartera por antigúedad | Distinguir emitido, cobrado, saldo y vencimiento; consulta agregada no truncada. |
| Margen gerencial | v_product_margin / v_partner_margin / v_tenant_margin | Ranking y desglose de componentes | Fórmula vigente: cobrado menos costo directo menos comisión. No llamarlo utilidad neta o EBITDA. |
| Renovaciones | useRenewalDashboard y alertas | Ventanas 7/15/30/45/60 días y lista priorizada | No es churn; mostrar contrato, monto, fecha y responsable cuando exista. |
| Cartera por partner | Acuerdos, atribuciones y vistas de margen | Barras/ranking con detalle | Diferenciar cliente directo/canal; no inferir contactos comerciales inexistentes. |
| Estado SaaS | Integración, target, requests y mappings | Matriz de ocho productos | HEALTHY requiere observación fechada. No representa uptime histórico. |
| Calidad del reporte | completeness/missing_fx del consolidado | Aviso contextual y enlace a tasas | Un dato incompleto no se presenta como cero. |
| Acción requerida | Alertas, documentos, fallos reales y renovaciones | Bandeja de acciones enlazadas | No crear un nuevo motor de tareas/aprobaciones en la primera noche. |

**No disponibles sin trabajo adicional de datos:** serie histórica real de MRR, NRR/GRR/churn confiables, CAC/LTV, embudo de oportunidades ponderado, MAU/consumo de cada SaaS, NPS, uptime/SLA histórico. Mostrar ausencia de cobertura o posponerlos; nunca rellenar con valores inventados.

Los tableros no sustituyen contabilidad. Las vistas actuales tienen fórmulas de gestión propias; cualquier cambio de definición requiere acuerdo de negocio.

## 7. Cobertura de pantallas

La siguiente matriz cubre los 32 componentes Page del ZIP. Es una propuesta; no significa que cada módulo requiera reconstrucción.

| Pantalla/componente | Mejora principal propuesta |
|---|---|
| `src/features/auth/LoginPage.tsx` | Conservar anatomía EBIM; resolver enlaces de ayuda y recuperación; foco, error, contraste. |
| `src/features/billing/BillingPage.tsx` | Totales completos de servidor; saldo y vencimiento; paginación y detalle exportable. |
| `src/features/billing/CostsPage.tsx` | Costos por categoría/alcance y margen bajo la fórmula vigente; no sumas truncadas. |
| `src/features/billing/ReconciliationPage.tsx` | Descuadres accionables con causa, detalle y evidencia; no corrección masiva automática. |
| `src/features/billing/RenewalsPage.tsx` | Priorización por urgencia, monto y fecha; recalcular y suspender permanecen separados. |
| `src/features/billing/SubscriptionDetailPage.tsx` | Separar contrato, líneas, OS/OC, pagos y timeline; no mezclar recurrente y una vez. |
| `src/features/billing/SubscriptionsPage.tsx` | Cartera contractual, renovación, método de cobro y valor mensual normalizado. |
| `src/features/catalog/FeatureFlagsPage.tsx` | Capacidades y alcance; conectar edición autorizada solo con contrato existente y pruebas. |
| `src/features/catalog/PlansPage.tsx` | Comparación legible de plan, periodicidad, precio, moneda y vigencia. |
| `src/features/catalog/ProductDetailPage.tsx` | Ficha del producto con clientes, contratos, cobros, margen y destinos; no mezclar monedas. |
| `src/features/catalog/ProductsPage.tsx` | Portafolio por producto: comercial, integración, entorno, salud fechada y accesos a detalle. |
| `src/features/commercial/AttributionsPage.tsx` | Vínculo venta-cliente-producto-ejecutivo, vigencia e impacto en comisiones. |
| `src/features/commercial/CommissionPlansPage.tsx` | Reglas legibles y ejemplos calculados en preview, sin alterar contrato económico. |
| `src/features/commercial/CommissionsPage.tsx` | Resumen por moneda/período y estados; liquidaciones con permiso y confirmación dedicada. |
| `src/features/commercial/SalesAgentsPage.tsx` | Cartera/atribuciones por ejecutivo, indicadores de actividad disponible, no oportunidades inventadas. |
| `src/features/dashboard/DashboardPage.tsx` | Resumen ejecutivo, finanzas y operación con datos reconciliables y jerarquía. |
| `src/features/deployments/DeploymentsPage.tsx` | Ambientes por producto, salud con timestamp y configuración sensible acotada. |
| `src/features/deployments/ProvisioningPage.tsx` | Cola de infraestructura diferenciada de provisioning SaaS y de ciclo comercial. |
| `src/features/deployments/SaasProvisioningPage.tsx` | Timeline, mapping, error recuperable y datos originales; no duplicar requests. |
| `src/features/onboarding/OnboardingPage.tsx` | Cinco pasos más claros, revisión económica y siguiente acción con contexto; no auto-alta SaaS. |
| `src/features/organizations/CustomersPage.tsx` | Vista cliente sobre el mismo directorio; no duplicar lógica de componentes. |
| `src/features/organizations/OrganizationDetailPage.tsx` | Cliente/partner 360 como centro de operación; consultas por organización. |
| `src/features/organizations/OrganizationsPage.tsx` | Directorio corporativo con buscador, tabs, alcance y navegación 360. |
| `src/features/organizations/PartnersPage.tsx` | Cartera y acuerdos del canal, margen y renovaciones, respetando RLS. |
| `src/features/platform/IntegrationDetailPage.tsx` | Vista operativa resumida y configuración avanzada secundaria; ocultar material secreto. |
| `src/features/platform/IntegrationsPage.tsx` | Matriz por entorno con salud observada, capacidades y estado real de configuración. |
| `src/features/regional/RegionalPage.tsx` | Período y valuación FX separados; cobertura de tasas y comparación por mercado. |
| `src/features/settings/AuditPage.tsx` | Bitácora legible, paginada, con before/after, entidad y correlación sin secretos. |
| `src/features/settings/NotFoundPage.tsx` | Mensaje claro y regreso a navegación permitida, consistente con la marca. |
| `src/features/settings/SettingsPage.tsx` | Apariencia sincronizada, perfil y entorno claros; no confundir con administración global de roles. |
| `src/features/tenants/TenantDetailPage.tsx` | Resumen 360, timeline y acciones por capacidad; DRY_RUN explícito. |
| `src/features/tenants/TenantsPage.tsx` | Separar estados comercial/técnico/admin y entorno; filtros de estado coherentes. |

## 8. Alcance recomendado para una corrida nocturna

### Paquete 1: fundamentos de confianza y diseño

Captura de baseline visual local; diccionario de métricas; corrección de totales truncados, períodos, estados y contratos de carga/error; prueba de aislamiento de caché. Tokens accesibles, botones, modales, tabs, topbar y tablas compartidas. Este paquete impacta casi toda la plataforma sin reescribirla.

### Paquete 2: experiencia ejecutiva y operativa

Dashboard ejecutivo con métricas ya disponibles; cliente/tenant 360; facturación, costos, comisiones y renovaciones; matriz SaaS y cronología de provisioning. Aplicar la misma anatomía a las 32 páginas; no añadir gráficos irrelevantes a cada formulario.

### Paquete 3: cierre funcional y verificación

Completar solo acciones administrativas respaldadas por RPC/permisos existentes y aprobadas para esta fase. Resolver enlaces sin destino, errores de estado, exportación con alcance correcto y auditoría legible. Validar pantalla por pantalla; documentar lo que no terminó sin fingir verde.

### Fuera de esta corrida salvo especificación independiente

Cambiar GENERIC/EWM_V1, crear otro smoke remoto, activar administradores, automatizar cobros/suspensión, inventar precios, modificar identidades del hub, reconciliar todo el drift, activar comunicaciones externas, reconstruir históricos que no existen, agregar un CRM completo, asumir telemetry de los otros SaaS, migrar todo el frontend a otra librería UI.

Una noche permite buscar una primera versión ejecutiva coherente y medible; no se garantiza toda la administración comercial, Auth y producción sin validación independiente. El cierre se decide por evidencia, no por cantidad de commits.

## 9. Criterios de aceptación propuestos

1. Cada página tiene captura antes/después en el viewport relevante; dashboard, 360 y tablas también en oscuro y móvil.
2. El sistema conserva marca EBIM, DM Sans, rutas, deep-links y permisos. Los estados cargando, error, vacío, sin permiso, dato parcial y valor cero son distintos.
3. Métricas agregadas no dependen de un lote de 200/300 filas. Tablas y gráficos concilian sobre el mismo período, moneda y alcance.
4. QAS/SANDBOX no se presentan como cartera comercial facturable por defecto; no cambiar los datos remotos para embellecer el tablero.
5. Cuatro estados separados por tenant: comercial, provisioning, salud y acceso. READY no se renombra CERTIFIED sin evidencia específica.
6. Dialog/tab keyboard, foco visible, contraste y tests de dos sesiones. Una anomalía visual no se corrige ampliando permisos.
7. No cambios en contratos firmados, secretos ni semántica de idempotencia. El test dorado de GENERIC y los tests críticos del negocio siguen vigentes.
8. Ejecutar y registrar el test 24_secret_key_rule.test.sql pendiente en local/CI seguro; no repetir escrituras de validación en QAS por rutina.
9. Tests visuales/funcionales con fixtures locales, sin correos, pagos, provisioning remoto ni cron externo. PR dev -> qas con gates; nunca bypass de protecciones.
10. Entrega de informe con cambios por pantalla, fuentes de KPI, screenshots, pruebas realmente ejecutadas, regresiones conocidas y lista concreta de pendientes.

## 10. Riesgos de ejecución y mitigación

**Permisos de Claude:** un prompt no modifica el gate. La sesión debe comprobar capacidades al inicio y avanzar en trabajo local aunque una acción remota esté bloqueada; un solo checklist operador, sin reintentos disfrazados.

**Datos sensibles:** fixtures sintéticos locales; no exportar tokens, llaves, passwords o material de credenciales. Los reportes deben distinguir evidencia histórica, lectura actual y simulación.

**Cambios concurrentes:** antes de integrar, inspeccionar dirty tree, commits y worktrees; no reset-hard, no borrar trabajo ajeno, no reescribir historia publicada. Cada producto no debe ser reabierto para esta mejora del portal.

**Esquema compartido:** agregar queries de lectura nuevas o parámetros opcionales cuando haga falta. No modificar silenciosamente el significado de consultas que ya usan otras pantallas. No full db push sobre drift.

**Interpretación financiera:** MRR no es caja; ARR es una proyección; el margen actual es gerencial basado en cobros, no utilidad contable. Documentar exactitud/cobertura antes de usar gráficos.

## 11. Recorrido propuesto de demostración

Inicio ejecutivo: entender la cartera y pendientes. Cliente 360: ver productos contratados, monedas, cobros y renovaciones. Tenant 360: explicar comercial PENDING versus provisioning ACTIVE y admin PREPROVISIONED. Matriz SaaS: las ocho integraciones y fecha de comprobación. Finanzas: del gráfico al detalle y a la tasa FX. Auditoría: explicar quién hizo qué, sin mostrar JSON o secretos como primera pantalla.

La demo QAS muestra evidencia de operación y datos de prueba claramente rotulados; no debe presentarse como facturación real de EBIM.

## 12. Referencias de criterio externo

Las recomendaciones de contraste y teclado usan como criterio W3C WCAG 2.2 (criterio 1.4.3) y WAI-ARIA Authoring Practices: Dialog (Modal) Pattern. Son criterios complementarios: los hallazgos del producto provienen del ZIP.

## Anexo A. Fragmentos de fuente verificables

Las líneas siguientes son fragmentos del ZIP, no pseudocódigo de una implementación futura. Se omiten archivos de credenciales y seeds de usuarios.

### E01: Inicio saturado y sin analítica temporal

**`src/features/dashboard/DashboardPage.tsx:40-80`**

```text
40: 
41:   return (
42:     <PageContainer
43:       title="Dashboard EBIM"
44:       description="Estado de la suite: catálogo, cuentas, recurrente, cobros, costos y comisiones."
45:     >
46:       <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
47:         <StatCard label="SaaS activos" value={formatNumber(s.active_products)} />
48:         <StatCard label="Organizaciones" value={formatNumber(s.organizations)} hint={`${s.partners} partners · ${s.customers} clientes`} />
49:         <StatCard label="Tenants productivos" value={formatNumber(s.production_tenants)} />
50:         <StatCard label="Demos y trials" value={formatNumber(s.demo_trial_tenants)} hint="No generan recurrente" />
51: 
52:         <StatCard label="MRR" value={formatCurrencyMap(s.mrr_by_currency)} tone="ok" hint="Sólo suscripciones activas" />
53:         <StatCard
54:           label="ARR estimado"
55:           value={formatCurrencyMap(
56:             Object.fromEntries(
57:               Object.entries(s.mrr_by_currency).map(([currency, value]) => [currency, Number(value) * 12]),
58:             ),
59:           )}
60:           hint="MRR × 12"
61:         />
62:         <StatCard label="Ingreso cobrado" value={formatCurrencyMap(s.collected_by_currency)} hint="Excluye DRAFT y VOID" />
63:         <StatCard label="Costo de infraestructura" value={formatCurrencyMap(s.cost_by_currency)} tone="warn" />
64: 
65:         <StatCard label="Comisión pendiente" value={formatCurrencyMap(s.commission_pending_by_currency)} tone="warn" hint="Elegible + devengada · por moneda" />
66:         <StatCard label="Comisión pagada" value={formatCurrencyMap(s.commission_paid_by_currency)} />
67:         <StatCard
68:           label="Provisioning fallido"
69:           value={formatNumber(s.provisioning_failures)}
70:           tone={s.provisioning_failures > 0 ? 'danger' : 'ok'}
71:         />
72:         <StatCard
73:           label="Tenants por modelo"
74:           value={Object.values(s.tenants_by_mode).join(' / ') || '—'}
75:           hint={Object.keys(s.tenants_by_mode).join(' / ') || 'Sin datos'}
76:         />
77:       </div>
78: 
79:       <div className="mt-5">
80:         <RegionalFinancePanel />
```

### E02: Totales y búsquedas limitados a un subconjunto

**`src/services/queries.ts:514-526`**

```text
514: export function useInvoices() {
515:   return useQuery({
516:     queryKey: ['invoices'],
517:     queryFn: async () =>
518:       unwrap(
519:         await supabase
520:           .from('invoices')
521:           .select('*, organizations(display_name), invoice_lines(*), payments(*)')
522:           .order('issue_date', { ascending: false, nullsFirst: false })
523:           .limit(200),
524:       ),
525:   });
526: }
```

**`src/services/queries.ts:596-607`**

```text
596: export function useCostEntries() {
597:   return useQuery({
598:     queryKey: ['cost-entries'],
599:     queryFn: async () =>
600:       unwrap(
601:         await supabase
602:           .from('cost_entries')
603:           .select('*, cost_allocations(*, saas_products(short_name), tenants(name), deployment_targets(code))')
604:           .order('period_start', { ascending: false })
605:           .limit(200),
606:       ),
607:   });
```

**`src/services/queries.ts:672-685`**

```text
672: export function useCommissionEvents() {
673:   return useQuery({
674:     queryKey: ['commission-events'],
675:     queryFn: async () =>
676:       unwrap(
677:         await supabase
678:           .from('commission_events')
679:           .select(
680:             '*, sales_agents(full_name, code), saas_products(short_name), tenants(name), commission_rules(name, basis), commission_settlements(code, status)',
681:           )
682:           .order('earned_on', { ascending: false })
683:           .limit(300),
684:       ),
685:   });
```

**`src/features/billing/BillingPage.tsx:34-49`**

```text
34:   });
35: 
36:   const all = invoices.data ?? [];
37:   const countable = all.filter((i) => !['DRAFT', 'VOID'].includes(i.status));
38:   // V3 · totales POR MONEDA: PEN y USD emitidos no son una sola cifra (R-7).
39:   const invoiced = sumByCurrency(countable, (i) => i.total, (i) => i.currency);
40:   const collected = sumByCurrency(
41:     all.flatMap((i) => ((i.payments ?? []) as Array<Record<string, unknown>>)
42:       .filter((p) => p.status === 'CONFIRMED')
43:       .map((p) => ({ amount: Number(p.amount), currency: (p.currency as string | null) ?? i.currency }))),
44:     (p) => p.amount,
45:     (p) => p.currency,
46:   );
47:   const outstanding = subtractByCurrency(invoiced, collected);
48:   const hasOutstanding = Object.values(outstanding).some((v) => v > 0);
49: 
```

### E03: Período financiero no expuesto por el hook

**`src/services/queries.ts:275-303`**

```text
275: export interface FinanceConsolidatedParams {
276:   asOf: string;
277:   groupBy: 'TOTAL' | 'MARKET' | 'PRODUCT' | 'PARTNER';
278:   marketCode?: string;
279:   currency?: string;
280:   saasProductId?: string;
281:   organizationId?: string;
282: }
283: 
284: /**
285:  * Consolidado gerencial (V3). La base suma por moneda, convierte cada total con
286:  * una tasa explícita y declara lo que falta: la UI solo presenta.
287:  */
288: export function useFinanceConsolidated(params: FinanceConsolidatedParams) {
289:   return useQuery({
290:     queryKey: ['finance-consolidated', params],
291:     queryFn: async (): Promise<FinanceConsolidated> => {
292:       const { data, error } = await supabase.rpc('finance_consolidated', {
293:         p_as_of: params.asOf,
294:         p_group_by: params.groupBy,
295:         p_market_code: params.marketCode || undefined,
296:         p_currency: params.currency || undefined,
297:         p_saas_product_id: params.saasProductId || undefined,
298:         p_organization_id: params.organizationId || undefined,
299:       });
300:       if (error) throw new Error(error.message);
301:       return data as unknown as FinanceConsolidated;
302:     },
303:   });
```

**`supabase/migrations/20260913000800_v3_consolidated_finance.sql:584-594`**

```text
584:   p_as_of              date default current_date,
585:   p_reporting_currency char(3) default null,
586:   p_group_by           text default 'TOTAL',
587:   p_market_code        text default null,
588:   p_currency           char(3) default null,
589:   p_saas_product_id    uuid default null,
590:   p_organization_id    uuid default null,
591:   p_period_start       date default null,
592:   p_period_end         date default null
593: )
594: returns jsonb
```

### E04: Fallas técnicas de distinta capa

**`supabase/migrations/20260913000800_v3_consolidated_finance.sql:386-393`**

```text
386:                                 from platform.commission_events where status = 'PAID'),
387:     'reporting_currency',    (select s.reporting_currency from platform.reporting_settings() s),
388:     'provisioning_by_status',(select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
389:                                from (select status, count(*) as n from platform.provisioning_requests
390:                                       group by status) x),
391:     'provisioning_failures', (select count(*) from platform.provisioning_requests where status = 'FAILED')
392:   );
393: $$;
```

### E05: No hay serie mensual de MRR

**`docs/finance/COST_MARGIN_MODEL.md:121-126`**

```text
121: |---|---|---|
122: | 1 | Sin conversión FX | Un dashboard multi-moneda muestra varias cifras, no un consolidado. |
123: | 2 | MRR desde `subscription_items` vigentes, no desde un snapshot mensual | No se puede reconstruir el MRR histórico de hace 6 meses. Requiere una tabla de snapshots. |
124: | 3 | Sin reconocimiento diferido de ingresos | Un pago anual se cuenta cobrado el día que entra, no prorrateado. Es correcto para caja, no para devengo contable. |
125: | 4 | El costo de plataforma (`scope = PLATFORM`) no se prorratea a productos | Aparece en el total pero no en el margen por producto. Requiere una regla de asignación acordada con negocio. |
126: 
```

**`supabase/migrations/20260913000800_v3_consolidated_finance.sql:406-418`**

```text
406: create or replace view platform.v_finance_facts
407: with (security_invoker = true) as
408: select
409:   'MRR'::text                     as metric,
410:   null::text                      as detail,
411:   v.saas_product_id,
412:   s.market_id,
413:   v.billed_organization_id        as organization_id,
414:   v.managing_organization_id      as partner_organization_id,
415:   v.currency::bpchar              as currency,
416:   v.mrr                           as amount,
417:   current_date                    as fact_date
418: from platform.v_subscription_mrr v
```

### E07: Variante de botón inexistente

**`src/app/index.css:67-78`**

```text
67:   .ebim-btn-primary {
68:     @apply ebim-btn bg-accent text-[color:var(--accent-fg)] hover:brightness-95 active:brightness-90;
69:   }
70: 
71:   .ebim-btn-ghost {
72:     @apply ebim-btn border border-border bg-card text-fg hover:bg-accent-soft;
73:   }
74: 
75:   .ebim-btn-danger {
76:     @apply ebim-btn bg-danger text-white hover:brightness-95;
77:   }
78: 
```

### E08: Contraste insuficiente en variantes activas

**`src/app/tokens.css:14-20`**

```text
14:   /* --- Marca EBIM (default de la suite) -------------------------------- */
15:   --accent: #5aa97f; /* verde EBIM */
16:   --accent-deep: #2f7355; /* variante AA para texto sobre claro */
17:   --accent-soft: #e8f4ee;
18:   --accent-fg: #ffffff;
19:   /* Anillo de foco: alfa fija. Tailwind no puede calcular opacidad sobre un
20:      color declarado como var(), así que el token trae su propia transparencia. */
```

**`src/app/tokens.css:65-75`**

```text
65:   --accent-soft: #1b3329;
66:   --accent-deep: #7cc79c; /* sobre fondo oscuro el "deep" invierte para mantener AA */
67:   --accent-ring: rgba(124, 199, 156, 0.35);
68: 
69:   --ok-soft: #12291d;
70:   --warn-soft: #2c2110;
71:   --danger-soft: #2e1513;
72:   --info-soft: #10262f;
73: 
74:   color-scheme: dark;
75: }
```

### E09: Modales y pestañas: semántica sin ciclo completo de teclado

**`src/components/ui/ConfirmDialog.tsx:27-37`**

```text
27:   const confirmRef = useRef<HTMLButtonElement>(null);
28: 
29:   useEffect(() => {
30:     if (!open) return;
31:     confirmRef.current?.focus();
32:     const onKey = (e: KeyboardEvent) => {
33:       if (e.key === 'Escape') onCancel();
34:     };
35:     window.addEventListener('keydown', onKey);
36:     return () => window.removeEventListener('keydown', onKey);
37:   }, [open, onCancel]);
```

### E10: Apariencia local no compartida

**`src/hooks/useAppearance.ts:30-53`**

```text
30:   const [mode, setModeState] = useState<ColorMode>(() =>
31:     readStored<ColorMode>(MODE_KEY, 'light', ['light', 'dark']),
32:   );
33:   const [density, setDensityState] = useState<Density>(() =>
34:     readStored<Density>(DENSITY_KEY, 'equilibrada', ['comoda', 'equilibrada', 'compacta']),
35:   );
36: 
37:   useEffect(() => {
38:     document.documentElement.setAttribute('data-theme', mode);
39:     try {
40:       localStorage.setItem(MODE_KEY, mode);
41:     } catch {
42:       /* almacenamiento no disponible: la preferencia dura la sesión */
43:     }
44:   }, [mode]);
45: 
46:   useEffect(() => {
47:     document.documentElement.setAttribute('data-density', density);
48:     try {
49:       localStorage.setItem(DENSITY_KEY, density);
50:     } catch {
51:       /* idem */
52:     }
53:   }, [density]);
```

### E11: Aislamiento de caché al cambiar sesión

**`src/app/App.tsx:46-55`**

```text
46: const queryClient = new QueryClient({
47:   defaultOptions: {
48:     queries: {
49:       retry: 1,
50:       staleTime: 30_000,
51:       refetchOnWindowFocus: false,
52:     },
53:   },
54: });
55: 
```

**`src/features/auth/AuthContext.tsx:62-66`**

```text
62:   const signOut = useCallback(async () => {
63:     await supabase.auth.signOut();
64:     setRoles(null);
65:   }, []);
66: 
```

### E14: Recuperar clave y solicitar acceso no completan un flujo

**`src/features/auth/LoginPage.tsx:242-248`**

```text
242:               {/* 11 · Link de recuperar, alineado a la derecha, bajo el campo. */}
243:               <div className="mt-1.5 text-right">
244:                 <a className="text-[13px] font-semibold text-accent-deep hover:underline" href="#recuperar">
245:                   ¿Olvidaste tu contraseña?
246:                 </a>
247:               </div>
248:             </div>
```

**`src/features/auth/LoginPage.tsx:270-277`**

```text
270:           {/* 13 · UN SOLO link secundario, en texto corriente. */}
271:           <p className="mt-5 text-center text-[13px] text-muted">
272:             ¿Necesitas acceso?{' '}
273:             <a className="font-semibold text-accent-deep hover:underline" href="#solicitar">
274:               Solicítalo al equipo de plataforma
275:             </a>
276:           </p>
277: 
```

### E15: Separar promesas comerciales y ejecución remota

**`src/features/tenants/TenantDetailPage.tsx:62-72`**

```text
62:     try {
63:       if (pendingAction === 'SUSPEND') {
64:         await suspend.mutateAsync({
65:           p_tenant_id: tenantId,
66:           p_reason: 'Suspensión solicitada desde la consola',
67:         });
68:         toast.success('Tenant suspendido', 'Se encoló la solicitud SUSPEND_TENANT en DRY_RUN.');
69:       } else {
70:         await resume.mutateAsync({ p_tenant_id: tenantId });
71:         toast.success('Tenant reactivado', 'Se encoló la solicitud RESUME_TENANT en DRY_RUN.');
72:       }
```

**`src/features/onboarding/OnboardingPage.tsx:325-332`**

```text
325:         p_attribution_pct: Number(v.attribution_pct) / 100,
326:         p_attribution_source: v.attribution_source,
327:         // Cobranza: la Fase 07 añade el perfil. Aquí no se presupone tarjeta.
328:         p_provisioning_mode: 'DRY_RUN',
329:         p_deployment_target_id: v.deployment_target_id || undefined,
330:         p_activate: v.activate,
331:         p_notes: v.notes || undefined,
332:       })) as { tenant_id?: string } | null;
```

### E16: Vista 360 valiosa pero compuesta por lecturas generales

**`src/features/organizations/Organization360.tsx:43-67`**

```text
43:   organizationName,
44:   capabilities,
45: }: {
46:   organizationId: string;
47:   organizationName: string;
48:   capabilities: string[];
49: }) {
50:   const collection = useSubscriptionCollection();
51:   const renewals = useRenewalDashboard();
52:   const documents = useCommercialDocuments();
53:   const invoices = useInvoices();
54:   const commissions = useCommissionDetail();
55:   const partnerFinance = usePartnerFinance();
56:   const tenants = useTenantOverview();
57:   const provisioning = useProvisioningRequests();
58:   const agreements = usePartnerAgreements(organizationId);
59: 
60:   const loading = collection.isLoading || renewals.isLoading || invoices.isLoading;
61: 
62:   // Todo se filtra en cliente sobre datos que RLS ya acotó: si una fila no es
63:   // visible para este usuario, sencillamente no llegó.
64:   const orgSubs = (collection.data ?? []).filter(
65:     (c) => c.billed_organization_id === organizationId,
66:   );
67:   const subIds = new Set(orgSubs.map((s) => s.subscription_id as string));
```

### E17: Auditoría y documentos poco orientados al operador

**`src/features/billing/CollectionDialogs.tsx:449-454`**

```text
449:       <TextField
450:         label="Referencia del archivo" placeholder="storage://os/2026/os-0455.pdf"
451:         hint="Una referencia, no el archivo ni una URL firmada."
452:         error={form.formState.errors.external_file_ref} {...form.register('external_file_ref')}
453:       />
454:       <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
```

