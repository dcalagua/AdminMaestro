# MasterAdmin — Experiencia ejecutiva y operación corporativa
## Especificación de diseño v1.0

**Documento:** `docs/superpowers/specs/2026-09-25-masteradmin-executive-experience-design.md`  
**Fecha de elaboración:** 25 de septiembre de 2026.  
**Estado:** alcance y dirección aprobados en conversación; especificación escrita preparada para revisión.  
**Etapa:** diseño. No es un plan de implementación ni una autorización de despliegue.  
**Producto:** MasterAdmin / AdminMaestro de EBIM.

---

## 1. Decisión y propósito

Evolucionar MasterAdmin como consola ejecutiva y administrativa de la suite EBIM, manteniendo su arquitectura, identidad visual, seguridad y contratos de provisioning. Dirección debe entender cartera, cobros, riesgos y prioridades; finanzas debe reconciliar cada cifra; comerciales deben llegar del cliente al contrato; operaciones debe distinguir configuración, salud observada y alta técnica.

La mejora no consiste en llenar todas las pantallas de gráficos. Se adopta una jerarquía común de información, consultas que representen el universo autorizado completo y continuidad entre resumen, detalle y acción existente.

### 1.1 Qué aprobó el usuario

- Conservar la identidad EBIM y mejorar profesionalmente la presentación.
- Tablero ejecutivo financiero-operativo con información útil al negocio.
- Cliente 360 y Tenant 360 como puntos centrales de la operación.
- Normalizar la experiencia de los 32 componentes de página auditados.
- Corregir problemas de presentación, datos e interacción que afectan esa experiencia.
- Proteger el provisioning certificado y no reabrir las ocho integraciones.
- Preparar una corrida nocturna posterior con entregables verificables.

### 1.2 Qué no se ha aprobado todavía

Este documento concreta ese alcance. Su revisión precede al plan ejecutable. No se ha aprobado instalar dependencias, cambiar código productivo, crear migraciones remotas, modificar QAS, publicar ramas, hacer PR ni iniciar una ejecución autónoma a partir de este documento.

La aprobación posterior del plan deberá distinguir ejecución local, publicación Git y promoción QAS. No se presume que el gate de herramientas cambie porque exista un prompt.

---

## 2. Fuentes, alcance de la evidencia y baseline

**Fuente A:** `AdminMaestro-dev (2).zip`.  
**SHA-256:** `54023a54367d64f772a3a6836368b699d00681efb752af5c8b23ea7b38ad1132`.

**Fuente B:** `MasterAdmin_Auditoria_UX_Negocio_2026-09-24.md`, entregado y aprobado como base del trabajo. Se conserva sin modificar en el paquete de referencia.

**Fuente C:** reportes de cierre aportados por el usuario: ocho productos certificados en QAS, administradores PREPROVISIONED, sin duplicados en los fixtures certificados. Es evidencia histórica aportada, no una nueva comprobación del remoto.

La auditoría del ZIP registró 484 archivos, 108 TS/TSX de aplicación, 32 componentes Page, 25 entradas de navegación y 45 migraciones. Los wrappers, login y no-encontrado cuentan como páginas; no son 32 módulos independientes.

No se inició sesión ni se renderizó el ZIP en navegador durante la auditoría original. Esta especificación no convierte el análisis estático en una certificación visual ni presume que el repositorio de la Mac siga en el mismo HEAD.

Toda afirmación sobre código actual se remite a A/B. Toda organización de pantallas, interacción o regla de presentación descrita como objetivo es una decisión de diseño de esta especificación, no una capacidad que ya esté implementada.

### 2.1 Tres superficies que no deben confundirse

1. **Código del ZIP:** baseline de análisis.
2. **Checkout/ramas del desarrollador:** deben reconciliarse antes de implementar.
3. **QAS y datos remotos:** no se modifican para producir gráficos o capturas atractivas.

El contenido del ZIP no permite asegurar todos los estados actuales de QAS. Los ocho productos no deben aparecer hardcodeados como HEALTHY o CERTIFIED.

---

## 3. Resultado y alcance funcional

### 3.1 Resultado esperado

Una consola coherente con:
- Inicio ejecutivo, perspectiva financiera y perspectiva de operación SaaS.
- Indicadores cuya fórmula, moneda, período y cobertura se puedan explicar.
- Navegación de negocio conservando URLs, hashes y autorización.
- Directorios, fichas, formularios, tablas y estados homogéneos.
- Clientes y tenants con situación comercial, técnica y de acceso separadas.
- Evidencia visual y funcional que permita comparar antes/después.

### 3.2 Dominios de diseño

**D1 — Confianza y componentes:** semántica de datos, paginación, caché de sesión, apariencia, botones, modales, tabs y layout.

**D2 — Experiencia ejecutiva:** dashboard, gráficos, cartera, cliente/tenant 360 y matriz SaaS.

**D3 — Normalización administrativa:** aplicación de los componentes a todas las páginas y cierre de interacciones acotadas respaldadas por contratos existentes.

Son dominios de una misma evolución. Esta enumeración no sustituye el futuro plan de tareas, commits, pruebas y responsables.

### 3.3 Fuera de alcance

- Cambiar GENERIC, EWM_V1, contratos firmados, claims M2M, claves, mappings o semántica de idempotencia.
- Repetir altas, replays, activaciones o suspensiones remotas de los ocho SaaS.
- Crear SSO, activar administradores o rehacer Auth.
- Crear un CRM de oportunidades, motor de tareas o centro completo de aprobaciones.
- Implementar cobro productivo, inventar precios, comisiones, asignación de costos o reglas fiscales.
- Reconstruir MRR histórico, churn, NRR, CAC, LTV, MAU, NPS o uptime sin fuentes.
- Migrar todo a otra librería UI, actualizar versiones mayores o sustituir el backend.
- Crear gestor documental completo, nuevos buckets o envío de documentos.
- Resolver todo el drift histórico de migraciones o toda la deuda de los SaaS.

---

## 4. Usuarios, permisos y privacidad

Se conservan las personas y permisos existentes. Las perspectivas “Ejecutivo”, “Finanzas” y “Operación SaaS” son vistas de información; no son nuevos roles ni concesiones.

| Perfil de uso | Pregunta principal | Restricción |
|---|---|---|
| Dirección EBIM autorizada | ¿Cómo está la cartera y qué requiere atención? | Solo cifras permitidas por sus permisos efectivos. |
| Finanzas autorizada | ¿Qué se cobró, qué se debe y cómo se compone el margen? | Conserva alcance por entidad, período y moneda. |
| Comercial / canal | ¿Qué ocurre con mis clientes y contratos? | No recibe datos globales fuera de su cartera. |
| Partner | ¿Cómo está mi cartera y mi canal? | Nunca hereda el universo EBIM por compartir componentes. |
| Operaciones / propietario técnico | ¿Qué integración o alta necesita atención? | No obtiene finanzas por ser persona EBIM con permisos técnicos limitados. |
| Usuario tenant | ¿Qué información de mi cuenta puedo consultar? | No se amplía su acceso a administración corporativa. |

El control visual no reemplaza la autorización. Las agregaciones nuevas también deben respetar RLS, permisos por columna y las comprobaciones de las RPC.

Una sección no autorizada se omite o se presenta como “Sin acceso”, según el patrón vigente, sin consultar datos globales para luego filtrarlos en el navegador.

### 4.1 Ciclo de sesión

E11 es una hipótesis a probar, no un incidente confirmado. La aceptación requiere:
- Cambiar de usuario o contexto no conserva cifras, filas ni opciones de la sesión anterior.
- Respuestas en vuelo de una sesión anterior no repueblan la caché de la siguiente.
- Las claves de consulta representan identidad y alcance cuando corresponda.
- Un cierre de sesión no se “arregla” cambiando RLS, permisos o roles.
- Las preferencias visuales no se mezclan entre usuarios ni guardan datos financieros.

---

## 5. Arquitectura de información y navegación

Se conservan todas las rutas existentes. Cambia la agrupación y la presentación, no el contrato de navegación.

| Grupo | Entradas existentes y etiqueta objetivo |
|---|---|
| Inicio | `/` → Resumen ejecutivo. |
| Clientes y canales | `/customers`, `/partners`, `/organizations`, `/sales-agents`, `/attributions`. |
| Productos y contratos | `/products`, `/plans`, `/feature-flags`, `/onboarding`, `/tenants`, `/subscriptions`. |
| Finanzas | `/billing`, `/costs`, `/commissions`, `/commission-plans`, `/renewals`, `/reconciliation`, `/regional`. |
| Operación SaaS | `/integrations`, `/deployments`, `/saas-provisioning`, `/provisioning`. |
| Gobierno | `/audit`, `/settings`. |

Etiquetas de negocio:
- Feature flags → “Capacidades”, conservando terminología técnica en el detalle.
- Deployments → “Entornos y despliegues”.
- Provisioning SaaS → “Altas SaaS”.
- Provisioning de infraestructura → “Solicitudes de infraestructura”.
- Todas las organizaciones → “Directorio corporativo”.
- Comisiones → separar claramente reglas, devengado y liquidación en el contenido.

Las rutas de detalle de producto, organización, tenant, suscripción e integración siguen funcionando. Los hashes de tabs ya utilizados no se rompen; cualquier ampliación conserva compatibilidad con enlaces existentes.

### 5.1 Shell

- Sidebar con grupos plegables, iconos Phosphor coherentes y estado activo reconocible.
- Topbar neutro basado en los tokens de superficie/borde existentes; sin tercer tinte arbitrario.
- Breadcrumbs y título humano en lugar de mostrar `location.pathname`.
- Indicador de entorno visible. No inferir QAS por el nombre de la rama.
- Perfil y apariencia accesibles sin duplicar la navegación.
- En móvil, menú tipo panel lateral con foco y cierre adecuados; el contenido no queda detrás de una capa invisible.
- No introducir buscador global de todo el sistema en este alcance.

---

## 6. Sistema visual

### 6.1 Identidad

Conservar DM Sans, isotipo EBIM y familia Phosphor ya presentes. Mantener verde EBIM `#5AA97F`, teal `#056769` e isotipo `#0A5A52` como identidad; las variantes funcionales podrán ajustarse para contraste.

No permitir paletas arbitrarias por usuario. Apariencia sigue limitada a modo y densidad, respetando la configuración de marca existente.

### 6.2 Jerarquía

- Título de página, contexto breve y una acción primaria clara.
- Acciones secundarias agrupadas; acciones peligrosas diferenciadas y no dominantes.
- KPI contextual solo cuando ayuda a esa tarea.
- Contenido y detalle con una estructura repetible.
- Unidades, moneda y fecha visibles; números alineados y legibles.
- Descripciones breves de negocio; SQL, JSON y nombres internos en panel avanzado o detalle.

### 6.3 Densidades contractuales

Conservar los valores documentados de `--control-h / --row-h / --pad-y / --pad-x`:

| Densidad | Valores |
|---|---|
| Cómoda | 40 / 52 / 12 / 14 |
| Equilibrada | 36 / 44 / 9 / 12 |
| Compacta | 32 / 38 / 6 / 10 |

El modo móvil no debe reducir objetivos de interacción solo por heredar densidad compacta. Se evita texto minúsculo para hacer caber datos; se reorganiza el layout o se permite scroll en la tabla.

### 6.4 Color y accesibilidad

Criterios adoptados de la auditoría:
- Texto normal con contraste objetivo AA de 4,5:1.
- Estado indicado mediante texto e icono, no solo color.
- Foco visible, mensajes legibles y variantes claras/oscuras verificadas.
- Gráficos sin 3D, degradados decorativos que dificulten lectura ni animaciones imprescindibles.
- Respetar reducción de movimiento y la anatomía de login EBIM.

La conformidad final se demuestra sobre el renderizado; no se declara únicamente por modificar tokens.

### 6.5 Componentes compartidos

| Componente | Contrato de experiencia |
|---|---|
| Encabezado de página | Breadcrumb, título, descripción, acciones y entorno/contexto. |
| Tarjeta KPI | Nombre, valor, unidad, alcance temporal, calidad/cobertura y acceso a detalle. |
| Contenedor de gráfico | Título-pregunta, leyenda, unidad, período, tabla alternativa y estado de datos. |
| Tabla | Buscador, tabs, orden, página, total, fila de detalle y exportación definida. |
| Badge de estado | Etiqueta de negocio; no fusionar estados de distinta dimensión. |
| Formulario | Grupos, errores junto al campo, guardado pendiente y protección de cambios no guardados. |
| Diálogo | Foco confinado/restaurado, Escape según estado, busy y bloqueo de doble envío. |
| Tabs | Teclado completo, panel asociado y deep-link existente. |
| Panel vacío/error | Explica ausencia, falta de permiso o fallo; no convierte todo a cero. |
| Timeline | Hecho, actor, fecha, entidad, resultado y correlación cuando existen. |

Se evoluciona la API de los componentes de manera compatible. Ninguna migración visual deja consumidores antiguos sin estilos.

---

## 7. Inicio ejecutivo y gráficos

### 7.1 Perspectiva ejecutiva

Orden de lectura:
1. Encabezado y contexto del reporte.
2. Seis KPI principales.
3. Cobros por mes y MRR actual por producto.
4. Requiere atención: cartera, documentos y renovaciones.
5. Resumen compacto de operación SaaS.

En pantallas anchas, los seis KPI se presentan en dos filas de tres; en tablet, dos columnas; en móvil, una columna legible. Esta distribución es una propuesta base, validada con valores largos y moneda explícita, no una obligación de recortar contenido.

### 7.2 Perspectiva financiera

Profundiza en:
- Cobrado del período.
- Facturado del período, con fecha y estados definidos.
- Saldo actual de cuentas por cobrar.
- Antigüedad de saldos.
- Costos directos, comisiones y margen gerencial.
- Comparación por producto, partner o mercado dentro del alcance permitido.
- Cobertura FX y montos que no pueden consolidarse.

Se distingue “foto actual” de “movimiento del período”. Cambiar la fecha de FX no cambia por sí mismo el período de cobros.

### 7.3 Perspectiva de operación SaaS

Matriz por producto y entorno con:
- Estado del catálogo.
- Integración y capacidad disponible.
- Destino habilitado/deshabilitado.
- Última comprobación y resultado de salud.
- Solicitudes SaaS por estado.
- Mapping o incidencia, cuando existan.
- Evidencia de certificación solo si existe una fuente verificable.

No calcula un “peor estado” mezclando destinos PRD/DRAFT con QAS activo. Un destino deshabilitado puede quedar visible como “No evaluado”, pero no contamina un resumen de destinos operativos habilitados.

No se hacen llamadas a ocho proveedores desde el navegador al renderizar. Se consumen datos autorizados del control plane y la fecha de observación. “Verificar conexión” conserva su acción explícita y puede escribir auditoría; no se ejecuta automáticamente en esta mejora.

### 7.4 Gráficos aprobados

| ID | Gráfico | Fuente conceptual | Interacción |
|---|---|---|---|
| G01 | Cobros confirmados mensuales | Hechos de pagos confirmados y vistas financieras existentes. | Seleccionar mes abre cobros del mismo período/alcance. |
| G02 | MRR vigente por producto | `v_subscription_mrr` y consolidado existente. | Producto abre su ficha; no representa evolución histórica. |
| G03 | Cartera por antigüedad | Facturas computables y saldos pendientes reconciliados. | Intervalo abre facturas de ese intervalo. |
| G04 | Cobrado, costo y comisión por SaaS | Vistas de margen y asignación vigente. | Tabla de componentes y enlace a detalle. |
| G05 | Cartera/contribución por partner | Acuerdos, atribuciones y vistas existentes. | Partner abre 360 sin ampliar permisos. |
| G06 | Renovaciones próximas | Contratos, fechas y alertas existentes. | Ventana abre lista de contratos correspondientes. |

No colocar los seis gráficos simultáneamente arriba del dashboard. G01/G02 son prioritarios en Ejecutivo; G03/G04/G05 pertenecen a Finanzas; G06 aparece como resumen accionable.

La implementación usará un contenedor común de gráficos. La dependencia concreta se evaluará en el plan por compatibilidad, accesibilidad, peso y licencia; no se instala ni se cambia el stack en esta etapa.

---

## 8. Diccionario semántico de indicadores

Todo indicador debe declarar:
`nombre`, `fuente`, `estados`, `unidad`, `fecha/período`, `alcance`, `moneda`, `cobertura`, `tratamiento de pruebas`, `permiso` y `detalle reconciliable`.

Las fórmulas actuales se conservan. Si una fuente no soporta la presentación pedida, el resultado se marca no disponible; no se inventa una fórmula sustitutiva.

### K01 — MRR vigente

Foto actual del recurrente mensual normalizado conforme a las vistas y reglas comerciales existentes. No equivale al cobro mensual. Excluye los conceptos y estados que ya excluye el modelo; no se alteran cadencias, prorrateos ni precios.

- Por moneda nativa o consolidado explícito.
- Siempre rotulado “vigente / al momento de consulta”.
- No aplicar un período pasado fingiendo reconstrucción histórica.
- Sin porcentaje de variación histórica hasta disponer de una serie real.
- ARR estimado puede mostrarse como dato secundario identificado como proyección de MRR.

### K02 — Cobrado del período

Pagos confirmados cuyo hecho de cobro pertenece al período, respetando el tratamiento vigente de reversos y parciales. No se suma el total de una factura cada vez que aparece un pago.

- El total no depende del número de filas de la página.
- La serie mensual y el detalle concilian.
- Las comparaciones solo se muestran cuando ambos períodos son comparables y tienen cobertura.
- Un período parcial se rotula; no se compara silenciosamente contra un mes completo.
- Si el denominador anterior es cero, no producir infinito ni un porcentaje engañoso.

### K03 — Saldo por cobrar

Saldo vigente de facturas computables según estados y aplicaciones de pago del modelo. Se rotula como foto actual o, solo si los datos lo soportan, saldo a una fecha.

- No restar todos los pagos de un período a todas las facturas de otro universo.
- Pagos en monedas distintas no se compensan sin regla existente.
- Saldos negativos/sobrepagos se muestran conforme al modelo; no se ocultan con un recorte a cero.
- La cifra abre exactamente las facturas que la componen.

### K04 — Cartera vencida

Porción de saldo por cobrar cuyo vencimiento ya pasó a la fecha de corte disponible.

- Separar vigente, 1–30, 31–60, 61–90 y más de 90 días, sin solapamientos.
- Facturas sin vencimiento van a “Sin fecha”, no a vencidas ni a vigentes por defecto.
- Esas bandas son una clasificación visual, no una nueva política de cobro.
- La antigüedad no reconstruye automáticamente saldos pasados.

### K05 — Margen gerencial

Conservar la fórmula de gestión documentada: cobrado menos costo directo menos comisión, con los criterios de asignación existentes.

- No llamarlo utilidad neta, EBITDA ni resultado contable.
- Mostrar los tres componentes, período y cobertura.
- Costos de plataforma sin asignación no se reparten arbitrariamente.
- Si el total incluye conceptos no atribuibles a productos, exponer “No asignado / plataforma” para explicar la conciliación.
- Los criterios exactos de estados de comisiones y costo se toman de las vistas existentes, no de etiquetas visuales nuevas.

### K06 — Renovaciones próximas

Número y monto de contratos en ventanas futuras definidas a partir de las fechas existentes.

- Selector de ventana 7/15/30/45/60 días.
- Identificar moneda, cliente, contrato, fecha y responsable solo cuando exista.
- No presentarlo como pronóstico de churn.
- No suspender ni renovar automáticamente desde el dashboard.

### 8.1 Métricas auxiliares

Facturado, comisiones, costos, cartera por partner, solicitudes de infraestructura y solicitudes SaaS se muestran en su perspectiva correspondiente. “Falla de infraestructura” y “Falla de alta SaaS” son indicadores distintos.

### 8.2 Reglas comunes de datos

- Período de operaciones, fecha de valuación FX y foto actual son parámetros distintos.
- Mantener las reglas de redondeo y precisión de dinero del backend.
- No sumar PEN, USD u otras monedas sin conversión explícita soportada.
- FX faltante produce cobertura parcial; no valor cero ni exclusión invisible.
- Moneda nativa y moneda de reporte se distinguen en tooltips, tarjetas y exportación.
- Excluir datos de prueba de cartera comercial por atributos existentes confiables, no por nombres o correos inventados.
- Un tenant PENDING no es necesariamente de prueba. Un tenant QAS puede requerir etiqueta de entorno sin ser una regla financiera por sí misma.
- Si no hay clasificación fiable, indicar cobertura/limitación antes de afirmar “sin pruebas”.
- QAS nunca recibe cifras inventadas para aparentar actividad comercial.

---

## 9. Lecturas, agregaciones y estados

### 9.1 Resumen y detalle separados

Las tarjetas/series se calculan mediante agregados autorizados del servidor sobre el universo completo. La tabla consulta una página del mismo universo.

La coincidencia de filtros, estados, moneda y fechas debe ser demostrable. No es válido quitar `.limit(200)` y descargar indefinidamente todo como sustituto de una agregación.

`finance_consolidated` ya admite período en el SQL auditado. Se aprovecha esa capacidad con cambios compatibles. Los nuevos agregados o consultas, de ser necesarios, se incorporarán de manera aditiva y solo para lectura.

### 9.2 Contrato de presentación de datos

Cada bloque distingue:
- Cargando.
- Completo con valor, incluido cero real.
- Vacío sin actividad.
- Parcial con motivo y cobertura.
- Fallido con reintento de lectura.
- Sin acceso.
- No disponible por falta de fuente.
- Observación anterior con fecha visible.

Un error en costos no convierte margen a una cifra aparentemente completa. Un error de una sección de 360 no borra las otras ni se disfraza de “No hay datos”.

### 9.3 Lecturas de 360

Las consultas se acotan por organización/tenant en servidor. No se descargan listas globales solo para filtrarlas localmente.

Se evita fan-out innecesario y estados globales de carga que dependen de solo tres de nueve consultas. Cada sección tiene estado, cobertura y enlace a su detalle.

### 9.4 Mutaciones

Se preservan las RPC de negocio. Las nuevas conexiones UI solo pueden consumir acciones ya definidas y autorizadas en esta especificación. No se amplían GRANT, roles o acceso para hacer funcionar una nueva tarjeta.

Después de una operación, se invalida únicamente el alcance afectado, sin dejar cifras antiguas ni borrar estado de formularios ajenos.

---

## 10. Tablas, búsqueda y exportación

- Buscador general y tabs de estado en listados, conforme a las convenciones EBIM.
- Contexto heredado desde una tarjeta puede representarse como chip removible.
- No convertir cada CRUD en diez selectores.
- Período, mercado y moneda se concentran en analítica y se reflejan como contexto en el detalle.
- Paginación y orden se aplican en servidor para colecciones relevantes.
- Seleccionar una página no altera el total agregado.
- Orden estable para evitar duplicados o saltos entre páginas.
- Tabla numérica con moneda visible, importes alineados y texto largo manejado sin perder información.
- Scroll horizontal confinado a tablas donde sea necesario; no al documento completo.
- Estado y acción no quedan fuera de alcance en móvil.

### Exportación

Debe explicitar “página actual” o “todos los resultados filtrados”. Si hay un límite técnico, se informa y no se etiqueta como exportación completa. Las columnas y filtros de salida corresponden a lo que el usuario está autorizado a ver.

No exportar secretos, claves, tokens ni columnas bloqueadas. Respetar protección frente a fórmulas en campos textuales de CSV/hojas de cálculo. No introducir una implementación de exportación distinta por pantalla.

---

## 11. Cliente 360, Tenant 360 y continuidad comercial

### 11.1 Cliente / partner 360

Encabezado con identidad comercial, país, sociedades y contexto disponible. No inventar un responsable cuando no hay fuente.

Secciones:
1. Resumen.
2. Productos y contratos.
3. Suscripciones, cobros y saldo.
4. Documentos comerciales.
5. Tenants y acceso.
6. Actividad.

Los datos parten de `OrganizationDetailPage`/`Organization360`; no se duplica el módulo. Clientes y partners reutilizan el mismo directorio/ficha con sus vistas y permisos.

### 11.2 Tenant 360

Cuatro dimensiones visibles:

| Dimensión | Qué representa | Qué no implica |
|---|---|---|
| Comercial | Estado del registro/contrato, prueba, facturabilidad. | No demuestra acceso remoto ni salud. |
| Alta técnica | Request y mapping SaaS. | No activa Auth ni cobra. |
| Salud | Última observación de un destino concreto. | No es uptime ni disponibilidad garantizada ahora. |
| Acceso administrador | PREPROVISIONED / estado respaldado por el proveedor. | No implica usuario autenticable sin verificación. |

Un fixture PENDING, mapping ACTIVE, MRR 0 y admin PREPROVISIONED se presenta sin un semáforo global falso.

### 11.3 Nueva venta

Mantener los cinco pasos existentes. Mejorar revisión, mensajes, agrupación y continuidad. Tras guardar, enlazar al tenant o al alta SaaS con contexto.

Ese enlace no ejecuta PROVISION. Si una operación encola DRY_RUN, el mensaje principal lo explica; no afirma que suspendió el acceso en los ocho productos.

### 11.4 Acciones administrativas que pueden conectarse

Solo donde el contrato y permiso existentes lo soportan:
- Gestión de sociedades vinculada a la organización.
- Presentación/edición de capacidades ya definidas.
- Formularios existentes de cliente/tenant, sin cambiar el ciclo de vida.
- Navegación desde alertas, renovaciones y documentos hacia su operación actual.
- Apariencia personal consistente.

Se excluye habilitar por primera vez liquidación masiva, reverso de cobro, cambio de proveedor de pago, administración global de roles o suspensión remota. Los hooks sin uso no constituyen por sí solos autorización funcional.

### 11.5 Login y ayuda

Mantener la anatomía EBIM. Recuperación y solicitud de acceso deben llevar a una ruta/canal real ya disponible; cuando no existe, mostrar explicación honesta. No dejar anclas vacías ni construir un flujo Auth nuevo en esta fase.

---

## 12. Salud, auditoría y trazabilidad

- Mostrar fecha de la comprobación de salud; evitar llamar “en tiempo real” a un dato persistido.
- No inventar un umbral contractual de desactualización. Usar uno existente o presentar antigüedad factual sin declarar SLA.
- Conservar la separación de cola de infraestructura, solicitudes SaaS y estado comercial.
- En solicitud SaaS: identidad lógica, mapping, intentos, error y correlación legibles.
- No modificar cuerpos firmados, claves, scopes ni reintentos para mejorar el layout.
- Auditoría muestra actor, acción, entidad, fecha y diff legible cuando existan ambos lados.
- Si no existe before/after, mostrar metadata disponible; no reconstruir un antes ficticio.
- JSON técnico puede existir en detalle controlado con las mismas restricciones, no como celda principal.
- La referencia documental OS/OC se identifica como referencia, no como archivo subido.
- No almacenar en nuevas vistas valores secretos que antes estaban protegidos.

---

## 13. Cobertura de las 32 páginas

La matriz detallada se encuentra en el Anexo A de este documento. Todos los componentes reciben la base visual compartida. La profundidad funcional prioriza Dashboard, 360, Tenants, Facturación y Operación SaaS; no se agrega un gráfico irrelevante a cada formulario.

Los wrappers de clientes/partners no se reimplementan de manera independiente.

---

## 14. Frontera técnica de cambios

### Permitido por el diseño

- Presentación de `src/app/`, componentes UI, hooks de apariencia/caché y páginas auditadas.
- Organización de consultas y agregaciones de lectura autorizadas.
- Parámetros opcionales del frontend hacia capacidades existentes.
- Consultas de detalle paginadas y nuevas vistas/RPC de lectura aditivas si son necesarias.
- Fixtures y tests locales, sin servicios reales.
- Documentación de métricas y evidencias.

### Protegido

- `supabase/functions/_shared/provisioning/` y lógica de `provisioning-orchestrator`.
- Algoritmos JWT, claves, `secret_ref`, contratos GENERIC/EWM_V1 y guardia de secretos.
- RPC de alta/mapping/idempotencia y tablas de certificación, salvo lecturas.
- Estados remotos de tenants, requests, mappings, planes, precios y credenciales.
- Repos y runtimes de EWM, eSupplier, TMS, Comerza, eChange, eExpense, eCommerce y GMAO.
- Políticas RLS/roles existentes: se prueban y conservan; no se abren para una nueva pantalla.
- Pagos, emails, WhatsApp, cron externo y operaciones productivas.

Ningún script de pruebas puede heredar automáticamente credenciales QAS y empezar a escribir. Los servicios externos se bloquean o sustituyen por fixtures locales, con señalización de que no es evidencia remota.

---

## 15. Calidad y aceptación

### AC01 — Identidad
DM Sans, isotipo, iconos, modo y densidad conservados; no aparece una segunda estética por módulo.

### AC02 — Cobertura
Cada uno de los 32 componentes tiene registro de revisión visual y un estado explícito: completado, sin cambio necesario justificado o pendiente.

### AC03 — Responsive
No hay scroll horizontal global, acciones tapadas o formularios inaccesibles en los viewports acordados.

### AC04 — Componentes
Botones, tablas, tabs, diálogos, formularios y mensajes comparten variantes; desaparece la dependencia de clases inexistentes.

### AC05 — Teclado
Foco visible, confinamiento y retorno de foco; tabs operables; confirmaciones pendientes sin doble envío.

### AC06 — Sesiones
La prueba con dos identidades/alcances no muestra datos residuales ni respuestas tardías de la sesión anterior.

### AC07 — Totales
Más de 200 facturas/costos y más de 300 comisiones no truncan indicadores ni búsqueda.

### AC08 — Temporalidad
Período transaccional, FX y snapshot se distinguen; no se anuncia MRR histórico inexistente.

### AC09 — Monedas
No se suman monedas nativas sin regla; cobertura FX parcial no se transforma en cero completo.

### AC10 — Conciliación
KPI, gráfico, tabla y exportación coinciden para el mismo alcance.

### AC11 — Calidad de datos
Cero, vacío, error, falta de permiso, parcial e indisponible son visual y semánticamente diferentes.

### AC12 — Estados tenant
Comercial, alta técnica, salud y acceso se muestran por separado.

### AC13 — Cuatro perspectivas de uso
Dirección, finanzas, canal/comercial y operación conservan sus permisos efectivos, sin nuevos roles implícitos.

### AC14 — Fuente de cada gráfico
Todos los gráficos tienen unidad, fuente, fecha/período, cobertura y acceso a detalle; no hay series sintéticas en QAS.

### AC15 — Administrativo
Las acciones nuevas de UI están dentro del alcance de §11.4 y consumen contratos/permisos existentes.

### AC16 — Continuidad
Nueva venta enlaza a su resultado/contexto sin ejecutar automáticamente provisioning.

### AC17 — Regresión protegida
Contrato dorado GENERIC, reglas financieras existentes y pruebas sensibles no se modifican para ocultar fallos.

### AC18 — Prueba pendiente
`24_secret_key_rule.test.sql` se ejecuta realmente en un entorno local/CI seguro; si no corre, se informa NOT_RUN y no se declara gate completo.

### AC19 — Operaciones remotas
La validación visual/funcional no genera altas, cobros, mensajes, replays o cambios de catálogo en QAS.

### AC20 — Evidencia
Entrega con capturas, matriz por página, fuentes KPI, resultado real de tests, limitaciones y hashes de la versión validada.

### 15.1 Matriz visual mínima

- Todas las páginas: desktop 1440 en claro; comprobación móvil 390 de estructura e interacción.
- Dashboard, Cliente 360, Tenant 360, Billing, SaasProvisioning e Integrations: también 1280 y 768; modo oscuro en desktop y móvil.
- Componentes compartidos: claro/oscuro y tres densidades.
- Estados: carga, error, vacío, sin permiso, cero, parcial, muchos registros y textos largos.
- Evidencia con fixtures locales controladas; no capturas que expongan credenciales.

No se exige un número artificial de screenshots si varias rutas comparten wrapper, pero cada componente debe enlazar a la evidencia que lo cubre.

### 15.2 Pruebas de datos

Fixtures con pagos parciales/revertidos, factura anulada, saldo negativo según contrato, fecha ausente, rango vacío, FX faltante, múltiples monedas, tenant de prueba explícito, usuario de alcance limitado y dataset superior a límites antiguos.

No cambiar fórmulas de negocio para hacer pasar un snapshot visual. Los resultados esperados derivan de las reglas existentes y de los datos de prueba.

---

## 16. Ejecución nocturna y promoción: límites del futuro plan

El plan deberá definir tareas pequeñas, archivos reales, tests antes/después, responsabilidades y puntos de integración. No se vuelve a auditar la suite completa por rutina.

La ejecución inicial se hará en un worktree aislado de MasterAdmin y con servicios locales/fixtures. Los cambios se integrarán siguiendo el flujo acordado: trabajo validado → dev → PR dev a qas → checks/revisión requerida → promoción autorizada.

Esta especificación no autoriza saltar branch protections, editar permisos del agente, usar bypass, forzar push, leer tokens del llavero ni asumir que un PR despliega Supabase automáticamente.

Si el gate bloquea una operación, se registra una vez y se continúa el trabajo independiente permitido. Se entrega un checklist operador consolidado; no se reintenta la misma acción disfrazada.

Los nuevos agregados SQL, si existen, necesitan plan de migración aditiva, comparación de permisos y compatibilidad frontend/backend. Un entorno sin esa migración debe indicar disponibilidad limitada, no fabricar totales.

No se ejecuta `db push` general sobre un historial con drift. No se reescriben migraciones históricas para esta mejora visual.

### 16.1 Criterio de entrega nocturna

- **Versión candidata completa:** todos los AC aplicables pasan y las páginas tienen evidencia.
- **Versión candidata parcial:** mejora utilizable, con páginas/gates pendientes identificados; no se denomina cierre total.
- **Bloqueado:** existe regresión de seguridad, dinero, datos o contratos protegidos.

Una ejecución larga no garantiza completar todo. La prioridad de presentación es: componentes confiables, inicio ejecutivo, 360 y finanzas; después la uniformidad administrativa restante. Ninguna prioridad justifica omitir permisos o pruebas.

---

## 17. Entregables de la futura implementación

1. Código y tests en commits acotados.
2. Diccionario KPI implementado con vínculos a consultas reales.
3. Inventario de páginas con cambios y evidencia.
4. Capturas antes/después representativas.
5. Informe de pruebas con PASS/FAIL/NOT_RUN y baseline separado.
6. Registro de migraciones de lectura nuevas, si las hubiera.
7. Guía corta del recorrido de demo.
8. Lista única de pendientes y requisitos de promoción.

El resultado esperado es una experiencia profesional que permita explicar qué ocurre y actuar sobre datos confiables, no una afirmación de “seguridad total”, “producción lista” o “negocio automatizado”.

---

## 18. Revisión de esta especificación

El alcance conversacional está aprobado. Se solicita revisar esta especificación escrita, especialmente:
- Los seis KPI y la distinción entre cobros, MRR y margen.
- Los límites de acciones administrativas.
- La exclusión de Auth, pagos productivos y provisioning.
- La prioridad de la entrega nocturna y sus evidencias.

La aprobación de este documento habilita preparar el plan de implementación; no equivale a aprobar un plan todavía inexistente.

**Estado del documento:** ESPECIFICACIÓN_LISTA_PARA_REVISIÓN.  
**Código productivo modificado por esta entrega:** NO.  
**QAS modificado por esta entrega:** NO.  
**Ejecución nocturna iniciada:** NO.



---

## Anexo A. Matriz de diseño por página

Los siguientes paths fueron contrastados con el ZIP de referencia. Las mejoras son objetivos propuestos de esta especificación.

### P01 — Ingreso

**Fuente:** `src/features/auth/LoginPage.tsx`.  
**Hallazgos relacionados:** E08,E09,E14.

**Diseño:** Conservar anatomía EBIM, resolver destinos reales de ayuda/recuperación, errores y contraste.

**Aceptación específica:** Labels, teclado y estados correctos; no enlaces que aparenten recuperar sin flujo.

**Preservar:** Auth existente, sin signup/invite/OTP nuevo.

### P02 — Facturación y cobros

**Fuente:** `src/features/billing/BillingPage.tsx`.  
**Hallazgos relacionados:** E02,E03,E06.

**Diseño:** Separar agregado completo de tabla paginada; saldo, vencimiento y exportación.

**Aceptación específica:** KPI/detail/export concilian con más de 200 facturas y pagos parciales.

**Preservar:** Estados, dinero, monedas y reglas de pago.

### P03 — Costos y margen

**Fuente:** `src/features/billing/CostsPage.tsx`.  
**Hallazgos relacionados:** E02,E03,E05,E06.

**Diseño:** Costo por alcance y categoría; desglose con margen gerencial.

**Aceptación específica:** Más de 200 costos sin pérdida; plataforma/no asignado explicado.

**Preservar:** Sin reparto de costos inventado.

### P04 — Conciliación

**Fuente:** `src/features/billing/ReconciliationPage.tsx`.  
**Hallazgos relacionados:** E06,E17.

**Diseño:** Diferencias priorizadas, causa, fuente y navegación a evidencia.

**Aceptación específica:** No esconder error ni disparar corrección por entrar a la pantalla.

**Preservar:** Sin reparación masiva automática.

### P05 — Renovaciones

**Fuente:** `src/features/billing/RenewalsPage.tsx`.  
**Hallazgos relacionados:** E03,E06,E15.

**Diseño:** Ventanas, urgencia, importe y contrato; bandeja de atención.

**Aceptación específica:** Lista corresponde a ventana y moneda; acciones distinguen revisar/ejecutar.

**Preservar:** Sin renovación/suspensión remota automática.

### P06 — Contrato 360

**Fuente:** `src/features/billing/SubscriptionDetailPage.tsx`.  
**Hallazgos relacionados:** E09,E15,E19.

**Diseño:** Tabs de contrato, ítems, documentos, cobros y actividad; acciones visibles.

**Aceptación específica:** Cadencia y cargo único distinguibles; guardado seguro y contexto intacto.

**Preservar:** Sin cambiar precios/cadencias ni pagos.

### P07 — Suscripciones

**Fuente:** `src/features/billing/SubscriptionsPage.tsx`.  
**Hallazgos relacionados:** E06,E15.

**Diseño:** Cartera contractual, estado, próxima renovación y valor mensual normalizado.

**Aceptación específica:** Estado contractual no se deduce del mapping técnico.

**Preservar:** MRR según contrato vigente.

### P08 — Capacidades

**Fuente:** `src/features/catalog/FeatureFlagsPage.tsx`.  
**Hallazgos relacionados:** E06,E13.

**Diseño:** Lectura clara de capacidad, alcance y disponibilidad; edición autorizada existente.

**Aceptación específica:** No asignar capacidad fuera de permiso ni confundir default con override.

**Preservar:** Sin nuevos derechos comerciales implícitos.

### P09 — Planes y licencias

**Fuente:** `src/features/catalog/PlansPage.tsx`.  
**Hallazgos relacionados:** E06,E13.

**Diseño:** Plan, precio, moneda, periodicidad, vigencia y límites comparables.

**Aceptación específica:** Ausencia de precio no aparece como plan gratis; cargos únicos separados.

**Preservar:** Sin pricing ficticio.

### P10 — Producto 360

**Fuente:** `src/features/catalog/ProductDetailPage.tsx`.  
**Hallazgos relacionados:** E02,E05,E18.

**Diseño:** Cartera, contratos, cobros, margen y destinos en una ficha.

**Aceptación específica:** Importes reconciliables; dato no autorizado omitido.

**Preservar:** No inferir certificación de ACTIVE.

### P11 — Suite SaaS

**Fuente:** `src/features/catalog/ProductsPage.tsx`.  
**Hallazgos relacionados:** E04,E06,E18.

**Diseño:** Portafolio de productos con estado comercial y técnico separado.

**Aceptación específica:** Número de productos y estados vienen de datos, no un hardcode 8/8.

**Preservar:** Preservar catálogo y mappings.

### P12 — Atribuciones

**Fuente:** `src/features/commercial/AttributionsPage.tsx`.  
**Hallazgos relacionados:** E06,E13.

**Diseño:** Relacionar ejecutivo, cliente/producto, vigencia y comisión.

**Aceptación específica:** La lectura no cambia titularidad o porcentaje.

**Preservar:** Reglas de atribución vigentes.

### P13 — Reglas de comisión

**Fuente:** `src/features/commercial/CommissionPlansPage.tsx`.  
**Hallazgos relacionados:** E06,E13.

**Diseño:** Reglas y ejemplos de lectura comprensibles.

**Aceptación específica:** Preview utiliza regla existente; no sustituye la liquidación real.

**Preservar:** Sin nuevas fórmulas comerciales.

### P14 — Comisiones

**Fuente:** `src/features/commercial/CommissionsPage.tsx`.  
**Hallazgos relacionados:** E02,E03,E06,E13.

**Diseño:** Totales completos por moneda/estado y detalle paginado.

**Aceptación específica:** Más de 300 eventos sin truncación; pagado y pendiente separados.

**Preservar:** No exponer nueva liquidación/reverso.

### P15 — Equipo comercial

**Fuente:** `src/features/commercial/SalesAgentsPage.tsx`.  
**Hallazgos relacionados:** E06,E12.

**Diseño:** Cartera y atribuciones disponibles por ejecutivo.

**Aceptación específica:** Sin embudo de oportunidades, contactos o actividad inventada.

**Preservar:** Alcance del comercial preservado.

### P16 — Resumen ejecutivo

**Fuente:** `src/features/dashboard/DashboardPage.tsx`.  
**Hallazgos relacionados:** E01,E02,E03,E04,E05.

**Diseño:** Perspectivas, seis KPI, gráficos disponibles y atención requerida.

**Aceptación específica:** Cumple diccionario K01–K06, sin 19 tarjetas equivalentes ni métricas sin fuente.

**Preservar:** Finanzas y operación no se confunden.

### P17 — Entornos y despliegues

**Fuente:** `src/features/deployments/DeploymentsPage.tsx`.  
**Hallazgos relacionados:** E06,E18.

**Diseño:** Destinos por producto/entorno, salud fechada y contexto sensible.

**Aceptación específica:** Ambiente visible; DRAFT o disabled no aparenta fallo de uptime.

**Preservar:** No habilitar al consultar.

### P18 — Solicitudes de infraestructura

**Fuente:** `src/features/deployments/ProvisioningPage.tsx`.  
**Hallazgos relacionados:** E04,E06,E15.

**Diseño:** Cola y timeline propios, diferenciados de alta SaaS.

**Aceptación específica:** DRY_RUN y resultado real explícitos; errores completos.

**Preservar:** No lanzar jobs por navegación.

### P19 — Altas SaaS

**Fuente:** `src/features/deployments/SaasProvisioningPage.tsx`.  
**Hallazgos relacionados:** E04,E07,E15,E19.

**Diseño:** Request, intentos, mapping, error y capacidades en una operación legible.

**Aceptación específica:** Sin nueva solicitud al volver/recargar; acciones según capacidad real.

**Preservar:** Idempotencia y contratos inmutables.

### P20 — Nueva venta

**Fuente:** `src/features/onboarding/OnboardingPage.tsx`.  
**Hallazgos relacionados:** E09,E15,E19.

**Diseño:** Cinco pasos claros, revisión económica y enlace contextual al resultado.

**Aceptación específica:** Guardar no ejecuta alta SaaS ni mensajes externos automáticamente.

**Preservar:** DRY_RUN/activación conforme al flujo vigente.

### P21 — Clientes

**Fuente:** `src/features/organizations/CustomersPage.tsx`.  
**Hallazgos relacionados:** E06,E12,E16.

**Diseño:** Vista cliente coherente del directorio compartido.

**Aceptación específica:** Mismos componentes/permisos; no duplicar CRUD.

**Preservar:** Misma identidad de organización.

### P22 — Cliente / partner 360

**Fuente:** `src/features/organizations/OrganizationDetailPage.tsx`.  
**Hallazgos relacionados:** E02,E13,E16,E17.

**Diseño:** Secciones de cartera, sociedades, contratos, cobros, tenants y actividad.

**Aceptación específica:** Consultas por organización; cada sección distingue error/vacío.

**Preservar:** Alcance y atributos sensibles preservados.

### P23 — Directorio corporativo

**Fuente:** `src/features/organizations/OrganizationsPage.tsx`.  
**Hallazgos relacionados:** E06,E12,E16.

**Diseño:** Buscador/tabs y acceso consistente a 360.

**Aceptación específica:** Navegación de clientes/partners unificada sin eliminar rutas.

**Preservar:** No fusionar organizaciones.

### P24 — Partners y canales

**Fuente:** `src/features/organizations/PartnersPage.tsx`.  
**Hallazgos relacionados:** E06,E12,E16.

**Diseño:** Cartera, acuerdos y contribución desde el alcance autorizado.

**Aceptación específica:** Partner no ve agregado global de EBIM.

**Preservar:** RLS y acuerdos comerciales vigentes.

### P25 — Integración SaaS

**Fuente:** `src/features/platform/IntegrationDetailPage.tsx`.  
**Hallazgos relacionados:** E07,E09,E18,E19.

**Diseño:** Resumen operativo al inicio; parámetros avanzados en segundo nivel.

**Aceptación específica:** Capacidades y estado legibles sin mostrar valor de secreto.

**Preservar:** No alterar claims, rutas ni secret_ref.

### P26 — Matriz de integraciones

**Fuente:** `src/features/platform/IntegrationsPage.tsx`.  
**Hallazgos relacionados:** E04,E06,E18.

**Diseño:** Filtro analítico de entorno, salud observada y configuración.

**Aceptación específica:** Resumen no mezcla targets de diferentes entornos.

**Preservar:** Certificación requiere evidencia, no enabled.

### P27 — Monedas y FX

**Fuente:** `src/features/regional/RegionalPage.tsx`.  
**Hallazgos relacionados:** E03,E06.

**Diseño:** Fecha FX, cobertura y alcance separados del período financiero.

**Aceptación específica:** FX incompleto identificable; no total consolidado falso.

**Preservar:** Reglas FX y redondeo actuales.

### P28 — Auditoría

**Fuente:** `src/features/settings/AuditPage.tsx`.  
**Hallazgos relacionados:** E06,E17.

**Diseño:** Actor, entidad, acción, diff disponible, correlación y páginas.

**Aceptación específica:** No JSON crudo como primera lectura; no secretos en export/detalle.

**Preservar:** Registro append-only intacto.

### P29 — Página no encontrada

**Fuente:** `src/features/settings/NotFoundPage.tsx`.  
**Hallazgos relacionados:** E12,E20.

**Diseño:** Mensaje y retorno a navegación autorizada coherentes con EBIM.

**Aceptación específica:** Sin bucle de redirección ni exposición de rutas no autorizadas.

**Preservar:** Guardas de ruta preservadas.

### P30 — Preferencias

**Fuente:** `src/features/settings/SettingsPage.tsx`.  
**Hallazgos relacionados:** E10,E11.

**Diseño:** Estado compartido de apariencia, perfil y entorno claros.

**Aceptación específica:** Cambio modo/densidad consistente; persistencia real declarada.

**Preservar:** No nuevo administrador global de roles.

### P31 — Tenant 360

**Fuente:** `src/features/tenants/TenantDetailPage.tsx`.  
**Hallazgos relacionados:** E07,E09,E15.

**Diseño:** Cuatro dimensiones, contrato, producto, acceso, timeline y acciones.

**Aceptación específica:** PENDING/ACTIVE/PREPROVISIONED coexisten sin texto engañoso.

**Preservar:** No afirmar suspensión remota por cambio comercial.

### P32 — Tenants

**Fuente:** `src/features/tenants/TenantsPage.tsx`.  
**Hallazgos relacionados:** E04,E06,E15.

**Diseño:** Estado comercial/técnico/admin, entorno y acceso a ficha.

**Aceptación específica:** Filtros de estado coherentes; muestra desconocido cuando no hay fuente.

**Preservar:** No cambiar estados para la demo.

---

## Anexo B. Trazabilidad de los 20 hallazgos

| Hallazgo | Secciones de diseño | Aceptación | Resultado buscado |
|---|---|---|---|
| E01 | 6–8 / P16 | AC01, AC14 | Dashboard jerarquizado; no se pierden datos. |
| E02 | 8–10 / Billing, Costs, Commissions, 360 | AC07, AC10 | Agregado completo y detalle paginado. |
| E03 | 8–9 / Finanzas y FX | AC08, AC09 | Período separado de valuación. |
| E04 | 7.3, 11.2, 12 | AC12, AC14 | Infraestructura, SaaS y comercial separados. |
| E05 | 8 / K01–K05 | AC08, AC14 | No histórico de MRR inventado. |
| E06 | 6.5, 10 / páginas de lista | AC04, AC07, AC10 | API compatible de tabla. |
| E07 | 6.5 | AC04 | Variante secundaria centralizada. |
| E08 | 6.4 | AC01, AC03, AC05 | Contraste y foco renderizados. |
| E09 | 6.5, 15.1 | AC05 | Modal y tabs por teclado. |
| E10 | 4.1, 6.1, 11.4 | AC01, AC06 | Apariencia compartida por usuario. |
| E11 | 4.1, 9 | AC06 | Hipótesis reproducida o descartada, sin afirmarla como incidente. |
| E12 | 5 | AC01, AC13, AC16 | Rutas conservadas y etiquetas humanas. |
| E13 | 11.4 | AC15 | Solo operaciones administrativas acotadas. |
| E14 | 11.5 | AC04, AC15 | Ayuda real; sin nuevo Auth. |
| E15 | 11.2–11.3, 12 | AC12, AC16, AC19 | No promesas de ejecución remota. |
| E16 | 9.3, 11.1 | AC07, AC10, AC11 | Consultas por alcance y estado por sección. |
| E17 | 10, 12 | AC10, AC15, AC20 | Auditoría legible; referencia no es upload. |
| E18 | 7.3, 12 | AC11, AC12, AC14 | Salud por entorno y timestamp. |
| E19 | 6.5, 14 | AC03, AC17 | Descomposición solo si sirve a la mejora; sin cambio mayor de stack. |
| E20 | 15–17 | AC02, AC18, AC20 | Validación visual y funcional efectiva. |


## Anexo C. Referencias concretas del baseline

Estas referencias describen la fuente recibida; no prueban que el remoto actual tenga esos mismos bytes.

- Shell/rutas: `src/app/App.tsx`, `src/app/AppShell.tsx`, `src/app/navigation.ts`.
- Marca/componentes: `src/app/tokens.css`, `src/app/index.css`, `src/components/ui/primitives.tsx`, `FormDialog.tsx`, `ConfirmDialog.tsx`, `SectionTabs.tsx`.
- Sesión/apariencia: `src/features/auth/AuthContext.tsx`, `src/features/auth/session.ts`, `src/hooks/useAppearance.ts`.
- Datos: `src/services/queries.ts`, `src/services/mutations.ts`.
- Dashboard: `src/features/dashboard/DashboardPage.tsx`, `RegionalFinancePanel.tsx`.
- Ficha corporativa: `src/features/organizations/Organization360.tsx`.
- Finanzas: `supabase/migrations/20260913000800_v3_consolidated_finance.sql`.
- Semántica económica: `docs/finance/COST_MARGIN_MODEL.md`.
- Convenciones: `docs/architecture/EBIM_CONVENTIONS.md`.
- Baseline de pruebas de navegador: `playwright.config.ts`.
- Fragmentos y líneas específicas: auditoría de referencia, E01–E20 y su Anexo A.

Cuando código y documentación difieren, el plan posterior debe registrar el desvío. Por ejemplo, la fuente usa Phosphor aunque una sección antigua de convenciones mencione SVG propios. El diseño conserva la biblioteca realmente presente; no reintroduce una segunda familia de iconos.
