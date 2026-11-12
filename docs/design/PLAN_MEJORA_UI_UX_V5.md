# Plan de mejora integral de UI/UX · Admin Maestro V5

Fecha: 2026-11-12. Base: `dev` = `f777588`, con el rediseño visual V4 ya incluido.
Evidencia: código de `src/`, capturas de `docs/superpowers/evidence/visual-gerencia/capturas/despues/` y la auditoría de la nube del mismo día.

## 1. Diagnóstico en una frase

La V4 dejó una **base visual sólida**: tokens, tema claro/oscuro AA, componentes compartidos, KPIs, ⌘K y modo presentación.
La consola, sin embargo, sigue organizada **como la base de datos y no como el trabajo**. Tiene 32 entradas de menú, la misma entidad en tres pantallas, la conexión con las apps repartida en cinco pantallas, jerga técnica a la vista y ningún flujo de punta a punta.
La V5 no repinta: **reorganiza en torno a tareas y a la suite**.

## 2. Qué se conserva (no tocar)

- Los tokens (`src/app/tokens.css`), la escala tipográfica, DM Sans, el tema claro/oscuro con 116/116 pares AA y la paleta de gráficos validada.
- Las tarjetas KPI con tendencia, los montos en moneda de reporte con el desglose nativo y la regla de no sumar monedas distintas.
- El conmutador Gráfico/Tabla, los títulos en forma de pregunta, el panel «Requiere atención» y el modo presentación con «Ocultar nombres».
- ⌘K, las migas, el foco al `h1`, los errores traducidos (`src/lib/pgError`) y las pestañas de estado con contador.
- El portal `/pagar` en móvil.

## 3. Principios de la V5

1. **Tarea antes que tabla.** Cada pantalla responde «¿qué tengo que hacer hoy?» antes de «¿qué hay en la tabla?».
2. **La suite es el centro.** Toda ficha de cliente muestra sus apps, su estado y sus accesos.
3. **Una entidad, una casa.** Organización, tenant, contrato y factura tienen una sola pantalla dueña.
4. **Lenguaje de negocio.** Nada de RPC, DRY_RUN, slug, shadow, cutover, M2M ni nombres de vistas SQL en la UI de negocio. Lo técnico va a «Avanzado».
5. **Siempre la siguiente acción.** Los estados vacíos, los errores y las alertas terminan en un botón.

## 4. Nueva arquitectura de información (de 32 entradas a 17)

| Grupo | Entradas | Qué absorbe |
|---|---|---|
| **Inicio** | Resumen · Bandeja | Resumen ejecutivo; «Requiere atención» pasa a ser una bandeja global |
| **Clientes** | Cuentas · Partners · Equipo comercial | Clientes + Directorio corporativo → **Cuentas** (filtro por tipo); Atribuciones pasa a ser una pestaña de la cuenta y del vendedor |
| **Suite** | Centro de la suite · Tenants · Apps | Integraciones + Entornos + Altas SaaS + Infraestructura + Sincronización → **Apps** (ficha por app); Uso pasa a ser una pestaña |
| **Comercial** | Nueva venta · Contratos · Catálogo | Suite SaaS, Planes, Add-ons, Capacidades y Registro de capacidades → **Catálogo** con pestañas |
| **Finanzas** | Cobranza · Comisiones · Costos y margen · Tarifas de partners | Facturación + Conciliación + Renovaciones → **Cobranza**; Comisiones + Planes de comisión → **Comisiones** |
| **Gobierno** | Usuarios · Auditoría · Configuración | Regional/FX y Créditos IA pasan a Configuración; Billing shadow y el registro técnico pasan a «Avanzado» (solo super admin) |

Las rutas viejas redirigen a la nueva casa, para que los enlaces y marcadores sigan funcionando.

## 5. Fases

### F0 · Base técnica (≈1 semana)
- Carga diferida por ruta (`React.lazy`) en las ~43 páginas que hoy entran en el chunk principal de 1,76 MB. Meta: menos de 450 KB gzip de carga inicial.
- `PagedTable` en todos los listados: hoy solo 5 la usan, y Tenants llega a 6.699 px de alto.
- Cerrar la deuda de consistencia:
  - 127 usos de `text-xs`/`text-sm`;
  - 11 `<table>` crudas;
  - 8 `<select>` nativos;
  - `input type=month` y fechas ISO → selector de período en español.
- Separar las páginas gigantes (`OnboardingPage` 821 líneas, `PaymentPortalPage` 841, `ExecutivePerspective` 823) en piezas reutilizables.
- Fijar Node 24 en CI y en Cloudflare (`NODE_VERSION`).

### F1 · Navegación y lenguaje (≈1 semana)
- El nuevo menú de 17 entradas, con los grupos plegados por rol (el partner y el técnico ven menos).
- Un **glosario de negocio** aplicado a toda la UI. Ejemplos:
  - DRY_RUN → «Simulación»;
  - Provisioning → «Alta en la app»;
  - Entitlements → «Módulos habilitados»;
  - Cutover → «Migración de cobro»;
  - Slug → «Código».
  - Decidir con el dueño si «tenant» se mantiene o pasa a «Espacio».
- Quitar del pie de los gráficos los nombres de vistas SQL (`executive_mrr_series`…) y las referencias a contratos (§4.4).

### F2 · Centro de la suite (≈2 semanas) — la pieza que falta
- **Franja de salud de las 8 apps**: luz por app y ambiente (salud, último chequeo, versión de contrato, canal de suspensión sí/no), con «Verificar ahora».
- **Matriz cuenta × app**: en cada celda, el estado de alta, de la suscripción, de los módulos, de suspensión y de uso, y la última sincronización. Un clic abre el detalle con las acciones (reintentar alta, sincronizar módulos, suspender o reactivar).
- **Ficha de app** (reemplaza las 5 pantallas técnicas). Pestañas: Resumen · Tenants · Conexión (endpoints, llaves, scopes) · Sincronización · Uso · Historial.
- Corregir el estado: el tenant pasa a ACTIVO cuando la app confirma el alta. Hoy queda en PENDING, con la app en ACTIVE.

### F3 · Ficha 360 de la cuenta (≈1,5 semanas)
- Cabecera fija con estado de salud, MRR, saldo vencido, apps activas y responsable comercial.
- Las 10–12 pestañas actuales quedan en 5: **Resumen · Apps y accesos · Contratos y cobranza · Personas · Actividad**.
- La auditoría en contexto («Actividad») en cada ficha: cuenta, tenant, contrato y app.
- La ficha de tenant con el mismo esquema, sin códigos de infraestructura en tamaño KPI.

### F4 · Flujos guiados de punta a punta (≈2 semanas)
- **Alta de cliente:** cuenta → plan y precio → contrato → primera factura → enlace de pago → alta en las apps, con un hilo visible que muestra en qué paso está cada cliente. Reemplaza «Nuevo tenant» y unifica con Nueva venta.
- **Cobranza:** bandeja de vencidas con acciones por fila (enviar enlace, registrar pago, programar cobro con tarjeta, suspender por mora con vista previa del impacto por app).
- **Emitir factura** como acción primaria de Cobranza, que hoy solo existe dentro del contrato.
- **Suspender / reactivar** con confirmación que muestra qué apps y usuarios se ven afectados.

### F5 · Bandeja, búsqueda y avisos (≈1 semana)
- Campana en el topbar y una **Bandeja** con lo que requiere acción (vencidas, altas fallidas, apps caídas, documentos por aprobar, renovaciones), asignable y con «hecho».
- ⌘K ampliado a facturas, pagos, usuarios, partners, apps y acciones («Emitir factura a…»).
- Los toasts de operaciones largas pasan a ser una cola visible de tareas en curso.

### F6 · Usuarios y accesos de la suite (≈1 semana; depende del backend)
- En la ficha de usuario, a qué apps entra, con qué rol y su estado en cada una. Hoy solo dice «1 tenant».
- Invitar, suspender y reactivar a un usuario en una o varias apps desde un solo lugar, cuando exista el canal SSO/usuarios.

### F7 · Responsive, accesibilidad y pulido (≈1 semana)
- Tablet real: menú lateral colapsable desde `md`.
- Móvil «de consulta»: Resumen con KPIs y bandeja; las tablas pasan a tarjetas.
- Gráficos legibles a 390 px: hoy el eje de cobranza se superpone.
- Stepper con texto, gráficos con descripción equivalente y esqueletos de carga en lugar de spinners.
- Los KPI sin datos se ven como «sin datos», no con el peso de una cifra real.

## 6. Métricas de éxito

| Métrica | Hoy | Meta |
|---|---|---|
| Entradas de menú | 32 | 17 |
| Carga inicial JS (gzip) | ≈483 KB | < 450 KB, con la mayoría de pantallas fuera del inicial |
| Altura del listado más largo | 6.699 px | ≤ 1 viewport + paginación |
| Pantallas para dar de alta a un cliente completo | 5–6 | 1 flujo guiado |
| Pantallas para saber si una app está bien | 5 | 1 (Centro de la suite) |
| Términos técnicos en la UI de negocio | ≈560 | 0 fuera de «Avanzado» |
| Contraste AA / e2e de teclado | 116/116 | se mantiene |

## 7. Orden recomendado y dependencias

F0 → F1 → F2 → F3 → F4 → F5 → F7, con F6 cuando exista el backend de usuarios/SSO.
F2 y F4 ganan mucho si antes se activan en la nube los canales que hoy faltan (ciclo de vida, entitlements y crons). Si no, el Centro de la suite mostrará honestamente «canal no activo».
Cada fase cierra con vitest, e2e, capturas antes/después y la revisión del dueño, como en la V4.
