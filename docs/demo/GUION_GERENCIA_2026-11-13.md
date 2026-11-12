# Guion de demo para Gerencia · Admin Maestro (13-nov-2026)

**Mensaje central:** desde una sola consola, EBIM ve, da de alta y gobierna los tenants de las 8 apps de la suite.

- URL: https://adminmaestro.pages.dev (ambiente QAS)
- Usuario: super admin EBIM (las credenciales se entregan aparte)
- Duración sugerida: 12–15 minutos

## 1. Resumen ejecutivo (2 min)
1. Entra en **Inicio › Resumen**. Muestra los KPIs, el MRR por moneda y el panel «Requiere atención».
2. Opcional: activa el **modo presentación** (`/?presentacion=1`) y el interruptor «Ocultar nombres» si proyectas.

> «Este es el pulso del negocio: ingresos recurrentes, cobranza y alertas, en todas las monedas sin mezclarlas.»

## 2. Centro de la suite: las 8 apps de un vistazo (4 min)
1. Entra en **Suite › Centro de la suite**.
2. Recorre la **franja de salud**: eSupplier, EWM, TMS, GMAO, eChange, eExpense, eCommerce y Comerza, cada una con su luz.
3. Pulsa **«Verificar ahora»** en una app. Es una verificación real contra la app en vivo, y la hora del chequeo se actualiza.
4. Baja a la **matriz cuenta × app**. Cada fila es un cliente y cada columna una app.
   - Usa el filtro **«Activas»**: son los tenants que existen de verdad dentro de cada app.
   - Abre una celda y se abre el panel lateral con el detalle y las acciones (ver tenant, suspender o reactivar, reintentar alta).

> «Antes había que entrar a cada app por separado. Ahora vemos aquí qué cliente está en qué app y en qué estado.»

## 3. Ficha de una app (2 min)
1. En una tarjeta de app, entra en **«Ver ficha»**, por ejemplo eChange o EWM.
2. Recorre las pestañas: Resumen, Tenants, Conexión (cómo se conecta de forma segura, sin mostrar secretos) e Historial de altas.

## 4. Dar de alta un tenant en vivo (4 min) — el momento fuerte
1. En **Suite › Tenants**, pulsa **«Nuevo tenant»**. Elige la app (recomendado: **eChange**, **TMS** o **EWM**), el cliente, un nombre y el correo del administrador.
2. Ve a **Suite › Apps**, pestaña **«Altas en las apps»**. Pulsa **«Nueva solicitud»**, elige el tenant y el ambiente **QAS**, y pulsa **«Crear solicitud»**. En la fila nueva pulsa **«Ejecutar alta»**.
3. Se ve el resultado «Activo», con el identificador que devolvió la app. Es una llamada real y firmada a la app.
4. Vuelve al **Centro de la suite**: aparece la celda nueva. Ábrela y confirma el estado activo.

> «En menos de un minuto el cliente queda creado dentro de la app, con trazabilidad y auditoría.»

**Ensayo hecho el 12-nov:** el alta de «Textiles Arequipa · eChange» desde MasterAdmin respondió ACTIVE y la app eChange registró el tenant. Para la demo usa otro nombre y otro código para no repetir.
**No uses eExpense ni GMAO para el alta en vivo.** El QAS de eExpense es un sistema en uso por un cliente, y GMAO comparte un único proyecto para todos sus ambientes.

## 5. Cuenta 360 y cobranza (2 min, opcional)
1. Entra en **Clientes › Cuentas**, abre un cliente y muestra sus tenants, contratos y facturación.
2. En **Finanzas › Cobranza** muestra las facturas, los cobros y el portal de pago del cliente (`/pagar`).

## Qué decir de lo que viene (honesto)
| Capacidad | Estado hoy | Siguiente paso |
|---|---|---|
| Alta de tenants en las 8 apps | ✅ Operativa y verificada | — |
| Salud de las apps | ✅ Verificación bajo demanda | Chequeo automático programado |
| Suspensión o reactivación dentro de la app | ⏳ Registrada en MasterAdmin; las apps tienen el receptor desarrollado pero no desplegado | Desplegar `lifecycle.v1` en las 8 apps |
| Módulos habilitados por contrato | ⏳ Diseñado y probado en desarrollo; apagado en QAS | Cargar el catálogo de capacidades y activar la sincronización |
| Consumo y uso por app | ⏳ Apagado en QAS | Activar la ingesta de uso |
| Usuarios de cada app desde aquí | ⏳ Hoy gestiona los usuarios de la consola | Canal de usuarios/SSO |

## Antes de entrar a la reunión (checklist)
- [ ] Abrir la URL e iniciar sesión 10 minutos antes.
- [ ] Pulsar «Verificar ahora» en las 8 apps (Render puede tardar ~30 s en despertar TMS y EWM).
- [ ] Tener a mano el nombre y el código del tenant que se creará en vivo.
- [ ] Si se proyecta, usar 1440 px de ancho o más y el modo claro.
