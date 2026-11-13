# Guion de demo para Gerencia · Admin Maestro (13-nov-2026)

**Mensaje central:** desde una sola consola, EBIM ve, da de alta y gobierna los tenants de las 8 apps de la suite.

- URL: https://adminmaestro.pages.dev (ambiente QAS)
- Usuario: super admin EBIM (las credenciales se entregan aparte)
- Duración sugerida: 15–18 minutos
- Versión: V5 completa (F0–F7) más el ciclo de vida del tenant, con la mejora visual V6 (franjas compactas, tablas densas, franja de salud compacta). Ensayada de punta a punta en la web publicada el 12-nov por la noche; los pasos se revisaron sobre la UI V6 el 13-nov.

## Mapa de la consola (para orientarse)
| Grupo | Entradas |
|---|---|
| Inicio | Resumen · Bandeja |
| Clientes | Cuentas · Partners · Equipo comercial |
| Suite | Centro de la suite · Tenants · Apps |
| Comercial | Nueva venta · Contratos · Catálogo |
| Finanzas | Cobranza · Comisiones · Costos y margen · Tarifas de partners |
| Gobierno | Usuarios · Auditoría · Configuración |

Atajo: **⌘K** (o el buscador de arriba) encuentra cualquier cliente, tenant o pantalla, y lanza acciones como «Nuevo tenant» o «Verificar salud de las apps».

---

## 1. Resumen y bandeja (2 min)
1. Entra en **Inicio › Resumen**. Muestra los KPIs, el MRR por moneda y el panel «Requiere atención». Arriba, una sola barra de filtros (moneda, mes analizado, horizonte) y el botón «Presentar».
2. Abre **Inicio › Bandeja**. Son los pendientes reales del día (unos 35), cada uno con su acción directa: cobros vencidos, contratos por renovar, altas por confirmar. La campana de arriba muestra el mismo contador.
3. Opcional, si proyectas: modo presentación (`/?presentacion=1`) e interruptor «Ocultar nombres».

> «Este es el pulso del negocio y lo que hay que hacer hoy, en una sola bandeja.»

## 2. Centro de la suite: las 8 apps de un vistazo (3 min)
1. Entra en **Suite › Centro de la suite**.
2. Recorre la **franja de salud**, una fila compacta con las 8 apps: eSupplier, EWM, TMS, GMAO, eChange, eExpense, eCommerce y Comerza. Cada app muestra su punto de salud y hace cuánto se comprobó; encima, una sola línea dice los canales activos («Alta en 8 de 8 · Módulos · Uso · Suspensión»).
3. Pulsa una app de la franja (por ejemplo **TMS**): se abre su **globo** con la salud, la última comprobación, los cuatro canales y dos botones, **«Ver ficha»** y **«Verificar ahora»**. Pulsa **«Verificar ahora»**: es una llamada real y firmada a la app en vivo, y la hora se actualiza. (El «Verificar ahora» de la cabecera verifica las 8 de una vez; Escape o un clic fuera cierra el globo.)
4. Baja a la **matriz cuenta × app**: una fila por cliente y una columna por app.
5. Abre una celda: se abre el detalle con el tenant, su contrato, sus módulos y las acciones posibles.

> «Antes había que entrar a cada app por separado. Ahora vemos aquí qué cliente está en qué app y en qué estado.»

## 3. Ficha de una app (1 min)
1. En el globo de una app de la franja, entra en **«Ver ficha»** (eChange o TMS).
2. Recorre las pestañas: Resumen, Tenants, Conexión (cómo se conecta de forma segura, sin mostrar secretos) e Historial (el historial de altas). Arriba queda fija la cabecera de la app con su salud.

## 4. Dar de alta un tenant en vivo (4 min) — el momento fuerte
**Datos a usar** (aún no existen; ninguno se ha usado en ensayos):

| | Opción principal | Respaldo |
|---|---|---|
| Cliente | **Minera Illimani** | **Comercial Santa Cruz** |
| App | **TMS** | **eChange** |
| Nombre del tenant | Minera Illimani · TMS | Comercial Santa Cruz · eChange |
| Código | `minera-illimani-tms` | `comercial-santa-cruz-echange` |
| Correo del administrador | `ti@minera-illimani.test` | `ti@santacruz.test` |

Pasos:
1. Entra en **Suite › Tenants** y pulsa **«Nuevo tenant»** (o ⌘K › «Nuevo tenant»).
2. **Paso 1 · Cuenta y app:** elige el cliente y la app. Pulsa **«Continuar»**.
3. **Paso 2 · Tenant:** deja «Venta directa EBIM», «Compartido» y «Producción». Escribe el nombre, el código y el correo del administrador. Pulsa **«Crear tenant»**.
4. **Paso 3 · Alta en la app:** en la fila de la app pulsa **«Solicitar alta»** y luego **«Ejecutar alta»**.
5. En unos 10–15 segundos el resultado pasa a **«Activo»**. Abajo a la izquierda, la cola de **Tareas** muestra «Alta activa en TMS» con el enlace al tenant.
6. Vuelve a **Centro de la suite**. La celda nueva dice **«Activo en la app · pendiente de confirmar en MasterAdmin»**. Ábrela y pulsa **«Confirmar como activo»** › **«Confirmar como activo»**. La celda pasa a «Activo» y el cambio queda en la auditoría.

> «En menos de un minuto el cliente queda creado dentro de la app, con trazabilidad y auditoría. La confirmación final la da una persona: nada cambia solo.»

**Ensayos hechos el 12-nov por la noche en la web publicada:**
- «GRUPASA · TMS» con el asistente completo: Activo en 16 s y confirmado desde la matriz.
- «Industrias Titán · TMS»: Activo y confirmado.

**No uses estas apps para el alta en vivo:**
- **EWM:** pide además una empresa y una configuración de producto que este asistente no captura, y rechaza el alta («Precondiciones no cumplidas»). Se comprobó en el ensayo.
- **eExpense:** su QAS es un sistema en uso por un cliente.
- **GMAO:** comparte un único proyecto para todos sus ambientes.

## 5. Cuenta 360 (2 min)
1. Entra en **Clientes › Cuentas** y abre **Industrias Titán**.
2. Muestra la cabecera fija: estado, salud de cobranza («Con deuda vencida»), MRR, saldo vencido, apps activas y responsable comercial.
3. Muestra el bloque **«¿En qué paso está el alta del cliente?»**: cuenta, contrato, factura, enlace de pago, pago y alta en las apps.
4. Recorre las pestañas **Apps y accesos**, **Contratos y cobranza** y **Actividad**.

> «Todo lo de un cliente en una ficha: qué contrató, qué debe y en qué apps está.»

## 6. Ciclo de vida: cobranza y cortes (2 min)
1. Desde **Centro de la suite**, pulsa **«Ciclo de vida y cortes»** (arriba a la derecha).
2. Muestra los KPIs: tenants activos, en gracia, **por suspender** y suspendidos.
3. Recorre las pestañas: Matriz de la suite, Cobranza y cortes, Historial de suspensiones, y Política y tareas programadas.
4. Pulsa **«Simular ciclo»**: muestra qué pasaría sin cambiar nada.

> «La regla de corte por impago vive en la base. Hoy el corte automático está apagado: decide una persona, y todo queda auditado.»

**No pulses «Ejecutar ciclo ahora»** durante la demo.

## 7. Cobranza (1 min, opcional)
1. En **Finanzas › Cobranza** muestra las pestañas de facturas, cobros y «Por cobrar».
2. Menciona el portal de pago del cliente (`/pagar`).

---

## Qué decir de lo que viene (honesto)
| Capacidad | Estado hoy | Siguiente paso |
|---|---|---|
| Alta de tenants en las apps | ✅ Operativa y ensayada (TMS, eChange) | EWM: capturar empresa y configuración en el asistente |
| Salud de las 8 apps | ✅ Verificación bajo demanda, real | Chequeo automático programado |
| Confirmación del tenant activo | ✅ Un clic, auditado | Que se confirme solo cuando la app responde «Activo» |
| Ciclo de vida (gracia, corte y reactivación) | ✅ Desplegado en MasterAdmin, con el corte automático apagado | Activar la política con la regla de negocio aprobada |
| Suspensión dentro de cada app | ⏳ MasterAdmin ya la decide y la registra; las apps tienen el receptor desarrollado pero no desplegado | Desplegar `lifecycle.v1` en las 8 apps |
| Módulos habilitados por contrato | ⏳ Jobs instalados; apagados hasta configurar sus credenciales | Cargar el catálogo de capacidades y activar la sincronización |
| Consumo por app | ⏳ Apagado en QAS | Activar la ingesta de uso |
| Usuarios de cada app desde aquí | ⏳ Hoy gestiona los usuarios de la consola | Canal de usuarios/SSO |
| Envío de correos (invitaciones) | ⏳ Sin SMTP configurado | Configurar el correo transaccional |

## Antes de entrar a la reunión (checklist)
- [ ] Abrir la URL e iniciar sesión 10 minutos antes.
- [ ] ⌘K › escribe «verificar» › **«Verificar salud de las apps»** (abre el Centro de la suite y verifica las 8; cada una aparece en la cola de Tareas). También sirve el «Verificar ahora» de la cabecera del Centro de la suite, o el del globo de cada app. Render puede tardar unos 30 s en despertar TMS y EWM.
- [ ] Confirmar que el cliente del alta en vivo **no tiene ya** un tenant en esa app: en la matriz, la celda debe estar vacía («—»).
- [ ] Tener a mano los datos de la tabla del paso 4.
- [ ] Si se proyecta: 1440 px de ancho o más, modo claro y zoom del navegador al 100 %.
- [ ] Cerrar las notificaciones del sistema operativo.

## Si algo falla en vivo
- **La app tarda o el alta queda «En curso»:** la cola de Tareas lo muestra. Sigue con el paso 5 y vuelve después a la ficha del tenant.
- **La app rechaza el alta:** la fila muestra el motivo y el botón «Reintentar». Cambia a la opción de respaldo (eChange).
- **Se cae la sesión:** vuelve a iniciar sesión. Lo creado ya está guardado y se retoma desde la ficha de la cuenta con «Dar de alta en las apps».
